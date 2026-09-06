#!/usr/bin/env python3
"""Find fixed-price micro-tasks on public feeds and submit them to Tasami Core.

Runs as a cron job. Standard library only — no pip install on the host, which
is the difference between a cron job that survives a rebuild and one that
silently stops.

    */30 * * * * /usr/bin/python3 /opt/tasami/scraper.py --submit >> /var/log/tasami-scraper.log 2>&1

Three things about this script are deliberate and worth reading before changing
them.

**It does not submit unless told to.** Every submission starts ten model roles
on a paid API. A loop that mistakes a filter for a match spends real money on
work nobody ordered, and it does it at cron speed while nobody is watching.
`--submit` is required; the default prints what it would have sent.

**Scraped text is hostile input.** A listing's description is written by a
stranger and ends up inside a model prompt. The pipeline fences it as data, but
the fence is not a reason to feed it anything: descriptions are length-capped,
control characters are stripped, and the tag-shaped junk that would close the
fence early is removed here rather than trusted to survive downstream.

**A data task cannot come from a feed.** `/api/v1/tasks/data` requires the
file, and a job advert never carries one — the file comes from the client after
they hire you. Listings that read as data work are therefore reported for you
to pursue, never auto-submitted. Submitting them to `/code` instead would run
the wrong ten briefings against a job that has no code in it.
"""

from __future__ import annotations

import argparse
import hashlib
import hmac
import json
import logging
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from pathlib import Path

log = logging.getLogger("scraper")

USER_AGENT = "TasamiBot/1.0 (+https://tasami.com; contact: owner)"
TIMEOUT = 30

# Both feeds are published for machine consumption. They are polled at cron
# pace with a real user agent, and nothing here logs in, renders a page, or
# reads anything the site does not hand out freely.
FREELANCER_API = "https://www.freelancer.com/api/projects/0.1/projects/active/"
REDDIT_FORHIRE = "https://www.reddit.com/r/forhire/new.rss"

# Your four, plus the phrasings that mean the same thing. Deliberately narrow.
# Broader terms were measured against the live feed and cost more than they
# returned: "web scraping" matched a manual OSINT research job through a skill
# tag, and would have spent ten model calls discovering it was not a script.
# Widen with --keywords when you want to see what a looser net catches; the
# `review` bucket exists so you can widen it without paying for the mistakes.
DEFAULT_KEYWORDS = (
    "python script",
    "python automation",
    "bug fix",
    "fix bug",
    "excel cleanup",
    "clean excel",
    "excel macro",
    "csv data",
    "clean csv",
)

# Work the line cannot do unattended, however well it matches a keyword. Cheaper
# to drop here than to spend ten model calls discovering it at Intake.
EXCLUDE = (
    "long term",
    "full time",
    "full-time",
    "ongoing basis",
    "interview",
    "meeting",
    "zoom call",
    "must be available",
    "hourly",
    "per hour",
    "tutor",
    "mentor",
    "training session",
)

# Currencies whose minor unit is not 1/100. Getting this wrong misreports a
# price by two orders of magnitude, and the auto-accept ceiling is measured in
# minor units — a ¥50,000 job read as 5,000,000 is held for no reason, and the
# reverse is worse.
ZERO_DECIMAL = {"JPY", "KRW", "VND", "CLP", "ISK", "PYG", "UGX", "RWF", "XAF", "XOF"}
THREE_DECIMAL = {"BHD", "KWD", "OMR", "JOD", "TND", "IQD", "LYD"}


@dataclass
class Listing:
    """One posting, normalised across sources."""

    source: str
    external_id: str
    title: str
    description: str
    url: str
    posted_at: int
    # None means the source does not publish a price. Distinct from 0, which
    # would be a real posting offering nothing.
    price_minor: int | None = None
    currency: str = "USD"
    fixed_price: bool | None = None
    skills: list[str] = field(default_factory=list)
    urgent: bool = False


# ─── fetching ────────────────────────────────────────────────────────────────


def _get(url: str, params: dict | None = None) -> bytes:
    if params:
        url = f"{url}?{urllib.parse.urlencode(params, doseq=True)}"

    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})

    # Three attempts with a widening gap. A feed that is briefly rate-limited
    # is the normal case on a schedule; giving up on the first 429 means the
    # run silently returns nothing and looks like "no matches today".
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
                return resp.read()
        except (urllib.error.URLError, TimeoutError) as exc:
            if attempt == 2:
                raise
            wait = 2 ** (attempt + 1)
            log.warning("fetch failed (%s), retrying in %ss: %s", url, wait, exc)
            time.sleep(wait)

    raise RuntimeError("unreachable")


def _minor(amount: float, currency: str) -> int:
    if currency in ZERO_DECIMAL:
        return int(round(amount))
    if currency in THREE_DECIMAL:
        return int(round(amount * 1000))
    return int(round(amount * 100))


def fetch_freelancer(keywords: tuple[str, ...], limit: int) -> list[Listing]:
    """The structured source, and the only one that publishes a price.

    Queried once per keyword rather than once overall: the API matches a single
    query string, and one combined query returns postings matching none of the
    terms well.
    """
    seen: dict[str, Listing] = {}

    for keyword in keywords:
        try:
            raw = _get(
                FREELANCER_API,
                {
                    "query": keyword,
                    "limit": limit,
                    "job_details": "true",
                    "full_description": "true",
                    "project_types[]": "fixed",
                },
            )
        except Exception as exc:  # noqa: BLE001 — one bad keyword must not end the run
            log.error("freelancer query %r failed: %s", keyword, exc)
            continue

        try:
            projects = json.loads(raw)["result"]["projects"]
        except (json.JSONDecodeError, KeyError, TypeError) as exc:
            log.error("freelancer returned an unreadable body for %r: %s", keyword, exc)
            continue

        for p in projects:
            pid = str(p.get("id") or "")
            if not pid or pid in seen:
                continue

            budget = p.get("budget") or {}
            currency = ((p.get("currency") or {}).get("code") or "USD").upper()[:3]
            minimum = budget.get("minimum")

            seen[pid] = Listing(
                source="freelancer.com",
                external_id=f"freelancer:{pid}",
                title=str(p.get("title") or "")[:500],
                description=str(p.get("description") or ""),
                url=f"https://www.freelancer.com/projects/{p.get('seo_url', '')}",
                posted_at=int(p.get("time_submitted") or 0),
                price_minor=_minor(float(minimum), currency) if minimum else None,
                currency=currency,
                fixed_price=(p.get("type") == "fixed"),
                skills=[j.get("name", "") for j in (p.get("jobs") or [])],
                urgent=bool((p.get("upgrades") or {}).get("urgent")),
            )

        # Polite spacing between queries. The API does not ask for it; hammering
        # a free endpoint from a cron job is how free endpoints stop being free.
        time.sleep(1)

    return list(seen.values())


def fetch_reddit_forhire() -> list[Listing]:
    """A second source, deliberately price-blind.

    r/forhire posts carry no structured budget, so nothing from here can pass
    the fixed-price filter. It is included because the postings are real work
    worth seeing — they arrive as candidates for you, never as submissions.
    """
    try:
        raw = _get(REDDIT_FORHIRE)
    except Exception as exc:  # noqa: BLE001
        log.error("reddit fetch failed: %s", exc)
        return []

    try:
        root = ET.fromstring(raw)
    except ET.ParseError as exc:
        log.error("reddit returned unparseable XML: %s", exc)
        return []

    ns = {"a": "http://www.w3.org/2005/Atom"}
    out: list[Listing] = []

    for entry in root.findall("a:entry", ns):
        title = (entry.findtext("a:title", default="", namespaces=ns) or "").strip()
        # [Hiring] only. [For Hire] posts are freelancers advertising themselves,
        # which is the opposite of a task and would otherwise match every keyword.
        if not title.lower().startswith("[hiring"):
            continue

        entry_id = entry.findtext("a:id", default="", namespaces=ns) or ""
        link_el = entry.find("a:link", ns)
        updated = entry.findtext("a:updated", default="", namespaces=ns) or ""

        out.append(
            Listing(
                source="reddit/r/forhire",
                external_id=f"reddit:{entry_id.rsplit('/', 1)[-1]}",
                title=title[:500],
                description=_strip_html(
                    entry.findtext("a:content", default="", namespaces=ns) or ""
                ),
                url=(link_el.get("href") if link_el is not None else ""),
                posted_at=_iso_to_epoch(updated),
                price_minor=None,
                fixed_price=None,
            )
        )

    return out


def _iso_to_epoch(value: str) -> int:
    try:
        # Python 3.11+ parses the trailing Z; older versions need it swapped.
        return int(time.mktime(time.strptime(value[:19], "%Y-%m-%dT%H:%M:%S")))
    except (ValueError, OverflowError):
        return 0


def _strip_html(text: str) -> str:
    text = re.sub(r"<[^>]+>", " ", text)
    text = (
        text.replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&amp;", "&")
        .replace("&quot;", '"')
        .replace("&#39;", "'")
        .replace("&nbsp;", " ")
    )
    return re.sub(r"\s+", " ", text).strip()


# ─── filtering ───────────────────────────────────────────────────────────────

DATA_MARKERS = (
    "csv",
    "excel",
    "xlsx",
    "spreadsheet",
    "data entry",
    "data clean",
    "deduplicate",
    "duplicate rows",
    "google sheet",
)


def classify(listing: Listing) -> str:
    """"code", "data", or "" for no match."""
    haystack = f"{listing.title} {listing.description} {' '.join(listing.skills)}".lower()

    if any(marker in haystack for marker in DATA_MARKERS):
        return "data"
    return "code"


def matches(
    listing: Listing,
    keywords: tuple[str, ...],
    max_age_hours: int,
    min_minor: int,
    max_minor: int,
) -> tuple[str, str]:
    """Return (verdict, reason), verdict in {"submit", "review", "skip"}.

    The reason is logged either way. A rejection that does not say why turns
    tuning the filter into guesswork, and this filter is the part of the script
    that decides what gets paid for.

    The keyword must appear in the **title or the tagged skills**. Matching
    anywhere in the description was measured against the live feed and both
    results were wrong in the same way: "bug fix" was a 30-day warranty clause
    on a full website build, and "web scraping" sat in a keyword-stuffed tail
    on a manual research job. A posting that is really a Python script says so
    where it names itself. A description-only hit is downgraded to review
    rather than dropped — it is weak evidence, not no evidence.
    """
    strong = f"{listing.title} {' '.join(listing.skills)}".lower()
    body = listing.description.lower()

    if not any(k in strong for k in keywords):
        if any(k in body for k in keywords):
            return "review", "keyword only in the description body"
        return "skip", "no keyword match"

    hit = next((x for x in EXCLUDE if x in f"{strong} {body}"), None)
    if hit:
        return "skip", f"excluded term: {hit!r}"

    if listing.fixed_price is not True:
        return "skip", "not a fixed-price posting"

    if listing.price_minor is None:
        return "skip", "no published price"

    if listing.price_minor < min_minor:
        return "skip", f"below floor ({listing.price_minor} {listing.currency})"

    if listing.price_minor > max_minor:
        return "skip", f"above ceiling ({listing.price_minor} {listing.currency})"

    if max_age_hours and listing.posted_at:
        age_h = (time.time() - listing.posted_at) / 3600
        if age_h > max_age_hours:
            return "skip", f"stale ({age_h:.0f}h old)"

    # Brief length is checked here because the server enforces a 20-character
    # minimum. Catching it now costs nothing; catching it there costs a signed
    # round trip and produces a 422 that reads like a bug.
    if len(listing.description.strip()) < 20:
        return "skip", "description too short to brief an agent"

    return "submit", "accepted"


# ─── submitting ──────────────────────────────────────────────────────────────

MAX_BRIEF = 8_000
# Trimmed to the tag shapes the pipeline uses to fence untrusted text. Stripping
# them here means a description cannot close the fence early and have the rest
# of itself read as instructions.
FENCE = re.compile(r"</?(ticket|upstream_artifacts|input_sample)>", re.IGNORECASE)


def clean_brief(listing: Listing) -> str:
    text = FENCE.sub(" ", listing.description)
    # Control characters, keeping tab and newline. A stray NUL or escape
    # sequence travels through JSON intact and reappears in a log viewer.
    text = "".join(c for c in text if c in "\t\n" or ord(c) >= 32)
    text = re.sub(r"\n{3,}", "\n\n", text).strip()

    if len(text) > MAX_BRIEF:
        text = text[:MAX_BRIEF] + "\n\n[truncated by the collector]"

    # The provenance line is appended, never prepended: the first thing a role
    # reads should be the work, and a URL at the top invites a model to treat
    # fetching it as part of the task.
    return f"{text}\n\n---\nSource: {listing.source} — {listing.url}"


def build_payload(listing: Listing) -> dict:
    return {
        "external_id": listing.external_id,
        "source": listing.source[:80],
        "title": listing.title[:500] or "Untitled posting",
        "brief": clean_brief(listing),
        "price_minor": listing.price_minor or 0,
        "currency": listing.currency,
    }


def sign(secret: str, timestamp: str, body: bytes) -> str:
    """HMAC-SHA256 over `timestamp.body`, matching the server byte for byte.

    The timestamp is inside the signed material, not beside it — otherwise a
    captured body replays with a fresh timestamp and verifies.
    """
    mac = hmac.new(secret.encode(), digestmod=hashlib.sha256)
    mac.update(timestamp.encode())
    mac.update(b".")
    mac.update(body)
    return mac.hexdigest()


def submit(base_url: str, secret: str, payload: dict) -> tuple[bool, str]:
    """POST one ticket. Returns (accepted, detail)."""
    # Serialised once and signed over these exact bytes. Re-encoding anywhere
    # between here and the socket changes them and fails every signature.
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    ts = str(int(time.time()))

    req = urllib.request.Request(
        f"{base_url.rstrip('/')}/api/v1/tasks/code",
        data=body,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "User-Agent": USER_AGENT,
            "x-tasami-timestamp": ts,
            "x-tasami-signature": sign(secret, ts, body),
        },
    )

    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            data = json.loads(resp.read() or b"{}")
            return True, f"ticket {data.get('ticket_id')} (duplicate={data.get('duplicate')})"
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")[:300]
        # 401 is the one worth naming: it means the secret or the clock is
        # wrong, and every subsequent submission this run will fail the same
        # way rather than being a problem with the individual listing.
        if exc.code == 401:
            return False, "401 — signature rejected (check the secret and the host clock)"
        return False, f"HTTP {exc.code}: {detail}"
    except (urllib.error.URLError, TimeoutError) as exc:
        return False, f"unreachable: {exc}"


# ─── state ───────────────────────────────────────────────────────────────────


def load_seen(path: Path) -> set[str]:
    try:
        return set(json.loads(path.read_text())["seen"])
    except (OSError, json.JSONDecodeError, KeyError, TypeError):
        # A missing or corrupt state file must not stop the run. The server
        # deduplicates on external_id anyway; this only saves wasted requests.
        return set()


def save_seen(path: Path, seen: set[str], keep: int = 5_000) -> None:
    trimmed = sorted(seen)[-keep:]
    tmp = path.with_suffix(".tmp")
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp.write_text(json.dumps({"seen": trimmed}))
        tmp.replace(path)  # atomic, so a crash mid-write cannot corrupt it
    except OSError as exc:
        log.error("could not persist state to %s: %s", path, exc)


# ─── main ────────────────────────────────────────────────────────────────────


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument(
        "--submit",
        action="store_true",
        help="actually POST. Without it, matches are printed and nothing is sent.",
    )
    ap.add_argument("--max-submissions", type=int, default=5,
                    help="hard cap per run (default 5). Every submission costs model calls.")
    ap.add_argument("--keywords", default=os.getenv("SCRAPER_KEYWORDS", ""),
                    help="comma-separated; overrides the defaults")
    ap.add_argument("--max-age-hours", type=int,
                    default=int(os.getenv("SCRAPER_MAX_AGE_HOURS", "24")))
    ap.add_argument("--min-price-minor", type=int,
                    default=int(os.getenv("SCRAPER_MIN_PRICE_MINOR", "3000")))
    ap.add_argument("--max-price-minor", type=int,
                    default=int(os.getenv("SCRAPER_MAX_PRICE_MINOR", "50000")))
    ap.add_argument("--limit", type=int, default=20, help="results per keyword query")
    ap.add_argument("--state", default=os.getenv("SCRAPER_STATE", "~/.tasami-scraper.json"))
    ap.add_argument("--verbose", action="store_true", help="log every rejection and why")
    args = ap.parse_args()

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)-7s %(message)s",
    )

    base_url = os.getenv("TASAMI_URL", "").strip()
    secret = os.getenv("INGEST_WEBHOOK_SECRET", "").strip()

    if args.submit and not (base_url and secret):
        log.error("TASAMI_URL and INGEST_WEBHOOK_SECRET are required with --submit.")
        return 2

    keywords = tuple(
        k.strip().lower() for k in args.keywords.split(",") if k.strip()
    ) or DEFAULT_KEYWORDS

    state_path = Path(args.state).expanduser()
    seen = load_seen(state_path)

    listings = fetch_freelancer(keywords, args.limit) + fetch_reddit_forhire()
    log.info("fetched %d listings across both sources", len(listings))

    submitted = 0
    data_candidates: list[Listing] = []
    review: list[tuple[Listing, str]] = []
    rejected = 0

    for listing in listings:
        if listing.external_id in seen:
            continue

        verdict, reason = matches(
            listing, keywords, args.max_age_hours,
            args.min_price_minor, args.max_price_minor,
        )
        if verdict == "skip":
            rejected += 1
            log.debug("skip %-28s %s | %s", listing.external_id, reason, listing.title[:60])
            continue

        if verdict == "review":
            # Never auto-submitted, and never marked seen: if the filter is
            # later tightened or loosened, these get reconsidered.
            review.append((listing, reason))
            continue

        if classify(listing) == "data":
            # Held rather than submitted. /api/v1/tasks/data needs the file,
            # and a job advert never carries one — it arrives from the client
            # after they hire you.
            data_candidates.append(listing)
            seen.add(listing.external_id)
            continue

        payload = build_payload(listing)

        if not args.submit:
            log.info(
                "WOULD SUBMIT %s | %s %s | %s",
                listing.external_id, payload["price_minor"], payload["currency"],
                payload["title"][:70],
            )
            continue

        if submitted >= args.max_submissions:
            log.info("submission cap of %d reached; %s and the rest wait for the next run",
                     args.max_submissions, listing.external_id)
            break

        accepted, detail = submit(base_url, secret, payload)
        if accepted:
            submitted += 1
            seen.add(listing.external_id)
            log.info("submitted %s -> %s", listing.external_id, detail)
        else:
            log.error("rejected %s -> %s", listing.external_id, detail)
            if detail.startswith("401"):
                # Every remaining submission fails identically. Stopping is the
                # honest response; continuing produces a wall of noise.
                break

    if data_candidates:
        log.info("%d data-work listings need the client's file before they can be "
                 "submitted to /api/v1/tasks/data:", len(data_candidates))
        for c in data_candidates:
            log.info("   %s %s — %s", c.currency, c.price_minor, c.url)

    if review:
        log.info("%d weak matches for you to judge (not submitted):", len(review))
        for listing, reason in review[:15]:
            log.info("   %s — %s | %s", reason, listing.title[:60], listing.url)

    save_seen(state_path, seen)
    log.info(
        "done: %d submitted, %d data candidates, %d for review, %d filtered out",
        submitted, len(data_candidates), len(review), rejected,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
