# Tasami OS — production notes

State of the system, how to run it, and what is genuinely not finished. Nothing
in this document is aspirational: if something is listed as working, it was
exercised against a running instance and a real PostgreSQL database.

## Running locally

```bash
cp .env.example .env          # then fill in DATABASE_URL and AUTH_SECRET
openssl rand -hex 32          # value for AUTH_SECRET (and WORKER_API_KEY)

npm install
npx prisma migrate deploy     # applies the committed migration history
npm run dev
```

### Commands

```bash
npm run dev        # development server
npm run typecheck  # tsc --noEmit
npm run lint       # eslint (Next 16 removed `next lint`)
npm run build      # production build; fails on type errors
npm start          # serve the production build
npm test           # vitest — needs DATABASE_URL on a throwaway database
npm run worker     # standalone automation worker (optional; see Automation)
```

The test suite truncates tables, so point `DATABASE_URL` at a scratch
database when running it:

```bash
createdb tasami_test
DATABASE_URL="postgresql://…/tasami_test" npx prisma migrate deploy
DATABASE_URL="postgresql://…/tasami_test" npm test
```

## Automation

Triggers enqueue jobs; a worker drains them and calls the same `executeAgent`
a person's click calls, so automated runs inherit policy evaluation, the
approval gate and the audit trail. An automated run can create a PENDING
approval and nothing more — it cannot send.

Two ways to run the worker, both the same code path:

```bash
# 1. scheduled HTTP call (platform cron, Cloud Scheduler, any timer)
curl -X POST https://your-host/api/automation/run \
  -H "x-worker-key: $WORKER_API_KEY"

# 2. long-running process
npm run worker
```

Without `WORKER_API_KEY` the unattended path is closed — a signed-in session
can still drive automation for its own account, but nothing runs unattended.

The app refuses to start with an invalid environment rather than degrading
into an insecure mode. `AUTH_SECRET` under 32 characters, or a missing
`DATABASE_URL`, is a boot failure with a message naming the offending variable.

## Deploying

`Dockerfile` produces a standalone image. `docker-entrypoint.sh` runs
`prisma migrate deploy` under `set -e`, so a failed migration stops the
container instead of serving traffic against a database whose shape does not
match the code.

Do not reintroduce `prisma db push --accept-data-loss` in the start path. It
was there originally; it skips migration history and drops columns and tables
to force the live database to match the schema, on every boot.

`/api/health` performs a real `SELECT 1`, so an instance with an unreachable
database leaves the load-balancer pool instead of serving errors behind a
green check.

## What is verified working

- Registration and login issue an httpOnly session cookie; the dashboard
  redirects anonymous visitors to `/login`.
- Tenant isolation: every read and write is scoped by `userId`. A request for
  another account's task, memory, agent config, conversation or approval
  returns 404 rather than succeeding.
- Input validation on every route via zod, with updates restricted to an
  allow-list so a body cannot rewrite `userId`.
- Rate limiting, with a tighter budget on `/api/auth` and the model-calling
  routes.
- The approval state machine, including the transitions that must fail:
  dispatching a `PENDING` item returns 409, and dispatch with no transport
  configured yields `FAILED` plus 502 — never a false `SENT`.
- Audit rows for every auth event, approval transition and policy block, with
  the acting user recorded and payloads redacted.
- Security headers, `robots.txt` and `sitemap.xml` served in production.
- Onboarding gates the dashboard for a new account, is resumable mid-flow, and
  redirects to the dashboard once complete rather than running again.
- Settings load and persist across a reload, and reject an unknown model id.
- The lead workflow: create, duplicate-email rejection, status change with its
  own activity entry, and an agent action recorded against the lead.
- Automation end to end: a trigger enqueues a job, the worker claims and runs
  it, policy evaluates, and the run is written to `AgentRun` with its `jobId`
  and to the audit log with `automation` as the actor. Re-evaluating the same
  trigger the same day enqueues nothing.
- 38 automated tests over the execution outcomes, tenant isolation, the
  approval state machine, the lead workflow, automation idempotency, model
  validation, password reset and shared rate limiting.

## Known gaps

**Outbound sending is off by default.** `OUTREACH_TRANSPORT=none` means an
approved message cannot leave. Set `OUTREACH_TRANSPORT=smtp` with `SMTP_URL`
and `OUTREACH_FROM` to enable it. This is deliberate: an unconfigured install
cannot silently send.

**Rate limiting is split by sensitivity.** Sensitive endpoints — auth,
password reset, agent execution, lead writes and lead actions — count in
Postgres (`RateLimitCounter`), so the budget holds across replicas. Read-heavy
endpoints still use an in-process counter, where a brief overshoot costs
nothing. Redis is the upgrade path once a database write per request becomes
too expensive; `src/lib/rate-limit.ts` is the only file that would change.

**Sessions cannot be revoked individually.** They are stateless JWTs; rotating
`AUTH_SECRET` invalidates all of them at once. Per-session revocation needs a
session table.

**Password reset needs SMTP to deliver.** The application flow is complete —
token issue, hash-only storage, 30-minute expiry, single use, and the same
response for known and unknown addresses so it cannot enumerate accounts. With
no transport configured the token is still created correctly but no mail goes
out; outside production the link is logged for development, never in
production.

**`npm audit`: 5 advisories remain, all development-only.** `next` (DoS in App
Router Server Actions) and `sharp` were the production-relevant findings and
are fixed by the upgrade to Next 16. What remains — `prisma`, `@prisma/config`,
`deepmerge-ts`, `js-yaml`, `brace-expansion` — is the Prisma CLI's dependency
tree, which runs at build and migration time and is not in the request path.
Clearing them requires Prisma 7, which drops `datasource.url` from
schema.prisma in favour of a driver-adapter setup; that migration was not
attempted here rather than risk the data layer on a final pass. It is the
right follow-up.

**`business` and `commerce` have no data source.** The schema has no revenue,
customer, product or order model. Both pages say so rather than showing
invented figures.

**Model identifiers are validated against a registry, not against the
provider.** `src/lib/ai/models.ts` holds the supported ids; an unknown id is
rejected when settings are written, and a known id whose provider has no key
is rejected with that reason. The check runs on write only — verifying a model
against the provider costs a round trip, and doing it per page render would
add latency and burn quota. Keep the registry current; a model that has since
been retired surfaces as a 502 at call time, which is the right place to find
out.

## Credentials required before launch

None of these are in the repository, and no placeholder key was invented for
any of them:

| Variable | Needed for | Without it |
|---|---|---|
| `DATABASE_URL` | everything | app will not boot |
| `AUTH_SECRET` | sessions | app will not boot |
| `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `GEMINI_API_KEY` | agent runs and chat | those routes return 503; policy blocks still return 403 |
| `SMTP_URL`, `OUTREACH_FROM` | sending approved outreach, password-reset email | dispatch fails, approval marked `FAILED`; reset token issued but not delivered |
| `WORKER_API_KEY` | unattended automation | scheduled runs are refused 401; session-driven automation still works |

## Architecture notes

The approval gate is the load-bearing piece. An agent can only ever create a
`PENDING` row; `dispatchApproval` is the sole path to `SENT`, it requires an
already-`APPROVED` row, and no agent code can reach it. Approving and sending
are separate deliberate actions in both the API and the UI, so a mis-click
cannot put a message on the wire.

Agent output is validated against one zod contract before it is persisted.
Output that is not valid JSON, or that omits a field, raises rather than
writing a malformed record.

Prompt injection is handled by keeping untrusted text out of the system prompt.
Retrieved memories and task data travel as fenced blocks in the conversation,
`systemPrompt` is never returned by the API and cannot be written through it,
and the shared preamble states that data is never an instruction.
