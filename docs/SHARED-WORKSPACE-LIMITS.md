# Shared-workspace limits

A workspace is shareable, so for every limit there are two questions: **whose
limit is it**, and **who is spending it**.

`docs/PLANS-AND-ENTITLEMENTS.md` answered the first — entitlements resolve from
the workspace's billing account. This document covers the second, and the eight
ways somebody can route around a limit once more than one person is inside.

Every claim below has a test in
`apps/api-kotlin/src/test/kotlin/com/vectorbea/api/entitlements/SharedWorkspaceExploitTest.kt`.

---

## 1. Guest-plan bleed

**The exploit.** Any check that reads the *requester's* plan instead of the
*workspace's* is a hole. An Enterprise user invited to a Free workspace gets
Enterprise limits inside somebody else's Free workspace.

**Why it is the most likely bug here.** It is invisible. The check runs, the
number is real, the code reads naturally, and the only symptom is that the wrong
tenant got the right answer.

**Closed, structurally.** `resolve_entitlements()` takes a workspace and has no
parameter for a user. Neither does any method on `EntitlementGuard`, with two
exceptions that use one to find an account they *own* — never to read a plan:

| Method | Takes a user for |
|---|---|
| `requireNewWorkspaceAllowed` | finding the account they already own workspaces on |
| `requireNewMemberAllowed` | asking "is this person already a seat here" |
| `requireMemberSpend` | charging *this* member's cap (§4) |

Two tests hold the line. One is behavioural: an **Enterprise** guest inside a
**Free** workspace is asserted to receive Free's numbers at every enforcement
point — quota, agent limit, feature gate, concurrency, retention, scheduling
weight, activation cap. The fixture always makes the two plans differ, so a bleed
cannot pass by coincidence. The other is structural: it reflects over
`EntitlementGuard` and fails if a method grows a second id, and it asserts the
SQL function's signature is still `p_workspace_id uuid` alone.

The audit itself is recorded in `V062`'s header. It found nothing — which is the
point of writing the structural test rather than only the audit.

---

## 2. Workspace proliferation

**The exploit.** A free account creates fifty workspaces and gets fifty times the
free quota.

**Closed by three bounds, which are not redundant:**

| Bound | Scope | Stops |
|---|---|---|
| `runs_per_month` | account | fifty workspaces being fifty allowances — they share one pool |
| `max_workspaces` | account | making the fifty in the first place |
| `runs_per_month_per_workspace` | workspace | one workspace draining the whole account's month |

The third is the one that is easy to miss. Without it, an account quota is
perfectly shared and one busy workspace still takes all of it before anybody else
gets a run.

The account bound is checked **first**, so when both are spent the message is
"your account is out of runs" — the one somebody can act on. "This workspace is
out of runs" would send an admin hunting for a workspace setting that will not
help.

`max_workspaces` is enforced on **both doors**: Kotlin `POST /api/workspaces`
and the Next.js route the workspace switcher uses. A limit enforced on one of two
doors is not a limit.

---

## 3. Seat evasion

Plans are per-seat (see `docs/PLANS-AND-ENTITLEMENTS.md`), so:

* **A guest is a seat.** `account_seats_used()` is a `COUNT(DISTINCT user_id)`
  across every workspace on the account. That `DISTINCT` is the per-seat model:
  one person in four workspaces is one seat, and adding them to a fifth is free.
* **Pending invitations count too.** Otherwise an account at its cap sends
  unlimited invitations that all fail on acceptance — the refusal reaching the
  invitee, who cannot act on it, instead of the admin, who can.
* **`max_members_per_workspace` binds regardless.** One paid workspace shared
  with 500 people is a capacity and support problem whatever the pricing says, so
  the ceiling exists independently of the seat count.

---

## 4. Guest spend

**The exploit.** A guest invited to help burns the host's tokens. The account
pays, the guest spends, and every existing limit is satisfied right up until the
month is gone.

**Closed with a new allocation scope on the existing ledger.** `usage_records`
grew one column — `actor_user_id`, stamped by `meter_run_usage` from the run's
`triggered_by_user_id` — and a per-member cap became the same ledger with a
different `GROUP BY`.

That reuse is the whole design. The member cap inherits every property the
billing ledger was built to have: a resumed run counts once, a replay counts
zero, a redelivery changes nothing. Deriving it by joining `agent_runs` at read
time would have worked until retention deleted the run row, at which point a
guest's spend would silently reset.

**Tokens, not money.** `docs/COST-ATTRIBUTION-FINDINGS.md` measured the displayed
cost figure as wrong by between 1.8× and 29× depending on the model string, with
the *sign* of the error changing with the model. A cap denominated in that would
cut off the wrong people and let the expensive ones through. Tokens are counted.

**The refusal names the owner's remedy, not a checkout page.** A guest refused
here does not own the plan and cannot upgrade it, so
`MEMBER_SPEND_CAP_EXCEEDED` says a workspace owner can raise their budget.
Sending them to a pricing page for somebody else's account is a dead end.

**Visibility.** `GET /api/workspaces/spend-by-member` gives the owner tokens,
runs and cap per member. A cap without a view is a support ticket waiting to
happen.

**A member budget divides the workspace's allowance; it never adds to it.**
Granting a contractor "unlimited" gives them what the workspace has left and not
a penny more — the workspace and account bounds are checked separately, and
first.

---

## 5. Trial recycling

**The exploit.** Create, consume the trial, delete, recreate.

**The decision, recorded because it is a judgement and not a fact.**

Trial state lives on `billing_accounts`, so deleting every workspace on an
account does not reset it — the account row survives, and recreating a workspace
returns to the same account.

For duplicate accounts, the defence is deliberately **one cheap layer**:

* **Anchor:** the first owner's email, normalised — lower-cased, `+tag` stripped,
  dots removed from the local part. That catches `me+1@`, `me+2@`, `m.e@`: the
  version of this that takes no effort, which is the overwhelming majority.
* **Effect:** an account whose anchor matches one that already consumed a trial
  starts with the trial consumed. It is **not blocked from existing.** Blocking
  signup on a heuristic turns a false positive into a lost customer; withholding
  a second free trial turns it into a support conversation.

**Deliberately not done**, and each for a reason:

| Not done | Why |
|---|---|
| IP / device fingerprinting | breaks offices, VPNs and households, and anyone it catches defeats it in a minute |
| Blocking disposable domains | a list that is always stale; real users at small domains get caught |
| Payment-method fingerprinting | the actual answer — and it needs S4. When a card is on file, demote this heuristic to a signal |

Perfect prevention is not achievable here and over-investing annoys real users.
This is the amount of defence the problem is worth before there is a payment
provider to do it properly.

---

## 6. Ownership transfer

**The exploit.** Transfer a Pro workspace to a Free account and 83 days of traces
fall under a 7-day window. The next retention sweep deletes them — correctly,
irreversibly, under a policy the customer never agreed to.

**Closed with a trigger on the column, not a check in a route.**
`billing_account_id` is an ordinary column: a support script, a bulk
reassignment, a migration, or a second transfer endpoint written next year can
all move it. A route-level check protects exactly one of those paths.

So `workspaces_account_change` fires on any `UPDATE OF billing_account_id` and
runs `retention_observe_policy` for all five entities, which is the same
downgrade-grace path S2 already built. A transfer is a plan change arriving by a
different route, and it must not have a second implementation.

The test asserts this by moving the column with a raw `UPDATE` — no route, no
service, no application code — and checking that grace opened anyway.

Every transfer is recorded in `workspace_transfers` with the from/to plans and
whether it was a downgrade.

---

## 7. Concurrency and fairness

* `max_concurrent_runs` — per workspace, from the plan, enforced at admission and
  again at the worker's claim (where it binds across every replica).
* `max_activations_per_workspace` — P10's cap, now plan data, so one tenant's
  fan-out cannot occupy the child lane.

**The split is deliberate.** The *workspace* activation cap became an
entitlement; the *per-run* cap and the vtime penalty stayed on
`workspace_usage_policies`. "How many agents may this tenant run at once" is
packaging — it is what one tenant takes from everybody else. "How many children
may one run dispatch at once" is a scheduler detail that makes a 20-wide fan-out
dispatch in waves, and it would be the same number on every plan. Selling it
would be selling an implementation detail of the queue.

Verified against the 20-child starvation case: Free allows 2 concurrent runs and
8 concurrent activations, so a 20-child fan-out waves rather than seizing the
lane; Team gets 96 and the same graph moves faster, because the cap follows the
plan rather than being a constant.

---

## 8. API keys

**The exploit.** A key is a way around a UI limit.

**Closed by there being no second enforcement path.** A key names a *workspace*.
Every entitlement check takes a workspace and has no parameter for a user, so a
request authenticated by a key resolves the same plan, quota, ceilings and
feature gates as the identical request from the browser. There is nothing to keep
in step, because there is nothing to keep in step *with*.

What a key does carry is `acts_as_user_id`, and that is the opposite of a bypass:
a guest who mints a key is still charged against **their own** member cap. Minting
a key is a different door into the same budget, not a bigger budget.

| Property | How |
|---|---|
| Scoped to a workspace | `authorizedWorkspaceIds = { the key's workspace }`, verified by `RequestContext` like any session |
| Inherits entitlements | by construction — see above |
| Revocable | `revoked_at`, idempotent, and workspace-scoped so another workspace's admin cannot revoke by guessing a UUID |
| Rate-limited per plan | `api_rate_limit_per_minute` |
| Capped in number | `max_api_keys`, on **live** keys — so rotating a credential is never blocked by the ceiling |

The secret is never stored, only its SHA-256. `prefix` (12 characters) is kept in
clear so a key is identifiable in a list and a log without being usable. There is
no "show again": losing it means minting another, which is the right trade for a
credential that can spend money.

SHA-256 rather than bcrypt or argon2, deliberately: those exist to make a slow
attack on a low-entropy human password expensive. This is 32 bytes from
`SecureRandom` — there is nothing to brute-force, and a deliberately slow hash on
the authentication path of every API request would be a self-inflicted denial of
service.

A key's role is `developer`: enough to run and build, never enough to change
members, billing or other keys. A credential that can mint more credentials
cannot be contained after a leak.

---

## Configuration

| Variable | Default | Effect |
|---|---|---|
| `ENTITLEMENTS_ENFORCED` | `false` | Whether a refusal is thrown or only logged as `WOULD REFUSE`. One flag across both services — two would be two chances to set only one. |

Everything in this document resolves from data. Changing a limit, adding a plan
or adjusting a member's budget is an `UPDATE`, not a deploy.
