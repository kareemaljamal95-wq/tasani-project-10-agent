"""Client for the execution sandbox.

The factory never runs code in its own process. It sends files to the sandbox
service, which holds the rlimits, the throwaway workspace and the verified
egress posture, and reads back what actually happened.

That separation is the whole point: this process holds the model keys and the
database credentials, and it must never be the process that executes something
a model wrote.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
import time
from collections.abc import Mapping
from dataclasses import dataclass, field

import httpx

from .config import settings

log = logging.getLogger(__name__)


class SandboxUnavailable(RuntimeError):
    """The sandbox is not configured, unreachable, or refusing to execute."""


@dataclass
class ExecutionResult:
    ok: bool
    exit_code: int | None
    stdout: str
    stderr: str
    timed_out: bool
    duration_ms: int
    # What the run wrote, when it was asked to collect. Empty otherwise —
    # never absent, so a caller cannot mistake "not requested" for "wrote
    # nothing".
    files: dict[str, str] = field(default_factory=dict)


def _as_file(path: str, value: str | Mapping[str, str]) -> dict[str, str]:
    """Normalise a file into the wire shape.

    A plain string is source text. A mapping carries its own encoding, which is
    how a binary xlsx crosses a JSON boundary at all — utf-8 decoding it would
    corrupt it silently, and the corruption only surfaces when the customer
    opens the delivered file.
    """
    if isinstance(value, str):
        return {"path": path, "content": value, "encoding": "utf8"}

    return {
        "path": path,
        "content": value["content"],
        "encoding": value.get("encoding", "utf8"),
    }


def _sign(secret: str, timestamp: str, body: bytes) -> str:
    mac = hmac.new(secret.encode(), digestmod=hashlib.sha256)
    mac.update(timestamp.encode())
    mac.update(b".")
    mac.update(body)
    return mac.hexdigest()


async def run(
    files: Mapping[str, str | Mapping[str, str]],
    command: str,
    args: list[str],
    *,
    collect: bool = False,
) -> ExecutionResult:
    """Execute files in the sandbox and return what happened.

    Raises rather than returning a synthetic failure when the sandbox cannot be
    reached: "the tests did not pass" and "we never ran the tests" are
    different facts, and collapsing them is how unverified code gets shipped as
    verified.
    """
    cfg = settings()

    if not cfg.sandbox_configured:
        raise SandboxUnavailable(
            "SANDBOX_URL and SANDBOX_SECRET are required to execute code."
        )

    payload = json.dumps(
        {
            "files": [_as_file(p, v) for p, v in files.items()],
            "command": command,
            "args": args,
            "collect": collect,
        }
    ).encode()

    ts = str(int(time.time()))

    async with httpx.AsyncClient(timeout=httpx.Timeout(cfg.SANDBOX_TIMEOUT_SECONDS)) as client:
        try:
            r = await client.post(
                f"{cfg.SANDBOX_URL.rstrip('/')}/run",
                content=payload,
                headers={
                    "content-type": "application/json",
                    "x-tasami-timestamp": ts,
                    "x-tasami-signature": _sign(cfg.SANDBOX_SECRET, ts, payload),
                },
            )
        except httpx.HTTPError as exc:
            raise SandboxUnavailable(f"Sandbox unreachable: {exc.__class__.__name__}") from exc

    if r.status_code == 503:
        # The sandbox refusing to execute is a configuration fault worth
        # naming exactly — most often an egress policy that was declared but
        # not actually applied.
        detail = r.json().get("reason", "execution disabled")
        raise SandboxUnavailable(f"Sandbox is not executing: {detail}")

    if r.status_code >= 400:
        raise SandboxUnavailable(f"Sandbox returned HTTP {r.status_code}.")

    body = r.json()
    return ExecutionResult(
        ok=bool(body.get("ok")),
        exit_code=body.get("exit_code"),
        stdout=str(body.get("stdout", ""))[:20_000],
        stderr=str(body.get("stderr", ""))[:20_000],
        timed_out=bool(body.get("timed_out")),
        duration_ms=int(body.get("duration_ms", 0)),
        files=dict(body.get("files") or {}),
    )
