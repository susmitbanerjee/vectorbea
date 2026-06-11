# Vectorbea Agent Scheduler

A production control plane for scheduled AI agent jobs — cron scheduling,
run history, retries, approval gates, per-job budgets, and full audit logs.

---

## What it does

Vectorbea lets you define, schedule, and monitor AI agent jobs the same way
you manage background workers in any serious production system.

- Define jobs with cron expressions or trigger them via API
- Set retry policies, budget caps, and timeout limits per job
- Require human approval before high-stakes runs execute
- Track every run's status, cost, and output in one place
- Get alerted on failures via Slack or email

---

## Architecture

```
vectorbea/
├── apps/
│   ├── web/          Next.js 15 control plane (dashboard + REST API)
│   └── worker/       BullMQ scheduler + executor worker process
├── packages/
│   ├── shared/       Shared TypeScript types
│   └── sdk-js/       Node.js SDK
├── prisma/
│   ├── schema.prisma Canonical database schema
│   ├── seed.ts       Prisma seed script (runs via npm run db:seed)
│   ├── seed.sql      SQL seed for mock-agent dev jobs (psql)
│   └── migrations/   SQL migration history
└── docker-compose.yml  Local dev infrastructure (Postgres + Redis)
```

| Layer | Technology |
|---|---|
| Control plane | Next.js 15, React 19, Tailwind CSS |
| Database | PostgreSQL 16, Prisma ORM |
| Job queue | BullMQ + Redis 7 |
| Worker | Node.js (TypeScript, tsx) |
| Auth | Supabase (optional — open mode available) |

---

## Prerequisites

| Tool | Minimum version | Notes |
|---|---|---|
| Node.js | 22.x | Use [nvm](https://github.com/nvm-sh/nvm) or [fnm](https://github.com/Schniz/fnm) |
| npm | 10.x | Bundled with Node 22 |
| Docker | 24.x | For Postgres and Redis |
| Docker Compose | 2.x | `docker compose` (V2 CLI plugin) |
| Git | any | — |

---

## Quick start

```bash
# 1. Clone
git clone https://github.com/your-org/vectorbea.git
cd vectorbea

# 2. Install all workspace dependencies
npm install

# 3. Configure environment
#    Root .env  → read by Prisma CLI, docker compose, and the worker
#    .env.local → read by the Next.js dev server
cp .env.example .env
cp apps/web/.env.example apps/web/.env.local
# The defaults work out of the box — no edits needed to start

# 4. Start infrastructure (Postgres + Redis)
docker compose up postgres redis -d

# 5. Run database migrations
npm run db:migrate

# 6. Seed the database
npm run db:seed

# 7. Start web + worker (with hot-reload)
npm run dev
```

Open **http://localhost:3000** — you should land on the dashboard with the
seeded *Acme Corp* organisation and 3 demo agent jobs.

> **No Supabase needed for local dev.** When `NEXT_PUBLIC_SUPABASE_URL` is
> set to the placeholder value (the default in both env examples), the app
> runs in *open/mock-session mode* — all requests resolve to the seeded
> `acme-corp` org automatically. No login screen.

---

## Step-by-step setup

### 1. Environment files

```bash
cp .env.example .env                          # Prisma CLI, docker compose, worker
cp apps/web/.env.example apps/web/.env.local  # Next.js dev server
```

Both files contain the same variables. The root `.env` is read by Prisma CLI
and the worker; `apps/web/.env.local` is read by the Next.js dev server
(Next.js does not read the root `.env`). You only need to edit these when:

- Using a remote database (Neon, Supabase, etc.)
- Enabling real Supabase authentication (`REQUIRE_AUTH=true`)
- Adding billing, email, or Slack integration keys

### 2. Start infrastructure

```bash
docker compose up postgres redis -d
```

This starts:
- **PostgreSQL 16** on `localhost:5432` — user/pass/db all `vectorbea`
- **Redis 7** on `localhost:6379`

Wait for containers to be healthy (about 5–10 s), then proceed.

### 3. Run migrations

```bash
npm run db:migrate
```

Runs `prisma migrate dev` against `prisma/schema.prisma`. Creates all tables
in your local Postgres. On first run this also generates the Prisma client.

### 4. Seed the database

```bash
npm run db:seed
```

Creates the `acme-corp` organisation, a seed owner user, and 3 demo agent
jobs. Safe to re-run (uses upsert — won't create duplicates).

To also load the **mock-agent dev jobs** (4 jobs pointing to local
`/api/mock-agents/*` endpoints for UI testing):

```bash
psql postgresql://vectorbea:vectorbea@localhost:5432/vectorbea \
  -f prisma/seed.sql
```

### 5. Start the dev servers

```bash
npm run dev          # starts web + worker concurrently
# or individually:
npm run dev:web      # Next.js on http://localhost:3000
npm run dev:worker   # BullMQ worker with tsx watch
```

### 6. Verify everything is working

```bash
curl -s http://localhost:3000/api/health | jq .
```

All checks should show `"ok": true`.

---

## Running individual services

| Command | What it does |
|---|---|
| `npm run dev` | Start web + worker (hot-reload) |
| `npm run dev:web` | Next.js dev server only |
| `npm run dev:worker` | BullMQ worker only (tsx watch) |
| `docker compose up postgres redis -d` | Start infra only |
| `docker compose up -d` | Start full stack in Docker (prod-like) |

---

## Database commands

| Command | What it does |
|---|---|
| `npm run db:migrate` | Create and apply new migrations (dev) |
| `npm run db:migrate:deploy` | Apply pending migrations (production) |
| `npm run db:seed` | Seed the database with demo data |
| `npm run db:studio` | Open Prisma Studio (visual DB browser) |
| `npm run db:generate` | Regenerate Prisma client after schema changes |
| `npm run db:reset` | Drop all data and re-run migrations (dev only) |

---

## Testing mock agent flows

The scheduler calls external HTTP endpoints to execute agent logic. Four
built-in mock endpoints let you test every run state without real AI
infrastructure.

First, load the mock seed data:

```bash
psql postgresql://vectorbea:vectorbea@localhost:5432/vectorbea -f prisma/seed.sql
```

Then open **http://localhost:3000/agent-jobs** and click any of the four
seeded jobs. Each job is pre-wired to a different mock endpoint:

| Job | Endpoint | Outcome |
|---|---|---|
| Daily Support Ticket Triage | `/api/mock-agents/success` | `SUCCEEDED` in ~2 s |
| CRM Enrichment with Approval | `/api/mock-agents/approval` | `WAITING_FOR_APPROVAL` → `SUCCEEDED` |
| Failed Payment Recovery | `/api/mock-agents/fail` | `FAILED` in 300 ms |
| Slow Batch Processor | `/api/mock-agents/slow` | `TIMEOUT` after 35 s |

> See [docs/local-development.md](docs/local-development.md) for step-by-step
> test flows including curl commands.

**Note:** Mock agents are called directly by the Next.js API routes in
`/api/mock-agents/*` and update the database directly — you do not need the
BullMQ worker running to test these flows. Just click "Run now" in the UI.

---

## Other scripts

| Command | What it does |
|---|---|
| `npm run lint` | ESLint across all workspaces |
| `npm run typecheck` | TypeScript type-check across all workspaces |
| `npm run test` | Run unit tests (Vitest) |
| `npm run build` | Production build of the web app |

---

## Full-stack Docker mode

To run web + worker in Docker containers (production-like, no hot-reload):

```bash
cp .env.example .env   # if not already done
docker compose up -d   # starts all four services
```

The web container will be available at **http://localhost:3000**.

The web and worker containers override `DATABASE_URL` and `REDIS_URL` to use
the Docker service names (`postgres` and `redis`) instead of `localhost`.
Everything else is read from your root `.env` file.

---

## Deploying to Vercel + Neon

For production deployment:

1. Create a Neon database (free tier works): https://neon.tech
2. Create a Vercel project connected to this repo
3. Set these environment variables in Vercel (Production + Preview):

```
DATABASE_URL=postgresql://<user>:<password>@<host>.neon.tech/vectorbea?sslmode=require
DIRECT_URL=postgresql://<user>:<password>@<host>.neon.tech/vectorbea?sslmode=require
REDIS_URL=redis://<host>:<port>   (Upstash Redis recommended)
NEXT_PUBLIC_APP_URL=https://your-domain.vercel.app
REQUIRE_AUTH=true
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
INTERNAL_API_SECRET=<openssl rand -hex 32>
```

4. Run migrations against the production DB:

```bash
DATABASE_URL=<neon-url> npx prisma migrate deploy --schema=prisma/schema.prisma
```

5. Seed the production DB (optional):

```bash
DATABASE_URL=<neon-url> npm run db:seed
```

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for full deployment documentation.

---

## Common errors

### `Error: connect ECONNREFUSED 127.0.0.1:5432`
Postgres is not running.
```bash
docker compose up postgres -d
```

### `Error: Redis connection refused`
Redis is not running.
```bash
docker compose up redis -d
```

### `Seed data not found` (500 on all API routes)
The database hasn't been seeded yet.
```bash
npm run db:seed
```

### `PrismaClientInitializationError`
Prisma client hasn't been generated, or `DATABASE_URL` is wrong.
```bash
npm run db:generate
# Check that DATABASE_URL is set in apps/web/.env.local
```

### `Module not found: Can't resolve '@/lib/generated/prisma'`
Same as above — Prisma client needs to be generated.
```bash
npm run db:generate
```

### Mock agent run stays `QUEUED` and never progresses
The BullMQ worker isn't running. Start it with `npm run dev:worker`, or
simulate it manually:

```bash
curl -s -X POST http://localhost:3000/api/mock-agents/success \
  -H "Content-Type: application/json" \
  -d '{"agentRunId": "<your-run-id>"}' | jq .
```

### Auth callback 400 error
Add `http://localhost:3000/auth/callback` to your Supabase project's
redirect URL allowlist (Dashboard → Authentication → URL Configuration).

---

## Project structure

```
vectorbea/
├── apps/
│   ├── web/                   Next.js control plane
│   │   ├── app/
│   │   │   ├── (app)/         Protected dashboard pages
│   │   │   └── api/
│   │   │       ├── agent-jobs/
│   │   │       ├── agent-runs/
│   │   │       ├── approvals/
│   │   │       ├── mock-agents/   ← local mock endpoints
│   │   │       └── health/
│   │   └── server/
│   │       └── services/      Business logic (budget, retry, …)
│   └── worker/
│       └── src/
│           ├── index.ts       Entry point
│           ├── scheduler.ts   CRON scheduler (BullMQ repeatable job)
│           ├── executor.ts    Agent run executor
│           ├── queues.ts      Queue + Redis connection
│           └── db.ts          Prisma client (shared from apps/web)
├── prisma/
│   ├── schema.prisma
│   ├── seed.ts                Prisma seed (npm run db:seed)
│   ├── seed.sql               Mock-agent SQL seed (psql)
│   └── migrations/
├── packages/
│   ├── shared/                Shared TypeScript types
│   └── sdk-js/                Node.js SDK
├── docs/
│   ├── local-development.md   Full local dev guide with curl examples
│   ├── DEPLOYMENT.md
│   └── mvp-scope.md
├── .env.example               Root env template (copy to .env)
└── docker-compose.yml
```

---

## Contributing

Branch off `dev`. PRs go against `master` only when ready for production.
