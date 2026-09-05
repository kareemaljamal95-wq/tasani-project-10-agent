"""Reading the line, and the one action a person takes on it."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Header, HTTPException, status
from sqlalchemy import select

from ..config import settings
from ..db import Session, Ticket, TicketState, audit
from ..payments import paypal
from ..security import verify_owner

async def require_owner(
    x_tasami_owner_key: str | None = Header(default=None),
) -> None:
    """Every route here is the owner's, including the reads.

    Applied to the router rather than to `release` alone: a ticket's artifacts
    are the generated source, and `GET /tickets/{id}` would otherwise serve
    delivered work to anyone who can count. Release is the dangerous one, but
    it is not the only one worth a key.
    """
    cfg = settings()

    if not cfg.owner_gate_ready:
        # Refuses rather than opening. An unset key is a misconfiguration, and
        # the only safe reading of it is "nobody is authorised yet".
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "OWNER_API_KEY is not configured; /tickets is closed until it is.",
        )

    if not verify_owner(cfg.OWNER_API_KEY, x_tasami_owner_key):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid owner key.")


router = APIRouter(
    prefix="/tickets", tags=["tickets"], dependencies=[Depends(require_owner)]
)


@router.get("")
async def list_tickets(state: TicketState | None = None, limit: int = 50) -> dict:
    async with Session() as session:
        stmt = select(Ticket).order_by(Ticket.created_at.desc()).limit(min(limit, 200))
        if state:
            stmt = stmt.where(Ticket.state == state)
        rows = (await session.execute(stmt)).scalars().all()

    return {
        "tickets": [
            {
                "id": t.id,
                "external_id": t.external_id,
                "title": t.title,
                "state": t.state.value,
                "reason": t.state_reason,
                "price_minor": t.price_minor,
                "currency": t.currency,
                "paid": t.paid_at is not None,
            }
            for t in rows
        ]
    }


@router.get("/{ticket_id}")
async def get_ticket(ticket_id: int) -> dict:
    async with Session() as session:
        t = await session.get(Ticket, ticket_id)

    if not t:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Ticket not found.")

    return {
        "id": t.id,
        "state": t.state.value,
        "reason": t.state_reason,
        "artifacts": t.artifacts,
        "delivered_at": t.delivered_at,
        "paid_at": t.paid_at,
    }


@router.post("/{ticket_id}/release")
async def release(ticket_id: int) -> dict:
    """Hand the finished package over, and open the receivable.

    This is the one step the line does not take itself. Everything before it —
    build, audit, test, package, document — runs unattended; handover reaches a
    party outside the company, so it stays a person's decision. Removing this
    endpoint's human caller is the only change that would make the line fully
    autonomous, and it is the change that puts unreviewed code in front of a
    paying customer under the owner's name.
    """
    async with Session() as session, session.begin():
        t = await session.get(Ticket, ticket_id)

        if not t:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Ticket not found.")

        if t.state is not TicketState.AWAITING_APPROVAL:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                f"Ticket is {t.state.value}; only AWAITING_APPROVAL can be released.",
            )

        order = None
        if settings().can_receive_payment and t.price_minor > 0:
            try:
                order = await paypal.create_order(
                    ticket_id=t.id,
                    amount_minor=t.price_minor,
                    currency=t.currency,
                    description=t.title,
                )
                t.provider_order_id = order["order_id"]
            except paypal.PaymentUnavailable as exc:
                # Delivery is not blocked on billing being reachable, but the
                # gap is recorded rather than passing as a completed sale.
                await audit(
                    session,
                    "receivable_failed",
                    str(exc),
                    ticket_id=t.id,
                )

        from ..db import utcnow

        t.state = TicketState.DELIVERED
        t.delivered_at = utcnow()

        await audit(
            session,
            "ticket_released",
            "Owner released the package for handover.",
            ticket_id=t.id,
            data={"order_id": t.provider_order_id},
        )

    return {
        "released": True,
        "ticket_id": ticket_id,
        "payment": order,
    }
