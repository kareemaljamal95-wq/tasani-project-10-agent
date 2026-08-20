# TASAMI — working notes

An AI-agent SaaS: a workforce of ten agents that find opportunities, turn them
into leads, draft outreach a human approves, and report on what happened.
Next.js 16 App Router, Prisma + PostgreSQL, TypeScript strict.

`PRODUCTION.md` is the operational reference — what is verified working, what is
genuinely not finished, and what credentials a launch needs. Read it before
concluding something is broken; several surprising behaviours are deliberate and
explained there.

## Commands

```bash
npm run dev        # development server
npm run typecheck  # tsc --noEmit
npm run build      # production build; fails on type errors
npm test           # vitest — needs DATABASE_URL on a throwaway database
npm run db:catalog # projects plans/prices/offers into the database (idempotent)
```

There is **no lint script**. The repo has no eslint config, and Next 16 removed
`next lint`. `npm run typecheck` and `npm run build` are the quality gates —
don't add a `lint` script that cannot run.

Tests need a real PostgreSQL database and truncate tables between cases, so
point `DATABASE_URL` at a scratch database, never a working one.

## Invariants

These are load-bearing. Each one exists because its absence caused a real
defect.

**The approval gate.** An agent can only ever create a `PENDING` approval.
`dispatchApproval` is the sole path to `SENT`, it requires an already-`APPROVED`
row, and no agent code can reach it. A failure must never produce a false
`SENT` — dispatch with no transport configured yields `FAILED` and 502.

**Policy is evaluated before provider availability.** A forbidden objective
returns a policy refusal even when no AI provider is configured. Reversing the
order turned a 403 into a 503 and told the caller the wrong thing.

**Every query is scoped by `userId`.** `updateMany`/`deleteMany` with
`{ id, userId }`, `findFirst` rather than `findUnique`. A guessed id must read
as not-found. This repo has had real IDOR bugs; treat it as a live risk.

**Money is integer minor units.** The client sends a plan code and an interval
and nothing else; amount and currency resolve server-side. No feature code
branches on a plan code — `src/lib/billing/entitlements.ts` is the single
authority.

**Nothing invents data.** No fabricated dashboard figures, no guessed contact
details for a real business, no fixture standing in for a live integration. A
page with no data source says so. A missing credential fails closed with 503.

**Migration history is source.** `prisma/migrations/` is committed and must stay
committed: with an empty migrations directory `prisma migrate deploy` prints
"No migration found" and exits 0, which is a green deploy against an unmigrated
database.

**An agent type needs an entry in `MICRO_BUDGET_USD`** (`src/lib/ai/policies.ts`).
Without one, `evaluatePolicy` blocks it as "Unknown agent" — provisioned, listed
in the UI, and dead on click.

## Traps

- **Prisma stays on 6.x.** Prisma 7 drops `datasource.url` from schema.prisma
  in favour of a driver adapter. Upgrading is a real task on its own branch, not
  an incidental bump.
- **`??` on an environment variable is a bug.** It falls back only on
  `null`/`undefined`, so a blank value in a hosting dashboard passes straight
  through. This took down a production build via `new URL('')`. `src/lib/env.ts`
  now drops blank values before validation; use `||` anywhere reading
  `process.env` directly.
- **`updateMany` with empty data counts 0**, which reads as not-found even when
  the row exists and is owned. Check ownership explicitly when a PATCH body may
  be empty.
- **`npm run worker` needs `tsx`, a devDependency**, so it does not exist in the
  container image (`npm ci --omit=dev`). The scheduled HTTP call is the
  production automation path.
- **Vercel Cron issues a GET** and presents `CRON_SECRET` as a bearer token; it
  cannot send `x-worker-key`. That is why `/api/automation/run` has both.

## Conventions

Comments explain *why*, especially where the code looks odd — the ordering
constraints, the atomic statements, the deliberate refusals. Don't add comments
that restate the line beneath them.

Tests assert against real database behaviour. External services are substituted
at the network boundary (`__setProvider`, `__setDiscoveryProvider`), never by
mocking the logic under test.

Derive test expectations from source data (`AGENT_DEFAULTS.length`) rather than
hardcoding counts that a legitimate change will break.
