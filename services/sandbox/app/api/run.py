"""The execution endpoint."""

from __future__ import annotations

import asyncio
import logging

from fastapi import APIRouter, Header, Request, Response, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from ..config import settings
from ..runner import COMMANDS, execute
from ..security import verify
from ..workspace import SourceFile, UnsafePath, Workspace, WorkspaceTooLarge

log = logging.getLogger(__name__)
router = APIRouter(tags=["sandbox"])

# Bounds how many runs execute at once. Without it, N concurrent requests each
# take their full memory ceiling and the service is killed by the platform for
# the sum of limits it thought it was enforcing individually.
_slots: asyncio.Semaphore | None = None


def _semaphore() -> asyncio.Semaphore:
    global _slots
    if _slots is None:
        _slots = asyncio.Semaphore(settings().SANDBOX_MAX_CONCURRENT)
    return _slots


class FileIn(BaseModel):
    path: str = Field(min_length=1, max_length=400)
    content: str


class RunIn(BaseModel):
    files: list[FileIn] = Field(min_length=1)
    command: str
    args: list[str] = Field(default_factory=list, max_length=32)
    # Files the caller wants back. Absent means only the run's output.
    collect: bool = False


@router.post("/run", response_model=None)
async def run(
    request: Request,
    x_tasami_timestamp: str | None = Header(default=None),
    x_tasami_signature: str | None = Header(default=None),
) -> Response | dict:
    cfg = settings()

    raw = await request.body()
    if not verify(cfg.SANDBOX_SECRET, x_tasami_timestamp, x_tasami_signature, raw):
        return Response(status_code=status.HTTP_401_UNAUTHORIZED)

    # The verdict from startup, not the declaration itself. An operator who
    # claimed egress was blocked and was wrong does not get to execute on the
    # strength of the claim.
    if not getattr(request.app.state, "may_execute", False):
        return JSONResponse(
            {
                "error": "Execution is disabled.",
                "reason": getattr(request.app.state, "egress_reason", "unverified"),
            },
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        )

    payload = RunIn.model_validate_json(raw)

    if payload.command not in COMMANDS:
        return JSONResponse(
            {"error": "Command not permitted."}, status_code=status.HTTP_400_BAD_REQUEST
        )

    async with _semaphore():
        with Workspace() as ws:
            try:
                written = ws.write(
                    [SourceFile(path=f.path, content=f.content) for f in payload.files]
                )
            except (UnsafePath, WorkspaceTooLarge) as exc:
                # Refused before anything ran. Reported to the caller because
                # the agent that produced the path needs to see its mistake.
                log.warning("Workspace refused", extra={"reason": str(exc)})
                return JSONResponse(
                    {"error": str(exc)}, status_code=status.HTTP_400_BAD_REQUEST
                )

            result = await execute(ws, payload.command, payload.args)
            produced = ws.collect(cfg.SANDBOX_MAX_OUTPUT_BYTES) if payload.collect else {}

    return {
        "ok": result.ok,
        "exit_code": result.exit_code,
        "timed_out": result.timed_out,
        "truncated": result.truncated,
        "duration_ms": result.duration_ms,
        "stdout": result.stdout,
        "stderr": result.stderr,
        "files_written": written,
        "files": produced,
    }
