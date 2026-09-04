"""The worker that drains the queue.

Runs as its own Northflank service against the same database. It is a separate
process rather than a background task inside the web service for one reason: a
model call takes minutes, and a request handler that holds a connection open
that long is a request handler that falls over under any real load.
"""

from __future__ import annotations

import asyncio
import logging
import os
import uuid

from .agents.pipeline import LineHalted, run_line
from .config import settings
from .db import Job, JobState, Session, Ticket, TicketState, audit, claim_job, utcnow

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("worker")

POLL_SECONDS = 5


async def _run_job(job_id: int) -> None:
    async with Session() as session, session.begin():
        job = await session.get(Job, job_id)
        if not job:
            return

        ticket = await session.get(Ticket, job.ticket_id)
        if not ticket:
            job.state = JobState.SUCCEEDED  # nothing to do; not a failure
            return

        ticket.state = TicketState.BUILDING

    try:
        artifacts = await run_line(ticket)

    except LineHalted as halt:
        # A deliberate refusal. Recorded with its reason and marked SUCCEEDED:
        # the job did its work, and retrying a refusal just refuses again.
        async with Session() as session, session.begin():
            t = await session.get(Ticket, ticket.id)
            j = await session.get(Job, job_id)
            if t:
                t.state = halt.state
                t.state_reason = halt.reason
            if j:
                j.state = JobState.SUCCEEDED
            await audit(
                session,
                "line_halted",
                halt.reason,
                ticket_id=ticket.id,
                data={"state": halt.state.value},
            )
        log.info("Line halted: %s (%s)", halt.reason, halt.state.value)
        return

    except Exception as exc:  # noqa: BLE001
        # An unexpected failure retries with backoff, then parks with its error
        # visible rather than disappearing.
        async with Session() as session, session.begin():
            j = await session.get(Job, job_id)
            if j:
                exhausted = j.attempts >= j.max_attempts
                j.state = JobState.FAILED if exhausted else JobState.PENDING
                j.last_error = str(exc)[:1000]
                j.locked_at = None
                j.locked_by = None
                if not exhausted:
                    from datetime import timedelta

                    j.run_at = utcnow() + timedelta(seconds=min(2**j.attempts, 60))
        log.exception("Job failed")
        return

    async with Session() as session, session.begin():
        t = await session.get(Ticket, ticket.id)
        j = await session.get(Job, job_id)
        if t:
            t.artifacts = artifacts
            # Built, audited, tested and packaged — and stopping here. The last
            # step reaches outside the company, so it waits for the owner.
            t.state = TicketState.AWAITING_APPROVAL
            t.state_reason = None
        if j:
            j.state = JobState.SUCCEEDED
            j.locked_at = None
            j.locked_by = None
        await audit(
            session,
            "line_completed",
            "Package ready; awaiting the owner's release.",
            ticket_id=ticket.id,
            data={"roles": sorted(artifacts)},
        )

    log.info("Ticket %s ready for release", ticket.id)


async def main() -> None:
    worker = f"worker-{os.getpid()}-{uuid.uuid4().hex[:6]}"
    log.info("Worker %s started (provider=%s)", worker, settings().has_model_provider)

    while True:
        async with Session() as session, session.begin():
            job_id = await claim_job(session, worker)

        if job_id is None:
            await asyncio.sleep(POLL_SECONDS)
            continue

        await _run_job(job_id)


if __name__ == "__main__":
    asyncio.run(main())
