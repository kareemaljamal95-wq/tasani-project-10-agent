#!/usr/bin/env python3
"""Write karmaai.online DNS records through Spaceship's API, not the cPanel UI.

Standard library only.

Why this exists: `karmaai.online` answers from `launch1/launch2.spaceship.net`,
so **Spaceship's DNS is authoritative and the cPanel zone is not**. Edits made
in cPanel for this domain change a zone nobody queries, which is what fighting
that UI feels like from the inside.

Three refusals are built in, and they are the point of it:

* It reads and **backs the whole zone up to a file** before any write. The API
  documents the save call as "add records or update TTL" without saying whether
  records you omit survive. An ambiguity that could delete your MX records —
  and with them your email — is not something to discover in production.
* `force` is never sent. That flag turns off Spaceship's own conflict checker,
  and the conflict it would suppress is usually the one worth seeing.
* Nothing is written without `--confirm`. The default prints the exact diff.

    export SPACESHIP_API_KEY=...  SPACESHIP_API_SECRET=...

    python3 spaceship_dns.py --show
    python3 spaceship_dns.py --set-cname app <target>.code.run
    python3 spaceship_dns.py --set-cname app <target>.code.run --confirm
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

API = "https://spaceship.dev/api/v1"
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)
DOMAIN = os.getenv("SPACESHIP_DOMAIN", "karmaai.online")
TIMEOUT = 30


class ApiError(RuntimeError):
    pass


def _call(method: str, path: str, body: dict | list | None = None) -> dict:
    key = os.getenv("SPACESHIP_API_KEY", "").strip()
    secret = os.getenv("SPACESHIP_API_SECRET", "").strip()

    if not key or not secret:
        raise ApiError(
            "SPACESHIP_API_KEY and SPACESHIP_API_SECRET are required. "
            "Create them in Spaceship under API Manager with the dnsrecords "
            "read and write scopes."
        )

    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        f"{API}{path}",
        data=data,
        method=method,
        headers={
            "X-Api-Key": key,
            "X-Api-Secret": secret,
            "Content-Type": "application/json",
            "Accept": "application/json",
            # Without this urllib sends "Python-urllib/3.x", which Cloudflare
            # in front of spaceship.dev rejects with error 1010 before the
            # request reaches the API at all. The failure arrives as a 403 that
            # reads exactly like a bad credential, which is the wrong thing to
            # go and check.
            "User-Agent": USER_AGENT,
        },
    )

    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            raw = resp.read()
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")[:500]
        # 401/403 named separately: the fix is a credential or a missing scope,
        # not a retry, and a generic "request failed" sends you reading logs
        # instead of reading the API Manager.
        if exc.code in (401, 403):
            raise ApiError(
                f"HTTP {exc.code} — key rejected or missing the dnsrecords scope. {detail}"
            ) from exc
        if exc.code == 429:
            raise ApiError(
                "HTTP 429 — rate limited (300 requests per domain per 300s). Wait and retry."
            ) from exc
        raise ApiError(f"HTTP {exc.code}: {detail}") from exc
    except (urllib.error.URLError, TimeoutError) as exc:
        raise ApiError(f"unreachable: {exc}") from exc


def list_records() -> list[dict]:
    """Every record in the zone, paged to the end.

    Paged rather than taking the first 500: a truncated read becomes a
    truncated backup, which is worse than no backup because it looks complete.
    """
    out: list[dict] = []
    skip = 0

    while True:
        page = _call("GET", f"/dns/records/{DOMAIN}?take=500&skip={skip}")
        items = page.get("items") or []
        out.extend(items)

        total = page.get("total")
        skip += len(items)

        if not items or (total is not None and skip >= total):
            break

    return out


def backup(records: list[dict], directory: Path) -> Path:
    directory.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    path = directory / f"{DOMAIN}-{stamp}.json"
    path.write_text(json.dumps({"domain": DOMAIN, "records": records}, indent=2))
    return path


def _label(rec: dict) -> str:
    return f"{rec.get('type', '?'):6} {rec.get('name', '?'):22} -> {_value(rec)}"


def _value(rec: dict) -> str:
    for field in ("address", "cname", "value", "exchange", "nsname", "ptrdname"):
        if rec.get(field):
            return str(rec[field])
    return json.dumps({k: v for k, v in rec.items() if k not in ("type", "name", "ttl")})


def find(records: list[dict], name: str, rtype: str) -> list[dict]:
    return [
        r
        for r in records
        if (r.get("name") or "").lower() == name.lower()
        and (r.get("type") or "").upper() == rtype.upper()
    ]


# Never removed to make room for something else. Deleting one of these breaks
# mail delivery or domain ownership, and neither failure is visible from a web
# browser — the site looks fine while the email silently stops.
PROTECTED = {"MX", "TXT", "NS", "SOA", "CAA", "SRV"}


def _conflicts(records: list[dict], name: str, rtype: str) -> list[dict]:
    """Records that must go before `name`/`rtype` can be written.

    A CNAME cannot coexist with another record of the same name, which is why
    writing one removes what is already there. That rule holds for a normal
    subdomain and is catastrophically wrong at the apex.

    This deleted a live domain's MX and SPF records. `@` is the name of the
    CNAME, and it is equally the name of the MX and the SPF TXT, so "everything
    sharing this name" swept up the mail configuration. An apex CNAME only
    exists at all through flattening, and flattening is precisely the case
    where it does coexist with MX and TXT.

    So the exclusivity rule is applied only below the apex, and never to a
    record type whose loss is invisible from a browser.
    """
    same_name = [r for r in records if (r.get("name") or "").lower() == name.lower()]

    if name == "@":
        # Apex: replace like with like and nothing else.
        return [r for r in same_name if (r.get("type") or "").upper() == rtype]

    if rtype == "CNAME":
        return [
            r
            for r in same_name
            if (r.get("type") or "").upper() not in PROTECTED
        ]

    return [r for r in same_name if (r.get("type") or "").upper() == rtype]


def apply_record(
    name: str, rtype: str, value: str, ttl: int, confirm: bool, backup_dir: Path
) -> int:
    records = list_records()
    print(f"zone has {len(records)} records")

    saved = backup(records, backup_dir)
    print(f"backup written: {saved}")

    if rtype.upper() == "CNAME":
        new = {"type": "CNAME", "name": name, "cname": value, "ttl": ttl}
    elif rtype.upper() == "TXT":
        new = {"type": "TXT", "name": name, "value": value, "ttl": ttl}
    else:
        print(f"unsupported type {rtype}", file=sys.stderr)
        return 2

    conflicts = _conflicts(records, name, rtype.upper())

    print("\n--- change ---")
    for c in conflicts:
        print(f"  REMOVE  {_label(c)}")
    print(f"  ADD     {_label(new)}")

    if not confirm:
        print("\nDry run. Nothing was written. Re-run with --confirm to apply.")
        return 0

    if conflicts:
        _call("DELETE", f"/dns/records/{DOMAIN}", conflicts)
        print(f"\nremoved {len(conflicts)} conflicting record(s)")

    # force stays false: the conflict checker is the last thing standing
    # between a typo and a zone that resolves nowhere.
    _call("PUT", f"/dns/records/{DOMAIN}", {"force": False, "items": [new]})
    print("record written")

    # Read back rather than trusting the 200. A write that reports success and
    # did not land is the failure this whole script exists to avoid.
    time.sleep(2)
    after = find(list_records(), name, rtype)

    if not after:
        print("\nWARNING: the record is not present on read-back.", file=sys.stderr)
        return 1

    for r in after:
        print(f"confirmed: {_label(r)}")

    print(
        "\nDNS is set. Propagation is minutes, but TLS will keep failing until "
        "the domain is added on the Northflank service — the certificate is "
        "issued there, not here."
    )
    return 0


def restore(path: Path, confirm: bool) -> int:
    """Put a backup back. The reason the backup is worth taking."""
    payload = json.loads(path.read_text())
    records = payload["records"]

    print(f"restoring {len(records)} records to {payload['domain']}")
    for r in records:
        print(f"  {_label(r)}")

    if not confirm:
        print("\nDry run. Re-run with --confirm to apply.")
        return 0

    _call("PUT", f"/dns/records/{payload['domain']}", {"force": False, "items": records})
    print("restored")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--show", action="store_true", help="print the current zone")
    ap.add_argument("--set-cname", nargs=2, metavar=("NAME", "TARGET"))
    ap.add_argument("--set-txt", nargs=2, metavar=("NAME", "VALUE"))
    ap.add_argument("--restore", metavar="BACKUP.json")
    ap.add_argument("--ttl", type=int, default=300,
                    help="low while cutting over, so a mistake is minutes not hours")
    ap.add_argument("--confirm", action="store_true", help="actually write")
    ap.add_argument("--backup-dir", default="./dns-backups")
    args = ap.parse_args()

    backup_dir = Path(args.backup_dir).expanduser()

    try:
        if args.show:
            for r in sorted(list_records(), key=lambda x: (x.get("type", ""), x.get("name", ""))):
                print(_label(r))
            return 0

        if args.restore:
            return restore(Path(args.restore), args.confirm)

        if args.set_cname:
            name, target = args.set_cname
            return apply_record(name, "CNAME", target, args.ttl, args.confirm, backup_dir)

        if args.set_txt:
            name, value = args.set_txt
            return apply_record(name, "TXT", value, args.ttl, args.confirm, backup_dir)

        ap.print_help()
        return 1

    except ApiError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
