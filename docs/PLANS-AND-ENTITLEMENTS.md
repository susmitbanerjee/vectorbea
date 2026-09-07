# Plans and entitlements (S3)

What a workspace is allowed to do, where that answer comes from, and how it is
enforced. No payment provider — S4 connects one to what this describes.

Schema: `apps/api-kotlin/src/main/resources/db/migration/V060__plans_and_entitlements.sql`.

---

## 0. The governing rule

> **Entitlements resolve from the workspace's billing account, never from the
> requesting user's plan.**

A Pro member acting inside a Free workspace gets Free limits. Everywhere.

This is not a convention anybody has to remember. It is a property of the
signatures:

```sql
resolve_entitlements(p_workspace_id UUID)   -- no parameter for a user
```

```kotlin
EntitlementResolver.resolve(workspaceId: UUID): Effective
EntitlementGuard.requireLimit(workspaceId: UUID, key: String, currentCount: Long)
```

There is no argument by which a caller could resolve from the actor. The one
method that takes a user — `requireNewWorkspaceAllowed(ownerUserId)` — does so
because there is no workspace to resolve from yet, and it resolves through a
workspace that user **owns**, never one they were invited to. See §5.2.

**The exploit this closes.** User U is on Pro through account A. Workspace W
belongs to account B, on Free. U is invited to W as a member. If any check read
"U's plan", U could run Pro-sized workloads inside a workspace B pays for — and
B's bill, B's retention and B's concurrency would be governed by a plan B never
bought. Sharing a workspace must not move who pays or which plan governs.

---

## 1. The pricing decision: per-seat, account-wide

Recorded here because it is a pricing decision and everything in S3 has a
different shape depending on the answer.

- A **billing account** subscribes to a plan and buys N seats.
- A **seat is a person**, counted once across the account no matter how many of
  its workspaces they belong to. `account_seats_used()` is the definition, and
  it is a `COUNT(DISTINCT user_id)`. That `DISTINCT` is the whole model: adding a
  colleague to a second workspace is free, which is what makes "invite them to
  the project workspace" an ordinary action rather than a billing event.
- **Workspaces are not priced.** `max_workspaces` is a plan limit, not a price
  driver.
- **Quotas are account-scoped**: one monthly allowance shared by every workspace
  on the account. The `scope` column exists so a future plan can say otherwise
  per key, without a schema change.
- `plans.price_model` records this as data (`per_seat`), so a per-workspace plan
  can later coexist rather than forcing a migration.

For S4: one subscription per account, quantity = seats. `billing_accounts` already
carries `external_customer_id`, `external_subscription_id`, `plan_status` and the
period columns, so S4 is an UPDATE and not a migration.

---

## 2. The model

```
billing_accounts ──owns──> workspaces ──has──> workspace_members
       │                                              │
       │ plan_code                                    │ (seats = COUNT DISTINCT user_id)
       ▼
     plans ──> plan_entitlements
       ▲
       └── account_entitlement_overrides   (per-account deviations, with an expiry)
```

A workspace has **exactly one** billing account (`workspaces.billing_account_id`,
`NOT NULL`). A `BEFORE INSERT` trigger assigns it, reusing the owner's existing
account when there is one — which is what makes `max_workspaces` meaningful, and
what keeps the column correct even when an API version that predates V060 inserts
a workspace.

### Four kinds, because they enforce and reset differently

| Kind | What it is | Enforced | Resets |
|---|---|---|---|
| `quota` | consumption over a period | at **admission only** | at the period boundary |
| `limit` | a ceiling at any instant | wherever the thing is created or configured | never |
| `feature` | on/off | by presence | never |
| `setting` | a parameter the runtime reads | not enforced — **consumed** | never |

`setting` is named honestly rather than folded into `limit`. `scheduling_priority`
and `support_tier` are neither ceilings nor allowances, and calling them limits
would be a lie that costs somebody an afternoon.

`-1` means unlimited. **Zero means zero** — a plan with `max_team_size = 0` cannot
build a team at all, which is a different statement from having no opinion.

### The keys

**Quotas** (account scope, monthly): `runs_per_month`, `agent_minutes_per_month`,
`tokens_per_month`.

**Limits**: `max_workspaces`, `max_seats`, `max_members_per_workspace`,
`max_concurrent_runs`, `max_agents`, `max_team_size`, `max_delegation_depth`,
and four retention windows — `retention_days_runs`, `retention_days_events`,
`retention_days_traces`, `retention_days_payloads`.

Retention is four keys and not one because payload **bytes** dominate storage
cost while a run row is cheap; a single number would price the cheapest at the
rate of the most expensive.

**Features**: `teams`, `delegation`, `replay`, `otel_export`, `mcp_tools`,
`api_access`.

**Settings**: `scheduling_priority` (the fair-queue weight), `support_tier`.

`EntitlementKeys.ALL` in Kotlin lists every key the code knows about, and
`EntitlementAcceptanceTest` fails the build if any of them is unseeded for any
plan. A missing limit resolves to "no opinion" and a missing feature resolves to
**off**, so an unseeded key is either a free upgrade or a silent outage — neither
shows up until a customer hits it.

---

## 3. Plans are data

Adding a plan or changing a limit is an `INSERT`/`UPDATE`, never a deploy.

The resolver caches, so "without a deploy" needs an invalidation signal that fires
for a change made in `psql` by somebody who has never heard of the cache. So it is
not a method anybody calls: statement-level triggers on `plans`,
`plan_entitlements`, `account_entitlement_overrides` and `billing_accounts` bump
`entitlement_catalog_version`, and `EntitlementResolver` re-reads that single row
at most once per `ENTITLEMENT_VERSION_POLL_MS` (default 5s), dropping the cache
when the number moves.

```sql
-- Raise a limit for everyone on Free. Takes effect within the poll interval.
UPDATE plan_entitlements SET int_value = 50
 WHERE plan_code = 'free' AND key = 'max_agents';

-- Or for one account, with a reason and an expiry.
INSERT INTO account_entitlement_overrides
  (billing_account_id, key, kind, scope, int_value, reason, expires_at)
VALUES ('…', 'max_concurrent_runs', 'limit', 'workspace', 25,
        'ACME pilot, agreed with sales', now() + interval '90 days');
```

An expired override stops applying without being deleted, so "what did they have
in March" stays answerable.

---

## 4. Seeded plans

Free / Pro / Team / Enterprise. **Prices are placeholders for S4 to correct.**

Two seed values are load-bearing rather than commercial, and both exist so that
applying the migration changes no workspace's behaviour:

- `free.max_concurrent_runs = 2` — the pre-S3 `workspace_usage_policies` default.
- `free.retention_days_payloads = 7` — the pre-S3 `log_retention_days` default.
  `PayloadStore` reads this key now; a smaller number would have shortened every
  existing workspace's payload retention the moment the migration applied. That
  is silent data loss dressed as packaging. Tighten it later with one `UPDATE`.

V060 §10 also carries forward any workspace whose limits had been raised by hand,
writing them as account overrides — so nobody who had been specially accommodated
is downgraded on the way through.

---

## 5. Enforcement points

Every one goes through `EntitlementGuard`. None reads a plan directly.

### 5.1 Run admission — `RunRoutes.triggerRun`

Order: fair-queue placement → rate limit → **plan quota** → admission control.

- **Quota** (`requireQuota`) is checked here and **nowhere else**. See the grace
  model, §6.
- **Concurrency** comes from `max_concurrent_runs`, resolved inside
  `AdmissionControl`'s snapshot statement via `workspace_limit()` so the active
  count and the ceiling are read at the same instant. The worker's claim
  (`WorkspaceLimitsProvider`) reads the same function, which is where the ceiling
  is actually enforced across replicas.
- **Priority** is `scheduling_priority`, read by `FairOrdering` through
  `workspace_scheduling_weight()`. This is **a number in an existing mechanism,
  not a new lane**: `fair_vtime` already divides a run's cost by the weight, so a
  weight-4 tenant advances its virtual clock a quarter as fast and is served
  about four times as often under contention. A paid run does not queue behind a
  free-tier batch, and nothing about the ordering, the clamp to `now`, or the
  claim changes.

### 5.2 Workspace creation — `MeRoutes.createWorkspace`

`max_workspaces`, counted across the account the new workspace will join. That
account is identified by an **anchor**: a workspace the caller already owns.
Ownership and not membership — using a workspace somebody invited them to would be
the governing rule broken in the place it is hardest to see. No anchor means this
is their first workspace, which is always allowed.

### 5.3 Members and seats — `lib/server/entitlements.ts`

Two checks, because under per-seat pricing they mean different things:

- `max_members_per_workspace` — a workspace ceiling.
- `max_seats` — a **billing quantity**, checked only when the invitee is not
  already on the account. Pending invitations count, so an account at its cap is
  refused at the point the admin can act on it rather than at the point the
  invitee cannot.

Enforced at invitation time **and** at acceptance, because an account can
downgrade in between. The acceptance check runs before the transaction, not
inside it: `requireSeatForNewMember` takes its own pooled connections, and calling
it while holding the transaction's connection is hold-and-wait on a pool of 3.

### 5.4 Agent, team and delegation config — at **save** time

- `max_agents` at `POST /api/agents`.
- `teams`, `delegation`, `max_team_size`, `max_delegation_depth` and `mcp_tools`
  at `POST /api/workflows/:id/versions`, via `GraphPlanCheck`.

Save time and not run time: a team of twelve on a plan that allows eight is a form
error the author fixes in the moment, or a 3am production failure in a workflow
that has been green for a week and belongs to somebody who did not write it.

The runtime keeps its own ceilings (`TeamLimits.maxDepth`, `AgentSafetyGuard`).
A graph can be saved under one plan and run under another, so the runtime must
still bound what it executes; this only adds the chance to say no while the author
is still in the room.

`GraphPlanCheck` parses through `WorkflowGraph` — the same reader the worker uses.
The graph arrives in three dialects and each puts a node's config somewhere
different; a second parser would find teams in one dialect and not the others.

### 5.5 Feature gates

`replay` at `POST /api/runs/:id/replay`. `otel_export` in the worker's
`RunTraceExporter`, via `workspace_has_feature()` — enforced at export and not
only at the settings screen, because a destination configured on Team must stop
being used when the account downgrades, and nothing deletes the row on a
downgrade (deliberately: an upgrade should find the endpoint still there).

The UI reads `GET /api/entitlements` — the resolved rows, not a plan code — so a
UI gate cannot promise something the API then refuses.

### 5.6 Retention (S2)

`workspace_retention_days(workspace, surface)` is read by `PayloadStore`. It falls
back to the pre-S3 `log_retention_days` column when a workspace has no
entitlement.

---

## 6. The grace model

A quota breach does not stop a run that is already admitted. Killing a run at 90%
to save the last 10% of a quota throws away every provider call already paid for
and every side effect already committed, and gives the customer nothing for it.
The **next** admission is refused instead, which costs nobody anything.

That is why `requireQuota` is called at exactly one place.

`billing_accounts.grace_until` is the manual form of the same idea: support can
hand an account a stay of execution without editing its plan, and it expires by
itself.

---

## 7. Refusals

Never a bare 403. Every refusal names three things — the **limit** (with the
number), the **plan** currently governing the workspace, and the **upgrade path**
— and the plan named is always the workspace's, never the reader's.

| Error | Status | When |
|---|---|---|
| `PLAN_QUOTA_EXCEEDED` | 429 | a metered allowance is spent; resolves with time, so `periodEnd` is in `details` |
| `PLAN_LIMIT_EXCEEDED` | 403 | a ceiling, hit now; waiting changes nothing |
| `PLAN_FEATURE_UNAVAILABLE` | 403 | the plan does not include it |
| `WORKSPACE_CONCURRENCY_LIMIT` | 429 | at the concurrency ceiling; now carries the plan too |

The upgrade path comes from `plans.upgrade_to_code` / `plans.upgrade_url`, so
re-packaging changes the sentence without a deploy. On the top plan there is no
upgrade, and the copy says "Contact us" rather than naming nothing.

On the web side, `toSafeApiError` passes `PlanLimitError` straight through with
its `detail`. Without that branch a plan refusal fell to the generic fallback and
came back as a 500 "internal error" — a correct enforcement decision reported as a
broken product.

---

## 8. Metering

`usage_records`, primary key `(run_id, metric)`. **The run id is the key** — not
an event, not a message, not a sequence number — because it is the only
identifier that survives every path a single run can take: resume, retry,
redelivery, reconcile. S4 bills from this table, so a double-counted run is a
double charge.

**Writes overwrite, never increment.** Every write stores the absolute value for
that run. `runs` is always 1; `tokens` and `agent_minutes` are the run's totals as
currently known, so a resume that did more work overwrites with a larger figure
and stays exact, while a redelivery changes nothing. `quantity = quantity + ?`
would double on every redelivery and be undetectable afterwards.

**`period_start` is stamped once**, on insert. A run admitted on the 31st and
completed on the 1st belongs to the month it was admitted in — otherwise its
`runs` row and its `tokens` row land in different invoices for the same run.

**A replay meters zero.** Enforced inside `meter_run_usage()`, not in a caller,
because both services meter. A replay makes no provider calls, and charging one
bills a debugging session.

Where each metric is written:

| Metric | Written by | When |
|---|---|---|
| `runs` | `UsageMeter` (API) | immediately after the run row is created |
| `tokens`, `agent_minutes` | `RunUsageMeter` (worker) | at the terminal transition, behind the status CAS |

`runs` is metered at **admission** and not at completion, because admission is
what the quota governs: metering at completion would let an account queue a
thousand runs against a spent quota, since none of them had finished yet.

Metering never fails a run — every path swallows its errors.
`reconcile_run_usage()` repairs anything lost and is called hourly from
`PartitionMaintenance.tick()`, under the same Redis lock, over a two-hour window
so a skipped cycle still gets swept.

`agent_minutes` is metered only for the agent execution classes. A four-second
transform is not an agent minute, and counting it as one would make the quota
measure wall-clock time rather than the scarce resource it rations.

---

## 9. Rollout: shadow mode

**`ENTITLEMENTS_ENFORCED` defaults to `false`.** Per the standing rule, a new
runtime behaviour ships behind a flag until its phase is signed off — and what is
new here is the **refusing**.

With it off:

- resolution runs, the settings page renders real plans, the ledger fills up;
- every check that *would* have refused logs
  `[entitlements] WOULD REFUSE (CODE): message | details`;
- **nothing is refused**, and no customer is affected.

Metering is deliberately **not** behind the flag. The ledger has to be complete
for the months before enforcement is armed, or the first invoice is drawn from a
partial history.

One flag across both services and the web app. Two would be two chances to set
only one, and a customer refused a seat by the web app while the API happily
admits their runs is a product that disagrees with itself.

**Arming it:** watch the `WOULD REFUSE` lines for a full billing period, fix the
seeds those lines expose, then set `ENTITLEMENTS_ENFORCED=true`.

Related env vars:

| Variable | Default | What it does |
|---|---|---|
| `ENTITLEMENTS_ENFORCED` | `false` | arm refusals (API, worker, web) |
| `ENTITLEMENT_VERSION_POLL_MS` | `5000` | how quickly a database edit takes effect |
| `ENTITLEMENT_CACHE_TTL_MS` | `60000` | backstop TTL on a resolved snapshot |
| `ENTITLEMENT_USAGE_TTL_MS` | `5000` | how stale a quota comparison may be |

---

## 10. Acceptance

`apps/api-kotlin/src/test/kotlin/com/vectorbea/api/entitlements/EntitlementAcceptanceTest.kt`,
against a real Postgres. Its world is built so the governing rule cannot pass by
accident: the **same user** owns a Pro account and is an active member of somebody
else's Free workspace, so any check that consults the actor's plan returns Pro's
numbers and fails.

| Criterion | Test |
|---|---|
| A Pro user in a Free workspace gets Free limits, per enforcement point | `enforcement point - …` (7 tests: quota, agents, features, workspace creation, members/seats, scheduling weight, retention) |
| Every refusal names the limit, the plan and the upgrade path | `every refusal names the limit, the plan and the upgrade path`, plus the top-plan case |
| A run that resumes four times meters once | `a run that resumes four times meters once` |
| A replayed run meters zero | `a replayed run meters zero` |
| Changing a limit in the database takes effect without a deploy | `changing a plan limit in the database takes effect without a deploy`, `adding a plan takes effect without a deploy` |

Plus: overrides beat plans and are visible as overrides, expired overrides stop
applying, shadow mode refuses nothing while still resolving, metering runs
regardless of the flag, every known key is seeded for every plan, a workspace
inserted without an account still gets one, and a second workspace joins the
owner's existing account rather than minting a fresh Free allowance.

---

## 11. What S4 adds

Nothing structural. `billing_accounts` already carries `external_customer_id`,
`external_subscription_id`, `plan_status` and the period window; `plans` already
carries price, currency, interval and price model. S4 wires a provider to them:

1. Checkout writes `plan_code`, `seats` and the external ids.
2. The webhook keeps `plan_status` and the period columns in step, which is what
   makes quota resets land on the invoice boundary rather than the calendar month.
3. Invoicing reads `usage_records` and `account_seats_used()`.

`plan_status` deliberately does **not** change what resolves today. Downgrading on
a failed payment is a policy decision for S4; guessing it here would delete a
customer's concurrency because a card expired.

---

## 12. Two grid entries that read as contradictions, and are not

Found during the marketing claim audit (`docs/audit/MARKETING-CLAIMS-AUDIT.md`).
Neither is a bug; both are confusing enough on a feature matrix to be worth
writing down before somebody "fixes" one of them.

### `pro` grants `max_team_size = 3` while `teams = false`

The size limit is dead configuration on that plan. `GraphPlanCheck` calls
`requireFeature(TEAMS)` *before* it compares the roster size, so a Pro workspace
is refused at the feature and never reaches the number. The row exists because
`EntitlementKeys.ALL` is asserted to be seeded for every plan — absence means
"off" everywhere else, and a missing row is how a forgotten seed becomes a free
upgrade.

Raising `teams` to true for Pro is therefore a one-row change with a limit
already sitting behind it. Lowering `max_team_size` to 0 for symmetry would
change nothing enforced today and would remove that.

### `pro` grants `delegation = true` while `teams = false`

Coherent, and not obvious. Delegation is not only a team-node feature:
`AgentNodeExecutor` opens a budget ledger when `delegationEnabled &&
agent.canDelegateTo.isNotEmpty()`, so a plain `agent` node whose *registered*
agent carries a roster delegates without any team node existing. Pro buys that;
it does not buy the `agent_team` node.

`GraphPlanCheck` reflects the same split: it requires `DELEGATION` when a team
node's roster contains a grant, and requires `TEAMS` for the node itself. The two
are checked separately because they are separately purchasable.

### The consequence for the pricing page

Both rows appear on the published matrix with the numbers as seeded, because
hiding a row that the API enforces is how a page starts disagreeing with a guard.
`__tests__/pricing-consistency.test.ts` compares every published cell against
these migrations and fails the build on drift.
