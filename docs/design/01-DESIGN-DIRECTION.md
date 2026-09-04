# Vectorbea — Design Direction
### "Ink & Iris" · A control plane that reads like an instrument, not a dashboard

---

## 0. The brief, restated

Vectorbea is a **durable execution control plane for agentic workflows**. The buyer is a platform/ops lead at a mid-to-large company. The daily user is an operator watching production and an engineer building graphs. The competitive set is Zapier (consumer-friendly, orange, playful), n8n (developer, dark, red accent), Datadog (dense, purple, telemetry-maximalist), Airflow (utilitarian, teal), Temporal and Prefect (the real spiritual competitors).

The product's single job on screen: **make durability legible.** Every competitor shows you a graph or a list. None of them show you, at a glance, *how much committed work survives a failure*. That is Vectorbea's entire thesis and it is currently invisible in the UI.

Everything below serves that.

---

## 1. The diagnosis (why the current UI reads amateur)

Not opinion — these are structural, and each one has a fix baked into the direction.

| # | Problem | Consequence | Fix |
|---|---------|-------------|-----|
| 1 | **Brand colour = success colour.** Green is the logo, the sidebar active state, the primary CTA, the "Active" pill, and the "Succeeded" badge. | Nothing is signal. An operator cannot scan for anomalies. | Brand moves to iris. Green is demoted to a single semantic job. |
| 2 | **Every surface is a card grid.** Tools, Agents, Workflows, Connections, Templates, Schedules — six pages, one layout. | The IA is invisible; nothing feels purpose-built. | Layout follows data shape: registries → tables, health → strips, plans → canvas. |
| 3 | **Uniform density.** 14px cards with 24px padding whether the page holds 2 items or 163. | Wastes the screen the operator lives on. | Three density modes; tables default to compact with tabular numerals. |
| 4 | **Zero keyboard surface.** No ⌘K, no shortcuts, no query language. | Disqualifies it against Datadog/Linear-class tooling instantly. | Command palette is a P1 primitive, not a nice-to-have. |
| 5 | **Status is a coloured dot.** "Failed / Succeeded / Queued" as pills only. | The *shape* of a run — where it got to before dying — is lost. | The Checkpoint Ribbon (§5). |
| 6 | **Dead ends everywhere.** 41% success rate links nowhere. 3 failed connections don't say what they block. The Approvals decision context shows unfilled template chips. | The UI reports; it never resolves. | Every number is a link to its cause. Blast-radius is a first-class concept. |
| 7 | **Lucide + default radii + default shadows.** | The exact signature of a generated UI. | Phosphor base + 28 bespoke domain marks; tinted shadows; deliberate radius scale. |
| 8 | **Environment exists in data, not in IA.** Run detail shows `ENVIRONMENT: PRODUCTION`; nothing in the chrome does. | Users cannot tell if they're about to break prod. | Persistent environment switcher with a chrome-level colour treatment. |

---

## 2. The spine: durable workers, persistent cells

The product's own vocabulary supplies the metaphor. Workers lease jobs off a queue. Each completed node commits a checkpoint that survives a crash. Work accumulates in cells that persist. The name is Vector**bea**.

**Used as:** hexagonal derivation for the canvas lattice, the checkpoint glyph, node port geometry, loading states, and empty-state illustration.

**Never used as:** bees, honey, yellow-and-black, hexagon-tiled backgrounds, "buzz" copy, or any literal hive imagery. The metaphor is structural, not decorative. If a stakeholder can point at it and say "that's the bee thing," it has gone too far.

---

## 3. Colour — "Ink & Iris"

### 3.1 The governing rule

> **Brand colour and status colour are disjoint sets.**
> Iris never means "good." Green never means "Vectorbea."

Iris was chosen precisely because it collides with no run state. Blue reads as *running*. Amber reads as *awaiting human*. Red reads as *failed*. Green reads as *succeeded*. Violet-indigo is the only major hue with no existing job in this product — which makes it available for identity, primary action, and selection, permanently and without ambiguity.

### 3.2 Neutrals — Graphite (cool, blue-undertone; deliberately not Tailwind `slate`/`zinc`)

**Dark (product default)**

| Token | Hex | Use |
|---|---|---|
| `graphite-1000` | `#07080C` | Canvas void, builder background |
| `graphite-950` | `#0A0C12` | App background |
| `graphite-900` | `#0F1118` | Base surface |
| `graphite-850` | `#141722` | Raised surface (cards, panels) |
| `graphite-800` | `#1A1E2B` | Overlay (menus, popovers) |
| `graphite-750` | `#212636` | Hover fill |
| `graphite-700` | `#2A3042` | Border subtle |
| `graphite-600` | `#39415A` | Border default |
| `graphite-500` | `#4E5773` | Border strong / disabled fg |
| `graphite-400` | `#6C7593` | Foreground muted |
| `graphite-300` | `#949CB6` | Foreground secondary |
| `graphite-200` | `#C3C9DB` | Foreground primary |
| `graphite-100` | `#E6E9F2` | Foreground high |
| `graphite-50` | `#F6F7FB` | Foreground max (headings) |

**Light**

| Token | Hex | Use |
|---|---|---|
| `paper-0` | `#FFFFFF` | Raised surface |
| `paper-50` | `#FAFBFD` | App background |
| `paper-100` | `#F3F5F9` | Sunken / table zebra |
| `paper-200` | `#E9ECF3` | Border subtle |
| `paper-300` | `#D7DCE7` | Border default |
| `paper-400` | `#B4BCCD` | Border strong |
| `paper-500` | `#7C8499` | Foreground muted |
| `paper-700` | `#4A5266` | Foreground secondary |
| `paper-900` | `#1B2030` | Foreground primary |
| `paper-1000` | `#0A0C12` | Foreground max |

### 3.3 Brand — Iris

| Step | Hex | Use |
|---|---|---|
| `iris-50` | `#EFF0FE` | Tint wash (light) |
| `iris-100` | `#E0E2FD` | Selected row (light) |
| `iris-200` | `#C4C7FB` | Border on tint |
| `iris-300` | `#9FA3F7` | Hover fg on dark |
| `iris-400` | `#7E82F2` | **Primary on dark** |
| `iris-500` | `#5A5CF0` | **Core brand** |
| `iris-600` | `#4644D6` | **Primary on light**, pressed |
| `iris-700` | `#3735AC` | Deep fill |
| `iris-800` | `#2B2A82` | |
| `iris-900` | `#1F1E5C` | |
| `iris-950` | `#111033` | Tint wash (dark) |

**Iris is allowed:** logo, primary buttons, focus rings, selection, active nav, links, the AI Architect surface, brand moments in marketing.

**Iris is forbidden:** any run status, any health indicator, any risk level.

### 3.4 Ember — the warm counterpoint

Copper/amber. Every competitor in this space is cold (blue-grey, purple-black). A warm secondary is what stops Vectorbea reading as another telemetry tool, and it does real semantic work: **Ember is the colour of human involvement.**

| Step | Hex | Use |
|---|---|---|
| `ember-200` | `#FFE3BC` | Tint wash (light) |
| `ember-300` | `#FFCF87` | Border on tint |
| `ember-400` | `#F7B15C` | Approval fg on dark |
| `ember-500` | `#E89234` | **Awaiting human / SLA** |
| `ember-600` | `#C4711F` | Pressed, fg on light |
| `ember-700` | `#94520F` | Deep fill |
| `ember-950` | `#2E1A05` | Tint wash (dark) |

**Ember means:** approval pending, SLA countdown, manual intervention required, "waiting on a person." It is also the accent for editorial/marketing warmth and for empty-state illustration.

### 3.5 Status — strictly rationed

Each colour has exactly one job. This is the whole point.

| Semantic | Name | Dark hex | Light hex | Meaning — and *only* this |
|---|---|---|---|---|
| Success | `verdant-500` | `#2FCB8B` | `#0E9C66` | A run/step **succeeded** |
| Failure | `signal-500` | `#FF5C6E` | `#D62842` | A run/step **failed** |
| Live | `pulse-500` | `#31C6E8` | `#0C93B4` | **Executing right now** |
| Waiting | `ember-500` | `#F7B15C` | `#C4711F` | **Blocked on a human** |
| Queued | `graphite-400` | `#6C7593` | `#7C8499` | Accepted, not started |
| Cancelled | `graphite-500` | `#4E5773` | `#B4BCCD` | Stopped by a person |

**Risk levels** (tools) use a separate ramp and are always paired with a glyph, never colour alone:
`low` → neutral outline · `medium` → ember outline · `high` → ember filled · `critical` → signal filled + hatched border.

### 3.6 Environment chrome

Environment is expressed as a **2px rail along the top of the viewport plus a chip in the topbar**, not as a coloured page.

- `production` → `iris-500` rail, solid chip
- `staging` → `ember-500` rail, chip with diagonal hatch
- `development` → `pulse-500` rail, dashed chip

The hatch/dash carries the meaning for colour-blind users; the rail is peripheral so it never competes with content.

### 3.7 Elevation

Shadows are **tinted with the surface hue and never pure black.** On dark, elevation is carried by border-lightening plus a very soft iris-tinted glow at ≤6% — not by drop shadows, which look muddy on near-black.

```
--shadow-1: 0 1px 2px -1px rgb(11 13 20 / .40), 0 1px 1px rgb(11 13 20 / .24);
--shadow-2: 0 4px 12px -3px rgb(11 13 20 / .42), 0 2px 4px -2px rgb(11 13 20 / .28);
--shadow-3: 0 16px 36px -12px rgb(11 13 20 / .52), 0 4px 10px -4px rgb(11 13 20 / .32);
--shadow-focus: 0 0 0 2px var(--bg-base), 0 0 0 4px var(--iris-500);
--glow-live: 0 0 0 1px rgb(49 198 232 / .28), 0 0 16px -4px rgb(49 198 232 / .34);
```

---

## 4. Typography

Three faces, three jobs, no overlap. All are free for commercial use.

| Role | Family | Source | Why |
|---|---|---|---|
| **Display** | **Cabinet Grotesk** | Fontshare | Editorial grotesque with real character at 40px+. Tight apertures, confident weight jumps. Carries marketing and the big telemetry numerals without looking like a bank. |
| **UI** | **Switzer** | Fontshare | Neutral geometric-grotesque that stays crisp at 13px, full 9-weight range, excellent tabular figures. Under-used, so it does not carry the "Inter default" tell. |
| **Mono** | **JetBrains Mono** | Google Fonts | Purpose-built for log reading at small sizes. Slashed zero, clearly distinct `1/l/I`, generous x-height. |

**Premium upgrade path** (if budget appears): Display → *PP Neue Montreal*; UI → *Söhne* or *ABC Diatype*; Mono → *Berkeley Mono*. The token layer must make this a one-file swap.

### 4.1 Scale

Product base is **14px**, not 16. Infrastructure operators run dense; 16px base wastes a third of a Runs table.

| Token | Size / LH / Tracking | Face | Use |
|---|---|---|---|
| `display-2xl` | 68 / 1.00 / -.034em | Cabinet 800 | Marketing hero only |
| `display-xl` | 52 / 1.04 / -.030em | Cabinet 700 | Marketing section heads |
| `display-lg` | 40 / 1.08 / -.026em | Cabinet 700 | Page hero, big metrics |
| `display-md` | 30 / 1.14 / -.020em | Cabinet 600 | Card metrics |
| `heading-lg` | 22 / 1.25 / -.016em | Switzer 600 | Page title |
| `heading-md` | 17 / 1.32 / -.010em | Switzer 600 | Panel title |
| `heading-sm` | 15 / 1.40 / -.006em | Switzer 600 | Card title |
| `body-lg` | 15 / 1.60 / 0 | Switzer 400 | Docs, marketing body |
| `body` | 14 / 1.55 / 0 | Switzer 400 | Default |
| `body-sm` | 13 / 1.50 / 0 | Switzer 400 | Table cells, dense UI |
| `label` | 12.5 / 1.35 / .004em | Switzer 500 | Form labels, chips |
| `caption` | 11.5 / 1.40 / .008em | Switzer 400 | Metadata |
| `eyebrow` | 11 / 1.20 / .10em UPPER | Switzer 600 | Section eyebrows |
| `mono` | 13 / 1.60 / 0 | JBM 400 | Logs, IDs, JSON |
| `mono-sm` | 11.5 / 1.55 / 0 | JBM 400 | Inline IDs, timestamps |

### 4.2 Numeric law

- `font-variant-numeric: tabular-nums` on **every** number in a table, metric, counter, duration, cost or token count. Non-negotiable — it is why animated counters don't jitter.
- Currency and token counts always mono. Durations always mono. UUIDs always mono, always truncated middle (`a35d65ca…3453b5`), always click-to-copy.
- Never render a raw float. `$0.0031` → `$0.0031`; `0.0` tokens → `—`.

---

## 5. ⭐ The signature: the Checkpoint Ribbon

**This is the one thing Vectorbea is remembered for. Build it first, use it everywhere.**

A run is a sequence of durable commits. The Ribbon renders that sequence as a row of cells — one per node — where the *fill* encodes commit state:

```
committed   ▰  solid, verdant           work that survives a crash
executing   ▰  solid, pulse + breathing  in flight right now
gated       ▰  solid, ember + halo       waiting on a person
failed      ▱  cracked, signal           the node that died
pending     ▱  hollow, graphite-700      never reached
skipped     ▱  hollow, dashed            branch not taken
recovered   ▰  verdant with ember notch  succeeded on retry
```

Cells are **hexagon-derived** (a soft-cornered rectangle with clipped top-left and bottom-right corners) — the hive geometry, abstracted to the point where it just reads as "precise."

### Why it works

- **One component, four scales.** 3px cells inline in a table row · 8px on a workflow card · 20px in the run header · full-width and interactive in run detail.
- **It answers the question the current UI can't.** Looking at a failed run today tells you nothing. The Ribbon tells you *8 of 12 nodes committed before it died* — so a retry costs 4 nodes, not 12. That is the product thesis, rendered.
- **It's a scrubber.** In run detail, drag across it and the canvas replays node states in sync.
- **It compresses.** Beyond ~40 nodes, cells collapse into proportional segments; a 200-node run still fits a table cell.

### Anti-requirements

Never animate more than one Ribbon at a time in a list. Never use it as decoration on marketing pages where it doesn't represent real state. Never let it exceed 32px tall outside run detail.

---

## 6. Iconography

**Base set: Phosphor Icons.** Regular weight at 16/20px for UI, Bold reserved for active/filled states. Never mix weights inside one hierarchy level. Normalise to 1.5px optical stroke.

**Rejected:** Lucide (it *is* the generated-UI tell), Heroicons (too soft for infra), emoji (never, anywhere).

### 6.1 The bespoke set — 28 domain marks

This is the highest-leverage anti-template move available. Vectorbea has primitives no icon library contains. Draw them: 24×24 grid, 1.5px stroke, hex-derived geometry, single-path where possible, optical centring over mathematical.

```
DURABILITY   checkpoint · resume-from-checkpoint · durable-run · replay · lease · commit-boundary
QUEUE        queue-depth · worker · backpressure · in-flight
GRAPH        fan-out · merge · branch · loop-iterative · wait-until
HUMAN        approval-gate · gate-approved · gate-rejected · sla-timer · escalation
FAILURE      incident · recovery-engine · blast-radius · root-cause
EXECUTION    tool-call · agent-brain · byok-key · token-meter · budget-burn
```

### 6.2 Node marks (builder)

Each node type gets a bespoke geometric glyph on a tinted chip. The glyph is abstract-structural, not literal:

`trigger` a struck arc · `agent` a nested cell · `llm` a radiating point · `tool` a keyed slot · `branch` a divergence · `parallel` stacked cells · `merge` a convergence · `wait` an arrested arc · `approval` a shield-cell · `checkpoint` a filled cell · `output` an opened cell · `end` a closed cell.

### 6.3 Provider logos

Monochrome-on-tint by default; full colour **only when connected**. This is what stops the Integrations page reading as a sticker sheet the way Zapier's directory does — and it makes "connected" scannable at a glance, which is the actual job of that page.

---

## 7. Motion

**Law: motion explains state change. Motion that decorates is deleted.** Every animation must answer "what just changed, and where did it come from?"

### 7.1 Tokens

```
--dur-instant  90ms    state flips, toggles
--dur-fast    140ms    hover, press, tooltip
--dur-base    200ms    dropdowns, tabs, chips
--dur-slow    320ms    drawers, sheets, route change
--dur-deliberate 480ms  first-paint orchestration only
--ease-standard  cubic-bezier(.20, 0, 0, 1)
--ease-entrance  cubic-bezier(.16, 1, .30, 1)
--ease-exit      cubic-bezier(.40, 0, 1, 1)
--spring-canvas  { stiffness: 260, damping: 30, mass: .9 }
--spring-cell    { stiffness: 420, damping: 26, mass: .7 }
```

Animate `transform` and `opacity` only. Never `width`, `height`, `top`, `left`. Every animation interruptible. Every one gated behind `prefers-reduced-motion` (which collapses to opacity-only at 90ms).

### 7.2 The seven signature motions

1. **Checkpoint bloom** — node commits: its Ribbon cell fills with a `--spring-cell` scale from .82→1, and a single hex ring expands outward and dissolves over 480ms. *The brand motion.* Fires exactly once per commit; never loops.
2. **Edge flow** — during a live run, a 12% opacity gradient travels the edge at 1.4s linear loop. Stops **instantly** (not eased) the moment the run pauses — the abruptness is the information.
3. **Log stream** — new lines enter at `translateY(3px) → 0`, 140ms, stagger 18ms. Sticky auto-scroll with a "Jump to live" pill when the user scrolls away.
4. **Metric roll** — counters interpolate *from their previous value*, never from zero, over 420ms `--ease-standard`, on tabular numerals so width is frozen.
5. **Gate breathing** — pending approvals carry an ember halo at 8%→14% opacity on a 2.6s sine loop. Must be barely perceptible; if it draws the eye in a screenshot, halve it.
6. **Failure jolt** — the failing node shakes 2px for 120ms and flashes its border once. Once. Never repeats, never propagates to neighbours.
7. **Replay scrub** — dragging the Ribbon drives canvas node states, log scroll position, and the metrics header in one synchronised transform. No lag, no easing — it tracks the pointer 1:1.

### 7.3 Page orchestration

On first paint of a data page: chrome is instant, then content staggers in at 40ms intervals over a max 240ms window, then live indicators start. Total under 400ms. Route changes reuse the shell — never re-animate the sidebar.

---

## 8. Layout & spacing

- **Lattice:** 4px base. Component padding steps 4 / 6 / 8 / 12 / 16 / 20 / 24. Section rhythm 32 / 48 / 64 / 96.
- **Radii:** `xs 4` (chips, cells) · `sm 6` (inputs, buttons) · `md 8` (cards) · `lg 12` (panels) · `xl 16` (modals, marketing) · `full` (pills, avatars). Nothing else.
- **Borders:** 1px always. Emphasis comes from colour step, never width.
- **Content max-width:** product 1600px, prose 68ch, marketing 1200px.
- **Density modes:** `comfortable` (44px row) · `default` (36px) · `compact` (28px). Persisted per user, per table.
- **Sidebar:** 248px expanded, 56px collapsed, with icon-only + tooltip. Collapse state persists.

---

## 9. Information architecture — revised

Current IA has 12 items in four groups where the grouping doesn't match the mental model (Schedules is a *trigger*, i.e. build-time; Usage is admin; Approvals is operate).

```
┌ Workspace ▾ ─────────────── Environment: Production ▾ ┐

OBSERVE
  Control              ← was Overview
  Runs
  Incidents            ← NEW, promoted from Recovery Engine
  Approvals

BUILD
  Workflows
  Agents
  Tools
  Templates

CONNECT
  Integrations
  Connections
  Triggers             ← Schedules + Webhooks + Manual/API, unified

GOVERN
  Usage & limits
  Members
  Audit log            ← NEW
  Settings
```

**Topbar:** global search (⌘K) · environment switcher · notification inbox · docs · theme · account.

### New surfaces and why

- **Incidents** — you already generate `incident_id` in the Recovery Engine. 83 failed runs are not 83 problems; they're probably 3. Clustering failures by signature is the single highest-value new page and it's the Datadog-competitive move.
- **Audit log** — the docs promise "a full audit trail" under Governance. There is no screen for it. Enterprise buyers ask for this in the first call.
- **Triggers** — Schedules-only today, but Usage lists Webhooks as a feature and run detail shows `trigger: manual`. Three trigger types, one page.

---

## 10. Product-UX upgrades per surface

Condensed; each is expanded into requirements inside its build prompt.

**Control** — replaces four flat tiles with a health strip (inflight, failure-budget burn-down, approval aging, spend vs budget), a **"Needs attention" triage feed** where every item is one click from resolution, and a **fleet heatstrip** — every workflow as a row of its last 30 runs. Anomalies become visible without reading a number.

**Runs** — query bar with real syntax (`status:failed workflow:renewals since:24h`), saved views, virtualised table, **inline Ribbon per row** so you see where each run died without opening it, bulk retry/cancel/compare, and failure clustering that converts "83 failed" into "3 root causes."

**Run detail** — three panes: scrubable step timeline / canvas mirror with live node state / context inspector. Panes not tabs. A **replay scrubber** across the top driving all three. Recovery Engine becomes a diagnosis card with root cause, blast radius, and a one-click fix (in the screenshot you sent: *"Connection 'Postgres Answers' is failing → Fix connection"*). Plus per-node cost, copy-as-cURL on tool calls, and diff-against-last-successful-run.

**Approvals** — decision context rendered with **real resolved values**, not template chips, alongside the evidence that produced them. Approve / Reject / Request changes, with a mandatory reason on reject. SLA countdown ring. Bulk approve behind a policy guard. Full decision audit trail.

**Incidents** — signature, first/last seen, occurrence sparkline, affected workflows and runs, suggested remediation, status lifecycle, assignee.

**Workflows** — table default with a health column (last-30 sparkline), owner, environment, version, trigger. **Visual version diff** — graph diff plus JSON diff. Publish flow: draft → validate → simulate → publish with a change summary.

**Builder** — ⌘K to add nodes, full keyboard graph editing, auto-layout, inline validation that highlights offending nodes, a **simulate panel** that dry-runs with mocked tool calls and gives a cost estimate *before* publish, minimap, and live/replayed run state painted onto the canvas.

**Inspector** — Configure / Inputs / Output / Advanced / Test. The **I/O mapping UI** is the big one: pick a field from an upstream node's output schema and bind it, with a live resolved-value preview. This is the "Unified I/O & mapping" concept your docs promise and no screen delivers. Plus retry/backoff rendered as a timeline preview and **idempotency key config** — currently absent and genuinely dangerous in a durable-execution product.

**Agents / Tools** — registries, not card grids. Agents: model, provider, cost per run, tool grants, guardrails, prompt version history. Tools: schema, auth, timeout, rate limit, last error, **"used by" reverse index**, and risk level that actually enforces policy (which risk tiers require approval, per environment).

**Connections** — health with latency trend, credential rotation, scoped read-only flags, and **blast radius**: *"3 workflows and 7 tools are blocked by this connection."* Had this existed, the failed run in your screenshots would have been prevented.

**Triggers** — unified schedules/webhooks/manual with next fire, timezone, jitter, overlap policy, and backfill.

**AI Architect** — the blueprint **streams and materialises progressively** as the plan is generated, the pipeline rail shows live stage progress, the blueprint is editable before build, and the confirmation screen shows exactly what will be created (N agents, N tools, N connections, N gates) with a cost estimate. Currently it's a textarea and an empty panel.

**Admin** — quota forecasting ("at current rate you hit the cap in 6 days"), RBAC matrix, SSO/SCIM placeholders, and an audit log with actor / action / target / diff.

---

## 11. The aesthetic risk, stated and justified

**The risk:** the product UI is near-monochrome. Deep graphite ink, one restrained iris accent, and *saturated colour reserved almost entirely for run state.* No colourful dashboard. No gradient cards. No decorative charts.

**Why it's defensible:** colour-as-signal has information value proportional to its scarcity. Datadog is colourful because it serves twenty data types; Vectorbea serves one question — *is my work surviving?* An austere surface where the only saturated pixels are status makes anomalies pre-attentive: an operator spots a red Ribbon cell across a 40-row table without reading a word. It also makes the product feel like an instrument rather than a toy, which is the correct register for the buyer.

**Where the boldness is spent:** entirely on the Checkpoint Ribbon. Everything else stays quiet and disciplined so the Ribbon is the thing people screenshot.

---

## 12. Voice

Errors do not apologise and are never vague. Empty states are invitations, never decoration. Verbs are active and consistent from control to confirmation — the button that says **Publish** produces a toast that says **Published**.

| Don't | Do |
|---|---|
| "Something went wrong" | "Connection 'Postgres Answers' refused the request. Check credentials or network access." |
| "No data" | "No runs in the last 24 hours. Widen the range or trigger a run." |
| "Are you sure?" | "Reset workspace? This deletes 163 runs and 11 workflows. Audit logs are kept." |
| "Submit" | "Publish version 2" |
| "Loading…" | Skeleton in the shape of the content that's coming |

---

## 13. Technical foundation

| Concern | Choice | Note |
|---|---|---|
| Framework | Next.js 15 App Router, React 19, TypeScript strict | |
| Styling | Tailwind CSS v4 `@theme` | Semantic tokens only; **zero** raw hex or default palette names in components |
| Primitives | Radix UI | shadcn as a *starting point*, aggressively restyled — the default look is forbidden |
| Variants | CVA + tailwind-merge | |
| Motion | Motion (framer-motion v11+) | |
| Canvas | @xyflow/react v12 | Fully custom node/edge/handle renderers |
| Tables | TanStack Table + TanStack Virtual | 10k rows at 60fps |
| Charts | visx | Hand-composed. Recharts defaults are a template tell. |
| Dense timeseries | uPlot | Where visx is too slow |
| Theming | next-themes, `class` strategy | |
| Docs | Component library in Storybook | |
| Testing | Playwright + visual regression | |

---

## 14. The anti-template checklist

Every prompt inherits this. It is the difference between a revamp and a reskin.

- [ ] No default Tailwind palette names in any component (`bg-blue-500` → `bg-status-live`)
- [ ] No raw hex outside the token file
- [ ] No default shadcn silhouette (`rounded-lg border bg-card` repeated everywhere)
- [ ] No Lucide, no emoji as icons
- [ ] No purple gradient hero, no glassmorphism, no floating 3D mockups
- [ ] Radii drawn only from the six-step scale
- [ ] Shadows tinted with base hue, never pure black
- [ ] All numbers tabular; all IDs mono, truncated, copyable
- [ ] Every interactive element defines hover / active / focus-visible / disabled / loading
- [ ] Every collection defines empty / loading / error / partial / permission-denied
- [ ] Icons optically aligned to text, not box-aligned
- [ ] Both themes verified — never inferred from one
- [ ] Contrast ≥4.5:1 body, ≥3:1 large and UI glyphs, in **both** themes
- [ ] Colour never the sole carrier of meaning — always paired with glyph or text
- [ ] `prefers-reduced-motion` honoured everywhere
- [ ] Keyboard path to every action; visible focus ring on all of them
