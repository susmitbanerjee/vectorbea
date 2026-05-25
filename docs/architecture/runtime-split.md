# Vectorbea — Runtime Architecture & Migration Plan

> Last updated: 2026-05-25
> Status: **Phase 1 complete** — boundary isolation done; Kotlin services not yet built

---

## Table of Contents

1. [Target Architecture](#target-architecture)
2. [Component Responsibilities](#component-responsibilities)
3. [Current State (Phase 1)](#current-state-phase-1)
4. [API Route Classification](#api-route-classification)
5. [Frontend API Client](#frontend-api-client)
6. [Forbidden Import Rule](#forbidden-import-rule)
7. [Migration Phases](#migration-phases)
8. [Data Flow Diagrams](#data-flow-diagrams)

---

## Target Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Browser / apps/web (Next.js — UI only)                        │
│  - React components, pages, layouts                             │
│  - lib/api/client.ts → all backend calls go here               │
│  - NO direct DB, Redis, secrets, or runtime imports             │
└──────────────────────┬──────────────────────────────────────────┘
                       │  HTTP / SSE / WebSocket
                       ▼
┌─────────────────────────────────────────────────────────────────┐
│  apps/api-kotlin (Kotlin HTTP API)                              │
│  - CRUD for workflows, agents, tools, connections, runs         │
│  - Auth / session validation                                    │
│  - Workspace membership enforcement                             │
│  - Secret access (read-only, never surfaced to client)          │
│  - Connection testing                                           │
│  - Enqueues workflow jobs → Redis                               │
│  - Reads/writes Postgres                                        │
└──────────┬──────────────────────────┬───────────────────────────┘
           │  Postgres                │  Redis
           ▼                          ▼
┌──────────────────┐       ┌──────────────────────────────────────┐
│  Postgres        │       │  apps/worker-kotlin (Kotlin Worker)  │
│  - Durable data  │◄──────│  - Dequeues jobs from Redis          │
│  - Runs/events   │       │  - Executes workflow graph           │
│  - Checkpoints   │       │  - Emits durable run events          │
│  - Audit logs    │       │  - Writes checkpoints to Postgres     │
└──────────────────┘       │  - Handles approvals/retries/replay  │
                           │  - Heartbeats via Redis               │
                           └──────────────────────────────────────┘
```

---

## Component Responsibilities

### `apps/web` — Frontend only

**Owns:**
- All React UI (pages, components, layouts)
- Client-side routing and navigation
- `lib/api/client.ts` — single typed HTTP client
- `lib/repository/` — typed wrappers over the API client
- `lib/workflows/` — client-side validation and template logic (no execution)
- Auth cookie handling (httpOnly cookies set by API)

**Must NOT own:**
- Direct database access (`@/server/db`, Prisma)
- Secret decryption (`getSecretForRuntime`, `secret-service`)
- Redis clients (`ioredis`, `bullmq`)
- Workflow execution (`executeWorkflow`, `workflow-executor`)
- Connection testing against live services
- Any business logic that belongs to the API layer

### `apps/api-kotlin` — Backend API service

**Owns:**
- All REST API endpoints (CRUD for every entity)
- Authentication and session token validation
- Workspace membership enforcement (authorization boundary)
- Database reads and writes (Postgres via JDBC/Exposed/JOOQ)
- Secret storage and resolution (never returned to client)
- Connection testing (runs SSRF checks, never exposes raw credentials)
- Enqueueing workflow run jobs to Redis
- Run and event APIs (status, events, timeline)
- Webhook ingestion endpoints
- Billing integration

**Technology:** Vanilla Kotlin HTTP service (Ktor / http4k), no framework magic.

### `apps/worker-kotlin` — Durable workflow worker

**Owns:**
- Consuming workflow job queue from Redis (BullMQ-compatible or native)
- Executing workflow graphs node by node
- Calling LLM APIs, tool endpoints, agent sub-flows
- Writing run events to Postgres (durable audit trail)
- Writing checkpoints for resumability
- Handling approval gates (waits for human approval before continuing)
- Retrying failed steps within policy limits
- Replaying runs from checkpoint
- Publishing heartbeats via Redis (for health monitoring)

**Does NOT own:**
- Serving HTTP to the browser (worker is internal only)
- Auth/session handling
- CRUD APIs

### `packages/contracts` — Shared schema/types (to be created)

**Owns:**
- OpenAPI spec or JSON Schema for all API endpoints
- Shared event schemas (run events, worker heartbeats)
- TypeScript types generated from the spec (consumed by `apps/web`)
- Kotlin data classes generated from the spec (consumed by `apps/api-kotlin` and `apps/worker-kotlin`)

### Postgres — Durable source of truth

- `platform_workflows` — workflow definitions and graphs
- `platform_runs` — run records, status, output, error
- `platform_run_events` — immutable event log per run
- `connections` — LLM/tool connection config (encrypted secrets via `secret_ref`)
- `workspaces`, `workspace_members` — multi-tenancy
- All audit logs, approvals, checkpoints

### Redis — Ephemeral coordination layer

- **Job queue** — workflow run jobs (producer: Kotlin API, consumer: Kotlin worker)
- **Pub/sub** — run event streaming (worker publishes, API streams to browser via SSE)
- **Cache** — hot reads (connection configs, workspace limits)
- **Locks** — prevent duplicate run execution
- **Worker heartbeats** — liveness tracking for worker instances

---

## Current State (Phase 1)

Phase 1 is complete. This phase isolated the boundaries without building the Kotlin services.

### What changed in Phase 1

1. **`apps/web/lib/api/client.ts` created** — single typed HTTP client for all frontend→backend calls. Reads `NEXT_PUBLIC_VECTORBEA_API_URL` for the Kotlin API base URL; defaults to `""` (relative) so existing Next.js internal API routes continue to work during migration.

2. **`lib/repository/index.ts` and `lib/repository/connections.ts` updated** — now delegate to `apiFetch` from `lib/api/client.ts` instead of raw `fetch`. Removes duplicated `getActiveWorkspaceId` / `withWorkspace` helpers.

3. **`scripts/check-forbidden-imports.mjs` added** — CI lint script that fails if any file outside `app/api/**`, `server/**`, `lib/server/**`, or `lib/workflow-runtime/**` imports DB, Redis, secrets, or runtime modules.

4. **`apps/web/package.json`** — added `check:boundaries` script.

### What remains for Phase 2+

- Build `apps/api-kotlin` to own all CRUD and run management.
- Build `apps/worker-kotlin` to own workflow execution.
- Migrate each classified Next.js API route to the Kotlin API (see classification below).
- Set `NEXT_PUBLIC_VECTORBEA_API_URL` to point at the Kotlin API.
- Delete migrated Next.js API routes.
- Create `packages/contracts` with OpenAPI spec and generated types.

---

## API Route Classification

All 98+ routes currently in `apps/web/app/api/` are classified below.

Legend:
- **[A] PROXY** — keep temporarily as a thin proxy to the Kotlin API once available
- **[B] MIGRATE** — full migration to Kotlin API planned
- **[C] DELETE** — obsolete, mock, or demo routes to remove
- **[D] DANGEROUS** — currently touches DB/secrets/runtime directly; highest migration priority

> All current routes are effectively [A+D]: they will become thin proxies once the Kotlin API is up. [D] marks those where the risk of keeping them in Next.js long-term is highest.

### Authentication

| Route | Method | Classification | Notes |
|---|---|---|---|
| `auth/google` | GET | [A] PROXY | OAuth initiation — stays or proxies to Kotlin API |
| `auth/google/callback` | GET | [A] PROXY | OAuth callback — set httpOnly cookie |
| `auth/microsoft` | GET | [A] PROXY | OAuth initiation |
| `auth/microsoft/callback` | GET | [A] PROXY | OAuth callback |
| `auth/github` | GET | [A] PROXY | OAuth initiation |
| `auth/callback` | GET | [A] PROXY | Generic OAuth callback |
| `auth/session` | GET | [A] PROXY | Returns current session — no DB in Next.js, use Kotlin API |
| `auth/set-session` | POST | [A] PROXY | Sets httpOnly cookie — keep in Next.js (cookie is browser-facing) |
| `auth/accept-invite` | POST | [B] MIGRATE | Writes to DB — must move to Kotlin API |

### Platform Workflows

| Route | Method | Classification | Notes |
|---|---|---|---|
| `platform/workflows` | GET/POST | **[D] DANGEROUS** | Direct DB read/write via Prisma |
| `platform/workflows/[id]` | GET/PATCH | **[D] DANGEROUS** | Direct DB access |
| `platform/workflows/[id]/graph` | GET | **[D] DANGEROUS** | Direct DB query for graph JSON |
| `platform/workflows/[id]/nodes/[nodeId]/test` | POST | **[D] DANGEROUS** | Calls `executeWorkflow` with DB + secrets |
| `platform/workflows/[id]/run` | POST | **[D] DANGEROUS** | Creates run, calls `executeWorkflow` via `after()`, reads secrets |
| `platform/workflows/[id]/run/[runId]/execute` | POST | **[D] DANGEROUS** | Direct `executeWorkflow` call — temporary, belongs in worker |

### Platform Runs

| Route | Method | Classification | Notes |
|---|---|---|---|
| `platform/runs` | GET | **[D] DANGEROUS** | Direct DB list query |
| `platform/runs/[id]` | GET/PATCH | **[D] DANGEROUS** | Direct DB access |
| `platform/runs/[id]/cancel` | POST | **[D] DANGEROUS** | Direct DB write |
| `platform/runs/[id]/events` | GET | **[D] DANGEROUS** | Direct DB query |

### Platform Agents & Tools

| Route | Method | Classification | Notes |
|---|---|---|---|
| `platform/agents` | GET | **[D] DANGEROUS** | Direct DB query |
| `platform/agents/[id]` | GET | **[D] DANGEROUS** | Direct DB query |
| `platform/tools` | GET | **[D] DANGEROUS** | Direct DB query |
| `platform/tools/[id]` | GET | **[D] DANGEROUS** | Direct DB query |
| `platform/summary` | GET | **[D] DANGEROUS** | Direct DB aggregate queries |

### Connections

| Route | Method | Classification | Notes |
|---|---|---|---|
| `connections` | GET/POST | **[D] DANGEROUS** | DB + secret writes |
| `connections/[id]` | GET/PATCH/DELETE | **[D] DANGEROUS** | DB + secret access |
| `connections/[id]/test` | POST | **[D] DANGEROUS** | Reads secrets, tests live connection — must be Kotlin API |
| `connections/[id]/discover-schema` | POST | **[D] DANGEROUS** | Secret + live network call |
| `connections/[id]/list-models` | GET | **[D] DANGEROUS** | Secret + live network call |

### Agent Jobs & Runs (legacy)

| Route | Method | Classification | Notes |
|---|---|---|---|
| `agent-runs` | GET | [B] MIGRATE | Legacy run list — migrate to platform/runs |
| `agent-runs/[id]` | GET | [B] MIGRATE | Legacy run detail |
| `agent-runs/[id]/retry` | POST | [B] MIGRATE | Retry logic belongs in worker |
| `agent-runs/[id]/cancel` | POST | [B] MIGRATE | Belongs in Kotlin API |
| `agent-runs/[id]/report-usage` | POST | [B] MIGRATE | Belongs in Kotlin API |
| `agent-jobs` | GET | [B] MIGRATE | Legacy jobs list |
| `agent-jobs/[id]` | GET | [B] MIGRATE | Legacy job detail |
| `agent-jobs/[id]/runs` | GET | [B] MIGRATE | Legacy run list for job |
| `agent-jobs/[id]/audit-logs` | GET | [B] MIGRATE | Legacy audit |

### Agents (legacy runtime agents)

| Route | Method | Classification | Notes |
|---|---|---|---|
| `agents` | GET | [B] MIGRATE | Legacy agent list |
| `agents/[id]` | DELETE | [B] MIGRATE | Legacy agent delete |
| `agents/[id]/commands` | POST | [B] MIGRATE | Runtime command dispatch — belongs in worker |
| `agents/[id]/metrics` | GET | [B] MIGRATE | Metrics query |
| `agents/heartbeat` | POST | [B] MIGRATE | Worker heartbeat → Redis, belongs in Kotlin API |

### Approvals

| Route | Method | Classification | Notes |
|---|---|---|---|
| `approvals` | GET/POST | [B] MIGRATE | DB writes — Kotlin API |
| `approvals/[id]` | GET | [B] MIGRATE | |
| `approvals/[id]/approve` | POST | [B] MIGRATE | Triggers worker resume — Kotlin API |
| `approvals/[id]/reject` | POST | [B] MIGRATE | |

### Settings & Admin

| Route | Method | Classification | Notes |
|---|---|---|---|
| `settings/providers` | GET/POST | [B] MIGRATE | Provider key management |
| `settings/providers/[id]` | GET/PATCH/DELETE | [B] MIGRATE | |
| `settings/integrations/slack` | GET/POST/PUT | [B] MIGRATE | Slack OAuth + config |
| `settings/integrations/slack/test` | POST | [B] MIGRATE | Live Slack test — Kotlin API |
| `settings/ingest-tokens` | GET/POST | [B] MIGRATE | Token management |
| `settings/ingest-tokens/[id]/rotate` | POST | [B] MIGRATE | Secret rotation — Kotlin API |
| `settings/ingest-tokens/[id]/revoke` | POST | [B] MIGRATE | |
| `settings/privacy` | GET/POST | [B] MIGRATE | |
| `settings/privacy/redaction-rules` | GET/POST | [B] MIGRATE | |

### Workspaces & Orgs

| Route | Method | Classification | Notes |
|---|---|---|---|
| `workspaces` | GET/POST | [B] MIGRATE | |
| `workspaces/[id]/members` | GET | [B] MIGRATE | |
| `workspaces/[id]/invitations` | POST | [B] MIGRATE | |
| `workspaces/[id]/notification-preferences` | GET/PUT | [B] MIGRATE | |
| `organizations` | GET/POST | [B] MIGRATE | |

### Billing & Webhooks

| Route | Method | Classification | Notes |
|---|---|---|---|
| `billing/checkout` | POST | [B] MIGRATE | Stripe integration — Kotlin API |
| `billing/usage` | GET | [B] MIGRATE | |
| `webhooks/lemonsqueezy` | POST | [B] MIGRATE | Webhook receiver — Kotlin API (needs HMAC verify) |
| `webhooks/billing` | POST | [B] MIGRATE | |
| `keys` | GET/POST | [B] MIGRATE | API key management |
| `keys/[id]` | GET/DELETE | [B] MIGRATE | |
| `onboarding/bootstrap` | POST | [B] MIGRATE | Workspace bootstrap — DB writes |

### Alerts, Audit, Metrics

| Route | Method | Classification | Notes |
|---|---|---|---|
| `alerts/rules` | GET/POST | [B] MIGRATE | |
| `alerts/rules/[id]` | GET | [B] MIGRATE | |
| `alerts/events` | GET | [B] MIGRATE | |
| `alerts/evaluate` | POST | [B] MIGRATE | |
| `alerts/trigger` | POST | [B] MIGRATE | |
| `audit` | GET/POST | [B] MIGRATE | |
| `audit/batch` | POST | [B] MIGRATE | |
| `audits` | GET | [B] MIGRATE | |
| `metrics` | GET | [B] MIGRATE | |

### Dashboard

| Route | Method | Classification | Notes |
|---|---|---|---|
| `dashboard/summary` | GET | [B] MIGRATE | Aggregate DB queries |
| `dashboard/requests` | GET | [B] MIGRATE | |
| `dashboard/connection-status` | GET | [B] MIGRATE | |
| `dashboard/governance` | GET | [B] MIGRATE | |
| `dashboard/scheduler` | GET/POST | [B] MIGRATE | |

### Proxy & Ingest

| Route | Method | Classification | Notes |
|---|---|---|---|
| `proxy/sync` | POST | [A] PROXY | Thin pass-through — keep as proxy |
| `proxy/prompts/[name]` | GET | [A] PROXY | Prompt fetch proxy |
| `proxy/audit/batch` | POST | [A] PROXY | Audit batch proxy |
| `ingest/events` | POST | [B] MIGRATE | Event ingestion — Kotlin API |

### Evaluation

| Route | Method | Classification | Notes |
|---|---|---|---|
| `eval/run` | POST | [B] MIGRATE | Evaluation runs — Kotlin API or worker |
| `eval/grade` | POST | [B] MIGRATE | Grading logic |

### Health & Network

| Route | Method | Classification | Notes |
|---|---|---|---|
| `health` | GET | [A] PROXY | Keep — pings DB + Redis for infra health; expose from Kotlin too |
| `network/outbound-ips` | GET | [B] MIGRATE | |

### Mock / Demo

| Route | Method | Classification | Notes |
|---|---|---|---|
| `mock-agents` | GET | **[C] DELETE** | Demo mock agents — remove after platform is stable |
| `mock-agents/success` | POST | **[C] DELETE** | |
| `mock-agents/fail` | POST | **[C] DELETE** | |
| `mock-agents/approval` | POST | **[C] DELETE** | |
| `mock-agents/slow` | POST | **[C] DELETE** | |
| `book-demo` | POST | [B] MIGRATE | Marketing form — move to Kotlin API or external service |

---

## Frontend API Client

**File:** `apps/web/lib/api/client.ts`

The single authorised way for frontend code to call the backend.

```ts
import { apiFetch, apiGet, apiPost, withWorkspace } from "@/lib/api/client";

// GET with workspace scoping
const run = await apiGet<Run>(withWorkspace(`/api/platform/runs/${id}`));

// POST with JSON body
const result = await apiPost<{ runId: string }>("/api/platform/workflows/xyz/run", { input });
```

**Configuration:**

| Env var | Default | Purpose |
|---|---|---|
| `NEXT_PUBLIC_VECTORBEA_API_URL` | `""` (relative) | Kotlin API base URL. When blank, all paths resolve against the Next.js origin. |

Set `NEXT_PUBLIC_VECTORBEA_API_URL=https://api.vectorbea.com` once the Kotlin API is deployed.

---

## Forbidden Import Rule

Run `npm run check:boundaries` (or `node scripts/check-forbidden-imports.mjs`) to verify no frontend code imports backend-only modules.

**Forbidden in `apps/web` UI/library code:**

| Import | Reason |
|---|---|
| `@/server/db` | Prisma DB client — server only |
| `@/lib/generated/prisma` | Generated Prisma types — server only |
| `getSecretForRuntime` | Secret decryption — server only |
| `secret-service` | Secret service module — server only |
| `executeWorkflow` | Workflow executor — moves to Kotlin worker |
| `workflow-executor` | Workflow executor module |
| `ioredis` | Redis client — server only |
| `bullmq` | Redis job queue — server only |
| `@/server/services` | Server service layer |

**Allowed only in:**
- `app/api/**` — Next.js API routes (temporary; will be replaced by Kotlin API)
- `server/**` — Server-side service modules
- `lib/server/**` — Server-only library modules
- `lib/workflow-runtime/**` — Workflow execution engine (moves to Kotlin worker)
- `lib/dal/**` — Data access layer (server-only)

---

## Migration Phases

### Phase 1 — Boundary Isolation (DONE ✓)

- [x] Created `apps/web/lib/api/client.ts`
- [x] `lib/repository/` delegates to `apiFetch` (no raw `fetch` + no duplicated workspace helpers)
- [x] `scripts/check-forbidden-imports.mjs` added
- [x] `check:boundaries` npm script added
- [x] All Next.js API routes classified
- [x] This document created

### Phase 2 — Kotlin API Shell

- [ ] Create `apps/api-kotlin` project (Ktor or http4k)
- [ ] Implement health endpoint
- [ ] Implement auth middleware (JWT or session token validation)
- [ ] Implement platform CRUD endpoints (workflows, runs, agents, tools)
- [ ] Set `NEXT_PUBLIC_VECTORBEA_API_URL` in staging env
- [ ] Verify `check:boundaries` still passes
- [ ] Migrate `platform/workflows/**` and `platform/runs/**` Next.js routes → delete

### Phase 3 — Connections & Secrets in Kotlin API

- [ ] Port secret-service to Kotlin (AES-256-GCM, same `enc_v1:` prefix)
- [ ] Port SSRF protection to Kotlin
- [ ] Implement `connections/**` endpoints in Kotlin API
- [ ] Delete corresponding Next.js routes

### Phase 4 — Kotlin Worker

- [ ] Create `apps/worker-kotlin` project
- [ ] Implement Redis job consumer (compatible with BullMQ or native)
- [ ] Port workflow executor logic to Kotlin
- [ ] Port LLM call logic (OpenAI function-calling loop)
- [ ] Implement durable event emission to Postgres
- [ ] Implement checkpoint/approval/retry/replay
- [ ] Remove `platform/workflows/[id]/run` and `execute` Next.js routes
- [ ] Remove `lib/workflow-runtime/` from Next.js entirely

### Phase 5 — Cleanup

- [ ] Delete all [C] mock/demo routes
- [ ] Delete all migrated [B] Next.js routes
- [ ] Remove Prisma client from `apps/web/package.json`
- [ ] Remove `ioredis`, `bullmq` from `apps/web/package.json`
- [ ] Create `packages/contracts` with OpenAPI spec
- [ ] Generate TypeScript types for `apps/web` from contracts
- [ ] `check:boundaries` passes with zero false positives

---

## Data Flow Diagrams

### Current (Phase 1) — Run Trigger

```
Browser
  │  click "Run Now"
  ▼
POST /api/platform/workflows/:id/run  (Next.js API route)
  │  creates run record (Postgres via Prisma)
  │  schedules via after()
  ▼
after() → executeWorkflow()  (lib/workflow-runtime/workflow-executor.ts)
  │  reads graph from Postgres
  │  reads secrets (AES decrypt)
  │  calls OpenAI / tool endpoints
  │  writes events to Postgres
  ▼
Browser polls GET /api/platform/runs/:id/events  every 1.5 s
```

### Target (Phase 4) — Run Trigger

```
Browser
  │  click "Run Now"
  ▼
POST https://api.vectorbea.com/v1/workflows/:id/run  (Kotlin API)
  │  validates session + workspace membership
  │  creates run record (Postgres)
  │  enqueues job → Redis
  │  returns { runId }
  ▼
Kotlin Worker (dequeues job)
  │  loads graph from Postgres
  │  resolves secrets (never leaves worker)
  │  executes graph, emits events to Postgres
  │  publishes events to Redis pub/sub
  ▼
Kotlin API streams events via SSE → Browser (EventSource)
Browser shows live progress
```
