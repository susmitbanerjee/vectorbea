# API gaps — what the redesign needs and what the API serves

Audited 2026-08-19 against `apps/api-kotlin` at `d113ab4`, the redesign in
`apps/web/src/**`, and `docs/architecture/09-EXECUTION-ARCHITECTURE-REVISED.md` §4.
Extended the same day with the OBSERVE screen audit (P10–P13, §6) and the
BUILD screen audit (P14–P18, §7) and the CONNECT/GOVERN audit (P19–P20, §8).

**Total: 48 gaps — 28 missing endpoints (❌), 20 shape deltas (⚠️).**
GAP-01–21 platform · GAP-22–32 OBSERVE (§6) · GAP-33–41 BUILD (§7) · GAP-42–48 CONNECT/GOVERN (§8).

§8.1 records a fixed authorization defect: every workspace owner was being
authorised as a viewer.

The headline is narrower than expected, and in an unexpected place. The *schema*
is largely built: migration `V027__ui_schema_gaps.sql` closed four of the six
architecture gaps outright, and `V023` closed a fifth. What is missing is mostly
the **read path** — tables and writers exist, endpoints do not. Three features
(audit log, ribbon, approval decision context) have complete storage and no way
to get the data out.

---

## 0. Read this before trusting the ERD

`docs/architecture/vectorbea_full_erd.md` is **stale**. It is missing at minimum
`audit_log`, `agent_runs.ribbon_json`, `node_total`, `node_committed`,
`priority`, `fair_vtime`, and `execution_class` — all of which exist in
migrations and are queried by live code. It also still shows both `approvals`
and `run_approvals` without indicating which won.

Everything below was audited against the **migrations and route handlers**, not
the ERD. Regenerating the ERD is a cheap and worthwhile chore.

---

## 1. Type generation — there is no OpenAPI spec, and generating one is not cheap

`apps/api-kotlin` exposes no OpenAPI or Swagger document, and has no dependency
that could produce one.

The reason matters more than the fact. The service does not run on Ktor, Spring
or Javalin — it runs on the JDK's built-in `com.sun.net.httpserver` with a
hand-rolled `Router`, and every response is assembled as an untyped map:

```kotlin
private fun AgentRun.toResponse(): Map<String, Any?> = mapOf(
    "id" to id.toString(),
    "totalTokens" to tokenCount,
    …
)
```

There is no framework to introspect and no typed DTO to reflect over. A
generator plugin would have nothing to read.

**Decision: hand-written Zod contracts in `packages/shared/src/contracts/`,**
with the schemas as the source of truth and TypeScript types `z.infer`red from
them. They are transcribed from the `toResponse()` functions and are therefore a
hand-maintained mirror — which is exactly why they are enforced at runtime at
the transport boundary (§2) rather than merely trusted.

### The OpenAPI side quest, honestly costed

It is worth doing, and it is **not** cheap — but the expensive part is not the
spec. It is that `mapOf(…)` is not a contract. The sequence is:

1. Replace `Map<String, Any?>` responses with `@Serializable` data classes
   (~25 route files, ~5,200 lines). This is the real cost, and it is worth doing
   on its own merits — it would have caught three of the shape deltas below at
   compile time.
2. Then a spec can be generated from those classes, and
   `openapi-typescript` can replace the hand-written contracts.
3. Then CI can diff the generated types and fail the web build on a breaking
   change.

Until step 1 happens, CI cannot meaningfully gate on API drift, because there is
nothing machine-readable to diff. **The runtime validation in §2 is the
substitute**: it catches the same drift, one release later and at runtime rather
than at build time. That is a real downgrade and should not be treated as
equivalent.

---

## 2. Runtime validation — shipped

Every response with a declared contract is parsed through Zod in
`src/lib/api/transport.ts` before any caller sees it.

- Mismatch → `VectorbeaApiError` with `intent: "contract_mismatch"`, carrying
  the full Zod issue list, the payload, and the **server's** `X-Request-Id`.
- Development → console group plus an unmissable overlay
  (`ContractMismatchOverlay`).
- Production → quiet for the user, but always reported via `onContractMismatch`.
  The payload is reduced to its *shape* (`{ id: "string", cost: "null" }`)
  before leaving the browser, so a contract report never becomes a customer-data
  leak.
- `contract_mismatch` is **never retryable**. A schema disagreement does not
  heal on a second call, and offering "Try again" would be a lie.

The mock transport validates against the same schemas, so fixtures cannot drift
from the contract either.

---

## 3. The gap table

Legend: ✅ exists and matches · ⚠️ exists, shape differs · ❌ no endpoint

### 3.1 Runs

| # | Need | State | Detail |
|---|---|---|---|
| GAP-01 | Checkpoint ribbon per run | ⚠️ | `agent_runs.ribbon_json`, `node_total`, `node_committed` **exist** (V027) and are worker-maintained in-transaction. `RunRoutes.AgentRun.toResponse()` **does not select them**. No N+1 risk — the column is there, the DTO ignores it. Roughly a five-line change. |
| GAP-02 | `workflowName` on a run row | ⚠️ | List returns `workflowId` only. The Runs table shows a name, so today it needs one `/api/workflows` fetch and a client-side join. |
| GAP-03 | `environment` as a name | ⚠️ | Returns `environmentId` (UUID). UI filters by `"production" \| "staging" \| "development"`. Needs a name on the row or a resolvable environment list. |
| GAP-13 | Run status vocabulary | ⚠️ | API: `completed`, `awaiting_approval`, `timed_out`. UI: `succeeded`, `awaiting-approval`. Reconciled in one place — `contracts.toUiRunStatus()`. |
| GAP-14 | Cost/token field names | ⚠️ | API `estimatedCostUsd`/`totalTokens` vs fixture `costUsd`/`tokens`. |
| GAP-15 | `nodes[]` on a run | ⚠️ | Detail-only, and via `/api/runs/:id/events`, not on the summary. The run list cannot draw a graph. |
| GAP-16 | `incidentId` on a run | ⚠️ | Not on the run. Reachable only via `/api/runs/:runId/failure-incident`, i.e. one call per row. |
| — | Queue position and ETA | ✅ | `/api/runs/:id/queue-position` (V023). Better than the UI asked for: distinguishes `tenant_cap` from `global_saturation`, and measures ETA from real throughput rather than modelling it. Returns `etaSeconds: null` honestly when throughput is unmeasurable. |

### 3.2 Failures and incidents

| # | Need | State | Detail |
|---|---|---|---|
| GAP-04 | Group-by-failure-code clustering | ❌ | `/api/failure-incidents` is a **flat** list with `status`/`category`/`limit` filters and no page envelope. The Incidents screen clusters by signature. Client-side grouping over a capped `limit` would silently under-count — the one thing a cluster count must not do. |
| GAP-05 | Incident occurrence sparkline | ❌ | UI `IncidentView` wants occurrences-per-hour over 24h. No aggregate endpoint. |
| — | Incident detail fields | ✅ | `retryable`, `autoReplaySafe`, `remediationJson`, `recommendedAction` all served — exactly what the Recovery Engine card needs. |

### 3.3 Connections

| # | Need | State | Detail |
|---|---|---|---|
| GAP-06 | Blast radius | ❌ | UI `BlastRadius` needs dependent workflows (with the binding node name), tools, agents, and queued run ids. Nothing computes it. The fixture resolves it from live graphs client-side; the API cannot, because the web app never holds every workflow's graph. |
| GAP-07 | Connection health history | ❌ | UI shows a health trend. API gives only `lastTestStatus`/`lastTestLatencyMs` — a single point. |
| — | Connection detail | ✅ | Rich and well-designed: `secretConfigured` instead of a secret ref, `networkStatus`, allow-lists, sanitised last-test error. |

### 3.4 Governance

| # | Need | State | Detail |
|---|---|---|---|
| GAP-08 | Audit log read | ✅ | **Closed.** `GET /api/audit` (Next.js, `lib/server/audit-records.ts`) reads `public.audit_log` with workspace scoping, range/action/result/actor filters and a `COUNT` over the same predicates. There is still no Kotlin `AuditRoutes.kt`: the web app queries Postgres directly, as it already does for members, support and auth. Moving the read into the API later is a refactor, not a gap. |
| GAP-09 | Approval decision context | ⚠️ | The largest single delta. V027 made `run_approvals` authoritative and added `sla_deadline_at`, `escalation_policy_json`, `decision_context_json` (**resolved** values, not templates) and `confidence_score`. `ApprovalRepository` **still queries the legacy `approvals` table**, so none of the four reach the API. The approvals screen is designed around exactly those fields. |
| GAP-17 | Approval SLA countdown | ⚠️ | Part of GAP-09: `slaRemainingMs` has a column and no read path. |
| GAP-18 | Approval evidence steps | ❌ | UI `EvidenceStep` links each context field to the run node that produced it. No endpoint. |

### 3.5 Registry

| # | Need | State | Detail |
|---|---|---|---|
| GAP-10 | Agent/tool reverse index | ❌ | UI `Reference` answers "what breaks if I change this" — workflow, environment, node id and node name per usage. No endpoint. Requires scanning every workflow's live graph, so it must be server-side. |
| GAP-11 | Workflow version diff | ❌ | `/api/workflows/:id/versions` lists; nothing compares two. |
| GAP-19 | Workflow aggregates | ⚠️ | `successRate30d`, `spend30dUsd`, `last30`, `avgDurationMs`, `owner`, `tags`, `connectionNames` are all in the fixture and none are served. |
| GAP-20 | `stepCount` on the workflow list | ⚠️ | Sharp edge: the list hard-codes `Triple(0, 0, 0)` because `graphJson` is not loaded. **It returns `0`, not null** — a zero that means "not computed". Detail returns the true count. Must not be rendered as real on the list. |

### 3.6 Fleet, control and debug

| # | Need | State | Detail |
|---|---|---|---|
| GAP-12 | Usage forecasting | ❌ | UI `Forecast` predicts when each limit is hit from today's elapsed rate. No endpoint, no rollup. |
| GAP-21 | Worker heartbeat as a timestamp | ⚠️ | `/api/workers` returns `heartbeat` **pre-rendered** as `"40s ago"`. The UI cannot re-render it as it ages, localise it, or sort by it — a fleet view's freshness silently freezes at whatever the server said. Should be an ISO timestamp. |
| — | Fleet health | ✅ | `/api/workers` and `/api/control/metrics` between them cover it, and `/api/control/metrics` carries a `freshness` block stating how stale each figure may be. |
| — | Node debug snapshots | ✅ | **Fully served, as predicted.** V017 plus three endpoints. `inputTemplate`, `resolvedInput`, `resolvedVariables` and `variableSources` are all present — the I/O mapping preview can show provenance, not just final values. |

---

## 4. Degradation decisions

Recorded per gap. Flags live in `apps/web/src/lib/flags/flags.ts`; each names the
gap that keeps it off, so the two cannot drift apart.

### (a) Build now — small, and blocking a core screen

| Gap | Why | Estimate |
|---|---|---|
| **GAP-01** ribbon | Column exists and is maintained. Add three fields to `AgentRun.toResponse()`. | ~5 lines |
| **GAP-02/03** name + environment | One join each in `RunRepository.list`. Removes an N+1 the Runs page would otherwise do on every render. | ~20 lines |
| **GAP-20** `stepCount` zero | Return `null` on the list instead of `0`. A wrong number is worse than an absent one. | ~2 lines |
| **GAP-21** heartbeat | Return the ISO timestamp; let the client format. | ~3 lines |
| ~~**GAP-08** audit read~~ | Done. `GET /api/audit` serves `public.audit_log`; filtering and the total both run in the database. Offset paging, not cursor — the screen needs "page 7 of 249" and a total, which a cursor cannot give. | shipped |
| **GAP-09** approvals | Point `ApprovalRepository` at `run_approvals` and expose the four V027 columns. The migration already did the hard part; leaving two approval tables live is also a correctness risk in its own right. | ~150 lines |

### (b) Feature-flag off — real feature, needs real backend work

| Gap | Flag | Note |
|---|---|---|
| GAP-04 clustering | `failureClustering` | Needs a `GROUP BY` endpoint over `failure_incidents`. Do not approximate client-side: an under-count is worse than no count. |
| GAP-06 blast radius | `connectionBlastRadius` | Needs server-side graph traversal. |
| GAP-10 reverse index | `registryReverseIndex` | Same traversal as GAP-06; build them together. |
| GAP-11 version diff | `workflowVersionDiff` | Diff of two `graph_json` documents. |
| GAP-12 forecasting | `usageForecasting` | Needs a rollup; `daily_workspace_usage` is a plausible base. |
| GAP-18 evidence steps | `approvalDecisionContext` | Blocked behind GAP-09. |

### (c) Honest empty state — visible, accurate, not a spinner

`<NotAvailableYet>` (`src/components/app/not-available-yet.tsx`) renders these.
Used where the surrounding screen is still worth showing:

- **GAP-05** sparkline → "Occurrence history is not available yet."
- **GAP-07** connection health history → "Health history is not available yet."
- **GAP-15/16** run graph and incident link on the list → link to the detail view.
- **GAP-19** workflow aggregates → omit the column; never render `0%` or `$0.00`.

### Never

No silent mock data in `live` mode. No zeros presented as measurements. No
perpetual skeleton — a skeleton that never resolves is a lie with extra steps.
`NEXT_PUBLIC_DATA_MODE=mock` is the only path to fixtures, and it paints a
permanent badge.

---

## 5. Summary

| Category | Count |
|---|---|
| ❌ No endpoint | 9 |
| ⚠️ Shape differs | 12 |
| ✅ Served and matching | 5 areas |
| **Total gaps** | **21** |

| Decision | Gaps |
|---|---|
| (a) Build now | 6 |
| (b) Flag off | 6 |
| (c) Honest empty state | 6 |
| Already served | 3 |

The UI ran ahead of the API — but less far than the fixture count suggests, and
the distance is mostly in **read paths for data already being written**, not in
missing capability. Six of the twenty-one are small enough to close in a single
sitting, and two of those (GAP-08, GAP-09) unblock whole screens.

The one genuine architectural debt is the absence of a machine-readable
contract. Everything in §3 was found by reading Kotlin by hand, and it will have
to be re-found by hand after the next API change. Typed response DTOs are the
fix, and they pay for themselves the first time they turn one of these shape
deltas into a compile error.

---

## 6. OBSERVE screens (P10–P13) — endpoint audit

Added while wiring Control, Runs, Run Detail, Approvals and Incidents.

### 6.1 The SSE stream does not do what it looks like it does

`GET /api/runs/:id/stream` (`RunRoutes.streamEvents`) replays persisted events
and then relays live ones, which reads like "a late subscriber misses nothing".
Read against the source, it has three defects. All three are client-compensated
in `src/lib/api/run-stream.ts`; all three are cheap to fix properly.

| # | Defect | Consequence | Fix |
|---|---|---|---|
| **GAP-22** | History capped at the **first 500** events (`PageParams(pageSize = 500)`, `ORDER BY sequence ASC`) | A run with 900 events streams 1–500 then jumps to live. **Events 501–900 never arrive.** A hole in the middle, not a truncated tail — and nothing reports it | Accept a cursor and start from it; `listByRun` already takes `afterSequence` |
| **GAP-23** | No resume. No `Last-Event-ID`, no `?afterSequence=` | Every reconnect replays from sequence 0. The client must de-duplicate the whole history on each drop | The same cursor as GAP-22 |
| **GAP-24** | Race between the Phase-1 DB read and the Phase-3 Redis `subscribe()` | Anything published in that window is delivered by neither path. Lost silently | Subscribe first, then read, then de-duplicate — or accept it and document the client backfill |

**Client compensation.** `openRunStream` de-duplicates on `sequence` (a Set, not
a high-water mark, because the replay is not guaranteed contiguous) and backfills
via `GET /api/runs/:id/events?afterSequence=N` — which *does* support resumption
— on open and on every reconnect. That closes all three holes at the cost of one
extra request per connection. Verified in `__tests__/run-stream.test.ts` by
killing the connection mid-run.

**GAP-25 — the stream cannot be authenticated by header.** `EventSource` cannot
set `Authorization`, so the token travels as a query parameter. It is same-origin
over TLS, but tokens in URLs land in access logs and proxy logs. A short-lived
single-use stream ticket (`POST /api/runs/:id/stream-ticket`) would remove the
exposure. Decision: **(c) accept and document** for now.

### 6.2 Control (P10)

| # | Need | State | Decision |
|---|---|---|---|
| — | Health strip: in-flight, queue depth, utilisation | ✅ | `/api/control/metrics`, with a `freshness` block |
| **GAP-26** | Workspace-wide activity stream | ❌ | `run_events` is only queryable with `run_id = ?` in the WHERE clause — there is no cross-run query at any layer. **(b) flag off.** Not approximable: polling N runs is the N+1 this screen exists to avoid |
| **GAP-27** | Fleet heatstrip — last 30 outcomes for every workflow in one call | ❌ | Nothing returns per-workflow recent outcomes. The fixture's `last30` is generated. **(b) flag off** — and explicitly must not become one call per workflow |
| — | Failure budget, spend vs budget | ⚠️ | Covered by GAP-19 (no workflow aggregates) and GAP-12 (no forecast) |
| — | Approvals aging | ⚠️ | Blocked behind GAP-09 — `sla_deadline_at` is not read |
| — | Needs-attention: unhealthy connections + blocked counts | ⚠️ | Connection status ✅; "blocked counts" is GAP-06 blast radius ❌ |
| — | Time range applied to all bands | ❌ | No list endpoint accepts a time range. `/api/runs` filters on `status` and `workflowId` only. **The selector cannot be wired to the server at all** |

### 6.3 Runs (P11)

| # | Need | State | Decision |
|---|---|---|---|
| — | Server-side pagination | ✅ | `page`/`pageSize`, capped at 100 |
| **GAP-28** | Server-side filtering beyond status/workflow | ⚠️ | `/api/runs` accepts **only** `status` and `workflowId`. The query language has eleven fields. `since`, `cost`, `env`, `trigger`, `duration`, `tokens`, `steps`, `incident` and bare text cannot be pushed down |
| **GAP-29** | Server-side sorting | ❌ | No `sort` parameter. Order is fixed |
| — | Inline Checkpoint Ribbon | ⚠️ | GAP-01. **(b) flag off** (`checkpointRibbon`), degrading to a status badge — never N+1 |
| — | Failure clustering band | ❌ | GAP-04. **(b) flag off** |
| — | Bulk retry / cancel | ✅ | `/api/runs/:id/{retry,cancel}` exist; bulk is N calls client-side, which is correct for a user-initiated action on an explicit selection |
| **GAP-30** | Saved views | ❌ | No endpoint, no table. **(c) localStorage**, per the brief |

On GAP-28, the compiler in `src/lib/api/query-compile.ts` returns an
`unsupported[]` list and the UI states which filters were not applied. It does
**not** filter client-side. Filtering one server page of 163,000 rows by
`cost>0.01` yields a table that is wrong rather than incomplete — wrong count,
wrong pagination, and no admission of either.

### 6.4 Run detail (P12)

| Need | State | Note |
|---|---|---|
| Initial load: run + events | ✅ | `/api/runs/:id` and `/api/runs/:id/events`, both server-prefetchable |
| Events paginated by sequence | ✅ | `afterSequence` + `pageSize` up to 500 |
| Failure incident | ✅ | `/api/runs/:runId/failure-incident` |
| Recovery Engine card | ✅ | `retryable`, `autoReplaySafe`, `remediationJson`, `recommendedAction` all served |
| **Retry / Replay / Re-run as three distinct operations (R01)** | ✅ | Genuinely three: `retry` re-enqueues the same run, `replay` creates a new run from the original inputs, `rerun` runs against the *current* workflow version. No mislabelling needed |
| Node debug snapshots | ✅ | Fully served |
| Replay scrubber from in-memory data | ✅ | Nothing to add server-side — events are already fully loaded |

Run detail is the **best-served screen in the product**, and the only one of the
five with no blocking gap.

### 6.5 Approvals (P13)

Blocked on **GAP-09**. `ApprovalRepository` reads the legacy `approvals` table,
so `decision_context_json` (the resolved values), `sla_deadline_at`,
`escalation_policy_json` and `confidence_score` never reach the API.

- Decision context → **(c) honest degraded state.** The brief is explicit: if the
  API returns unfilled templates rather than resolved values, show that. Do not
  fabricate.
- SLA countdown → cannot be computed; there is no deadline to count down to.
  **(b) flag off** (`approvalDecisionContext`).
- Approve / reject → ✅ endpoints exist. Reject reason is enforced client-side;
  server-side enforcement is **unverified** — `/api/approvals/:id/reject` accepts
  a body, but whether `reason` is required was not confirmed.
- **GAP-31 — reassign has no endpoint.** Only approve and reject exist.

### 6.6 Incidents (P13)

- Grouped by code with occurrence counts → **GAP-04** ❌
- Sparklines → **GAP-05** ❌
- Affected runs → meant to reuse the Runs table, but there is no
  `runs?incidentId=` filter (**GAP-16**), so the list cannot be built
- Acknowledge → ✅ `/api/failure-incidents/:id/mark-resolved` and
  `/api/incidents/dead-letters/:id/acknowledge`
- **GAP-32 — assign and mute have no endpoints.** Only acknowledge/resolve.

### 6.7 What this means for the five screens

| Screen | Wireable today | Blocking gaps |
|---|---|---|
| **Run detail (P12)** | **Fully** | none |
| **Runs (P11)** | Mostly — list, pagination, status/workflow filter, bulk actions | ribbon, clustering, sort, most filters, saved views |
| **Approvals (P13)** | List and decide only | resolved context, SLA, reassign |
| **Control (P10)** | Health strip only | activity stream, heatstrip, time range, blast radius |
| **Incidents (P13)** | Flat list only | grouping, sparklines, affected runs, assign, mute |

The screen the demo most depends on — Run detail — is the one that is fully
served. Control is the least served: three of its four bands have no endpoint.

---

## 7. BUILD screens (P14–P18) — endpoint audit

### 7.1 Assumptions in the brief, checked

| Assumption | Verdict |
|---|---|
| "Visual diff computed client-side from two `graph_json` payloads — no API work needed" | **Correct.** `WorkflowVersion.toResponse()` returns the parsed `graph` in full, plus `inputSchema`, `outputSchema`, `triggerConfig` and the three policies. Implemented in `src/lib/api/graph-diff.ts`. One caveat: `/api/workflows/:id/versions` returns *every* version with its full graph, so diffing two of two hundred ships two hundred graphs. Pagination problem, not a blocker |
| "`workflow_node_debug_snapshots` carries `resolved_input_json` and `variable_sources_json` — the data almost certainly already exists" | **Correct, and it is the best-served thing in the builder.** Wired: `src/lib/api/node-debug.ts` + `ResolvedInputPreview` |
| "Templates from static config or DB — determine which" | **Static.** `src/mocks/templates.ts`. No `templates` table in the schema, no endpoint. Not a gap — a deliberate static catalog |
| "Blueprint materialisation streams from `_events` (SSE or polling — check)" | **Polling only.** There is no architect SSE endpoint. `workflow_architect_events` has no read route at all; progress comes from `GET /api/architect/sessions/:id/build-steps` |

### 7.2 New gaps

| # | Need | State | Decision |
|---|---|---|---|
| **GAP-33** | Workflow validation endpoint | ❌ | No `/validate`. **(c)** Validate client-side against the graph schema and **label it as client-side** — the brief's own instruction. A client-only check must not be presented as a server guarantee |
| **GAP-34** | Simulate step in the publish flow | ❌ | No `/simulate`. **(b) flag off and disable the step.** Publish becomes draft → validate → publish. Faking a simulate that does nothing is worse than not offering it |
| **GAP-35** | Node-type catalog | ❌ | Nothing serves available node types. The palette must stay a client constant. **(c)** — note in the UI that the palette is build-time, so a node type added server-side will not appear until the web app ships |
| **GAP-36** | Optimistic locking on version save | ❌ | `createVersion` takes a graph, writes a new version and calls `setCurrentVersion` unconditionally. **Two concurrent editors: last write silently wins.** The brief requires "never silent overwrite" and the server cannot currently honour it |
| **GAP-37** | Test-this-node / agent / tool invoke | ❌ | Only `/api/connections/:id/test` and the architect's connection test exist. There is no way to invoke a single node, agent or tool. **(b) flag off** the test consoles in P16 and P17 |
| **GAP-38** | Architect event stream | ❌ | `workflow_architect_events` is written and never read over HTTP. **(c) poll** `build-steps`; the seven-stage pipeline is fully readable that way |
| **GAP-39** | Architect cancel | ❌ | Sessions can be created, advanced and read, but not cancelled. Resume works — `GET /api/architect/sessions/:id` carries the state. **(b) flag off** cancel |
| **GAP-40** | Provenance in the debug snapshot is a **guess** | ⚠️ | `WorkflowRuntime` recovers the source node by regex from the template text and matches it against node ids/labels; the resolver does not report it. Also, `resolvedValue` is looked up per FIELD, so two expressions in one field both carry the whole field's value. The preview renders "probably from X" and never draws it as a definite edge |
| **GAP-41** | `resolvedVariables` duplicates `variableSources` | ⚠️ | Both columns are written from the same list. Harmless, but one of them should go before something starts depending on a difference that does not exist |

### 7.3 GAP-36 in detail — why "concurrent edit detection" is only half-possible

The brief asks for conflict detection with an explicit resolve UI, never a silent
overwrite. The client can compare the `currentVersionId` it loaded against the
one currently on the workflow before saving, and refuse to save when they differ.
That catches the common case — two people with the builder open — and it is worth
doing.

It is **not** a guarantee. Between the check and the write there is a window in
which the other save lands, and nothing in the API rejects the second write.
Closing it properly needs one of:

- `POST /api/workflows/:id/versions` accepting `expectedCurrentVersionId` and
  returning **409** on mismatch, or
- an `If-Match` header against a workflow ETag.

Either is a small change to `createVersion`. Until then, the UI should describe
what it does honestly: "checked when you saved", not "protected".

### 7.4 What this means for the five BUILD screens

| Screen | Wireable today | Blocking gaps |
|---|---|---|
| **Inspector (P16)** | I/O mapping preview **fully**; registry pickers fully | test-this-node (GAP-37) |
| **Workflows (P14)** | List, version history, client-side diff, publish | simulate (GAP-34), validate (GAP-33) |
| **Architect (P18)** | Seven-stage pipeline, quota-before-prompt, resume, all generation steps | streaming (GAP-38), cancel (GAP-39) |
| **Builder (P15)** | Load/save graph, autosave | validation (GAP-33), palette (GAP-35), **safe concurrent save (GAP-36)** |
| **Agents & Tools (P17)** | List, detail, create/edit | reverse index (GAP-10), test consoles (GAP-37) |

The Inspector's I/O mapping preview — the screen the brief singles out — is
**fully served**, and Architect is the best-served feature area in the product:
fifteen endpoints including quota, readiness and per-requirement connection
binding.

---

## 8. CONNECT and GOVERN screens (P19–P20) — endpoint audit

### 8.1 The role bug — root cause found and fixed

**Symptom:** Settings showed "Your role: Viewer" beside a row saying Owner.

**Root cause:** two role vocabularies that disagreed, silently.

```
database  CHECK (role IN ('owner', 'admin', 'developer', 'viewer'))   -- V006
typescript type WorkspaceRole = "viewer" | "editor" | "admin"          -- was
```

They matched on two of four values. `normalizeRole` returned `"viewer"` for
anything it did not recognise, so `owner` and `developer` were both demoted.
`editor` was in the union but is **not a permitted database value**.

**This was not a display bug.** `lib/auth/oauth-upsert.ts` inserts every OAuth
sign-up as `owner`, so `hasWorkspaceRole(role, "admin")` returned **false for
every workspace owner** — across the 29 files that import the guard. An owner
was refused admin-gated routes such as creating a policy pack. The mislabelled
header was the visible half of an authorization defect.

**Fixed:**

- `lib/server/assert-workspace-member.ts` — union now matches the database
  exactly; `owner` ranks above `admin`; `editor` is accepted as a legacy alias
  for `developer` rather than demoted; unknown still falls back to `viewer`.
- `packages/shared` — `workspaceRole`, `ROLE_LEVEL`, `normalizeWorkspaceRole`,
  `roleAtLeast`, and the `me` contract, which normalises role on parse.
- `src/lib/auth/permissions.ts` — one capability matrix.
- `src/lib/auth/use-role.ts` — the only supported way for a screen to read the
  role, keyed by the ACTIVE workspace because role is per membership.

Fifteen tests in `__tests__/workspace-role.test.ts`, including a regression
guard that fails if the union is ever re-narrowed.

**Related — GAP-42, now closed.** `app/api/workspaces/[id]/invitations/route.ts`
defaulted new invitations to `role: "editor"`, and `lib/server/invitations.ts`
inserted `inv.role` straight into `workspace_members`. `editor` violates the
CHECK constraint, so accepting a default-role invitation failed at the database.
The default is now `viewer`, `parseRole` accepts `editor` only as an alias for
`developer`, and `owner` is refused outright — ownership is transferred from the
Members list, not invited. The whole flow also moved off the Supabase
`vectorbea.workspace_invitations` table, which no deployment provisions, onto
`public.workspace_invitations` (V038); `POST /api/auth/accept-invite` verifies
the application's own JWT rather than calling `supabase.auth.getUser`, which had
rejected every accept regardless of the token presented.

### 8.2 Secrets — verified never returned ✅

The brief asked for this to be verified rather than assumed. It holds:

- `ConnectionResponse` carries `secretConfigured: Boolean`, with the comment
  *"replaces secretRef — never expose the ref"*. There is no secret or ref field
  on any read path.
- `secretRef` appears only on the write side (`encryptSecretIfPresent`).
- Rotation has its own endpoint: `POST /api/connections/:id/rotate-secret`.

The UI can therefore show "credential set" and offer rotation without ever
having a secret to leak.

### 8.3 New gaps

| # | Need | State | Decision |
|---|---|---|---|
| **GAP-43** | Connection **blast radius** | ❌ | Still no endpoint. The brief authorises building it, and it is a straightforward join — `tools.connection_id`, plus a scan of each live workflow version's `graph_json` for bound connections, plus a count of queued runs on the affected workflows. **Not built here: this environment has Java 8 and `apps/api-kotlin` sets `jvmToolchain(17)`, so the module cannot be compiled or tested.** Shipping Kotlin I cannot build would be worse than flagging it. **(b) flag off** (`connectionBlastRadius`) until it can be written and verified against a real toolchain |
| **GAP-44** | Integration catalogue from the API | ❌ | Same as templates — the catalogue is static (`src/mocks/connectivity.ts`). Connected state IS derivable from `/api/connections`, so `ProviderLogo` colour can be driven by real status against a static catalogue. **(c)** — works, but a provider added server-side needs a web deploy to appear |
| **GAP-45** | Schedule `overlap_policy` / `misfire_policy` | ⚠️ | The columns exist; `ScheduleRoutes.toResponse()` returns `cron`, `timezone`, `nextRun`, `lastRun`, `status` and the workflow link, but **not** the two policies. The Triggers screen shows them. Small DTO addition |
| **GAP-46** | Webhook and manual/API trigger management | ❌ | `/api/schedules` covers cron only. Trigger *types* live in `workflow_versions.trigger_config`, which is readable but has no management endpoint. **(b) flag off** the non-cron trigger tabs |
| **GAP-47** | Schedule backfill | ❌ | Enable/disable exist (`PATCH /api/schedules/:id`). There is no backfill action |
| **GAP-48** | Reset workspace | ❌ | No reset or delete-workspace endpoint at all. **(b) flag off the danger zone** — an action with no endpoint must not render as a button |
| — | Real counts for a destructive confirmation | ✅ | Achievable today without new work: `/api/runs` and `/api/workflows` both return `total` in the page envelope, so "This deletes 163 runs and 11 workflows" can be built from two calls. Worth wiring **when** GAP-48 lands — the count is real, the action is not |

### 8.4 Next-five-fire-times

Client-side, no API work — `src/lib/cron.ts` already exists, and the schedule
DTO returns both `cron` and `timezone`. The server computes `nextFireAt` with
`CronExpression.parse(...).nextAfter(now, zone)`, so a client implementation
must use the same timezone semantics or the first of the five will disagree with
the server's `nextRun`.

### 8.5 Audit log screen

Unchanged from GAP-08: table and writer exist, no read endpoint. Ship the screen
behind the `auditLog` flag with the honest empty state, exactly as the brief
asks.

### 8.6 Permissions

`src/lib/auth/permissions.ts` gates presentation only. Every module in it says
so, and it is worth repeating here: **client-side gating is not security.** The
server re-checks through `assertWorkspaceMember` / `requireWorkspaceRole`, which
is why fixing the role union mattered — the client and the server now agree on
what an owner is, and both were wrong in the same direction before.
