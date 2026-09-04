"""Liveness, and an honest readiness report.

`healthy` means the process is up and the database answers. The capability
flags are separate on purpose: a line with no model provider is running and
useless, and reporting that as healthy-with-no-detail is how a silent outage
lasts a day.
"""

from __future__ import annotations

from fastapi import APIRouter
from sqlalchemy import text

from ..config import settings
from ..db import Session

router = APIRouter(tags=["health"])


@router.get("/health")
async def health() -> dict:
    cfg = settings()

    try:
        async with Session() as session:
            await session.execute(text("SELECT 1"))
        database = True
    except Exception:  # noqa: BLE001 — the reason belongs in logs, not the body
        database = False

    return {
        "status": "healthy" if database else "degraded",
        "service": "tasami-factory",
        "checks": {
            "database": database,
            "ingest_gate": bool(cfg.INGEST_WEBHOOK_SECRET),
            "model_provider": cfg.has_model_provider,
            # Not cosmetic: the QA gate is decided by a real exit code, so
            # without this the line reaches review and holds every ticket.
            "execution": cfg.sandbox_configured,
            "payments": cfg.can_receive_payment,
            "payments_environment": cfg.PAYPAL_ENVIRONMENT,
            "delivery_webhook": cfg.can_deliver,
        },
    }
