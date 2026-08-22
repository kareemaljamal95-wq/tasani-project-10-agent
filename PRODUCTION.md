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
npm run build      # production build; fails on type errors
npm start          # serve the production build
npm test           # vitest — needs DATABASE_URL on a throwaway database
npm run worker     # standalone automation worker (optional; see Automation)
npm run db:seed    # DEVELOPMENT ONLY — refuses to run with NODE_ENV set
npm run db:catalog # projects plans/prices/offers into the database (idempotent)
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

**The scheduled HTTP call is the recommended production path.** It needs no
second deployment unit, it is bounded by `maxDuration`, and several instances
can run it safely because jobs are claimed with `FOR UPDATE SKIP LOCKED`. Do
not run both paths against the same database unless you want both — they are
safe together, just redundant.

Two things about the worker process, confirmed by running it:

- `npm run worker` executes `tsx scripts/worker.ts`, and `tsx` is a
  **devDependency**. It therefore does **not** exist in the container image,
  whose runner stage installs with `npm ci --omit=dev`. The worker is for a
  host that has development dependencies installed. To run it as the container's
  process instead, either move `tsx` into `dependencies` or compile the script
  ahead of time — do not assume `npm run worker` works inside the image.
- Use `curl -fsS` for the scheduled call, as shown. `-f` makes curl exit
  non-zero on 401/503, which is what lets a cron job or scheduler alert on a
  bad worker key or an unready instance instead of silently succeeding.

Suggested schedule: **every 5 minutes**. Each call evaluates every enabled
trigger and drains up to 25 jobs. Trigger matching is bounded by each
trigger's `cooldownHours` (default 24) and by a per-(trigger, lead, day)
idempotency key, so a shorter interval increases responsiveness without
increasing the number of actions taken.

### Configuration failure behaviour

Configuration is validated lazily, on first use. An instance missing
`AUTH_SECRET` therefore *starts* — so `/api/health` validates the environment
itself and returns 503 when it is invalid. Without that, a misconfigured
instance served a green health check while 500-ing every real request, and a
scheduled automation caller would have retried against it indefinitely. Point
your readiness probe at `/api/health` and it will keep such an instance out of
the pool.

## Business discovery

A scan searches a real directory for businesses in a market and imports them as
leads. `POST /api/discovery/scan` takes a query and a location; a trigger with
`kind: 'discovery'` runs the same path on a schedule, storing its search in
`objectiveTemplate` as `"query @ location"`.

**Nothing is invented.** Only fields the source actually published are stored.
In particular no email address is derived — Places does not publish one, and a
guessed `info@domain` would put real mail in front of a real business at an
address nobody verified. Leads arrive with a phone and website where the listing
had them, and gaps where it did not.

**Dedup does not go through email.** `Lead` is unique on `(userId, email)`, and
Postgres does not collide NULLs, so an emailless directory listing would be
re-imported by every scheduled scan. Discovered leads carry
`externalSource`/`externalId` with their own unique constraint, and a re-scan
imports zero.

Scans are metered separately from AI actions (`discovery_scans` vs `ai_actions`
in `UsageCounter`). A directory lookup is not a model call, so billing it as one
would overstate model usage on every invoice; exhausting one budget leaves the
other usable. `discovery.enabled` is off for Starter and on for Growth (50
scans) and Scale (300).

A scheduled scan is pinned to one per (trigger, day). The Vercel cron evaluates
triggers every five minutes; without that key it would drive 288 metered calls a
day to a paid external service.

Without `GOOGLE_PLACES_API_KEY` the endpoint answers 503 and writes nothing —
the same posture as a missing AI provider, and it is never charged for.

**Before launch:** confirm what the Places terms permit you to cache and for how
long. Storing a name, phone and website as a CRM lead is ordinary use, but the
retention terms are the provider's to set, not this document's.

## Billing

Pricing lives in `src/lib/billing/catalog.ts` as data. No feature code branches
on a plan code; everything resolves through `src/lib/billing/entitlements.ts`,
which is the single authority. `npm run db:catalog` projects the catalog into
the database and must run after any deploy that changes prices or limits.

**The client chooses a plan code and an interval, and nothing else.** Amount,
currency and any promotional price are resolved server-side. A request carrying
`amount=1` is not rejected — the field is simply never read. Verified at
runtime: a checkout posted with `amount=1, currency=XXX, priceId=forged` for
the Scale plan stored `39900 USD`.

**A browser return from PayPal activates nothing.** Only a signature-verified
webhook changes billing state. `/billing/return` reports the current state and
asks the customer to wait if confirmation has not arrived.

Webhook endpoint: `POST /api/billing/webhooks/paypal`. It fails closed —
without `PAYPAL_WEBHOOK_ID` every delivery is rejected. Idempotency comes from
a unique constraint on (provider, providerEventId); ordering safety from the
subscription state machine, which refuses illegal transitions rather than
applying whatever arrived last.

Metering: an **AI action** is one call to `executeAgent` that reached the
model. Policy-blocked runs are not counted — the customer is not charged for
the system refusing. The counter is incremented by one atomic statement, so
concurrent requests cannot both overshoot the limit.

Subscription states and what they grant are defined in
`src/lib/billing/entitlements.ts`. `CANCELLED` keeps access until
`currentPeriodEnd` because that period is already paid for; the automation
worker expires lapsed rows on its normal cycle.

## Deploying

### Northflank (current production)

Live at `web--web--rpsnqydlz8bs.code.run`. Build is the repository `Dockerfile`;
`vercel.json` and `railway.json` are inert here.

`NEXT_PUBLIC_APP_URL` is a **build argument**, not a runtime variable — Next
inlines `NEXT_PUBLIC_*` at build time. Changing the domain therefore needs a
rebuild, not a restart.

Secrets live in the `app-secrets` group. **Write them by reading the group
first, merging, and sending it whole.** A PATCH replaces `secrets.variables`
rather than merging into it; sending a single key once wiped five others.

Automation runs as the `automation-tick` cron job, every five minutes, calling
`/api/automation/run` with `x-worker-key`. It uses a small `curlimages/curl`
image rather than the application image — the tick is one HTTP call, so it needs
neither a build nor the app's dependencies. Two details that cost time:
`customCommand` does not go through a shell, so the command is wrapped in
`sh -c` for `$WORKER_API_KEY` to expand; and `curl -f` is deliberate, so a 401
or 503 exits non-zero and the run is recorded as failed instead of quietly
succeeding.

Backups: daily snapshot at 02:17 UTC, 10-day retention. `retentionTime` is in
days for a daily schedule (maximum 60), not seconds.

### Railway

Railway builds the `Dockerfile`, so `vercel.json` and `scripts/vercel-build.sh`
are inert there — Railway never reads them. `railway.json` declares the builder,
the `/api/health` health check and the restart policy so the deploy is
reproducible from the repository rather than from dashboard state.

Migrations run from `docker-entrypoint.sh` at **container start**, against a
live `DATABASE_URL`. That is why Railway is an easier target than Vercel: none
of the build-time migration problems below can occur.

**`NEXT_PUBLIC_APP_URL` must be set before the image is built.** Next inlines
`NEXT_PUBLIC_*` at build time, and a Dockerfile build is isolated from the host
environment, so a platform variable does not reach it unless an `ARG` opts in —
Railway documents this. The builder stage declares `ARG NEXT_PUBLIC_APP_URL`
for exactly that reason. Setting the variable at runtime is too late: the value
is already compiled in.

That creates an ordering requirement, and skipping the last step is silent:

1. Create the service from the repository. The first build has no domain yet, so
   it bakes the `http://localhost:3000` fallback.
2. Generate the public domain.
3. Set `NEXT_PUBLIC_APP_URL` to it, no trailing slash.
4. **Redeploy**, so the image is rebuilt with the real origin.

Skip step 4 and the deploy is green, `/api/health` is 200, and every canonical
tag, OpenGraph URL, `robots.txt` and `sitemap.xml` entry on the live site says
`localhost`. Verify with `curl -s https://<host>/sitemap.xml | head`.

Automation is a **second service** on the same repository, with the start
command `node scripts/trigger-automation.mjs` and a cron schedule of
`*/5 * * * *`. Railway cron is UTC, has a five-minute minimum, and skips a tick
if the previous run is still going — which is why that script performs one cycle
and exits rather than looping. It needs `WORKER_API_KEY` and
`AUTOMATION_TARGET_URL` (the web service's public URL), and exits non-zero on a
refusal so a bad key shows as a failed run instead of a quiet success.

### Vercel

`vercel.json` runs `scripts/vercel-build.sh`, which applies migrations and then
builds. That is load-bearing: `docker-entrypoint.sh` is the only other place
migrations run, and Vercel never executes it. Without it the platform serves
traffic against an unmigrated database — and because `/api/health` proves
liveness with `SELECT 1`, which succeeds on an empty database, the instance
reports healthy while every real query fails on a missing table.

Migrations therefore run **at build time**, which has three consequences the
script handles and a bare `prisma migrate deploy && next build` does not:

- **`DATABASE_URL` must be set for the build, not just the runtime.** Without it
  Prisma fails with `Validation Error Count: 1`, which names nothing. The script
  fails with the variable name and where to set it.
- **Preview deployments are skipped by default.** A preview build reads the same
  `DATABASE_URL`, so migrating from one would apply an unreviewed migration to
  production. Set `RUN_MIGRATIONS_ON_PREVIEW=1` if previews have their own
  database.
- **Migrations cannot run over a transaction pooler** (pgBouncer, Supabase
  `:6543`, a `*-pooler` Neon host). The app wants the pooled URL; migrations
  need a direct one. Set `DIRECT_DATABASE_URL` to the direct connection string
  and the script uses it for migrations only. With no pooler, leave it unset.

Automation runs from the `crons` entry in the same file, every five minutes.
Vercel Cron invokes the path with **GET** and presents `CRON_SECRET` as a bearer
token — it cannot send `x-worker-key` — so `/api/automation/run` exports a GET
handler for that door alone. The GET path takes no session fallback: a
state-changing GET that accepts a cookie is reachable from any page the operator
visits. `POST` is unchanged and still serves both the worker key and a signed-in
session.

`maxDuration` is declared in the route (`export const maxDuration = 60`), not in
`vercel.json`. A drain of 25 jobs that each make a model call does not fit the
platform default.

After the first successful deploy, run `npm run db:catalog` once against the
production database — plans, prices and the Founding Partner offer are projected
from `src/lib/billing/catalog.ts`, not from a migration.

### Blank environment variables

A variable set to an empty string in a hosting dashboard is treated as unset:
`src/lib/env.ts` drops blank values before validation. This is not tidiness. A
blank `NEXT_PUBLIC_APP_URL` in Vercel Production failed the build outright —
`new URL('')` at module scope in the root layout, reported as
`Failed to collect page data for /_not-found` — and would have broken checkout
and password reset, which build absolute URLs from the same value, while
`/api/health` returned 503 and kept the instance out of the pool. `tests/env.test.ts`
holds the guard, including the case that must *not* degrade: a blank
`AUTH_SECRET` still refuses to boot rather than defaulting to something.

The fallback is `http://localhost:3000`, so a green build proves nothing on its
own. Check `sitemap.xml` after deploying — if `<loc>` shows localhost, the
variable is still wrong.

### Docker / Cloud Run

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
- 92 automated tests over the execution outcomes, tenant isolation, the
  approval state machine, the lead workflow, automation idempotency, model
  validation, password reset, shared rate limiting, billing and entitlements,
  blank-environment handling, and discovery (dedup across re-scans, tenant
  separation, entitlement and budget refusal, and failing closed with no
  provider).

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

**`npm audit`: 5 advisories remain — `prisma`, `@prisma/config`,
`deepmerge-ts`, `js-yaml`, `brace-expansion`.** All are the Prisma **CLI**
dependency tree. Classified empirically, not by assumption: `npm ls --omit=dev`
resolves none of the five in the production dependency graph, so they load at
build and migration time and never in the request path. `next` (DoS in App
Router Server Actions) and `sharp` were the production-relevant findings and
are already fixed by the move to Next 16. Eliminating the remainder requires
Prisma 7, which drops `datasource.url` from schema.prisma in favour of a
driver-adapter setup — a schema-contract change deliberately not attempted
during an activation pass. It is the right follow-up, done on its own branch
with the suite green.

**Linting is not configured.** The repository has no eslint config; `next lint`
supplied one implicitly and Next 16 removed the command. The `lint` script was
removed rather than left as a command that cannot run. `npm run typecheck` and
`npm run build` (which fails on type errors) are the quality gates.

**`npm run db:seed` is development-only.** It creates a demo account whose
password is a literal in `prisma/seed.ts`. The script now refuses to run unless
`NODE_ENV` is development, because a documented seed command that plants a
known-password account is a backdoor anywhere else.

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
| `DIRECT_DATABASE_URL` | migrations, when `DATABASE_URL` is pooled | the build fails at `prisma migrate deploy`; unset is correct for a direct connection |
| `GOOGLE_PLACES_API_KEY` | business discovery | `/api/discovery/scan` returns 503; scheduled scans skip without failing |
| `WORKER_API_KEY` | unattended automation | scheduled runs are refused 401; session-driven automation still works |
| `CRON_SECRET` | the Vercel Cron GET into automation | the scheduled GET is refused 401; Vercel injects this automatically |

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
