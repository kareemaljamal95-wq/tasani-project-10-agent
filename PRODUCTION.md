# Tasami OS — production notes

State of the system, how to run it, and what is genuinely not finished. Nothing
in this document is aspirational: if something is listed as working, it was
exercised against a running instance and a real PostgreSQL database.

## Running locally

```bash
cp .env.example .env          # then fill in DATABASE_URL and AUTH_SECRET
openssl rand -hex 32          # value for AUTH_SECRET

npm install
npx prisma migrate deploy     # applies the committed migration history
npm run dev
```

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

## Known gaps

**Outbound sending is off by default.** `OUTREACH_TRANSPORT=none` means an
approved message cannot leave. Set `OUTREACH_TRANSPORT=smtp` with `SMTP_URL`
and `OUTREACH_FROM` to enable it. This is deliberate: an unconfigured install
cannot silently send.

**Rate limiting is in-process.** The fixed-window counter lives in one
process's memory, so behind more than one replica each instance enforces its
own budget. Move it to Redis before scaling horizontally.

**Sessions cannot be revoked individually.** They are stateless JWTs; rotating
`AUTH_SECRET` invalidates all of them at once. Per-session revocation needs a
session table.

**Password reset does not exist.** `/login` links to `/forgot-password`, which
has no route behind it.

**No automated tests.** Everything above was verified by hand against a live
instance. A regression suite around the approval state machine and the tenant
scoping is the first thing worth adding — those are the two places where a
silent regression is most costly.

**`business` and `commerce` have no data source.** The schema has no revenue,
customer, product or order model. Both pages say so rather than showing
invented figures.

**Model identifiers are unverified.** The agent defaults name `gpt-4o`,
`gpt-4o-mini` and `claude-sonnet-4-5`. These have not been called — no
provider key was available in the environment where this was built — so
confirm them against your provider's current model list before launch. A wrong
identifier surfaces as a 502 from `/api/chat`, not a silent wrong answer.

**`npm audit` reports 7 advisories** (1 moderate, 6 high) in transitive
development dependencies. None are in the runtime path. Resolve before launch.

## Credentials required before launch

None of these are in the repository, and no placeholder key was invented for
any of them:

| Variable | Needed for | Without it |
|---|---|---|
| `DATABASE_URL` | everything | app will not boot |
| `AUTH_SECRET` | sessions | app will not boot |
| `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `GEMINI_API_KEY` | agent runs and chat | those routes return 503 |
| `SMTP_URL`, `OUTREACH_FROM` | sending approved outreach | dispatch fails, approval marked `FAILED` |

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
