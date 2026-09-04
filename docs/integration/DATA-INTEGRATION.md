# Data integration — state of play

Written 2026-08-19 against `apps/api-kotlin` at `d113ab4`.
Companion to [API-GAPS.md](./API-GAPS.md), which holds the 48 numbered gaps.

> **Read §6 first if you are preparing a demo.** It lists every place the
> interface implies a capability the API cannot serve.

---

## 1. Headline

The data layer is built and tested. **No screen consumes it yet.** Every screen
in `src/components/app/**` still renders fixtures, and those fixtures reach
production.

| | |
|---|---|
| Screens on live data | **0 of ~15** |
| Screens on fixtures | **80** |
| `src/**` files importing fixtures | **87** |
| Production chunks containing fabricated data | **4**, including `layout-*.js` |
| Numbered API gaps | **48** (28 missing endpoints, 20 shape deltas) |
| Tests covering the data layer | **69**, all passing |

The gap between "data layer ready" and "screens live" is the whole remaining
job. It is not blocked on the frontend: roughly half of each screen depends on
endpoints that do not exist.

---

## 2. Fixtures in production — measured, not assumed

The brief asked for bundle verification rather than an assumption. Verified:

```
.next/static/chunks/7128-*.js                    inc_7c2f18ab90de, run_01JBQZ8XK4
.next/static/chunks/app/(app)/layout-*.js        Acme Platform, ws_acme_eu, run_01JBQZ8XK4
.next/static/chunks/app/(app)/settings/page-*.js Acme Platform
.next/static/chunks/app/(marketing)/page-*.js    run_01JBQZ8XK4
```

`layout-*.js` is the significant one: it loads on **every authenticated page**,
so a fabricated workspace named "Acme Platform" is downloaded by every user on
every visit.

`src/mocks/**` is 7,876 lines / 360KB of source.

### Why the directory was not deleted

87 files import it. Deleting it breaks the build at 87 places and deletes the
only thing those screens currently render. The requirement — *nothing can
silently render fake data* — is met by making the debt visible, countable and
unable to grow, then wiring screens one at a time.

### What was put in place instead

**A ratchet, not a ban.** `eslint.config.mjs` errors on any `~/mocks` import
outside three allowlisted categories (the mock transport, `src/mocks` itself,
`*.stories.tsx`) plus an explicit 87-file migration baseline. Verified working:
a new file importing `~/mocks/fixtures` fails lint immediately. The list only
shrinks; a file leaves it when its screen is wired.

**`npm run check:fixtures`** reports the debt and fails when fixture markers are
found in built chunks. It currently **fails**, correctly, on the four chunks
above. That failure is the deliverable's own success criterion, not a defect in
the check.

**Not added to CI while it fails.** Wiring a red check into CI blocks every PR.
Add this step to the `web` job the moment the bundle is clean:

```yaml
      - name: Fixtures
        run: npm run check:fixtures
```

### Marketing pages are a separate case

`src/components/marketing/recovery-loop.tsx` hard-codes `run_01JBQZ8XK4` in an
illustrative animation. That is **not** the same defect: a landing-page
illustration is understood to be illustrative, whereas a Control screen showing
"163 runs" claims to be a measurement. Left alone deliberately.

---

## 3. What is built and proven

| Layer | State | Tests |
|---|---|---|
| Cookie sessions, single-flight token refresh | done | 5 |
| Typed transport: retry, timeout, 401 refresh-and-retry | done | 10 |
| Error taxonomy → UI intent | done | covered above |
| Runtime Zod validation at the boundary | done | 7 |
| Contracts in `packages/shared` | done | — |
| Mock transport (validated against the same contracts) | done | 3 |
| SSE run stream: resume, de-dup, backoff, polling fallback | done | 8 |
| Query-bar → API params compiler | done | 9 |
| Graph diff (client-side) | done | 9 |
| I/O mapping preview shaping | done | 9 |
| Role reconciliation + capability matrix | done | 15 |
| Scope isolation / cache leakage | done | 10 |

### Resilience — verified

- **Token expiry mid-session** — pre-emptive refresh 60s before expiry; twenty
  concurrent 401s collapse to one refresh. Proven.
- **SSE dropped mid-run** — connection killed mid-stream in test; resumes,
  de-duplicates the server's from-zero replay, delivers every sequence exactly
  once. Proven. Note this compensates for three real server defects (GAP-22/23/24).
- **Rapid environment switching** — scope sits at the front of every key, so two
  environments cannot share an entry; leaving a scope removes its subtree and
  nothing else. Proven across five switch rounds.
- **Sign-out** — `queryClient.clear()`, so nothing is served to the next user.
  Proven.
- **API down** — transport raises `upstream_unavailable` after retries rather
  than throwing; screens render an error state. Structurally correct, **not
  observed end-to-end** (see §5).

---

## 4. Endpoints consumed, per screen family

| Screen family | Endpoints the client can call today |
|---|---|
| Run detail | `/api/runs/:id`, `/api/runs/:id/events`, `/api/runs/:id/stream`, `/api/runs/:runId/failure-incident`, `/api/workflow-runs/:runId/debug/nodes[/:nodeId]`, `/api/runs/:id/{retry,replay,rerun,cancel}` |
| Runs list | `/api/runs` (page, pageSize, status, workflowId) |
| Control | `/api/control/metrics`, `/api/workers` |
| Approvals | `/api/approvals`, `/api/approvals/:id/{approve,reject}` |
| Incidents | `/api/failure-incidents`, `/api/failure-incidents/:id/mark-resolved` |
| Workflows / Builder | `/api/workflows`, `/api/workflows/:id`, `/api/workflows/:id/versions`, `/api/workflows/:workflowId/run` |
| Registries | `/api/agents`, `/api/tools`, `/api/connections`, `/api/connections/:id/{test,rotate-secret}` |
| Architect | 15 endpoints under `/api/architect/*`, including `usage` (quota) and `readiness` |
| Identity | `/api/me` — the single source of truth for role |

---

## 5. Not verified, and why

Honesty about the limits of this pass.

| Requirement | Status |
|---|---|
| Screenshots of loading / error / empty / 403 per screen | **Not produced.** The Browser pane in this environment does not composite frames, so no screenshot can be taken. Attempted twice |
| Forced conditions (block the API, 500, empty array, 403) | **Not exercised end-to-end.** No API, Postgres or Redis runs here; `curl localhost:8080` refuses. Error *paths* are unit-tested; error *screens* do not exist yet |
| 3G throttle, no layout jumps | **Not measured.** Needs rendered screens |
| Runs list with 10k rows | **Not measured.** Needs a database. Pagination is server-side by construction (`page`/`pageSize`, capped at 100) |
| Request count / bytes per screen | **Not measured.** Needs a running app with wired screens |
| N+1 request log | **Not measured**, but two offenders are known statically and both are prevented by design: the Checkpoint Ribbon degrades to a badge behind a flag rather than firing one request per row (GAP-01), and the Control fleet heatstrip is flagged off entirely because the one-call endpoint does not exist (GAP-27) |

None of these can be closed without a running stack. They are the first things
to do on a machine with Postgres, Redis, JDK 17 and the API up.

---

## 6. Where the UI promises more than the backend delivers

**The section that matters most.** Each of these is a demo that fails in front
of someone. All are flag-off or honest-empty-state today; the risk is a flag
being switched on without the endpoint landing.

| # | The UI implies | The API provides | Flag |
|---|---|---|---|
| GAP-27 | A fleet heatstrip: last 30 outcomes for every workflow | Nothing. No per-workflow recent outcomes at any layer | `fleetHealth` guards the served part; heatstrip stays off |
| GAP-26 | A live workspace activity stream | `run_events` is queryable **only** with `run_id = ?`. There is no cross-run query | off |
| GAP-04 | Failures clustered by signature with counts | A flat list, capped by `limit`. Client-side grouping would **under-count**, which is worse than not shipping | `failureClustering` |
| GAP-06 | "This broken connection blocks 12 workflows and 41 runs" | Nothing computes it. That number is the entire point of the feature | `connectionBlastRadius` |
| GAP-09 | Approval decision context with **resolved** values | `ApprovalRepository` still reads the legacy `approvals` table; `decision_context_json`, `sla_deadline_at`, `escalation_policy_json`, `confidence_score` never reach the API | `approvalDecisionContext` |
| GAP-08 | A governance audit trail | Table and writer exist; **no read endpoint**. Data is being written that nothing can retrieve | `auditLog` |
| GAP-12 | "You will hit your limit on Thursday" | No forecast endpoint, no rollup | `usageForecasting` |
| GAP-48 | A danger zone that resets the workspace | No reset endpoint at all. The *counts* for the confirmation are obtainable (`total` on two list endpoints); the action is not | off |
| GAP-20 | A workflow list showing step counts | Returns hard-coded **`0`** on the list (`Triple(0,0,0)`) — a zero meaning "not computed". Must render as absent, never as zero | — |
| GAP-01 | An inline Checkpoint Ribbon per run | `ribbon_json` exists and is maintained; the DTO does not select it. ~5 lines from working | `checkpointRibbon` |
| GAP-22/23/24 | "A late subscriber misses nothing" on the run stream | History capped at the first 500 events, no resume cursor, and a read-then-subscribe race. **Client compensates**; the server claim is still false | — |
| GAP-34 | A publish flow with a simulate step | No simulate endpoint. Step disabled rather than faked | off |
| GAP-37 | Test consoles for agents and tools | No invoke endpoint. Only connection tests exist | off |
| GAP-36 | Safe concurrent editing | `createVersion` has no optimistic locking. **Last write silently wins.** Client-side check is best-effort, not a guarantee | — |

### Fixed during this work

| | |
|---|---|
| **Role bug** | The TS union `"viewer"\|"editor"\|"admin"` disagreed with the DB constraint `('owner','admin','developer','viewer')`. `owner` and `developer` were silently demoted to `viewer`. Since every OAuth sign-up is inserted as `owner`, **every workspace owner was authorised as a viewer** across 29 files. Fixed; 15 tests |
| **Empty run lists** | The client read `payload.runs`; the API returns `Page<T>` with `items`. Every list would have been silently empty |
| **Mock/live divergence** | Mock mode served UI-shaped fixtures while the API returns different shapes, so mock mode never exercised the real contract. Mock now emits API shapes and validates against the same shared schemas |
| **Stale-token replay** | The transport re-read the token on 401 replay instead of using the refreshed one — worked only because the browser provider caches |

---

## 7. Recommended order

1. **The six small Kotlin changes** (API-GAPS §4a, ~350 lines): ribbon fields,
   workflow name + environment on the run row, `stepCount` null instead of zero,
   heartbeat as a timestamp, audit read endpoint, approvals table switch. These
   unblock Control, Approvals and Incidents at once. Needs JDK 17.
2. **`expectedCurrentVersionId` on `createVersion`** — closes GAP-36, the one
   defect here that can silently destroy a user's work.
3. **Wire Run detail** — the only screen with zero blocking gaps, and the one a
   demo runs through.
4. **Wire Runs, then Approvals** — removing each from the ESLint baseline as it
   lands, so `check:fixtures` counts down.
5. **Turn on the CI fixture gate** once the bundle is clean.

Steps 3–5 are the point at which "0 of 15 screens live" starts moving, and at
which the four contaminated chunks start emptying.
