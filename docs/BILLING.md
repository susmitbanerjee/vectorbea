# Billing (S4)

Complete, tested, and switched off. There is no bank account; the goal is that
turning it on later is configuration rather than a project.

Companion to `docs/PLANS-AND-ENTITLEMENTS.md`, which owns what a plan *includes*.
This document owns what a plan *costs* and how it is collected.

---

## 1. What "switched off" means

| Thing | State today |
|---|---|
| Schema (V063) | Applied. Subscriptions, invoices, payment methods, events, usage reports, reconciliations. |
| `BillingProvider` interface | Complete, with three implementations. |
| Stripe / Razorpay | Implemented, **not credentialed**. Absent credentials, they are not constructed. |
| `NoopBillingProvider` | The default. A complete implementation that never talks to anybody. |
| API routes | Registered and working, against noop. |
| UI | Behind the `billing` flag, **default false**. |

An endpoint that only exists once a flag is on is an endpoint nobody tests, so
the routes are always registered and the data path always runs. What the flag
gates is showing a customer a checkout that would take no money.

**To turn it on:** set `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` and/or the
three `RAZORPAY_*` variables, populate `provider_price_refs`, set
`billing_accounts.provider`, and set `NEXT_PUBLIC_FLAG_BILLING=true`. No code
changes.

A provider is only constructed when **both** its API credentials and its webhook
secret are present. Half-configured is the dangerous state — charges would be
created and every subsequent state change rejected as unsigned — so a missing
webhook secret disables the provider entirely, and says so at ERROR.

---

## 2. Our schema is the truth

Every object has **our** id as its primary key and the provider's in an
`external_*` column. Nothing reads from a provider to answer a question.

That is §3, and it is enforced structurally: `BillingRepository` has no
`BillingProvider` field and could not call one. Webhooks push state in;
enforcement, the UI and invoice history read out.

```
provider ──webhook──▶ billing_events ──▶ subscriptions ──▶ billing_accounts.plan_code
                                                                   │
                                                                   ▼
                                                        resolve_entitlements()
                                                                   │
                                                                   ▼
                                                          every quota check
```

`billing_accounts.plan_code` is the **only** column billing writes that
entitlements read. Billing has no opinion about what a plan includes — that is
the catalogue's job — so the two cannot disagree.

**A provider outage cannot stop a run.** Asserted by a test that points Stripe at
a dead port, confirms the calls fail retryably, and then resolves entitlements
and admits a run anyway.

---

## 3. Two providers, and why the abstraction is load-bearing

An interface with one implementation is a guess about what varies. These are the
divergences that actually shaped the design:

| | Stripe | Razorpay |
|---|---|---|
| Plan change | in place, same id | **cancel + recreate, NEW id** |
| Webhook signature | `HMAC(timestamp.body)`, replay window | `HMAC(body)`, no timestamp |
| Body encoding | form-encoded | JSON |
| Tax | Stripe Tax | GST, inclusive pricing |
| Metered usage | subscription items, `action=set` | **no usage API at all** |

The first one is the trap: a caller that assumed the external id was stable would
keep a dead reference and stop receiving webhooks for the live subscription —
looking fine until the next invoice. `changeSubscriptionPlan` therefore *returns*
the id, and `BillingLifecycleTest` runs against a fake that changes it.

The last one is where honesty mattered more than symmetry. Razorpay's metered
charges are add-ons, and an add-on is a *charge* rather than a running total —
creating one per report would re-bill the period on every retry. So
`reportUsage` reports nothing there and says so; local meters stay authoritative
and the reconciler treats "no metered API" as *nothing to compare* rather than as
drift.

### No SDKs

Both providers are implemented over the JDK HTTP client and Jackson. The repo's
rule is no new dependencies without asking, and two vendor SDKs would be two —
each with its own HTTP client, JSON binding and release cadence.

The better reason: SDK types leak into calling code, and the abstraction meant to
make providers interchangeable would quietly acquire a Stripe shape. What is
genuinely given up is vendor-tuned retries and new API fields arriving for free.

---

## 4. Webhooks

Four rules, each from a different failure:

**Verify first, over the raw body.** An unverified webhook is an unauthenticated
write into the billing schema. The *raw bytes* matter — a body parsed and
re-serialised will not verify, and the failure looks like an attack rather than a
bug in our own plumbing. Nothing is stored for an unverified body.

**Record before applying.** The row is inserted, then the handler runs. A crash
between them leaves a `received` row the redelivery finds.

**Idempotent on the provider's event id.** `UNIQUE (provider, external_event_id)`
with `ON CONFLICT DO NOTHING … RETURNING` — not a check-then-insert, because two
retries can arrive concurrently and both pass a check. *A duplicate webhook
changes nothing*, asserted by replaying one five times and diffing state.

**Never infer.** An unrecognised type is stored as `ignored` and logged, never
guessed from its name — `customer.subscription.paused` and `.updated` start the
same way and mean different things. Same discipline as `decideOnApproval`:
anything unrecognised means wait. The row stays so it can be replayed once a
handler exists.

### Out-of-order

Providers reorder. `subscriptions.last_event_at` holds the **provider's**
timestamp of the last event applied, and an older event is declined and recorded
as `stale`.

The first version compared the incoming timestamp against our own `updated_at`
and was wrong twice: two different clocks measuring two different things, and it
failed immediately, because a row written a millisecond ago has an `updated_at`
later than the `occurred_at` of the event about to describe it. Every first
webhook was rejected as stale. The test that caught it replays an `active` event
stamped *before* a cancellation and asserts the subscription stays cancelled.

### Response codes

| Outcome | Status | Why |
|---|---|---|
| processed / duplicate / ignored / stale | 200 | Providers retry non-2xx for days. An event we decided about must not be redelivered forever. |
| bad signature | 400 | Not a delivery problem — an unauthenticated request. |
| handler threw | 500 | **On purpose.** Provider redelivery is the only free retry we have, and the idempotency record makes it safe. |

---

## 5. Lifecycle

```
trialing ──▶ active ──▶ past_due ──▶ (restricted)
                │            │
                │            └──▶ paid ──▶ active
                ▼
            canceled (at period end)
```

**Past due degrades on a schedule, and never touches data.** `dunning_policy`
holds the days: warn at 1, escalate at 7, restrict at 21. Restriction sets
`billing_restricted_at`, which refuses **new runs** and nothing else.

It deliberately does **not** change `plan_code`, because `plan_code` drives
*retention* — and shortening retention over a late card would have the S2 sweeper
delete the customer's traces. A failed payment must never destroy data. There is
a test that asserts exactly this: 25 days past due, restricted, plan unchanged,
retention window unchanged.

**Cancellation runs to period end.** `billing_settle_ended_subscriptions()` moves
the account to `free` once `current_period_end` passes — which in turn opens S2's
downgrade grace on the next sweep. A customer who cancels keeps both their plan
and their data for the period they paid for, and then gets the normal protection.

**Downgrades wait for period end too**, for the same reason: dropping the plan
mid-period would shorten retention immediately. Upgrades apply at once and are
prorated.

---

## 6. Usage-based billing

Reads the S1 ledger (`usage_records`) via `billing_reportable_usage()`, so what is
billed is exactly what was metered: one row per run, replays excluded, resumes
counted once. A second aggregation path would be a second opinion about revenue.

Two independent protections against double-charging:

1. **The key is derived, not generated.** `account:period:metric:quantity`. A
   retry presents the *same* key, so both our unique constraint and the
   provider's own idempotency deduplicate it. A generated UUID would defeat the
   mechanism entirely.
2. **The report is absolute, not incremental.** Each report states the period's
   TOTAL. A lost report is corrected by the next; a duplicate writes the same
   total. Deltas would make every retry a double charge and every lost report a
   permanent undercount — neither visible until an invoice.

A **retryable** failure releases the key so the next sweep tries again; a
**permanent** one keeps it marked failed, because retrying "no such subscription"
forever hides a configuration error behind a queue that never drains.

### Reconciliation

`UsageReporter.reconcile()` compares the local meter against what was last
reported and records the difference. A report that quietly stopped succeeding
looks exactly like a quiet month — revenue simply does not arrive and nothing is
red. `unreported` is kept distinct from `drift`: never having told the provider
anything is a different problem from having told it something wrong.

---

## 7. Tax and currency

**Currency is decided at signup, not per transaction.** Per-transaction currency
gives an account a mixed-currency invoice history, a lifetime value that needs an
FX rate, and a customer quoted one number and charged another.
`setBillingIdentity` uses `COALESCE(currency, ?)` so it can be set once and not
overwritten; changing it is a support action that ends one subscription and
starts another, because that is genuinely what it is.

**INR is priced, not converted.** ₹3,999 is a decision about the Indian market.
$49 at an exchange rate would move every time the rupee did, which is not a price
anybody can put on a page.

**Tax behaviour is per price.** India quotes GST-inclusive, the US exclusive.
`plan_prices.tax_behavior` carries it, because one platform-wide assumption is an
18% error in somebody's favour. We compute no tax ourselves: Stripe Tax handles
international, Razorpay handles GST.

---

## 8. Constraints

**Never trust a client claim about a plan.** The API takes a plan *code*. Price,
amount, currency and entitlements all come from the catalogue. There is no field
a client could use to claim a cheaper price, and the subscription records which
`plan_prices` row it used.

**Every displayed price comes from the plan record.** The server returns minor
units and a currency code; the client formats with `Intl` (reading
`maximumFractionDigits` back, so a zero-decimal currency is not divided by 100).
No constant in the UI holds a price.

**No PCI scope, structurally.** `payment_methods` has a brand, an expiry and four
digits — and a `CHECK` limiting `last4` to four characters, so a mistaken PAN
write fails at the database rather than succeeding quietly. The only way to add a
payment method is a hosted session at the provider; there is no endpoint that
accepts a card number and nowhere to put one.

---

## 9. What has been verified, and what has not

**Run and passing** (`BillingLifecycleTest`, 12 tests):

- Full lifecycle — subscribe, use, invoice, upgrade, downgrade, cancel, settle —
  against the **noop** provider and a **fake that behaves like Razorpay**
  (returns a new external id on plan change).
- A duplicate webhook changes nothing (replayed five times, state diffed).
- An unsigned webhook is refused and stores nothing.
- An unrecognised event type is stored and ignored.
- An out-of-order event does not resurrect a cancelled subscription.
- A dead provider does not block a run.
- A retried usage report does not double-charge; a changed total does report.
- Reconciliation flags drift.
- A client cannot name its own price.
- Past due restricts runs and leaves retention alone.

**Not run: the Stripe and Razorpay sandboxes.** This machine has no credentials
for either. The suite includes both and skips them when the environment is empty;
`providersUnderTest()` prints exactly what ran, so a green suite never implies a
sandbox was reached.

To run against them:

```bash
export STRIPE_TEST_SECRET_KEY=sk_test_...
export STRIPE_TEST_WEBHOOK_SECRET=whsec_...
export RAZORPAY_TEST_KEY_ID=rzp_test_...
export RAZORPAY_TEST_KEY_SECRET=...
export RAZORPAY_TEST_WEBHOOK_SECRET=...
cd apps/api-kotlin && ./gradlew integrationTest --tests '*BillingLifecycleTest*'
```

The acceptance criterion "full lifecycle passes against both sandboxes" is
therefore **not met yet**, and cannot be from here. Everything it needs is built:
the suite is written once and parameterised over providers, so it is one export
away. The fake-Razorpay provider covers the semantic divergence most likely to
break a caller; what the sandboxes would additionally prove is that the wire
formats, signatures and error shapes are right — which is exactly what nobody
should assume from reading docs.

---

## 10. Configuration

| Variable | Default | Effect |
|---|---|---|
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | — | Both required, or Stripe is disabled. |
| `RAZORPAY_KEY_ID` / `_KEY_SECRET` / `_WEBHOOK_SECRET` | — | All three required. |
| `STRIPE_API_BASE`, `RAZORPAY_API_BASE` | live | Point at a sandbox or a mock. |
| `NEXT_PUBLIC_FLAG_BILLING` | `false` | The UI. |
| `billing_accounts.provider` | `noop` | Per account, so India can be on Razorpay while everybody else is on Stripe. |
