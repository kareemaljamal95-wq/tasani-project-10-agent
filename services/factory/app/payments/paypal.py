"""PayPal, for money coming in.

Two things this module is careful about, because both have cost real money on
this platform before:

**Receiving and paying out are different APIs.** Orders/Capture brings money
in; the Payouts API sends it out, needs a separate permission on the merchant
account, and moves funds irreversibly. This module implements receiving only.
`send_payout` exists as an explicit, disabled stub so nobody wires one up
believing it is the other.

**An order is not money.** `intent: CAPTURE` leaves an order APPROVED until the
merchant calls capture — an uncaptured order looks like a completed sale in
every dashboard and in the buyer's inbox while nothing has moved. So the
receivable is only marked paid after capture reports COMPLETED, read back from
PayPal rather than assumed.
"""

from __future__ import annotations

import logging
from typing import Any

import httpx

from ..config import settings

log = logging.getLogger(__name__)


class PaymentUnavailable(RuntimeError):
    """Credentials are missing or PayPal refused them."""


class PaymentDeclined(RuntimeError):
    """PayPal answered, and the answer was no."""


# Issue codes that mean the money was refused, as opposed to "we could not
# ask". Separating them is what keeps a customer from being told to retry a
# card that will refuse again.
DECLINE_ISSUES = (
    "INSTRUMENT_DECLINED",
    "TRANSACTION_REFUSED",
    "PAYER_CANNOT_PAY",
    "PAYER_ACCOUNT_RESTRICTED",
    "PAYER_ACCOUNT_LOCKED_OR_CLOSED",
)

_token: dict[str, Any] = {"value": None, "expires_at": 0.0}


async def _access_token(client: httpx.AsyncClient) -> str:
    import time

    cfg = settings()
    if not cfg.can_receive_payment:
        raise PaymentUnavailable(
            "PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET are required to take payment."
        )

    if _token["value"] and _token["expires_at"] > time.time() + 60:
        return _token["value"]

    r = await client.post(
        f"{cfg.paypal_base_url}/v1/oauth2/token",
        auth=(cfg.PAYPAL_CLIENT_ID, cfg.PAYPAL_CLIENT_SECRET),
        headers={"content-type": "application/x-www-form-urlencoded"},
        content="grant_type=client_credentials",
    )

    if r.status_code == 401:
        # Three causes, and the environment rules one of them out. Naming the
        # rest is the difference between reading a log line and guessing.
        hint = (
            " Check the app is a REST app (not NVP/SOAP), that the key came from"
            " the Live tab rather than Sandbox, and that it was not truncated."
            if cfg.PAYPAL_ENVIRONMENT == "production"
            else " Check the key came from the Sandbox tab rather than Live."
        )
        raise PaymentUnavailable(f"PayPal rejected the credentials (401).{hint}")

    if r.status_code >= 400:
        raise PaymentUnavailable(f"PayPal returned HTTP {r.status_code}.")

    body = r.json()
    _token["value"] = body["access_token"]
    _token["expires_at"] = time.time() + float(body.get("expires_in", 0))
    return _token["value"]


async def create_order(
    *, ticket_id: int, amount_minor: int, currency: str, description: str
) -> dict[str, str]:
    """Open an order for a delivered ticket. Returns its id and approval URL."""
    cfg = settings()

    async with httpx.AsyncClient(timeout=httpx.Timeout(30)) as client:
        token = await _access_token(client)

        r = await client.post(
            f"{cfg.paypal_base_url}/v2/checkout/orders",
            headers={
                "authorization": f"Bearer {token}",
                "content-type": "application/json",
                # PayPal deduplicates on this, which is what makes a retried
                # request return the original order rather than a second one.
                "paypal-request-id": f"ticket-{ticket_id}",
            },
            json={
                "intent": "CAPTURE",
                "purchase_units": [
                    {
                        "reference_id": str(ticket_id),
                        "description": description[:127],
                        "amount": {
                            "currency_code": currency,
                            # Minor units are the store of record; the string
                            # is built here rather than trusting a float.
                            "value": f"{amount_minor // 100}.{amount_minor % 100:02d}",
                        },
                    }
                ],
            },
        )

        if r.status_code >= 400:
            raise PaymentUnavailable(f"PayPal could not open the order ({r.status_code}).")

        body = r.json()
        approve = next(
            (l["href"] for l in body.get("links", []) if l.get("rel") == "approve"), ""
        )
        return {"order_id": body["id"], "approval_url": approve}


async def capture_order(order_id: str) -> str:
    """Take the money for an approved order. Returns the capture status."""
    cfg = settings()

    async with httpx.AsyncClient(timeout=httpx.Timeout(30)) as client:
        token = await _access_token(client)

        r = await client.post(
            f"{cfg.paypal_base_url}/v2/checkout/orders/{order_id}/capture",
            headers={
                "authorization": f"Bearer {token}",
                "content-type": "application/json",
                "paypal-request-id": f"capture-{order_id}",
            },
            json={},
        )

        if r.status_code < 400:
            return str(r.json().get("status", "UNKNOWN"))

        detail = r.text
        if r.status_code == 422 and "ORDER_ALREADY_CAPTURED" in detail:
            return "COMPLETED"

        issue = next((c for c in DECLINE_ISSUES if c in detail), None)
        log.error(
            "Capture failed", extra={"order_id": order_id, "status": r.status_code, "issue": issue}
        )

        if issue:
            raise PaymentDeclined("The payment method was declined by the provider.")

        raise PaymentUnavailable(f"PayPal could not capture the order ({r.status_code}).")


async def send_payout(*_args: Any, **_kwargs: Any) -> None:
    """Deliberately not implemented.

    Paying money *out* is a different API with a separate merchant permission
    and irreversible effects. It is left closed rather than half-built so that
    nobody calls it expecting the receiving flow, and so enabling it is a
    decision someone makes on purpose.
    """
    raise NotImplementedError(
        "Outbound payouts are not enabled. This service receives payment only; "
        "the PayPal Payouts API requires its own account permission and moves "
        "funds irreversibly."
    )
