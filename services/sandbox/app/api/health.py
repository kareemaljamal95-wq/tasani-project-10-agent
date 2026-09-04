"""Liveness and an honest capability report."""

from __future__ import annotations

from fastapi import APIRouter, Request

from ..config import settings
from ..runner import COMMANDS
from ..workspace import dropped_env_keys

router = APIRouter(tags=["health"])


@router.get("/health")
async def health(request: Request) -> dict:
    cfg = settings()

    return {
        "status": "healthy",
        "service": "tasami-sandbox",
        "checks": {
            # False here means the service is up and deliberately refusing to
            # run anything — the distinction /health exists to make.
            # The verified verdict, not the declaration. These disagree
            # exactly when someone has claimed a posture the platform does not
            # actually provide — the case worth surfacing.
            "executes": getattr(request.app.state, "may_execute", False),
            "network_policy_declared": cfg.SANDBOX_NETWORK_POLICY or "undeclared",
            "network_verdict": getattr(request.app.state, "egress_reason", "unverified"),
            "authenticated": bool(cfg.SANDBOX_SECRET),
        },
        "limits": {
            "timeout_seconds": cfg.SANDBOX_TIMEOUT_SECONDS,
            "memory_mb": cfg.SANDBOX_MEMORY_MB,
            "cpu_seconds": cfg.SANDBOX_CPU_SECONDS,
            "max_concurrent": cfg.SANDBOX_MAX_CONCURRENT,
        },
        "commands": sorted(COMMANDS),
        # Count only. Naming them would list the service's own secret keys.
        "parent_env_withheld": len(dropped_env_keys()),
    }
