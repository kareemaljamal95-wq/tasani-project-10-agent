"""Webhook authenticity.

The ingestion endpoint has no session and no cookie — the sender is a machine.
Authenticity therefore comes from a signature over the exact bytes received,
and the door fails closed: an unsigned, missigned or unconfigured request never
reaches the line.
"""

from __future__ import annotations

import hashlib
import hmac
import time

# A signature older than this is refused even if it verifies, so a captured
# request cannot be replayed indefinitely.
MAX_SKEW_SECONDS = 300


def sign(secret: str, timestamp: str, body: bytes) -> str:
    """The signature a sender must produce: HMAC-SHA256 over `timestamp.body`.

    The timestamp is inside the signed material, not beside it — otherwise an
    attacker replays a valid body with a fresh timestamp and passes.
    """
    mac = hmac.new(secret.encode(), digestmod=hashlib.sha256)
    mac.update(timestamp.encode())
    mac.update(b".")
    mac.update(body)
    return mac.hexdigest()


def verify(secret: str, timestamp: str | None, signature: str | None, body: bytes) -> bool:
    if not secret or not timestamp or not signature:
        return False

    try:
        sent_at = int(timestamp)
    except ValueError:
        return False

    if abs(time.time() - sent_at) > MAX_SKEW_SECONDS:
        return False

    # compare_digest, never ==: an early-exit comparison leaks the signature
    # one byte at a time to anyone willing to measure.
    return hmac.compare_digest(sign(secret, timestamp, body), signature)
