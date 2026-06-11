# Local Development

## Prerequisites

| Tool | Minimum version | Notes |
|---|---|---|
| Node.js | 22.x | Use nvm or fnm |
| npm | 10.x | Included with Node 22 |
| Docker | 24.x | For Postgres and Redis |
| Docker Compose | 2.x | `docker compose` (v2 CLI) |
| Git | any | — |

Optional but recommended:
- **pnpm** 9.x — faster installs with workspace deduplication
- **Prisma CLI** — `npm i -g prisma` for migration commands

---

## First-time setup

### 1. Clone and enter the repo

```bash
git clone https://github.com/your-org/vectorbea.git
cd vectorbea
```

### 2. Start infrastructure

```bash
docker compose up postgres redis -d
```

This starts:
- PostgreSQL 16 on `localhost:5432` (user: `vectorbea`, password: `vectorbea`, db: `vectorbea`)
- Redis 7 on `localhost:6379`

### 3. Configure the web app

```bash
cp apps/web/.env.example apps/web/.env.local
```

Minimum required variables for **open/mock-session mode** (no Supabase needed):

```env
DATABASE_URL=postgresql://vectorbea:vectorbea@localhost:5432/vectorbea
DIRECT_URL=postgresql://vectorbea:vectorbea@localhost:5432/vectorbea
REDIS_URL=redis://localhost:6379
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

> **Open mode**: when `NEXT_PUBLIC_SUPABASE_URL` is not set (or set to the
> placeholder value), the app runs without authentication. All API routes
> resolve to the seeded `acme-corp` organisation automatically.
>
> To enable real Supabase auth, add your project credentials and set
> `REQUIRE_AUTH=true`.

### 4. Install dependencies

```bash
cd apps/web && npm install
```

### 5. Run database migrations

```bash
# From apps/web/
npx prisma migrate dev
```

> The Prisma schema lives in `prisma/schema.prisma` at the repo root.

### 6. Seed the database

Open your database client (or `psql`) and run `prisma/seed.sql`.  
With Docker Postgres:

```bash
psql postgresql://vectorbea:vectorbea@localhost:5432/vectorbea \
  -f prisma/seed.sql
```

This creates:
- `acme-corp` organisation + seed owner user
- 4 agent jobs pre-wired to local mock endpoints (see below)
- Budget policies for each job

### 7. Start the web app

```bash
cd apps/web && npm run dev
```

Open **http://localhost:3000** — you should land on the dashboard.

---

## Mock agent endpoints

The scheduler calls external HTTP endpoints to execute agent logic. During
local development, four built-in mock endpoints simulate realistic agent
behaviour without requiring real infrastructure.

| Endpoint | Simulates | State after run |
|---|---|---|
| `POST /api/mock-agents/success` | Normal 2-step run, 1-2 s | `SUCCEEDED` |
| `POST /api/mock-agents/fail` | CRM API rate-limit error | `FAILED` |
| `POST /api/mock-agents/approval` | Pauses for human approval | `WAITING_FOR_APPROVAL` → `SUCCEEDED` |
| `POST /api/mock-agents/slow` | Sleeps 35 s (triggers timeout) | `TIMEOUT` |

Call `GET /api/mock-agents` to see the full description of each endpoint.

**How they work:** each mock endpoint accepts the standard scheduler payload
(`agentRunId`, `resumeFromApproval`, etc.) and updates the `AgentRun` record
in the DB directly. The run status changes are visible in the UI as soon as
the HTTP call returns.

---

## Testing each flow

### ✅ Test: Successful run

1. Open **http://localhost:3000/agent-jobs**
2. Click **"Daily Support Ticket Triage"** (endpoint: `mock/success`)
3. Click **"Run now"**
4. A green `QUEUED` toast appears. The run is created in the DB
5. Click the run ID or navigate to **/agent-runs** to see it
6. Within 2 s the status changes to `SUCCEEDED`
7. The run detail shows: 2 steps, 2500 tokens, $0.01 cost

> You can also trigger it directly with curl:
> ```bash
> curl -s -X POST http://localhost:3000/api/agent-jobs/job_seed_triage_vectorbea/runs | jq .
> ```

---

### ❌ Test: Failed run + retry

1. Click **"Failed Payment Recovery"** (endpoint: `mock/fail`)
2. Click **"Run now"** — the run moves to `FAILED` within 300 ms
3. Open the run detail — you see the error: *"Mock CRM API rate limit exceeded."*
4. Click **"Retry Run"** — a new run is created with `Attempt #2`
5. The retry also fails (same mock endpoint) — expected
6. Click **"Retry Run"** again on attempt 2 → attempt 3
7. After `maxRetries` (3) attempts, the button becomes disabled and shows
   *"Maximum retry limit reached"*

> To test a custom error message:
> ```bash
> # Update the job endpoint URL to include a custom message
> curl -s -X POST "http://localhost:3000/api/mock-agents/fail?errorMessage=DB+connection+lost" \
>   -H "Content-Type: application/json" -d '{}' | jq .
> ```

---

### 🔐 Test: Approval flow

This test requires two HTTP calls: one to trigger the run, one to resume after
the approval decision.

**Step 1 — Trigger the run:**

1. Click **"CRM Enrichment with Approval"** (endpoint: `mock/approval`)
2. Click **"Run now"**
3. The run status moves to `WAITING_FOR_APPROVAL`
4. A notification badge appears on the **Approvals** sidebar item

**Step 2 — Review the approval:**

5. Navigate to **/approvals**
6. You see: *"Approve CRM update — Agent wants to update 12 customer records"*
7. Optionally add a reason in the text field

**Step 3a — Approve:**

8. Click **"Approve"** → confirm in the modal
9. The approval endpoint is called with `resumeFromApproval: true`
10. The mock agent completes, the run moves to `SUCCEEDED`
11. Navigate to the run detail — the Approval Requests section shows who
    approved and when

**Step 3b — Reject:**

8. Click **"Reject"** → add reason → confirm
9. The run moves to `CANCELLED` with the rejection reason as `errorMessage`
10. The approval inbox becomes empty

> Direct API test (replace IDs with real values from your DB):
> ```bash
> # Trigger
> RUN_ID=$(curl -s -X POST http://localhost:3000/api/agent-jobs/job_seed_crm_approval_vectorbea/runs \
>   | jq -r '.run.id')
>
> # Wait 1 s for the mock to create the approval request
> sleep 1
>
> # List pending approvals
> APPROVAL_ID=$(curl -s "http://localhost:3000/api/approvals?status=PENDING" \
>   | jq -r '.approvals[0].id')
>
> # Approve
> curl -s -X POST "http://localhost:3000/api/approvals/$APPROVAL_ID/approve" \
>   -H "Content-Type: application/json" \
>   -d '{"reason":"Looks safe"}' | jq .
> ```

---

### ⏱ Test: Timeout

The slow mock sleeps 35 s. The seed job has `maxDurationSeconds = 10` to
demonstrate timeout detection (the scheduler or worker enforces this limit).

1. Click **"Slow Batch Processor (Timeout Test)"**
2. Click **"Run now"**
3. The run enters `RUNNING` state
4. After ~35 s (the mock completes), the run moves to `TIMEOUT`
5. The error message reads: *"Run timed out: exceeded maximum allowed duration."*
6. Click **"Retry Run"** to queue another attempt

> To test with a shorter sleep:
> ```bash
> curl -s -X POST "http://localhost:3000/api/mock-agents/slow?seconds=5" \
>   -H "Content-Type: application/json" -d '{}' | jq .
> ```

---

### 💰 Test: Budget limits

The seed jobs have budget policies. To test enforcement:

**Daily run limit:**

1. Open **"Daily Support Ticket Triage"** — budget shows `maxRunsPerDay: 3`
2. Click **"Run now"** three times (each takes 1-2 s)
3. On the 4th attempt you get:
   *"Run blocked: daily run limit exceeded (3/3 runs today)."*
4. The budget progress bar on the job detail turns red at 100%

**Per-run cost limit:**

```bash
# Simulate a run that exceeded cost — report-usage enforces this
curl -s -X POST "http://localhost:3000/api/agent-runs/{RUN_ID}/report-usage" \
  -H "Content-Type: application/json" \
  -d '{"totalTokens": 999999, "estimatedCostUsd": 99.99, "status": "SUCCEEDED"}' | jq .
# Response will show budgetViolation with field=maxCostUsdPerRun
```

---

## Creating a custom mock job

1. **Create the job** via the UI at **/agent-jobs/new**, or via API:

```bash
curl -s -X POST http://localhost:3000/api/agent-jobs \
  -H "Content-Type: application/json" \
  -d '{
    "name": "My test job",
    "triggerType": "MANUAL",
    "timezone": "UTC",
    "endpointUrl": "http://localhost:3000/api/mock-agents/success",
    "httpMethod": "POST",
    "maxDurationSeconds": 120,
    "maxRetries": 3,
    "retryBackoffSeconds": 30,
    "requireApprovalBeforeRun": false,
    "requireApprovalBeforeExternalAction": false
  }' | jq .
```

2. **Trigger a run:**

```bash
JOB_ID="<id from step 1>"
curl -s -X POST "http://localhost:3000/api/agent-jobs/$JOB_ID/runs" | jq .
```

3. **Watch the run:**

```bash
RUN_ID="<id from step 2>"
curl -s "http://localhost:3000/api/agent-runs/$RUN_ID" | jq '.run | {id, status, totalTokens, estimatedCostUsd}'
```

---

## Checking system health

```bash
curl -s http://localhost:3000/api/health | jq .
```

All checks should be `"ok": true`. If `database` fails, ensure Postgres is
running and `DATABASE_URL` is correct.

---

## Common commands

```bash
# Run linting
cd apps/web && npm run lint

# Run TypeScript typecheck
cd apps/web && npx tsc --noEmit

# Run unit tests
cd apps/web && npx vitest run

# Generate Prisma client after schema changes
cd apps/web && npx prisma generate

# Create a new migration
cd apps/web && npx prisma migrate dev --name describe-your-change

# Reset local database (drops all data)
cd apps/web && npx prisma migrate reset

# Re-seed after reset
psql postgresql://vectorbea:vectorbea@localhost:5432/vectorbea -f prisma/seed.sql
```

---

## Project structure

```
vectorbea/
├── apps/
│   ├── web/                   Next.js control plane — npm run dev
│   │   ├── app/
│   │   │   ├── (app)/         Protected UI pages (dashboard, jobs, approvals)
│   │   │   └── api/
│   │   │       ├── agent-jobs/
│   │   │       ├── agent-runs/
│   │   │       ├── approvals/
│   │   │       ├── mock-agents/   ← local mock endpoints (success/fail/approval/slow)
│   │   │       └── health/
│   │   └── server/
│   │       └── services/      Business logic (budget-policy, agent-run-retry, …)
│   └── worker/                BullMQ worker — stub, not yet runnable
├── prisma/
│   ├── schema.prisma          Canonical database schema
│   ├── seed.sql               Seed data (run manually in SQL editor)
│   └── migrations/            SQL migration files
└── docs/
```

---

## Troubleshooting

**`Error: connect ECONNREFUSED 127.0.0.1:5432`**
→ Postgres is not running. Run `docker compose up postgres -d`.

**`Error: Redis connection refused`**
→ Redis is not running. Run `docker compose up redis -d`.

**`Seed data not found` (500 on all API routes)**
→ Run `prisma/seed.sql` against your database. See step 6 above.

**`Auth callback 400 error`**
→ Check that your Supabase redirect URL includes `http://localhost:3000/auth/callback`.

**`PrismaClientInitializationError`**
→ Ensure `DATABASE_URL` is set in `.env.local` and Postgres is running.

**Mock agent run stays QUEUED and never progresses**
→ The mock agents are called by the BullMQ worker, which is not running in
the stub. To trigger the mock endpoint manually (simulating what the worker
would do), call the endpoint directly:
```bash
curl -s -X POST http://localhost:3000/api/mock-agents/success \
  -H "Content-Type: application/json" \
  -d '{"agentRunId": "<your-run-id>"}' | jq .
```
This updates the run in the DB immediately, just as the worker would.
