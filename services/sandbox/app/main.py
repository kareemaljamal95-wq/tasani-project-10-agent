"""Sandbox entry point."""

from __future__ import annotations

import logging

from fastapi import FastAPI

from .api import health, run
from . import egress
from .config import settings

logging.basicConfig(level=logging.INFO)
log = logging.getLogger(__name__)

app = FastAPI(title="Tasami Sandbox", version="1.0.0", docs_url=None, redoc_url=None)
app.include_router(health.router)
app.include_router(run.router)


@app.on_event("startup")
async def startup() -> None:
    cfg = settings()

    # Verified once at boot rather than per request: the answer cannot change
    # without the platform changing under a running container, and probing on
    # every run would add a network round trip to work that must not need one.
    ok, reason = egress.verify(cfg.SANDBOX_NETWORK_POLICY)
    app.state.may_execute = ok
    app.state.egress_reason = reason

    if ok:
        log.info("Sandbox ready — %s", reason)
    else:
        log.warning("Execution disabled — %s", reason)
