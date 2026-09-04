"""Application entry point."""

from __future__ import annotations

import logging

from fastapi import FastAPI

from .api import health, tickets, webhooks
from .config import settings
from .db import init_models

logging.basicConfig(level=logging.INFO)
log = logging.getLogger(__name__)

app = FastAPI(title="Tasami Factory", version="1.0.0", docs_url=None, redoc_url=None)

app.include_router(health.router)
app.include_router(webhooks.router)
app.include_router(tickets.router)


@app.on_event("startup")
async def startup() -> None:
    # settings() raises here rather than on the first request, so a
    # misconfigured deploy fails at boot instead of serving errors while
    # reporting itself healthy.
    cfg = settings()
    await init_models()

    if not cfg.has_model_provider:
        log.warning("No model provider configured — the line will hold every ticket.")
    if not cfg.can_receive_payment:
        log.warning("PayPal not configured — released tickets record no receivable.")
