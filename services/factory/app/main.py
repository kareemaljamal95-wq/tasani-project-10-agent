"""Application entry point — the unified core.

One service, one database, one set of credentials, two intakes:

    POST /api/v1/tasks/code    technical work, built from a written brief
    POST /api/v1/tasks/data    bulk CSV/XLSX work, brief plus the files

Both are HMAC-signed with `INGEST_WEBHOOK_SECRET`, both create a row in the
same `tickets` table, and both are drained by the same worker down the same ten
roles. What differs is the `kind` stamped on the ticket: it selects each role's
briefing, and it decides whether the sandbox runs a test suite or runs a
cleaning script and then checks what it produced.

`POST /webhooks/tickets` is kept and unchanged. It predates the merger, it is
already configured in senders, and breaking it to tidy the URL space would cost
more than the duplication saves. It creates a `technical_code` ticket.

The one asymmetry worth stating: everything above is unattended, and
`POST /tickets/{id}/release` is not. Handover reaches a party outside the
company, so it stays a person's decision on both lines.
"""

from __future__ import annotations

import logging
import os

from fastapi import FastAPI

from .api import health, tasks, tickets, webhooks
from .config import settings
from .db import init_models

# Structured enough to search, plain enough to read in a hosting dashboard's
# log viewer. LOG_LEVEL is read directly because logging is configured before
# settings() can raise, and a config error must still be legible.
logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s %(levelname)-8s %(name)s %(message)s",
)
log = logging.getLogger(__name__)

# docs_url and redoc_url stay off. The schema names every endpoint, its
# payload shape and its headers — a map of the intake surface, served
# unauthenticated, on a public domain.
app = FastAPI(title="Tasami Core", version="2.0.0", docs_url=None, redoc_url=None)

app.include_router(health.router)
app.include_router(tasks.router)
app.include_router(webhooks.router)
app.include_router(tickets.router)


@app.on_event("startup")
async def startup() -> None:
    # settings() raises here rather than on the first request, so a
    # misconfigured deploy fails at boot instead of serving errors while
    # reporting itself healthy.
    cfg = settings()
    await init_models()

    # Warnings, not failures: each of these degrades the line in a defined way
    # that is visible on /health, and none of them makes it unsafe to run.
    if not cfg.has_model_provider:
        log.warning("No model provider configured — the line will hold every ticket.")
    if not cfg.sandbox_configured:
        log.warning("No sandbox configured — nothing will pass review unexecuted.")
    if not cfg.owner_gate_ready:
        log.warning("OWNER_API_KEY unset — /tickets is closed, including to you.")
    if not cfg.can_receive_payment:
        log.warning("PayPal not configured — released tickets record no receivable.")

    log.info(
        "Tasami Core ready: intake=%s, execution=%s, owner_gate=%s",
        "code+data",
        cfg.sandbox_configured,
        cfg.owner_gate_ready,
    )
