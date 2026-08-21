# Endpoint inventory — `apps/api-kotlin`

Generated 2026-08-19 by reading every `Router` registration in
`apps/api-kotlin/src/main/kotlin/com/vectorbea/api/**`, not by guessing from the
client or from `API-GAPS.md`.

**121 routes across 32 route classes. All 32 classes are registered in `Main.kt`
— there are no orphaned route files.**

| Method | Count |
|---|---|
| GET | 65 |
| POST | 45 |
| PATCH | 5 |
| DELETE | 4 |
| PUT | 1 |
| GET (SSE) | 1 |

## How this was produced, and what is actually verified

Extraction is mechanical: every `router.get/post/put/patch/delete/sseGet("…")`
call site, with file and line. Regenerate it with:

```bash
grep -rnoE '\.(get|post|put|patch|delete|sseGet)\s*\(\s*"(/[^"]*)"' --include='*.kt' .
```

Both `\s*` matter, and this is not hypothetical fussiness — the registrations are
column-aligned for readability, so the codebase contains `router.get( "/api/…"`
(space after the paren) **and** `router.get ( "/api/…"` (space before it, used
throughout `WorkflowArchitectRoutes.kt`). A regex missing the first drops three
routes; missing the second drops six, including
`GET /api/architect/sessions/:id`. Both mistakes were made while producing this
document, and each one silently under-reports rather than failing loudly.

Two levels of confidence are mixed below, and they are not equally strong:

- **Verified live.** The service was run locally on JDK 17 against the real Neon
  database (`RUN_MIGRATIONS=false`, so validate-only) and the endpoint was
  exercised over HTTP with a real workspace id. Sixteen were:
  `/health`, `/ready`, `/version`, `/api/status`, `/api/workers`,
  `/api/bootstrap`, `/api/me`, `/api/workflows`, `/api/runs`, `/api/agents`,
  `/api/tools`, `/api/connections`, `/api/failure-incidents`,
  `/api/incidents/dead-letters`, `/api/approvals`, `/api/dashboard/summary`.
  Only GET was exercised — nothing in this audit wrote to the database.
- **Read from source.** Everything else. Response shapes come from the
  `toResponse()` functions and `Response.ok(...)` call sites. Treat those as
  accurate-to-the-code, not proven-over-the-wire.

Nothing in this document is inferred from the web client or from fixtures.

### What the live run found

Flyway reported `[migrations] schema validation passed`, so the deployed schema
matches this jar's migrations. Two endpoints still **fail against it**:

| Endpoint | Result |
|---|---|
| `GET /api/dashboard/summary` | **500** — `relation "approvals" does not exist` |
| `GET /api/approvals` | **500** — `relation "approvals" does not exist` |

Migration `V027__ui_schema_gaps.sql` consolidated `approvals` into
`run_approvals` and renamed the old table to `approvals_deprecated_v027`.
`repository/ApprovalRepository.kt` (lines 67, 94, 127, 133) and
`repository/DashboardRepository.kt` (line 78) were never updated. Schema
validation cannot catch this — Flyway checks migration checksums, not whether
application SQL still matches the tables those migrations produced.

It is not a rename-and-go fix: V027 also normalised status to upper case, moved
to `node_id`, and added `workspace_id`/`environment_id` to the winning table.

**`GET /api/me` returns 401 in dev mode** and is the only endpoint that does. It
dereferences `req.principal`, so unlike every other route it cannot be reached
without a genuine Supabase JWT — `X-Workspace-Id` is not a substitute.

### The environment filter is the reason screens look empty

`GET /api/bootstrap` returns the workspace's real environment. **Every workflow,
run, agent and tool row in the live database references a different environment
id that does not exist in the `environments` table at all.** So:

```
GET /api/workflows  with X-Environment-Id from bootstrap  → {"items":[],"total":0}
GET /api/workflows  with no X-Environment-Id              → 1 real workflow
```

Passing the bootstrap environment filters out **all** real data. Omitting the
header returns it. Any screen that sends `X-Environment-Id` will render empty
against a live API holding real rows — which looks exactly like a broken screen
or a missing endpoint, and is neither. Fix the orphaned `environment_id` values
before concluding anything about a blank screen.

## Preconditions for exercising these endpoints

Every DB-backed route class is registered **conditionally on a database being
present**. With `DATABASE_URL` unset the service starts and logs, per route
group, `… disabled — no database`, and those paths return **404, not 503** —
they were never registered with the router. A 404 from `/api/workflows`
therefore means "the API booted without a database", not "wrong path". This is
the single most misleading failure mode in the service.

Redis is optional outside production: `RedisProvider` failures degrade to
`NoOpCacheService` with queue, locks, events and rate limiting disabled. Routes
that need the queue (`POST /api/workflows/:workflowId/runs/debug`, run triggers)
throw `ServiceUnavailable` rather than 404.

## Authentication

Implemented in `auth/AuthMiddleware.kt`, applied by `HttpServer` **before**
routing, so it covers every path uniformly.

**When `JWT_SECRET` / Supabase config is absent, auth is bypassed entirely** —
the middleware logs `AuthMiddleware: disabled (dev mode)` and requests proceed
with no principal. Locally this means **no Supabase token is required**; supply
`X-Workspace-Id` instead and it is trusted verbatim. This is the supported local
path and it removes the need for an `E2E_SUPABASE_TOKEN` against a dev server.

| Tier | Paths | Rule |
|---|---|---|
| Public | `/healthz`, `/health`, `/metrics`, `/version`, `/api/bootstrap`, `/api/network/check` | Never require auth. Matched by exact set **or prefix**. |
| Beta-allowed | `/api/me`, `/api/beta/status`, `/api/beta/apply`, `/api/health`, `/api/version` | Reachable by an authenticated but unapproved user. |
| Product | Everything else | Requires a verified Supabase JWT **and** `beta_status=approved` when `PRIVATE_BETA_MODE` is on. |

Two entries in that table are **stale and should be deleted from
`AuthMiddleware`**: `/api/network/check` and `/api/health` / `/api/version` are
not registered by any route class. `GET /api/health` returns 404 — confirmed
live. The real paths are `/health` and `/version`. Exempting paths that do not
exist is harmless today but is exactly the kind of drift that later exempts a
path that does.

### Workspace scoping

`api/RequestContext.kt` derives scope for every product endpoint:

- `X-Workspace-Id` header, or `?workspaceId=` — **required**.
- With a JWT principal, the requested workspace is checked against
  `authorizedWorkspaceIds` → **403** if not a member. A single membership is
  auto-selected when the header is omitted; multiple memberships without a
  header is a **400**.
- Without a principal (dev mode) the header is trusted as-is.
- `X-Environment-Id` (or `?environmentId=`) is optional on reads and
  **required** on the writes that call `requireEnvironmentId()` — notably
  `POST /api/workflows` and `POST /api/workflows/:workflowId/runs/debug`.

## Response conventions

`http/Response.kt` — `ok` → 200, `created` → 201, `noContent` → 204.

Every response body is assembled as an untyped `Map<String, Any?>`. There is no
typed DTO layer and no OpenAPI document; `API-GAPS.md` §1 costs that out and the
conclusion still holds.

Paginated lists return the `repository/Page.kt` envelope:

```json
{ "items": [], "total": 0, "page": 1, "pageSize": 20,
  "totalPages": 0, "hasNext": false, "hasPrev": false }
```

Paging is `?page=` / `?pageSize=` via `Request.pageParams()` — default 50, **max
100**, silently coerced rather than rejected. Note the mismatch: `Page.empty()`
defaults to `pageSize = 20` while `pageParams()` defaults to 50, so an empty
list reports a page size the caller never asked for.

Errors are uniform and carry a correlation id (verified live):

```json
{ "error": { "code": "NOT_FOUND", "message": "/api/me not found",
             "requestId": "3aae908962874a66" } }
```

---

## Routes

`Auth` column: **P** public · **B** beta-allowed · **W** workspace-scoped
product endpoint · **A** admin.

### Health, metadata, ops

| Method | Path | Auth | Params | Response | Source |
|---|---|---|---|---|---|
| GET | `/health` | P | — | `{status, service, time, version}` — **verified live** | `routes/HealthRoutes.kt:46` |
| GET | `/ready` | P | — | readiness; checks DB/Redis reachability | `routes/HealthRoutes.kt:47` |
| GET | `/version` | P | — | `{service, version, env}` — **verified live** | `routes/VersionRoutes.kt:18` |
| GET | `/metrics` | P | — | Prometheus text exposition | `routes/MetricsRoutes.kt:19` |
| GET | `/api/status` | W | — | Fleet liveness/load/headroom from `workers`. Liveness derived from heartbeat age: healthy <45s, stale >120s | `routes/FleetStatusRoutes.kt:61` |
| GET | `/api/control/metrics` | W | — | Control-page counters | `routes/ControlMetricsRoutes.kt:48` |
| GET | `/api/workers` | W | `workspaceId` | Worker rows | `routes/WorkerRoutes.kt:29` |
| GET | `/api/network/outbound-ips` | W | — | Static egress IPs for allow-listing | `routes/NetworkRoutes.kt:18` |

### Identity and bootstrap

| Method | Path | Auth | Params | Response | Source |
|---|---|---|---|---|---|
| GET | `/api/me` | B | — | Current user, workspaces, memberships | `routes/MeRoutes.kt:25` |
| POST | `/api/workspaces` | B | body | Creates a workspace | `routes/MeRoutes.kt:26` |
| GET | `/api/bootstrap` | P | — | Bootstrap state | `routes/BootstrapRoutes.kt:37` |
| POST | `/api/bootstrap` | P | body | Seeds initial workspace/environment | `routes/BootstrapRoutes.kt:36` |
| GET | `/api/beta/status` | B | — | Beta application status | `beta/BetaRoutes.kt:39` |
| POST | `/api/beta/apply` | B | body | Submits application | `beta/BetaRoutes.kt:40` |

### Workflows

| Method | Path | Auth | Params | Response | Source |
|---|---|---|---|---|---|
| GET | `/api/workflows` | W | `status`, `page`, `pageSize`, `X-Environment-Id` | `Page<Workflow>` via `listWithGraph` — LEFT JOINs versions for step/agent/tool counts. Cached 60s | `routes/WorkflowRoutes.kt:129` |
| POST | `/api/workflows` | W | body `{name, slug?, description?, status?}` | 201 Workflow. **Requires `X-Environment-Id`** | `routes/WorkflowRoutes.kt:130` |
| GET | `/api/workflows/:id` | W | — | Workflow + current version `graphJson` | `routes/WorkflowRoutes.kt:131` |
| PATCH | `/api/workflows/:id` | W | body `{name?, description?, status?}` | Updated workflow | `routes/WorkflowRoutes.kt:132` |
| DELETE | `/api/workflows/:id` | W | — | 204 | `routes/WorkflowRoutes.kt:133` |
| GET | `/api/workflows/:id/versions` | W | — | Version list | `routes/WorkflowRoutes.kt:135` |
| POST | `/api/workflows/:id/versions` | W | body `{graph}` | New version. **Sets current version unconditionally — no optimistic locking** (GAP-36) | `routes/WorkflowRoutes.kt:134` |

`status` is validated against `WORKFLOW_STATUSES`; `slug` is derived from `name`
when absent.

### Runs

| Method | Path | Auth | Params | Response | Source |
|---|---|---|---|---|---|
| POST | `/api/workflows/:workflowId/run` | W | body; `Idempotency-Key` supported | Enqueues a run | `routes/RunRoutes.kt:190` |
| GET | `/api/runs` | W | `status`, `workflowId`, `type`, `page`, `pageSize` | `Page<Run>`. **No time-range and no `sort`** (GAP-29, GAP-282) | `routes/RunRoutes.kt:193` |
| GET | `/api/runs/:id` | W | — | Run detail | `routes/RunRoutes.kt:194` |
| GET | `/api/runs/:id/events` | W | `afterSequence` | Run events, cursor-paged by sequence | `routes/RunRoutes.kt:195` |
| GET | `/api/runs/:id/stream` | W | — | **SSE.** Live run events; requires Redis pub/sub | `routes/RunRoutes.kt:198` |
| POST | `/api/runs/:id/cancel` | W | — | Cancels | `routes/RunRoutes.kt:201` |
| POST | `/api/runs/:id/retry` | W | — | Retries whole run | `routes/RunRoutes.kt:202` |
| POST | `/api/runs/:id/retry-node` | W | body `{nodeId}` | Retries one node | `routes/RunRoutes.kt:203` |
| POST | `/api/runs/:id/replay` | W | — | Replays | `routes/RunRoutes.kt:207` |
| POST | `/api/runs/:id/rerun` | W | — | New run from same input | `routes/RunRoutes.kt:208` |
| GET | `/api/runs/:id/queue-position` | W | — | Position in queue | `routes/QueuePositionRoutes.kt:32` |
| GET | `/api/runs/:id/chain` | W | — | Continuation chain | `routes/ContinuationRoutes.kt:48` |
| GET | `/api/runs/:runId/history-stats` | W | — | Durable-history size stats | `routes/DurableRunRoutes.kt:35` |
| POST | `/api/runs/:runId/continue-as-new` | W | — | Truncates history, continues | `routes/DurableRunRoutes.kt:36` |
| GET | `/api/runs/:runId/continuations` | W | — | Continuation records | `routes/DurableRunRoutes.kt:37` |
| POST | `/api/runs/:runId/recover` | W | — | Recovers a stuck run | `routes/DurableRunRoutes.kt:38` |
| GET | `/api/agent-iterations/:runId` | W | — | Per-iteration agent trace | `routes/AgentIterationRoutes.kt:21` |

### Debug runs

Captured **only** when a run was started in debug mode — never for normal
"Run Now" executions.

| Method | Path | Auth | Params | Response | Source |
|---|---|---|---|---|---|
| POST | `/api/workflows/:workflowId/runs/debug` | W | body `{input}` | Starts a debug run. Requires queue + `X-Environment-Id` | `routes/DebugRoutes.kt:86` |
| GET | `/api/workflow-runs/:runId/debug/nodes` | W | — | Per-node summaries | `routes/DebugRoutes.kt:87` |
| GET | `/api/workflow-runs/:runId/debug/nodes/:nodeId` | W | — | Resolved inputs/outputs, variable provenance, failure explanation | `routes/DebugRoutes.kt:88` |
| GET | `/api/workflow-runs/:runId/debug/nodes/:nodeId/attempts` | W | — | Attempt history | `routes/DebugRoutes.kt:89` |

### Agents and tools

| Method | Path | Auth | Params | Source |
|---|---|---|---|---|
| GET | `/api/agents` | W | `status`, `page`, `pageSize` | `routes/AgentRoutes.kt:104` |
| POST | `/api/agents` | W | body | `routes/AgentRoutes.kt:105` |
| GET | `/api/agents/:id` | W | — | `routes/AgentRoutes.kt:106` |
| PATCH | `/api/agents/:id` | W | body | `routes/AgentRoutes.kt:107` |
| DELETE | `/api/agents/:id` | W | — | `routes/AgentRoutes.kt:108` |
| GET | `/api/tools` | W | `status`, `type`, `page`, `pageSize` | `routes/ToolRoutes.kt:92` |
| POST | `/api/tools` | W | body | `routes/ToolRoutes.kt:93` |
| GET | `/api/tools/:id` | W | — | `routes/ToolRoutes.kt:94` |
| PATCH | `/api/tools/:id` | W | body | `routes/ToolRoutes.kt:95` |
| DELETE | `/api/tools/:id` | W | — | `routes/ToolRoutes.kt:96` |

### Connections

| Method | Path | Auth | Params | Notes | Source |
|---|---|---|---|---|---|
| GET | `/api/connections` | W | `status`, `type`, `page`, `pageSize` | Secrets never returned | `routes/ConnectionRoutes.kt:136` |
| POST | `/api/connections` | W | body | Secret encrypted AES-256-GCM; requires `SECRET_ENCRYPTION_KEY` | `routes/ConnectionRoutes.kt:137` |
| GET | `/api/connections/:id` | W | — | | `routes/ConnectionRoutes.kt:138` |
| PATCH | `/api/connections/:id` | W | body | | `routes/ConnectionRoutes.kt:139` |
| DELETE | `/api/connections/:id` | W | — | | `routes/ConnectionRoutes.kt:140` |
| POST | `/api/connections/:id/test` | W | — | Live credential test; writes `lastTestStatus`/`lastTestLatencyMs` | `routes/ConnectionTestRoutes.kt:41` |
| POST | `/api/connections/test-unsaved` | W | body | Tests before persisting | `routes/ConnectionTestRoutes.kt:42` |
| POST | `/api/connections/:id/rotate-secret` | W | body | | `routes/ConnectionTestRoutes.kt:43` |
| GET | `/api/connections/:id/list-models` | W | — | Provider model list | `routes/ConnectionTestRoutes.kt:44` |
| POST | `/api/connections/schema-preview` | W | body | Preview for unsaved connection | `routes/SchemaPreviewRoutes.kt:41` |
| POST | `/api/connections/:id/schema-preview` | W | body | Preview for saved connection | `routes/SchemaPreviewRoutes.kt:42` |

Connection mutations are written to `audit_log` by `api/audit/AuditLog.kt`. There
is still no read endpoint for it (GAP-08).

### Contracts and publish gate

| Method | Path | Auth | Notes | Source |
|---|---|---|---|---|
| GET | `/api/workflows/:id/contracts` | W | Active `node_contracts` | `contract/ContractRoutes.kt:44` |
| GET | `/api/workflows/:id/contracts/:nodeId` | W | | `contract/ContractRoutes.kt:45` |
| PUT | `/api/workflows/:id/contracts/:nodeId` | W | Upsert. The only PUT in the API | `contract/ContractRoutes.kt:46` |
| POST | `/api/workflows/:id/contracts/:nodeId/infer` | W | Infers schema from samples | `contract/ContractRoutes.kt:47` |
| POST | `/api/workflows/:id/contracts/:nodeId/test` | W | Tests sample output against the contract | `contract/ContractRoutes.kt:48` |
| GET | `/api/workflows/:id/publish-readiness` | W | **Server-side publish gate.** Joins live `graph_json` against active contracts and reports unenforceable schemas | `contract/ContractRoutes.kt:49` |

### Approvals and confidence

| Method | Path | Auth | Params | Source |
|---|---|---|---|---|
| GET | `/api/approvals` | W | `status`, `runId`, `workflowId`, paging | `routes/ApprovalRoutes.kt:68` |
| GET | `/api/approvals/:id` | W | — | `routes/ApprovalRoutes.kt:69` |
| POST | `/api/approvals/:id/approve` | W | body | `routes/ApprovalRoutes.kt:70` |
| POST | `/api/approvals/:id/reject` | W | body | `routes/ApprovalRoutes.kt:71` |
| GET | `/api/approvals/:id/gate` | W | — | Confidence gate for the decision | `confidence/ConfidenceRoutes.kt:41` |
| POST | `/api/approvals/:id/decide` | W | body | Records decision with confidence | `confidence/ConfidenceRoutes.kt:42` |
| GET | `/api/workflows/:id/calibration` | W | — | Calibration curve | `confidence/ConfidenceRoutes.kt:43` |
| GET | `/api/runs/:id/confidence` | W | — | Per-run confidence | `confidence/ConfidenceRoutes.kt:44` |

Note the overlap: `approve`/`reject` (ApprovalRoutes) and `decide`
(ConfidenceRoutes) are two decision paths on the same resource. Confirm which
the UI should call before wiring the screen.

### Incidents and dead letters

| Method | Path | Auth | Params | Source |
|---|---|---|---|---|
| GET | `/api/failure-incidents` | W | `status`, `category`, `limit` — **flat list, no page envelope** | `recovery/FailureIncidentRoutes.kt:18` |
| GET | `/api/failure-incidents/:id` | W | — | `recovery/FailureIncidentRoutes.kt:19` |
| POST | `/api/failure-incidents/:id/mark-resolved` | W | — | `recovery/FailureIncidentRoutes.kt:20` |
| GET | `/api/runs/:runId/failure-incident` | W | — | `recovery/FailureIncidentRoutes.kt:17` |
| GET | `/api/incidents/dead-letters` | W | `status` | `routes/DeadLetterRoutes.kt:29` |
| GET | `/api/incidents/dead-letters/:id` | W | — | `routes/DeadLetterRoutes.kt:30` |
| POST | `/api/incidents/dead-letters/:id/acknowledge` | W | — | `routes/DeadLetterRoutes.kt:31` |

### Schedules

| Method | Path | Auth | Notes | Source |
|---|---|---|---|---|
| GET | `/api/schedules` | W | Cron only | `routes/ScheduleRoutes.kt:26` |
| PATCH | `/api/schedules/:id` | W | Enable/disable/update. No backfill (GAP-47) | `routes/ScheduleRoutes.kt:27` |

### Dashboard

| Method | Path | Auth | Source |
|---|---|---|---|
| GET | `/api/dashboard/summary` | W | `routes/DashboardRoutes.kt:34` |

### AI Architect

Session-based, seven-stage pipeline. All `W`. Sixteen routes — the read side is
substantial and easy to miss, since every GET here is written `router.get (`.

| Method | Path | Source |
|---|---|---|
| POST | `/api/architect/sessions` | `architect/WorkflowArchitectRoutes.kt:27` |
| GET | `/api/architect/sessions/:id` | `:28` — carries full session state; the resume path |
| POST | `/api/architect/sessions/:id/generate-plan` | `:29` |
| POST | `/api/architect/sessions/:id/revise-plan` | `:30` |
| POST | `/api/architect/sessions/:id/approve-plan` | `:31` |
| GET | `/api/architect/sessions/:id/connection-requirements` | `:33` |
| POST | `/api/architect/sessions/:id/connection-requirements/:reqId/bind-existing` | `:34` |
| POST | `/api/architect/sessions/:id/connection-requirements/:reqId/use-simulation` | `:35` |
| POST | `/api/architect/sessions/:id/connection-requirements/:reqId/test` | `:45` |
| POST | `/api/architect/sessions/:id/generate-tools` | `:37` |
| POST | `/api/architect/sessions/:id/generate-agents` | `:38` |
| POST | `/api/architect/sessions/:id/create-workflow` | `:40` |
| GET | `/api/architect/sessions/:id/build-steps` | `:42` — the seven-stage pipeline state |
| GET | `/api/architect/sessions/:id/readiness` | `:43` |
| GET | `/api/architect/connections` | `:47` |
| GET | `/api/architect/usage` | `:49` — drives the build-limit display |

`API-GAPS.md` is correct that resume works via `GET /api/architect/sessions/:id`,
and correct that GAP-38 is pollable via `build-steps`. Build limit: 1 built
workflow per rolling 30 days, enforced at `create-workflow` and readable from
`/api/architect/usage`.

### Telemetry

| Method | Path | Auth | Notes | Source |
|---|---|---|---|---|
| POST | `/api/telemetry/events` | W | Client ingestion | `telemetry/TelemetryRoutes.kt:63` |
| POST | `/internal/telemetry/events` | service | Service-to-service; `INTERNAL_API_SECRET` | `telemetry/TelemetryRoutes.kt:69` |
| GET | `/api/admin/telemetry/summary` | A | | `:75` |
| GET | `/api/admin/telemetry/business` | A | | `:76` |
| GET | `/api/admin/telemetry/engineering` | A | | `:77` |
| GET | `/api/admin/telemetry/users` | A | | `:78` |
| GET | `/api/admin/telemetry/revenue` | A | Revenue reporting is disabled | `:79` |
| GET | `/api/admin/telemetry/architect` | A | | `:80` |
| GET | `/api/admin/telemetry/workflows` | A | | `:81` |
| GET | `/api/admin/telemetry/environments` | A | | `:82` |
| GET | `/admin/telemetry/styles.css` | A | Console asset | `AdminConsoleRoutes.kt:26` |
| GET | `/admin/telemetry/app.js` | A | Console asset | `AdminConsoleRoutes.kt:27` |

The whole telemetry group is **not registered when analytics has no database** —
`[telemetry] analytics disabled — no database; ingestion and admin routes not
registered`.

### Beta administration

All `A`.

| Method | Path | Source |
|---|---|---|
| GET | `/api/admin/beta/applications` | `beta/BetaRoutes.kt:43` |
| POST | `/api/admin/beta/applications/:id/approve` | `:44` |
| POST | `/api/admin/beta/applications/:id/reject` | `:45` |
| POST | `/api/admin/beta/workspaces/:wsId/enable-real-execution` | `:46` |
| POST | `/api/admin/beta/workspaces/:wsId/disable` | `:47` |
| GET | `/api/admin/beta/workspaces/:wsId/usage` | `:48` |

---

## Corrections to `API-GAPS.md`

Cross-referenced against all 121 routes. The audit is broadly sound — most of
the 48 gaps hold. These do not.

### GAP-43 — the stated cause is wrong

> "Not built here: this environment has Java 8 and `apps/api-kotlin` sets
> `jvmToolchain(17)`, so the module cannot be compiled or tested."

**JDK 17 is installed** at `C:\Program Files\Eclipse Adoptium\jdk-17.0.18.8-hotspot`.
It is not on `PATH` — `java -version` reports 1.8.0_492 because `JAVA_HOME`
points at the JDK 8 install — but Gradle 8.14 runs on it and
`:compileKotlin` succeeds. A 25 MB fat jar already exists at
`build/libs/vectorbea-api-0.1.0-all.jar`.

The toolchain was never the blocker. Set `JAVA_HOME` and the module builds:

```bash
JAVA_HOME="/c/Program Files/Eclipse Adoptium/jdk-17.0.18.8-hotspot" ./gradlew compileKotlin
```

The blast-radius endpoint is unbuilt, but for want of a decision, not a
compiler. The gap stands; **its stated reason must be struck**, because it has
been cited to defer Kotlin work at least twice.

### GAP-33 — a server-side validation endpoint exists

The gap says "No `/validate`" and recommends client-side validation labelled as
client-side. But `GET /api/workflows/:id/publish-readiness`
(`contract/ContractRoutes.kt:49`) reads the live `graph_json`, joins it against
active `node_contracts`, and reports which declared schemas the selected
provider path cannot enforce. That is a publish gate computed on the server.

It is not a general graph validator, so GAP-33 is not fully closed — but
"validate client-side and label it client-side" is the wrong recommendation
while a server gate exists and is unused. Rescope to "wire
`publish-readiness`; add graph-shape validation on top if still needed."

### Endpoints the audit does not mention at all

None of these appear anywhere in `API-GAPS.md`. Several bear directly on screens
the audit marked "flag off":

| Endpoint | Bears on |
|---|---|
| `GET /api/status` | Control page fleet health — real liveness/load/headroom |
| `GET /api/runs/:id/chain` | Continuation chains |
| `GET /api/agent-iterations/:runId` | Agent iteration traces |
| `GET /api/workflow-runs/:runId/debug/nodes` (+ `:nodeId`, `/attempts`) | Node-level inputs, outputs, provenance, attempts |
| `GET /api/workflows/:id/publish-readiness` | GAP-33 above |
| `GET /api/architect/usage` | The 1-build-per-30-days limit — readable, not just enforced |
| `GET /api/admin/beta/applications`, `GET /api/admin/beta/workspaces/:wsId/usage` | Beta admin screens |

`GAP-37` ("no way to invoke a single node, agent or tool") is still literally
true — but `POST /api/workflows/:workflowId/runs/debug` plus the three debug
read routes give node-level inputs, outputs and attempt history. Re-judge
whether the P16/P17 test consoles need single-node invocation, or whether a
debug run satisfies them.

### Gaps confirmed as still open

Spot-checked against the route table and correct as written: GAP-04, GAP-05
(no aggregation on `/api/failure-incidents` — flat list, `limit` only), GAP-06,
GAP-08 (writer exists, no read route), GAP-11 (no version compare), GAP-26,
GAP-27, GAP-29 (no `sort` on any list endpoint), GAP-36 (`createVersion` sets
current version unconditionally), GAP-46, GAP-47, GAP-48.

`/api/runs` accepting only `status`, `workflowId` and `type` is confirmed — there
is no time-range parameter on any list endpoint, so the OBSERVE time selector
cannot be server-wired today.
