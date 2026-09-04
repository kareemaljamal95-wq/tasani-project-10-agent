"""Checking that the declared network posture is the real one.

`SANDBOX_NETWORK_POLICY=blocked-at-platform` is a claim by whoever set the
variable. This verifies it, because a claim that is wrong is worse than no
claim: the service would execute model-written code believing egress is closed
while it is wide open — which is exactly what the first test run of this
service found.

The probe is deliberately crude. It does not try to characterise the network;
it asks one question — can this process open a TCP connection to somewhere on
the internet — and a yes contradicts the declaration.
"""

from __future__ import annotations

import logging
import socket

log = logging.getLogger(__name__)

# The ports code actually leaves on. An earlier version of this probe tested
# 53 only, reported "egress verified closed", and was wrong: the environment
# blocked DNS while passing 80 and 443 straight through. A probe that clears a
# network it never tested is worse than no probe, so the list covers HTTP and
# HTTPS first and DNS last.
PROBES: tuple[tuple[str, int], ...] = (
    ("1.1.1.1", 443),
    ("1.1.1.1", 80),
    ("8.8.8.8", 443),
    ("8.8.8.8", 53),
)
TIMEOUT = 2.0


def egress_reachable() -> bool:
    for host, port in PROBES:
        try:
            with socket.create_connection((host, port), timeout=TIMEOUT):
                return True
        except OSError:
            continue
    return False


def verify(policy: str) -> tuple[bool, str]:
    """Return whether execution may proceed, and why.

    A declaration of `allowed` is taken at face value — the operator has said
    egress is open and accepted that. A declaration of `blocked-at-platform` is
    tested, and a reachable network fails it closed.
    """
    if policy == "allowed":
        return True, "egress declared open by the operator"

    if policy != "blocked-at-platform":
        return False, "SANDBOX_NETWORK_POLICY is undeclared"

    if egress_reachable():
        log.error(
            "Egress reachable while policy claims it is blocked — refusing to execute."
        )
        return False, (
            "policy claims egress is blocked at the platform, but this process "
            "reached the internet; add a Northflank network policy denying "
            "egress from this service, or set SANDBOX_NETWORK_POLICY=allowed "
            "to accept an open network deliberately"
        )

    return True, "egress verified closed"
