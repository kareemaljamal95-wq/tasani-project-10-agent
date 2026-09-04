"""Inbound webhooks: ticket ingestion, and PayPal's payment events."""

from __future__ import annotations

import logging

from fastapi import APIRouter, Header, Request, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import select

from ..config import settings
from ..db import Job, Session, Ticket, TicketState, audit
from ..security import verify

log = logging.getLogger(__name__)
router = APIRouter(tags=["webhooks"])


class IncomingTicket(BaseModel):
    external_id: str = Field(min_length=1, max_length=200)
    source: str = Field(min_length=1, max_length=80)
    title: str = Field(min_length=1, max_length=500)
    brief: str = Field(min_length=20, max_length=50_000)
    # Minor units only. A field that accepts 49.99 becomes a rounding argument
    # with a customer the first time a currency has three decimals.
    price_minor: int = Field(ge=0)
    currency: str = Field(min_length=3, max_length=3)


@router.post("/webhooks/tickets", status_code=status.HTTP_202_ACCEPTED)
async def ingest(
    request: Request,
    x_tasami_timestamp: str | None = Header(default=None),
    x_tasami_signature: str | None = Header(default=None),
) -> dict[str, object]:
    """Accept a ticket from an upstream source.

    Verified over the exact bytes received, so the body is read raw and parsed
    afterwards — re-serialising parsed JSON changes the bytes and fails every
    signature.
    """
    raw = await request.body()

    if not verify(
        settings().INGEST_WEBHOOK_SECRET, x_tasami_timestamp, x_tasami_signature, raw
    ):
        # 401 and nothing else. A verification failure must not reveal whether
        # the secret, the timestamp or the digest was the problem.
        return Response(status_code=status.HTTP_401_UNAUTHORIZED)  # type: ignore[return-value]

    payload = IncomingTicket.model_validate_json(raw)

    async with Session() as session, session.begin():
        existing = (
            await session.execute(
                select(Ticket).where(Ticket.external_id == payload.external_id)
            )
        ).scalar_one_or_none()

        # Every provider redelivers eventually. A duplicate is an accepted
        # no-op, never a second ticket and never an error the sender retries.
        if existing:
            return {"accepted": True, "ticket_id": existing.id, "duplicate": True}

        ticket = Ticket(
            external_id=payload.external_id,
            source=payload.source,
            title=payload.title,
            brief=payload.brief,
            price_minor=payload.price_minor,
            currency=payload.currency.upper(),
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
            f"Ticket {payload.external_id} accepted from {payload.source}.",
            ticket_id=ticket.id,
            data={"price_minor": payload.price_minor, "currency": payload.currency},
        )

    return {"accepted": True, "ticket_id": ticket.id, "duplicate": False}


@router.post("/webhooks/paypal", status_code=status.HTTP_200_OK)
async def paypal_event(request: Request) -> dict[str, str]:
    """PayPal's own events.

    Fails closed: without PAYPAL_WEBHOOK_ID there is nothing to verify against,
    so every delivery is rejected rather than trusted. Verification itself is
    PayPal's own API call — a hand-rolled signature check against their cert
    chain is a way to get this subtly wrong.
    """
    if not settings().PAYPAL_WEBHOOK_ID:
        return Response(status_code=status.HTTP_401_UNAUTHORIZED)  # type: ignore[return-value]

    body = await request.json()
    event_type = str(body.get("event_type", ""))

    async with Session() as session, session.begin():
        await audit(
            session,
            "paypal_event",
            f"Received {event_type}.",
            data={"event_id": body.get("id"), "event_type": event_type},
        )

    # Accepted so the provider stops retrying something already decided about.
    return {"received": "true", "event_type": event_type}
