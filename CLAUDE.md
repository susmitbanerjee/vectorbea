# Vectorbea — Engineering & Design Constitution

## Sources of truth
- Design direction: /docs/design/01-DESIGN-DIRECTION.md
- Tokens: /src/styles/tokens/*.css — the ONLY place hex values may appear
- Components: /src/components/ui/** (primitives), /src/components/app/** (composed)

## Hard rules
1. No raw hex, rgb, or hsl outside /src/styles/tokens/.
2. No default Tailwind palette names in components. `bg-slate-800` is a bug.
   Use semantic tokens: bg-surface-raised, text-fg-secondary, border-subtle,
   bg-status-failed, text-status-live.
3. No Lucide. Icons come from @phosphor-icons/react or /src/components/icons/domain.
4. No emoji anywhere in the UI.
5. Radii only from: xs 4, sm 6, md 8, lg 12, xl 16, full.
6. Spacing only from the 4px lattice.
7. All numbers in tables/metrics: font-variant-numeric: tabular-nums.
8. All IDs: mono font, middle-truncated, click-to-copy.
9. Animate transform/opacity only. Never width/height/top/left.
10. Every animation respects prefers-reduced-motion.
11. Brand colour (iris) never indicates status. Status green never indicates brand.

## Every component must define
hover · active · focus-visible · disabled · loading

## Every collection must define
empty · loading (skeleton in content shape) · error · partial · permission-denied

## Copy rules
Active voice. Sentence case. The verb on the button is the verb in the toast.
Errors state what happened and how to fix it. Never "Something went wrong."

## Verification before marking work done
- Both themes checked visually, not inferred
- Keyboard-only pass on every interactive element
- Contrast: 4.5:1 body, 3:1 large text and UI glyphs
- No console errors, no hydration warnings
- `npm run typecheck && npm run lint && npm run build` clean

---
# Repo resolution — read this before applying the rules above

The rules above are written against the abstract paths used in
`/docs/design/02-EXECUTION-PLAN.md`. In this repository they resolve as follows.

## Paths

| Constitution path | Actual path |
|---|---|
| `/src/styles/tokens/*.css` | `apps/web/src/styles/tokens/*.css` |
| `/src/components/ui/**` | `apps/web/src/components/ui/**` |
| `/src/components/app/**` | `apps/web/src/components/app/**` |
| `/src/components/icons/**` | `apps/web/src/components/icons/**` |
| `/src/lib/**` | `apps/web/src/lib/**` |
| `/src/mocks/**` | `apps/web/src/mocks/**` |

Import them with the `~/*` alias, which maps to `apps/web/src/*`:

```ts
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/cn";
```

The pre-existing `@/*` alias still maps to `apps/web/*` and is how **legacy** code imports
`@/components/**` and `@/lib/**`. Do not repoint it.

## Commands

The package manager is **npm**, not pnpm. Run from `apps/web`:

```bash
npm run typecheck && npm run lint && npm run build
```

Other scripts: `npm run format`, `npm run storybook`, `npm run test:visual`.

## Legacy coexistence — this is a revamp inside a live product

`apps/web/app/**` and `apps/web/components/**` are the **legacy** presentation layer: 389 files,
~70 routes, 4,698 raw hex values. It ships to production today.

- **Do not delete legacy components.** They are replaced incrementally, screen by screen.
- **Do not change any API call, data model, route path, or business logic** while re-skinning.
- `apps/web/tailwind.config.ts` is **frozen legacy**, loaded via `@config` so existing classes keep
  resolving. Never add to it. New tokens go in `src/styles/tokens/*.css` under `@theme`.
- The global `* { @apply border-border; }` reset in `app/globals.css` is **load-bearing** under
  Tailwind v4 (it pins the default border colour). Do not remove it.

The hard rules are mechanically enforced by ESLint in `apps/web/src/**` only. They are the standard
everywhere, but legacy files predate them and will fail — that is expected, and is what the
incremental migration in `/docs/audit/CURRENT-STATE.md` §10 exists to resolve.

## Known state you should not rediscover

- **The dark theme exists now (P02), for the new token layer only.** `:root` *is* dark; `:root.light`
  is the light peer. `ThemeProvider` offers system/light/dark, defaults to dark, and persists under
  `vectorbea-theme`. The legacy layer is hard-coded light and does **not** follow the theme — that is
  deliberate, and is what makes dark safe to ship before the screens are migrated.
- **Eight legacy CSS variables were renamed to `--legacy-*`** because they collided with the new
  semantic token names (`--bg-app`, `--border-subtle`, `--border-strong`, `--accent`, and four
  `--status-*`). Never reintroduce those names outside `src/styles/tokens/`. See
  `/docs/audit/CURRENT-STATE.md` §9.8.
- **Colour changes must pass `npm run check:contrast`.** It grades every semantic pairing in both
  themes and enforces that brand (iris) and status hues stay disjoint.
- Three generations of run UI coexist (`components/runs/**`, `components/agent-runs/**`,
  `components/agent-runs/v2/**`). Confirm which routes reference each before removing any.
- Brand, success, focus ring and sidebar-active all currently resolve to the same `#007F4E`.
  Splitting them is the point of the revamp; never reintroduce a shared variable.

Full baseline and migration order: `/docs/audit/CURRENT-STATE.md`.

## Agent runtime work — standing rules

Design docs: docs/AGENT-HARNESS-ARCHITECTURE.md, docs/AGENT-TRACE-AND-DEBUGGER.md,
docs/AGENT-BRAIN-EXECUTION.md, docs/AGENTIC-WORKFLOW-EXECUTION-FLOW.md,
docs/PLANS-AND-ENTITLEMENTS.md, docs/RETENTION.md,
docs/SHARED-WORKSPACE-LIMITS.md, docs/BILLING.md, docs/HTTP-TOOLS.md,
docs/WAITS-AND-SIGNALS.md, docs/INGRESS.md, docs/RESULT-DELIVERY.md,
docs/SRE-AND-INCIDENT-RESPONSE.md, docs/ENTERPRISE-CONNECTIVITY.md,
docs/SKILLS.md.
Read the relevant sections before changing runtime code. The docs explain WHY
each guard exists; most were written after a production bug.

### Invariants — never break these

1. The model chooses; the runtime executes. No action is dispatched without
   runtime validation against a grant list. A roster or tool list in a prompt
   is documentation, not enforcement.
2. Every durable key must survive re-execution. No iteration numbers, no
   timestamps, no random IDs in approval keys or idempotency keys. A step
   re-executes from iteration 1 on resume; any key that changes between
   attempts opens a duplicate gate or a duplicate side effect.
3. Terminal run state is durable in Postgres before the queue message is
   acknowledged.
4. Sanitization happens once, at the write boundary. RunEventStore, SpanWriter
   and PayloadStore store what they are given. Raw provider responses, stack
   traces, connection secrets and full payloads must never reach them.
5. A child activation is never allocated more budget than its parent's
   remaining budget.
6. A ceiling breach is not a failure. CeilingExceeded stays a distinct
   terminal state and always names the limit that was hit.
7. Observability never blocks execution INDEFINITELY — and spans may drop,
   events may not. Both use bounded buffers; what a full one does differs.
   A dropped span is a degraded trace, so SpanWriter drops and counts. A dropped
   event is a hole in a timeline that pages on `?afterSequence=`, and a lost
   RUN_FAILED is an outage reported as a success, so RunEventStore applies
   back-pressure and flushes on the emitting thread. That block is bounded
   (AGENT_EVENT_BACKPRESSURE_TIMEOUT_MS); past the deadline it drops loudly,
   because every thread parked on a database that is not answering is the
   outage this rule exists to prevent. Every drop is counted and exposed;
   span drops also persist to agent_runs.dropped_spans, because "was this
   trace complete" is asked hours later.
8. Cross-workspace access is impossible. Agent, tool and roster lookups are
   workspace-scoped at the same boundary, and fail closed if the check errors.
9. One engine. A new orchestration pattern is a policy over the existing
   primitives, never a second runtime.
10. Retention is a DELETION, not a filter. Data past its window is removed from
   Postgres — no `hidden` column, no read-time predicate. A filter leaves the
   bytes present, still billed, and one forgotten `WHERE` away from being served
   by an export, a support query or the next feature. `RetentionAcceptanceTest`
   fails the build if a soft-delete column appears. See docs/RETENTION.md.
11. Entitlements resolve from the workspace's BILLING ACCOUNT, never from the
   requesting user's plan. A Pro member acting inside a Free workspace gets Free
   limits, at every enforcement point. `resolve_entitlements()` and every method
   on `EntitlementGuard` take a workspace and have no parameter for a user —
   keep it that way. Nothing outside `com.vectorbea.api.entitlements` and
   `lib/server/entitlements.ts` may read `plans` or `plan_entitlements`
   directly. See docs/PLANS-AND-ENTITLEMENTS.md.
12. A workspace is SHAREABLE, so every limit needs a second question answered:
   who is spending it. Runs carry `triggered_by_user_id`, the usage ledger
   carries `actor_user_id`, and a guest is held to their own member cap — an
   API key inherits that cap rather than escaping it. Moving a workspace between
   billing accounts opens retention grace via a TRIGGER on the column, not a
   check in a route, because a support script moving it would otherwise put Pro
   data under Free retention silently. See docs/SHARED-WORKSPACE-LIMITS.md.
13. Billing never sits on a read path. Entitlements resolve from
   `billing_accounts.plan_code`, which billing only ever WRITES — no quota check
   calls a payment provider, so a provider outage cannot stop a run.
   `BillingRepository` has no provider field and could not call one. Past due
   sets `billing_restricted_at` and must NEVER change `plan_code`, because
   `plan_code` drives retention and a late card would then delete a customer's
   data. Webhooks are verified over the RAW body, deduplicated on the provider's
   event id, ordered by the PROVIDER's timestamp, and an unrecognised type is
   stored and ignored — never inferred. See docs/BILLING.md.
14. A tool's definition changes only through a VERSION. `agents.allowed_tool_ids`
   grants a tool by uuid, so an id whose behaviour changed underneath it is a
   grant to something nobody reviewed. A spec re-import writes `tool_versions`
   rows in `review_state = 'pending'` and NEVER touches `tools` —
   `ToolVersionRepository.apply` is the only writer of the live definition, it
   takes a person, and it records who. The rule is never-mutate, not "not when
   granted": a grant can be added a minute after an import. A credential never
   appears in `http_spec_json` — auth strategies name FIELDS of the connection's
   secret, and `SpecSecretScan` rejects a document that inlines one, because
   that column is read by the list endpoint, rendered in a form, snapshotted
   into every version and shown in re-import diffs. See docs/HTTP-TOOLS.md.
15. A run parks through the WAIT PRIMITIVE and nothing else. Approval, async
   tools, signals and the agent's own WAIT action are kinds of one thing —
   invariant 9 applied to suspension. A second parking mechanism means a second
   timeout policy, a second reconciler sweep and a second way for a run to be
   stuck forever, and only one of those would be tested. Every wait carries a
   deadline (clamped, never absent), resolves by compare-and-set on
   `status = 'waiting'` so a redelivered callback resolves it exactly once, and
   is keyed by a derivation that survives re-execution. Waiting consumes no
   wall-clock budget because a wait ends the tick, not because anything is
   subtracted afterwards. A new kind is not done until the reconciler sweeps it —
   `WaitReconciliationTest` walks the enum, so it fails until then. The
   approval gate is the one kind still parking through its own mechanism; that
   migration is a stop-and-ask, and docs/WAITS-AND-SIGNALS.md §12 says what it
   should look like. See docs/WAITS-AND-SIGNALS.md.

16. A run starts through RUN INGRESS and nothing else. API, webhook, schedule,
   event and MCP are adapters that say who is asking and what for; the rate
   limit, the plan quota, the fair placement, the admission decision, the
   metering and the events happen once, in `RunIngress`. This is not tidiness:
   the sequence used to live in a route handler, so `WorkflowScheduler` could
   not call it and reimplemented the half it remembered — and scheduled runs
   skipped every plan check in the product, for free, until somebody read the
   two functions side by side. A run started five different ways differs in
   `trigger_type` and in nothing else, and `IngressAcceptanceTest` reads the
   rows back to prove it. Idempotency is claimed BEFORE the checks and released
   by every refusal, because a run that was refused did not happen and its key
   must still work. See docs/INGRESS.md.

17. DELIVERY IS A SECOND AXIS, NOT A RUN STATUS. A run that produced the right
   answer and could not deliver it did not fail: its output is correct, its cost
   was real, and retrying the RUN would re-execute every side effect. So
   `agent_runs.delivery_status` is its own column, on the LIST response as well
   as the detail one, and the UI shows both facts at once. Delivery happens
   after the terminal transition, so it has its own retry, its own dead-letter
   queue (`run_deliveries.status = 'dead'`, redeliverable in place) and its own
   loop — `onTerminalTransition` INSERTs a row and returns, because that
   function is on the completion path and somebody else's HTTP does not belong
   on it. The idempotency key a receiver deduplicates on is DERIVED from
   `(run, target, sequence)`, so every retry and every operator redelivery
   carries the key the first attempt carried; a per-attempt key would make each
   retry a new event to them and our logs would still say "delivered". A
   destination is a TOOL — it reuses that tool's connection, credential,
   approval policy and audit trail — and a caller blocked on a sync or streamed
   run is NOT a delivery target, because it has no endpoint to retry against.
   See docs/RESULT-DELIVERY.md.

18. A RUN IS A SINGLETON ON ITS DEDUP KEY, AND THE INDEX SAYS SO. Two alerts
   for one service must not start two incident runs, and the case that matters —
   two arriving in the same second — is exactly the one a read-then-write loses,
   because it is what a flapping check produces.
   `agent_runs_dedup_live_unique` is the enforcement; the lookup in `RunIngress`
   exists only so a policy can be acted on and the holding run named, and the
   index's refusal is translated into the same answer that lookup would have
   given. This is a DIFFERENT question from idempotency: a `dedup_key` asks "is
   something already working on this thing" and is freed when the run ends,
   while an `idempotency_key` asks "is this the same request" and expires on a
   clock. The dedup check sits BEFORE the idempotency claim, because a `join`
   starts no run and burning a key on it would make the caller's own retry look
   like a duplicate. `cancellation_requested` is NOT live for this purpose — a
   run on its way out has no claim on the key, and treating it as live makes
   `supersede` lose the race to the run it has just cancelled, every time.
   Priority weights the fair-queue clock as well as ordering the claim, because
   `priority DESC` alone is a strict lane and a trickle of Sev1s would starve
   batch work completely; and a requested priority is clamped to the workspace's
   plan ceiling, because a field any caller can set to 100 orders nothing.
   Cancelling a run walks `parent_run_id` DOWNWARDS and takes each descendant
   through the same terminal CAS — one bulk UPDATE would be one statement and
   would leak every child's waits, budget, children and deliveries.
   See docs/SRE-AND-INCIDENT-RESPONSE.md.

19. WHAT LEAVES THE CUSTOMER'S PERIMETER IS AN ALLOW-LIST, ENFORCED AT OUR
   END. A self-hosted runner exists so a customer can tell their own security
   review that prompts and tool results never leave their network. Everything
   else about it — the pool, the token, the lease — is plumbing;
   `RunnerReport` is the sentence they are buying, and it has to be true by
   construction rather than by care. An ALLOW-LIST because a deny-list is a list
   of the leaks somebody thought of: an unnamed field that gets dropped is a
   degraded feature, and an unnamed field that passes through is their data in
   our database. AT OUR END because a runner is software the customer deploys
   and may be an old build — a guarantee that depends on the remote side having
   redacted correctly is a hope with a version number. Titles and summaries are
   payloads: a summary is generated from the thing it summarises. A run's OUTPUT
   has no policy that admits it. A run pinned to a pool must be unclaimable
   through BOTH doors — `PostgresClaim` carries `runner_pool_id IS NULL`, and
   `RunIngress` does not enqueue it, because the Redis path never reads
   `agent_runs` and would hand it to a platform worker through the side the
   claim predicate cannot see. `payloads_withheld` is set at CREATION and stored
   rather than derived, because the Debug tab has to say "withheld by policy"
   while the run is still going and years after the pool is deleted — an empty
   panel reads as a product that lost your data.
   See docs/ENTERPRISE-CONNECTIVITY.md.

20. A CUSTOMER'S PRICE IS NOT OUR LIST PRICE, AND EGRESS IS NOT A GLOBAL
   SWITCH. `connections.provider` says WHOSE capacity, credential, breaker and
   price; `connections.protocol` says what the wire looks like. Conflating them
   worked only while every connection pointed at the vendor it was named after.
   An enterprise runs a negotiated rate, so `connection_model_prices` overrides
   per CONNECTION (the credential is what the contract attaches to), quotes
   input and output SEPARATELY (output is 3-5x input, so a blend is right at one
   ratio only), and resolves LONGEST-PATTERN-FIRST so a catch-all cannot
   silently override the specific rates configured before it. The list path is
   untouched, because generalising it would move every historical figure on
   every dashboard. Reaching a private address is per connection, off by
   default, and USELESS WITHOUT AN ALLOW-LIST — `private_allowed` with no
   `allowed_hosts` reaches nothing, refused by the schema and by the guard,
   because "allow private" and "these three hostnames" are one decision and
   splitting them is how a temporary allowance becomes a permanent hole. Cloud
   metadata addresses are refused under EVERY policy. There is no
   `insecureSkipVerify` anywhere in the TLS path and the omission is the
   feature. See docs/ENTERPRISE-CONNECTIVITY.md.

21. A SKILL GRANTS COMPETENCE, AND NOTHING ELSE. It is a named, versioned
   bundle granted per agent like a tool — so it inherits the tool discipline
   rather than inventing one: the check is runtime code against a database, the
   VERSION is the unit of change, the lookup is workspace-scoped and fails
   closed, and the text is sanitized at the write boundary. What it must never
   acquire is a way to widen anything. `validateToolAllowed` and
   `validateAgentAllowed` take NO skill as input and would behave identically if
   the feature were deleted; the worst a malicious skill can do is waste a
   prompt, and `SkillInjectionTest` asserts that with text saying the opposite of
   the grant. Granting a skill whose required tools the agent lacks is REFUSED AT
   SAVE, with the missing list, because otherwise the failure lands at iteration
   four of a production run and reads as a model that hallucinated a tool — and
   the same check runs again per activation, dropping the skill, because a tool
   can be revoked a minute after the grant. Composition is ordered (after the
   agent's own instructions, before observations — that position is the
   precedence claim, not a rendering choice) and bounded, and EVERY CUT IS
   RECORDED: an agent that "ignored" a skill it was never shown is the hardest
   failure here to diagnose, so the budget is ordinary and the bookkeeping is the
   feature. One composer, shared by the save path and the run path — a second
   implementation makes the save-time warning a lie, which is invariant 16's
   lesson. See docs/SKILLS.md.

### Conventions

- Migrations: Flyway, in apps/api-kotlin/src/main/resources/db/migration.
  Forward-only. Never edit an applied migration. New columns are nullable or
  have defaults; the API and worker deploy independently and must tolerate
  schema skew in both directions.
- Kotlin: match the surrounding style. No new dependencies without asking.
- Feature flags: every new runtime behaviour ships behind an env-var flag,
  defaulting to off, until its phase is signed off.
- Behaviour changes require a doc update in the same commit.

### Stop and ask instead of guessing

Ask before proceeding if a change would touch:
- the shape of an approval key, or decideOnApproval
- the run status state machine or the status CAS
- run lease acquisition or renewal
- the event sequence assignment
- idempotency key derivation, including `RunWait.keyFor` and the callback
  token derived from it
- the order of checks in `RunIngress.start`, or where the idempotency claim
  sits within it — including where the DEDUP check sits relative to it
- the status list in `agent_runs_dedup_live_unique`, `RunDedup.LIVE_STATUSES`
  or `SignalStore.LIVE_STATUSES`. All three must agree; if they do not, a
  `join` can be told a run holds the key and then be refused a signal by that
  same run, which is an alert silently dropped
- `RunDelivery.keyFor`, or anything else a receiver deduplicates on — a wrong
  guess produces duplicate side effects in somebody else's system, where we
  cannot see them
- `RunnerReport.ALLOWED_EVENT_FIELDS`, or anything else that widens what a
  self-hosted runner may send us — every addition has to be a number, an
  identifier or an enum, and a field that can carry a fragment of a prompt or a
  tool result breaks a commitment a customer made to their own security review
- the `runner_pool_id IS NULL` predicate in `PostgresClaim`, or the ingress
  branch that declines to enqueue a pinned run. Either one alone lets a
  customer's prompts execute on our infrastructure, silently
- anything that alters what happens on resume
- the position of the skills block in the system prompt, or anything that lets
  a skill reach `allowed_tool_ids`, `can_delegate_to` or an output schema. The
  first is a precedence decision the model reads as authority; the second turns
  a bundle of prose into a permission, which is the one thing skills are
  defined as not being

These are the places where a plausible-looking change causes duplicate side
effects in production. A wrong guess here is expensive; a question is cheap.
