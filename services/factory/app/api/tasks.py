"""The unified intake: `/api/v1/tasks/code` and `/api/v1/tasks/data`.

Two endpoints, one line. They differ only in what arrives — a brief, or a brief
plus a file — and in the `kind` stamped on the ticket, which is what routes the
ten roles to their code briefing or their data briefing.

They are separate paths rather than one endpoint with a `type` field because
their payloads are genuinely different shapes, and a single schema where half
the fields are conditionally required is a schema that validates nothing. The
`type` still appears in the response, so a caller can confirm what it created.

Authentication is the same HMAC as the original ingestion webhook and the same
shared secret: the sender is a machine either way, and adding a second
credential would mean two things to rotate and one of them forgotten.
"""

from __future__ import annotations

import base64
import binascii
import logging

from fastapi import APIRouter, Header, Request, Response, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, ValidationError, field_validator
from sqlalchemy import select

from ..config import settings
from ..db import Job, Session, TaskKind, Ticket, TicketState, audit
from ..security import verify

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/tasks", tags=["tasks"])

# Base64 costs a third in transit, so this is the ceiling on the encoded body
# rather than on the file. Held deliberately below the sandbox's per-file cap:
# a file accepted here that the sandbox would refuse is a ticket that fails
# after the customer has been told it was accepted.
MAX_ENCODED_BYTES = 20_000_000


class TaskBase(BaseModel):
    external_id: str = Field(min_length=1, max_length=200)
    source: str = Field(min_length=1, max_length=80)
    title: str = Field(min_length=1, max_length=500)
    brief: str = Field(min_length=20, max_length=50_000)
    # Minor units only. A field that accepts 49.99 becomes a rounding argument
    # with a customer the first time a currency has three decimals.
    price_minor: int = Field(ge=0)
    currency: str = Field(min_length=3, max_length=3)


class CodeTaskIn(TaskBase):
    """A technical ticket: buildable from its brief alone."""


class InputFile(BaseModel):
    path: str = Field(min_length=1, max_length=200)
    # Base64 always, even for a plain CSV. One encoding for every upload means
    # no branch that can pick the wrong one, and a UTF-8 assumption that holds
    # for the first thousand files and breaks on a Windows-1256 export.
    content_b64: str = Field(min_length=1)

    @field_validator("path")
    @classmethod
    def _plain_name(cls, v: str) -> str:
        # The path is placed under `input/` inside the sandbox, which refuses
        # traversal on its own. Refused here too, because a name rejected at
        # the door produces a clear 422 instead of a run that fails obscurely.
        if "/" in v or "\\" in v or v.startswith("."):
            raise ValueError("path must be a plain file name")
        return v

    @field_validator("content_b64")
    @classmethod
    def _decodable(cls, v: str) -> str:
        if len(v) > MAX_ENCODED_BYTES:
            raise ValueError("file exceeds the maximum upload size")
        try:
            base64.b64decode(v, validate=True)
        except (binascii.Error, ValueError) as exc:
            raise ValueError("content_b64 is not valid base64") from exc
        return v


class DataTaskIn(TaskBase):
    """A bulk-data ticket: a brief plus the files it applies to."""

    files: list[InputFile] = Field(min_length=1, max_length=20)


def _parse(model: type[TaskBase], raw: bytes) -> tuple[TaskBase | None, Response | None]:
    """Validate a hand-parsed body into a 422 rather than a 500.

    FastAPI only converts a ValidationError automatically for a body it
    declared itself. These endpoints parse the raw bytes by hand — the
    signature covers exactly what arrived — so an invalid payload would
    otherwise surface as an unhandled exception and a 500, telling the sender
    the service is broken when the sender's own body is malformed.

    The detail is rebuilt field by field rather than passed through from
    `exc.errors()`, for two reasons that both bite. Pydantic echoes the
    offending value by default, and here that value can be a customer's entire
    base64-encoded file — reflected into the response and the logs. And a
    custom validator's error carries the original exception object in `ctx`,
    which is not JSON-serialisable: returning it turns a 422 into a 500.
    """
    try:
        return model.model_validate_json(raw), None
    except ValidationError as exc:
        detail = [
            {
                "field": ".".join(str(p) for p in err["loc"]),
                "error": str(err["msg"]),
                "type": str(err["type"]),
            }
            for err in exc.errors(include_url=False, include_input=False)
        ]
        return None, JSONResponse(
            {"error": "invalid payload", "detail": detail},
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        )


async def _authentic(
    request: Request, timestamp: str | None, signature: str | None
) -> bytes | None:
    """Return the raw body when the signature holds, else None.

    Verified over the exact bytes received, so the body is read raw and parsed
    afterwards — re-serialising parsed JSON changes the bytes and fails every
    signature.
    """
    raw = await request.body()

    if not verify(settings().INGEST_WEBHOOK_SECRET, timestamp, signature, raw):
        return None

    return raw


async def _accept(payload: TaskBase, kind: TaskKind, inputs: list[dict]) -> dict:
    """Create the ticket and queue its run. Shared by both endpoints."""
    async with Session() as session, session.begin():
        existing = (
            await session.execute(
                select(Ticket).where(Ticket.external_id == payload.external_id)
            )
        ).scalar_one_or_none()

        # Every provider redelivers eventually. A duplicate is an accepted
        # no-op, never a second ticket and never an error the sender retries.
        if existing:
            return {
                "accepted": True,
                "ticket_id": existing.id,
                "type": existing.kind.value,
                "duplicate": True,
            }

        ticket = Ticket(
            external_id=payload.external_id,
            source=payload.source,
            title=payload.title,
            brief=payload.brief,
            price_minor=payload.price_minor,
            currency=payload.currency.upper(),
            kind=kind,
            inputs=inputs,
            state=TicketState.RECEIVED,
        )
        session.add(ticket)
        await session.flush()

        session.add(
            Job(
                ticket_id=ticket.id,
                kind="run_line",
                idempotency_key=f"line:{ticket.id}",
            )
        )
        await audit(
            session,
            "ticket_received",
            f"{kind.value} ticket {payload.external_id} accepted from {payload.source}.",
            ticket_id=ticket.id,
            data={
                "price_minor": payload.price_minor,
                "currency": payload.currency,
                "kind": kind.value,
                # Names and sizes, never contents. The audit log is read by
                # people and shipped to log aggregators; an uploaded customer
                # file does not belong in either.
                "inputs": [{"path": f["path"], "bytes": f["bytes"]} for f in inputs],
            },
        )

    return {
        "accepted": True,
        "ticket_id": ticket.id,
        "type": kind.value,
        "duplicate": False,
    }


@router.post("/code", status_code=status.HTTP_202_ACCEPTED, response_model=None)
async def submit_code_task(
    request: Request,
    x_tasami_timestamp: str | None = Header(default=None),
    x_tasami_signature: str | None = Header(default=None),
) -> dict | Response:
    raw = await _authentic(request, x_tasami_timestamp, x_tasami_signature)
    if raw is None:
        # 401 and nothing else. A verification failure must not reveal whether
        # the secret, the timestamp or the digest was the problem.
        return Response(status_code=status.HTTP_401_UNAUTHORIZED)

    payload, invalid = _parse(CodeTaskIn, raw)
    if invalid is not None:
        return invalid

    return await _accept(payload, TaskKind.TECHNICAL_CODE, [])


@router.post("/data", status_code=status.HTTP_202_ACCEPTED, response_model=None)
async def submit_data_task(
    request: Request,
    x_tasami_timestamp: str | None = Header(default=None),
    x_tasami_signature: str | None = Header(default=None),
) -> dict | Response:
    raw = await _authentic(request, x_tasami_timestamp, x_tasami_signature)
    if raw is None:
        return Response(status_code=status.HTTP_401_UNAUTHORIZED)

    payload, invalid = _parse(DataTaskIn, raw)
    if invalid is not None:
        return invalid

    inputs = [
        {
            "path": f.path,
            "content_b64": f.content_b64,
            "bytes": len(base64.b64decode(f.content_b64)),
        }
        for f in payload.files
    ]

    return await _accept(payload, TaskKind.BULK_DATA_CSV, inputs)
