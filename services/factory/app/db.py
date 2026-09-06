"""Storage and the job queue.

Postgres is the only dependency, and the queue lives in it rather than in a
broker. At this volume a second piece of infrastructure to operate costs more
than it saves, and `FOR UPDATE SKIP LOCKED` gives the one guarantee that
matters: two workers never claim the same job.
"""

from __future__ import annotations

import enum
from datetime import datetime, timezone

from sqlalchemy import (
    BigInteger,
    DateTime,
    Enum,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from .config import settings


class Base(DeclarativeBase):
    pass


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class TicketState(str, enum.Enum):
    """Where a ticket sits on the line.

    `HELD` is the state that keeps this honest: a ticket the line refuses to
    start on its own — priced above the ceiling, or missing something it cannot
    supply — waits for a person instead of being silently dropped or silently
    attempted.
    """

    RECEIVED = "RECEIVED"
    REJECTED = "REJECTED"
    HELD = "HELD"
    BUILDING = "BUILDING"
    FAILED_REVIEW = "FAILED_REVIEW"
    READY = "READY"
    AWAITING_APPROVAL = "AWAITING_APPROVAL"
    DELIVERED = "DELIVERED"


class TaskKind(str, enum.Enum):
    """What kind of work a ticket is.

    Stored on the ticket rather than inferred from the brief: the same sentence
    can describe either job, and a line that guesses will eventually run a
    Pandas prompt over a web-app ticket and call the result a delivery.
    """

    TECHNICAL_CODE = "technical_code"
    BULK_DATA_CSV = "bulk_data_csv"


class JobState(str, enum.Enum):
    PENDING = "PENDING"
    RUNNING = "RUNNING"
    SUCCEEDED = "SUCCEEDED"
    FAILED = "FAILED"


class Ticket(Base):
    __tablename__ = "tickets"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )

    # The sender's own id. Unique so a webhook delivered twice — which every
    # provider does eventually — produces one ticket, not two.
    external_id: Mapped[str] = mapped_column(String(200), unique=True, index=True)
    source: Mapped[str] = mapped_column(String(80))

    title: Mapped[str] = mapped_column(String(500))
    brief: Mapped[str] = mapped_column(Text)

    # Which line this ticket runs down. Defaulted at the column so a row
    # written before this existed reads as code work rather than as null.
    kind: Mapped[TaskKind] = mapped_column(
        # values_callable, or SQLAlchemy stores the member *names*
        # (TECHNICAL_CODE) while the API speaks values (technical_code). The
        # existing enums never noticed because their names and values match.
        Enum(TaskKind, name="task_kind", values_callable=lambda e: [m.value for m in e]),
        default=TaskKind.TECHNICAL_CODE,
        server_default=TaskKind.TECHNICAL_CODE.value,
        index=True,
    )

    # Uploaded source files for a data task, base64-encoded. Held on the ticket
    # so the run is reproducible from the row alone — re-running a ticket after
    # a sandbox outage must not depend on the sender still having the file.
    inputs: Mapped[list] = mapped_column(JSONB, default=list)

    # Integer minor units, as on the main platform. A float here becomes a
    # rounding argument with a customer.
    price_minor: Mapped[int] = mapped_column(Integer)
    currency: Mapped[str] = mapped_column(String(3))

    state: Mapped[TicketState] = mapped_column(
        Enum(TicketState, name="ticket_state"), default=TicketState.RECEIVED, index=True
    )
    state_reason: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Everything the line produced, keyed by agent role.
    artifacts: Mapped[dict] = mapped_column(JSONB, default=dict)

    delivered_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    paid_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    provider_order_id: Mapped[str | None] = mapped_column(String(120), nullable=True)


class Job(Base):
    __tablename__ = "jobs"
    __table_args__ = (UniqueConstraint("idempotency_key", name="uq_jobs_idem"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )

    ticket_id: Mapped[int] = mapped_column(ForeignKey("tickets.id", ondelete="CASCADE"))
    kind: Mapped[str] = mapped_column(String(60))

    state: Mapped[JobState] = mapped_column(
        Enum(JobState, name="job_state"), default=JobState.PENDING, index=True
    )
    run_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    max_attempts: Mapped[int] = mapped_column(Integer, default=3)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)

    locked_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    locked_by: Mapped[str | None] = mapped_column(String(80), nullable=True)

    idempotency_key: Mapped[str | None] = mapped_column(String(200), nullable=True)


class AuditEvent(Base):
    """Append-only record of everything the line decided.

    Written for the refusals as much as the successes: a ticket the line
    declined must leave evidence of why, or an operator has no way to tell a
    deliberate refusal from a silent failure.
    """

    __tablename__ = "audit_events"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, index=True
    )
    ticket_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True, index=True)
    kind: Mapped[str] = mapped_column(String(60), index=True)
    message: Mapped[str] = mapped_column(Text)
    data: Mapped[dict] = mapped_column(JSONB, default=dict)


_engine = create_async_engine(settings().DATABASE_URL, pool_pre_ping=True, echo=False)
Session = async_sessionmaker(_engine, expire_on_commit=False)


# create_all creates missing tables and nothing else — it will not add a column
# to a table that already exists, and it will not create an enum type whose
# table it skipped. A deployment that already ran would therefore accept the
# new fields in Python and fail on every insert. These statements are additive,
# idempotent, and safe to run on every boot.
_ADDITIVE: tuple[str, ...] = (
    """
    DO $$
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'task_kind') THEN
            CREATE TYPE task_kind AS ENUM ('technical_code', 'bulk_data_csv');
        END IF;
    END $$;
    """,
    "ALTER TABLE tickets ADD COLUMN IF NOT EXISTS kind task_kind "
    "NOT NULL DEFAULT 'technical_code'",
    "ALTER TABLE tickets ADD COLUMN IF NOT EXISTS inputs jsonb "
    "NOT NULL DEFAULT '[]'::jsonb",
)


async def init_models() -> None:
    async with _engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

        # After create_all, so the table is guaranteed to exist on a first boot.
        for statement in _ADDITIVE:
            await conn.execute(text(statement))


CLAIM_SQL = text(
    """
    WITH claimed AS (
        SELECT id FROM jobs
        WHERE run_at <= NOW()
          AND (state = 'PENDING'
               OR (state = 'RUNNING' AND locked_at < NOW() - INTERVAL '5 minutes'))
        ORDER BY run_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
    )
    UPDATE jobs j
    SET state = 'RUNNING', locked_at = NOW(), locked_by = :worker,
        attempts = j.attempts + 1, updated_at = NOW()
    FROM claimed
    WHERE j.id = claimed.id
    RETURNING j.id
    """
)


async def claim_job(session: AsyncSession, worker: str) -> int | None:
    """Claim one runnable job.

    SKIP LOCKED is what makes this safe from several workers at once: a row
    another transaction holds is passed over instead of blocking. The stale
    clause reclaims work from a worker that died mid-job rather than stranding
    it in RUNNING forever.
    """
    row = (await session.execute(CLAIM_SQL, {"worker": worker})).first()
    return row[0] if row else None


async def audit(
    session: AsyncSession,
    kind: str,
    message: str,
    *,
    ticket_id: int | None = None,
    data: dict | None = None,
) -> None:
    session.add(
        AuditEvent(kind=kind, message=message, ticket_id=ticket_id, data=data or {})
    )
