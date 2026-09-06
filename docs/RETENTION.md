# Tiered retention

How long a workspace's data is kept, how it is deleted, and what the numbers say
about why it is built this way.

Companion to `docs/PLANS-AND-ENTITLEMENTS.md` — retention windows are
entitlements like any other, resolved from the workspace's billing account and
never from the requesting user's plan.

---

## 1. Retention is a deletion, not a filter

Data past retention is **gone from Postgres**. There is no `hidden` column, no
`deleted_at` predicate, and no read-time filter anywhere in this feature.
`RetentionAcceptanceTest` asserts that no such column exists, and will fail the
build if one appears.

The reason is that a filter is a promise every future code path has to keep. The
bytes stay on disk, still billed, and one forgotten `WHERE` — in an export, a
support query, a direct API call, a feature written next year — puts them back
in front of somebody. A delete is a fact instead of a promise: if the row is not
in `run_events`, no query over `run_events` can return it, however it is written.

The one thing that looks like a filter, `retention_effective_days`, computes a
**cutoff for deletion**. It decides what to remove, not what to show.

---

## 2. Five entities, because they differ in cost and in value

| Entity | Tables | Why its own window |
|---|---|---|
| `runs` | `agent_runs` + ~20 cascading children | The record. Longest window; cheapest per row. |
| `events` | `run_events` (monthly partitions) | The timeline. |
| `traces` | `run_spans` (monthly partitions) | The forensics. Largest table per §12.1. |
| `payloads` | `run_payloads`, `run_payload_blobs` | Largest content per row, shortest window. |
| `archives` | `run_trace_archives` + object store | Outlives the partition it came from. |

The usual right shape is *the record persists, the forensics do not* — 90 days of
run summaries alongside 7 days of full traces. A single number would force the
cheapest, most valuable data to share a window with the most expensive and most
perishable, and whichever way it is set, one of them is wrong.

Windows are plan entitlements: `retention_days_runs`, `_events`, `_traces`,
`_payloads` (V060) and `_archives` (V061). Changing one is an `UPDATE`, not a
deploy.

---

## 3. The measurement, and what it decided

§3 of the brief asked for the cost of row-level deletion to be measured before
choosing a mechanism. Measured 2026-09-04, postgres:16, 2,000,000 events in one
monthly partition (2.88 GB, 40 workspaces interleaved, 50k rows each — the
partition's real index set):

| Operation | Rows | Time | Bytes returned to the OS |
|---|---|---|---|
| Per-workspace row delete, cold cache | 49,679 | **22.8 s** | 0 |
| Per-workspace row delete, warm cache | 49,680 | 0.75–1.8 s | 0 |
| `VACUUM` after 250k deletes | — | **84 s** | **0** (2955 MB → 2955 MB) |
| `DETACH` + `DROP PARTITION` | 2,000,000 | **1.8 s** | **2955 MB → 0** |

Three findings, each of which changed the design.

**A row-level delete returns no storage.** `VACUUM` frees space for *reuse*
inside the table; the file keeps its high-water mark until the partition is
dropped. Deleting 12.5% of the rows made the table *grow* — 2880 MB to 2955 MB —
before vacuum. So row-level deletion is here for **correctness** (§1: the data is
gone) and the **storage lever is, and remains, the partition drop**.

**The delete is heap-bound, not index-bound.** `Heap Blocks: exact=50000` for
50,000 rows — one block per row, because workspaces interleave in insert order,
so one workspace's month is scattered across the entire heap. The index scan was
30 ms of a 22.8 s statement. That is why V061 adds **no** `(workspace_id,
created_at)` index to `run_events`: it already has `run_events_workspace_idx`,
the planner picks it, and a better index would optimise 0.1% of the cost while
adding maintenance to the hottest write path in the system. `run_spans` gets one
only because it had no workspace index at all and would otherwise
sequential-scan.

**The real storage wins are the unpartitioned entities.** `run_payloads` and
`run_payload_blobs` hold the largest content per row and are not partitioned, so
deletion is the only reclaim there is — and `run_payloads.expires_at` plus its
index have been waiting for this since V040. Archive objects are the other:
retiring one returns real bytes in the bucket, immediately.

---

## 4. Downgrade: grace, warning, export, then deletion

A Pro workspace with 90 days of traces moving to Free (7 days) must not lose 83
days instantly.

```
plan change ──► sweeper OBSERVES it ──► grace (default 30 days) ──► deletion
                     │                        │
                     │                        ├─ old window still honoured
                     ├─ workspace_retention_  ├─ warned, with dates
                     │  state records the     └─ export offered and automatic
                     │  window it had
                     └─ notified_at stamped
```

* **Observe precedes delete in the same pass.** The sweeper records every
  workspace's window before it deletes anything, so there is no sweep in which a
  workspace both learns of a downgrade and loses data to it.
* **Grace is a maximum, not a swap:** the window in force is
  `GREATEST(new, previous)`. A workspace that downgrades and then upgrades past
  its old window is not held back by stale state.
* **Two downgrades do not shorten the first one's protection.** Team → Pro →
  Free carries Team's 90 days and the later of the two grace deadlines. A
  customer sliding down the tiers is in more trouble, not less.
* **An upgrade is immediate** and closes any running grace. Nobody needs
  protecting from more retention.

The dates the customer sees come from `retention_effective_days`, the same
function the deleter calls. The page never does date arithmetic — a browser in
another timezone would otherwise show a day the job does not honour, and the day
on the screen is the one the customer remembers.

### Why there is no soft-delete column

The brief asks for "soft-delete before hard-delete". That is implemented as
**export, then delete, then expire the export** rather than as a hidden-row flag:

| Phase | Where the data is | Recoverable? |
|---|---|---|
| Grace | Postgres, fully visible | n/a |
| Deleted | Export bundle only | Yes, for `WORKSPACE_EXPORT_DAYS` (30) |
| Expired | Gone | No |

This gives the recoverable window a soft-delete exists for, without a predicate
every read path has to remember (§1). The middle phase is a real second copy the
customer can download, not a row we are still storing and choosing not to show.

---

## 5. Export before delete

`WorkspaceExporter` streams NDJSON.gz into the archive store. Two callers, one
writer, one ledger (`workspace_exports`):

* a person pressing **Export** — `POST /api/retention/exports` writes a `queued`
  row, a worker claims it with a CAS and runs it, the client polls `status`;
* the **sweeper**, before its first destructive batch, unless a bundle already
  covers the range.

Both produce identical bundles, because both go through the same function. "Was
this exported before it went" has to be answerable from one place.

An empty range writes **no object at all** — probed with an indexed `LIMIT 1`
before the object is opened. `ArchiveStore` has no `delete` (deliberately; it is
the store whose contract is that it never garbage-collects), so an object written
for a range that turned out to be empty would be orphaned in the bucket forever,
one per empty sweep per workspace per hour. `RetentionAcceptanceTest` found that.

---

## 6. The job says when it last worked

`retention_sweeps` holds one row per pass: `running`, then `succeeded`, `failed`
or `interrupted`. `GET /health/retention` reads it and returns **503** when the
job is stale or stuck, so the uptime check that already exists catches it —
rather than a 200 with a `stale: true` field somebody has to write an alert rule
against.

Two failures, reported separately because the fixes differ:

* **stale** — nothing has succeeded within `RETENTION_STALE_AFTER_HOURS` (26).
  The job is stopped, crashing, or was never started.
* **stuck** — a sweep has been `running` for over 30 minutes. It holds the Redis
  lock, so nothing else can start. From outside this looks exactly like stale and
  is not.

This exists because the repo has shipped scheduled SQL functions with no caller
twice already (V028, V046). `MigrationFunctionCallersTest` catches the missing
caller; this catches the caller that stopped.

---

## 7. Every deletion is auditable

`retention_deletions` records, per batch: the workspace, the entity, the window
in days, **the policy that authorised it** (`plan` / `grace` / `platform_floor`),
the plan code, the cutoff, the scope, rows deleted, bytes freed, and the export
key if one was written.

The policy is denormalised on purpose. The plan can change tomorrow; the reason
this row went must not. `GET /api/retention/deletions` serves a workspace its own
rows — platform-wide operations (a partition drop, an archive retirement) carry a
null workspace and are deliberately not exposed, because telling one customer
when another's data moved is not their business.

---

## 8. Idempotent and resumable, with no cursor

Every batch is `DELETE ... WHERE created_at < cutoff LIMIT n`, committed on its
own. "What is expired" is recomputed from the data each time, so:

* interrupted anywhere, the next pass finds exactly what the last one missed,
  because those rows still match the predicate;
* run twice, the second pass finds nothing;
* there is no stored cursor to go stale, point at a deleted row, or need
  invalidating when the policy changes.

The cost is re-planning each batch — about 30 ms of a 1.5 s batch — which buys
the removal of an entire class of resume bug.

A pass that exceeds `RETENTION_MAX_RUNTIME_SECONDS` (600) stops, marks itself
`interrupted`, and leaves the rest for the next one. That is a normal outcome,
not a failure.

---

## 9. What the measurement argues for next: partition by retention class

**Not built. This is the recommendation §3 asked for, with the numbers behind
it.**

The problem the numbers expose: a time partition holds *every* tenant's rows for
that month, so it can only be dropped once the **most generous** window in the
system has passed — `retention_platform_floor_days()`. One Enterprise workspace
on 365 days pins every partition for a year, including the 2.9 GB of free-tier
traces inside it. Row-level deletion removes those rows correctly but returns
**zero bytes** until the partition drops.

The fix is to make the partition key `(retention_class, month)`, so a free-tier
partition for September can be dropped on 8 October while the enterprise
partition for the same month lives out its year.

What makes it tractable is that **it composes with the grace period rather than
fighting it**. The obvious objection is that a plan change would have to move
rows between partitions — an `UPDATE` of a partition key, which is a delete plus
an insert, over months of data. It does not:

* a workspace that downgrades keeps its existing rows in the paid partition,
  which honours the **old** window — exactly what grace requires;
* its **new** rows land in the free partition;
* the old rows age out under the old policy and the partition drops on schedule.

No row movement, and the downgrade behaviour falls out of the layout instead of
needing a job.

The cost is real and is why it is not in V061: converting `run_events` is a
re-partition of the hottest table in the system. V028 already declines its own
conversion above ~5M rows and prints the manual procedure; this would need the
same treatment plus a maintenance window, a rehearsal, and a way to derive
`retention_class` on the write path. It belongs in its own change with its own
rollback plan.

---

## 10. Configuration

| Variable | Default | What it does |
|---|---|---|
| `RETENTION_DELETE_ENABLED` | `false` | Actually delete. Off logs `WOULD DELETE` lines instead. |
| `RETENTION_INTERVAL_MS` | `3600000` | Sweep interval. |
| `RETENTION_BATCH_SIZE` | `5000` | Rows per statement. |
| `RETENTION_MAX_RUNTIME_SECONDS` | `600` | Budget per pass. |
| `RETENTION_STALE_AFTER_HOURS` | `26` | When `/health/retention` returns 503. |
| `WORKSPACE_EXPORT_DAYS` | `30` | How long an export bundle is served. |
| `TRACE_ARCHIVE_DIR` | — | Where bundles and archives are written. |

`RETENTION_DELETE_ENABLED` is off by default and should stay off for at least one
full cycle of log review per environment. The first run of a deleter against real
customer data is irreversible, and a cycle of `WOULD DELETE` lines is the cheapest
way to find a mis-seeded window before it costs somebody their traces.

---

## 11. Measured result

From `RetentionAcceptanceTest`, one full cycle on a free-tier workspace
(7-day windows) holding 23 runs — 20 of them 40 days old, 3 of them 1 day old:

```
workspace storage, before -> after one full cycle (free plan, 7-day windows)
  events         rows    115 -> 15       bytes     17480 -> 2280
  payloads       rows     23 -> 3        bytes      3864 -> 504
  runs           rows     23 -> 3        bytes      6256 -> 816
```

An 87% reduction across all three entities, with everything inside the window
untouched — which the test also asserts, because a sweep that deleted everything
would pass "storage fell" and be a catastrophe.

Byte figures are estimated from `pg_column_size` over a bounded sample of the
workspace's own rows. The first version of that function divided
`relpages * block_size` by `reltuples` — the textbook estimate — and returned
**zero** for every table, because `reltuples` is `-1` until something has
`ANALYZE`d the table and a freshly migrated database has not. Row counts moved
correctly while the byte column read 0.00, which is the worst kind of wrong:
plausible, and silently useless. Read the delta, not the absolute number.
