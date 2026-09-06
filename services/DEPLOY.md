# Deploying the production line on Northflank

Three services in project `tasami`, all built from this one repository. Each
has its own build context, so they deploy independently and a failing sandbox
build cannot take the web app with it.

| Service | Build context | Start command | Public |
|---|---|---|---|
| `factory-web` | `services/factory` | `uvicorn app.main:app --host 0.0.0.0 --port $PORT` | yes |
| `factory-worker` | `services/factory` | `python -m app.worker` | no |
| `sandbox` | `services/sandbox` | `uvicorn app.main:app --host 0.0.0.0 --port $PORT` | **no** |

`sandbox` must have **no public domain**. It is reached over the internal
network by `factory-worker` only, and a sandbox with a public URL is an
open remote-code-execution endpoint guarded by one shared secret.

---

## Secret groups

Two groups, so the sandbox never inherits the model keys. That separation is
the design: the process holding the API keys is not the process running
model-written code, and no misconfiguration can merge them.

### `factory-secrets` → linked to `factory-web` and `factory-worker`

| Variable | Value | Required |
|---|---|---|
| `DATABASE_URL` | `postgresql+asyncpg://…` from the Northflank addon | yes |
| `INGEST_WEBHOOK_SECRET` | `openssl rand -hex 32` | yes |
| `OWNER_API_KEY` | `openssl rand -hex 32` | yes — `/tickets` is closed without it |
| `SANDBOX_URL` | `http://sandbox:8080` (internal DNS) | for execution |
| `SANDBOX_SECRET` | same value as the sandbox group | for execution |
| `OPENAI_API_KEY` | `sk-…` | one of the two |
| `ANTHROPIC_API_KEY` | `sk-ant-…` | one of the two |
| `PAYPAL_CLIENT_ID` | from the Live REST app | to invoice |
| `PAYPAL_CLIENT_SECRET` | from the **same** app | to invoice |
| `PAYPAL_ENVIRONMENT` | `production` | |
| `PAYPAL_WEBHOOK_ID` | from a webhook on the **same** app | |
| `AUTO_ACCEPT_CEILING_MINOR` | e.g. `50000` — above this a ticket waits for you | |
| `DELIVERY_WEBHOOK_URL` | where a released package is announced | optional |

### `sandbox-secrets` → linked to `sandbox` only

| Variable | Value |
|---|---|
| `SANDBOX_SECRET` | same value as in `factory-secrets` |
| `SANDBOX_NETWORK_POLICY` | `blocked-at-platform` |
| `SANDBOX_TIMEOUT_SECONDS` | `120` |
| `SANDBOX_MEMORY_MB` | `1024` |
| `SANDBOX_CPU_SECONDS` | `90` |
| `SANDBOX_MAX_CONCURRENT` | `2` |

The sandbox container needs **at least `SANDBOX_MEMORY_MB × SANDBOX_MAX_CONCURRENT`**
of RAM — 2 GB at these values. Each run may take its full ceiling, and the
platform kills the service for the sum, not the individual limit.

**No model keys here, and no `DATABASE_URL`.** The sandbox needs neither, and
anything present in its environment is one `os.environ` read away from
model-written code — the environment is scrubbed before a run precisely
because that assumption should never be load-bearing.

---

## Two traps this deployment has already hit

**A variable defined on the service beats the same key inherited from a secret
group, silently.** Editing the group then changes nothing for that key, and
nothing in the running app can tell — the value is present, it is simply the
old one. Northflank strikes the shadowed row through on the service's
Environment tab and that greyed row is the only evidence. Check it before
concluding an edit did not apply. Environment is read once at boot, so a
restart is required either way; a restart alone will not fix a shadowed key.

**PayPal keys, and the webhook id, must come from the same app.** Verification
calls PayPal with the credentials *and* the webhook id, so an id belonging to
a different app rejects every delivery with 401 while the id is present, the
credentials work, and health is green.

---

## Network policy — the one step that is not a variable

The sandbox verifies its own egress at boot. Declaring
`SANDBOX_NETWORK_POLICY=blocked-at-platform` without actually applying a
policy makes the service refuse to execute and say so, which is the intended
behaviour rather than a fault.

In Northflank: the `sandbox` service → **Networking** → deny egress. Then
`GET /health` on the sandbox must show:

```json
{"checks": {"executes": true, "network_verdict": "egress verified closed"}}
```

If it shows the refusal instead, the policy is not applied yet.

---

## Going live, in order

1. **Create the Postgres addon** and copy its connection string. The factory
   creates its own tables at boot.
2. **Create the three services** with the build contexts above. Give
   `factory-web` a public domain; give the sandbox none.
3. **Create both secret groups** and link each to its own services.
4. **Apply the sandbox network policy**, then restart the sandbox.
5. **Check the sandbox** — `/health` must report `executes: true` with
   `egress verified closed`.
6. **Check the factory** — `/health` must report `database: true`,
   `model_provider: true`, `ingest_gate: true`, `execution: true`, and
   `owner_gate: true`. With `execution: false` the line still runs, reaches
   review, and holds every ticket, because it will not pass work it never
   executed. With `owner_gate: false` nobody can work the release gate —
   including you.
7. **Send one ticket** to `POST /webhooks/tickets`, signed as below. It should
   come back `202` with a ticket id, and reach `AWAITING_APPROVAL` within a
   few minutes.
8. **Release it yourself** — `POST /tickets/{id}/release`. This is the step
   that never becomes automatic.

### The two intakes

Both are signed with `INGEST_WEBHOOK_SECRET` and both feed the same line. The
`kind` on the ticket selects each role's briefing and decides what the sandbox
runs.

| Endpoint | Body | Sandbox runs |
|---|---|---|
| `POST /api/v1/tasks/code` | brief only | the test suite QA wrote |
| `POST /api/v1/tasks/data` | brief + `files[]` | `clean.py`, then the checks against `output/` |
| `POST /webhooks/tickets` | brief only | as `/tasks/code` — kept for senders already configured |

A data task's files are base64 in `files[]`, each a plain name with no
directory part; they land in `input/` inside the sandbox. The roles are shown
only the first 25 lines of each file, never the whole thing — a bulk file of
personal data is not sent to a model provider, and a model handed ten megabytes
of rows will summarise them and be wrong.

Upload ceiling is 20 MB of base64 per file, held below the sandbox's own 25 MB
so a file accepted here is never one the sandbox will later refuse.

### Signing a test ticket

```bash
SECRET=<INGEST_WEBHOOK_SECRET>
BODY='{"external_id":"TCK-1","source":"manual","title":"Reverse a string",
"brief":"Write a Python function reverse(s) returning the reversed string, with tests.",
"price_minor":5000,"currency":"USD"}'
TS=$(date +%s)
SIG=$(printf '%s.%s' "$TS" "$BODY" | openssl dgst -sha256 -hmac "$SECRET" -r | cut -d' ' -f1)

curl -X POST https://<factory-web-domain>/webhooks/tickets \
  -H "content-type: application/json" \
  -H "x-tasami-timestamp: $TS" \
  -H "x-tasami-signature: $SIG" \
  -d "$BODY"
```

---

## Working the approval gate

Two different doors, and they take different credentials — a signature is not
interchangeable with a key here.

| Door | Who knocks | Credential |
|---|---|---|
| `POST /webhooks/tickets` | a machine, unattended | HMAC signature (`INGEST_WEBHOOK_SECRET`) |
| `GET`/`POST /tickets/…` | you, by hand | static header (`OWNER_API_KEY`) |

Set these once per shell. `history -d` afterwards, or prefix each command with a
space if your shell is set to ignore those lines:

```bash
FACTORY=https://<factory-web-domain>
OWNER_KEY=<OWNER_API_KEY>
```

### 1. See what is waiting for you

```bash
curl -s "$FACTORY/tickets?state=AWAITING_APPROVAL" \
  -H "x-tasami-owner-key: $OWNER_KEY"
```

### 2. Read one before releasing it

`artifacts` holds every role's output, including the generated source and the
sandbox's real exit code. This is the step the gate exists for — releasing
without it is the same as having no gate.

```bash
curl -s "$FACTORY/tickets/<id>" \
  -H "x-tasami-owner-key: $OWNER_KEY"
```

### 3. Release it

```bash
curl -s -X POST "$FACTORY/tickets/<id>/release" \
  -H "x-tasami-owner-key: $OWNER_KEY"
```

Returns `{"released": true, …}` with a `payment` block when PayPal is
configured and the ticket is priced above zero. Then the ticket is `DELIVERED`.

**Responses worth recognising:**

| Code | Meaning |
|---|---|
| `401` | wrong or missing `x-tasami-owner-key` |
| `404` | no such ticket id |
| `409` | the ticket is not `AWAITING_APPROVAL`; only that state can be released |
| `503` | `OWNER_API_KEY` is unset, so `/tickets` is closed to everyone |

Both doors answer `401`, so read the path before the code: a `401` from
`/webhooks/tickets` is a bad signature or a timestamp outside the five-minute
window, and a `401` from `/tickets` is the owner key.

A `409` is usually `HELD` or `FAILED_REVIEW` rather than a fault — read
`state_reason` in the listing. `HELD` with "Code was not executed" means the
sandbox was unreachable, not that the work is bad.

There is no "un-release". Delivery announces the package outward and opens a
receivable, so step 2 is not optional politeness.

---

## What "live" means, precisely

With all of the above in place the line ingests a ticket, plans it, writes the
code, wires its integrations, audits it, **runs its tests in the sandbox**,
analyses it, produces a Dockerfile and an environment contract, writes the
README, and packages the result — unattended.

It then stops at `AWAITING_APPROVAL` and waits for you. Everything before that
point is automatic; handover is not, and the QA gate is decided by the
sandbox's exit code rather than by a model's opinion of its own work.
