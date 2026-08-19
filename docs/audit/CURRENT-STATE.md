# Vectorbea — Current State Audit
### Pre-revamp baseline · captured 2026-08-10 · branch `dev` @ `4e7d435`

This document is the factual baseline for the "Ink & Iris" revamp described in
[`/docs/design/01-DESIGN-DIRECTION.md`](../design/01-DESIGN-DIRECTION.md). Every number here was
measured, not estimated. Scripts used are noted so the numbers can be re-derived after each phase.

> **Headline:** this is not a greenfield. It is a mature, shipping Next.js application with 389
> TypeScript files, ~70 routes and 114 components. The revamp is a *replacement of the presentation
> layer inside a live product*, which changes the risk profile of the plan considerably. The five
> findings in §9 are the ones that will make this harder than the execution plan assumes.

---

## 1. Framework and versions

| Concern | Actual | Target (design §13) | Gap |
|---|---|---|---|
| Monorepo | npm workspaces (`apps/*`, `packages/*`) | — | Plan says `pnpm`; **it is npm**. All `pnpm x` commands in the plan are `npm run x`. |
| Web app location | `apps/web` | `/src` | Plan paths are unprefixed. Resolve `/src/**` → `apps/web/src/**`. |
| Framework | Next.js 15.5.15, App Router | Next.js 15 App Router | ✅ |
| React | 19.2.6 | React 19 | ✅ |
| TypeScript | 5.9.3, `strict: true` | strict | ✅ |
| Node | v24.14.0 local · `22` in CI | ≥22 | ✅ |
| Styling | **Tailwind 3.4.19** + shadcn HSL CSS vars | **Tailwind v4 `@theme`** | ⚠️ Migration required — see §6 |
| Theming | next-themes 0.4.6, `attribute="class"` | next-themes, class strategy | ⚠️ **`forcedTheme="light"`** — see §9.1 |
| Primitives | Radix (3 packages only) | Radix | ⚠️ Expand |
| Variants | CVA 0.7.1 + tailwind-merge 2.6.1 + `cn()` | CVA + tailwind-merge | ✅ `cn()` exists at `apps/web/lib/utils.ts` |
| Motion | framer-motion 12.38.0 (**2 files**) | Motion v11+ | ✅ present, barely used |
| Canvas | @xyflow/react 12.10.2 (8 files) | @xyflow/react v12 | ✅ |
| Icons | **lucide-react 0.468.0 — 117 files** | Phosphor + bespoke | ❌ Full replacement |
| Charts | recharts 2.15.0 (3 files) | visx (+ uPlot) | ❌ Replace; low blast radius |
| Tables | none — hand-rolled `<table>` | TanStack Table + Virtual | ❌ Not installed |
| Component docs | none | Storybook | ❌ Not installed |
| Visual testing | vitest 2.1.8 (unit only) | Playwright + visual regression | ❌ Not installed |
| Fonts | Geist + Geist Mono (`next/font/google`) | Cabinet Grotesk, Switzer, JetBrains Mono | ❌ Replace |

### Build and quality tooling

- **Lint:** ESLint 9 flat config, extends `next/core-web-vitals` only. No custom rules.
- **`apps/web` has no `typecheck` script.** CI calls `npx tsc --noEmit` directly.
- **Lint is non-blocking in CI:** `npx next lint || true` (`.github/workflows/ci.yml:90`). Design-rule
  enforcement therefore has *no teeth today*; §8 fixes this.
- **Install topology is split.** `apps/web` carries its own `package-lock.json` and `node_modules`
  (CI runs `npm ci` inside `apps/web`), while `react`/`react-dom`/`typescript` resolve from the
  hoisted **root** `node_modules`. Install new web dependencies **in `apps/web`**.

---

## 2. Routing structure

App Router with four top-level segments:

| Group | Purpose | Auth | Indexed |
|---|---|---|---|
| `app/(app)/**` | Authenticated product | Yes — `layout.tsx` gates auth → email verification → private-beta | `noindex` |
| `app/(marketing)/**` | Public marketing | No | Yes |
| `app/docs`, `app/support`, `app/beta`, `app/signin\|signup\|login\|verify-email`, `app/auth/**` | Public/edge surfaces | Mixed | Mixed |
| `app/api/**` | Route handlers | Per-route | n/a |

`app/(app)/layout.tsx` is the authenticated shell: a server component performing three sequential
gates (auth cookie → `isEmailVerified` → `getUserBetaStatus`), then rendering
`WorkspaceProvider > [OAuthTokenTransfer, TelemetryPageViews, SupportWidget, AppSidebar, main]`.
It is `export const dynamic = "force-dynamic"`.

**Constraint for the revamp:** this file contains business logic (redirect gates) and must be
*re-skinned in place*, never regenerated. Its two `style={{ background: "var(--bg-app)" }}` inline
styles and the `flex h-screen overflow-hidden` shell are the only presentational parts.

---

## 3. Route inventory

70 `page.tsx` files. `server`/`client` is the top-level directive; line count indicates how much
presentation is inlined into the route file itself.

### 3.1 Product — `(app)`

| Route | Kind | Lines | Component tree (direct `@/components` imports) |
|---|---|---|---|
| `/dashboard` | client | 515 | `architect/ArchitectLogo`, `ui/page-kit` |
| `/dashboard/metrics` | client | 212 | `layout/app-header`, `ui/{badge,button,card,select}` |
| `/dashboard/infrastructure` | server | 8 | `dashboard/infrastructure-dashboard` (757L) |
| `/runs` | client | 681 | `runs/RunsHealthBar`, `ui/search-input`, `ui/StatusBadge` |
| `/runs/[id]` | client | 443 | `runs/RunDetailsPage` |
| `/approvals` | client | 270 | `ui/button`, `ui/page-kit` |
| `/workflows` | client | 299 | `icons/vectorbea-icons`, `ui/page-kit` |
| `/workflows/[id]` | client | 624 | — (fully inlined) |
| `/workflows/[id]/builder` | client | **1581** | `workflow-builder/{AddNodeCommandMenu,edges/WorkflowEdge,NodeInspectorDrawer,NodePalette,nodes,WorkflowInspector,WorkflowTemplatePicker}` |
| `/workflows/new` | client | 275 | `architect/ArchitectLogo` |
| `/workflows/new/architect` | client | **1789** | `architect/{ArchitectLogo,ConnectionPickerModal}`, `ui/page-kit`, `ui/provider-icon`, `workflow-builder/NodeIcon` |
| `/workflows/import` | client | 1215 | `ui/app-select` |
| `/agents` | client | 233 | `icons/vectorbea-icons`, `ui/{app-select,page-kit,provider-icon,search-input}` |
| `/agents/[id]` | client | 724 | — (fully inlined) |
| `/agents/new` | client | 457 | `ui/app-select` |
| `/tools` | client | 217 | `icons/vectorbea-icons`, `ui/{app-select,page-kit,search-input}` |
| `/tools/[id]` | client | 635 | `ui/app-select` |
| `/tools/new` | client | 493 | `connections/SchemaPickerPanel`, `ui/app-select` |
| `/connections` | client | 239 | `ui/{page-kit,provider-icon,search-input}` |
| `/connections/[id]` | client | 1042 | `ui/app-select` |
| `/connections/new` | client | 1035 | `ui/app-select` |
| `/integrations` | client | 268 | `ui/page-kit`, `ui/search-input` |
| `/templates` | client | 312 | `architect/ArchitectLogo`, `ui/page-kit` |
| `/schedules` | client | 228 | `ui/page-kit` |
| `/workers` | client | 286 | — |
| `/api-keys` | server | 61 | `api-keys/api-keys-client`, `layout/app-header` |
| `/settings` | client | 463 | `layout/app-header`, `ui/{button,dialog,input,page-kit}` |
| `/settings/sdk` | client | 762 | `layout/app-header`, `ui/{badge,card,dialog,select}` |
| `/settings/members` | client | 523 | `layout/app-header`, `rbac-guard`, `ui/{badge,button,card,dialog,input,table}` |
| `/settings/usage` | client | 293 | `architect/ArchitectLogo`, `layout/app-header`, `ui/page-kit` |
| `/settings/audit` | client | 239 | `layout/app-header`, `ui/app-select`, `ui/card` |
| `/settings/profile` | server | 89 | `layout/app-header`, `ui/{badge,card}` |
| `/settings/production-readiness` | server | 127 | `layout/app-header` |
| `/settings/privacy` | server | 19 | — |
| `/settings/billing` | server | 7 | redirect stub |
| `/admin/beta/applications` | server | 27 | → `client.tsx` |
| `/agent-runs`, `/agent-runs/[id]` | server | 7–9 | legacy → superseded by `/runs` |
| `/agent-jobs`, `/agent-jobs/[id]`, `/agent-jobs/new` | server | 7 | redirect stubs |
| `/alerts`, `/artifacts`, `/audit-logs`, `/policies/packs`, `/release-gates`, `/release-gates/[versionId]` | server | 7–9 | **redirect stubs** (e.g. `/alerts` → `/runs`) |

### 3.2 Marketing and public

| Route | Kind | Lines | Component tree |
|---|---|---|---|
| `/` | server | 26 | `marketing/home-content` (498L), `seo/json-ld` |
| `/use-cases` + 6 children | server | 76–184 | `marketing/{content,logo,site-chrome}`, `seo/json-ld` |
| `/compare` + 3 children | server | 65–146 | `marketing/{content,logo,site-chrome}`, `seo/json-ld` |
| `/book-demo` | client | 488 | `ui/Logo` |
| `/onboarding` | client | 281 | `brand/bee-logo`, `ui/{button,card,input}` |
| `/docs` | client | 443 | `ui/page-kit` |
| `/support` | server | 42 | `support/support-portal` (370L) |
| `/beta` | client | 470 | — |
| `/signin`, `/signup`, `/login` | server | 38–40 | `auth/auth-screen` (309L) |
| `/verify-email` | — | — | `auth/verify-email-screen` |
| `/auth/callback`, `/auth/accept-invite` | client | 33, 219 | — |

**Observation.** Eleven routes are ≥450 lines of inlined JSX with no component extraction; five
exceed 1000 lines. `/workflows/new/architect` (1789L) and `/workflows/[id]/builder` (1581L) are the
two largest files in the app. For these, "replace the presentation layer" means **rewriting the
route file**, and the business logic inside must be lifted out first. Budget accordingly in P15/P18.

---

## 4. State management and data fetching

There is no state library — no Redux, Zustand, Jotai, or TanStack Query.

| Layer | Mechanism |
|---|---|
| Server state | Server Components `await`ing `lib/server/**` and `lib/dal/**` directly |
| Client state | `useState` / `useEffect` / `useReducer` local to the component |
| Cross-cutting | React Context: `WorkspaceProvider` (`lib/workspace-context`), `ThemeProvider`, `BootstrapProvider` |
| Client→server | `lib/api/client.ts` — single typed `fetch` wrapper targeting `NEXT_PUBLIC_VECTORBEA_API_URL`, falling back to relative `/api/*` during the Kotlin migration |
| Caching | `lib/dal/cache-tags.ts` + Next.js `revalidateTag` |

**82 raw `fetch(` calls across 39 files** sit *inside components*, largely in `useEffect`. This is
the main reason component reuse is low and why loading/error states are inconsistent.

> **Revamp constraint (from the brief): do not change any API call.** The correct move is to keep
> each call where it is and re-skin around it, or lift the call into the route file and pass data
> down as props to a new pure presentational component. Do not introduce TanStack Query as part of
> this revamp — it is a data-layer change, not a presentation change, and belongs in its own PR.

---

## 5. Hard-coded design values — quantified

Measured over the 389 `.ts`/`.tsx` files in `apps/web/{app,components,lib}`
(script: `scratchpad/audit-stats.ps1`; regexes listed inline).

| What | Occurrences | Files | Notes |
|---|---:|---:|---|
| **Raw hex colours** | **4,698** | **109** | The headline number. `#[0-9a-f]{3,8}` |
| — of which brand green (`#007F4E`/`#006B45`/`#00A65A`) | 385 | 59 | The colour that must become iris *or* verdant depending on meaning |
| `rgb()` / `rgba()` | 151 | 51 | Mostly shadows and overlays |
| Raw `hsl()` with literal numbers | 0 | 0 | ✅ all `hsl()` use is `hsl(var(--token))` |
| **Default Tailwind palette classes** | **1,490** | **75** | `bg-slate-*`, `text-gray-*`, `border-red-500`, … |
| **Arbitrary Tailwind values** | **5,857** | **140** | `text-[13.5px]`, `bg-[#007F4E]`, `h-[36px]` |
| — of which arbitrary pixel values | 2,571 | 129 | Bypasses the 4px lattice entirely |
| Inline `style={{…}}` | 861 | 91 | Bypasses Tailwind and the token layer |
| `lucide-react` imports | 117 | 117 | Exactly one import line per file |
| Emoji literals in source | 90 | 18 | Forbidden by the constitution. (8 of these are astral-plane emoji; the rest are BMP symbols such as ✓ and ⚠ used as icons.) |

### Where the colour actually lives

Three competing, overlapping token systems exist simultaneously:

1. **shadcn HSL variables** in `app/globals.css:11-110` — `--background`, `--primary`, … consumed via
   `tailwind.config.ts` `colors` as `hsl(var(--x))`.
2. **A parallel hex variable set** in the same `:root` block — `--surface-0`, `--text-primary`,
   `--vb-green`, `--status-*`, `--shadow-*`. ~50 variables, hex-valued, consumed via
   `style={{…}}` and bespoke utility classes.
3. **Literal hex in `tailwind.config.ts`** — the `sidebar`, `surface` and `vbgreen` scales are raw
   hex *in the config file*, not variables, so they cannot be themed at all.

`app/globals.css` additionally hard-codes ~40 hex values inside `@layer utilities` — `.card-surface`,
`.nav-active`, `.badge-*`, `.docs-prose *`, `.event-card`, `.timeline-rail`.

### The brand/success collision, in code

Design direction §1 problem 1 is literally expressed in the config:

```ts
// tailwind.config.ts
primary: "hsl(var(--primary))"   // --primary: 157 100% 25%  → #007F4E
success: "hsl(var(--success))"   // --success: 157 100% 25%  → #007F4E   ← identical
vbgreen: { DEFAULT: "#007F4E" }  // brand
```

```css
/* globals.css */
--status-success: #007F4E;   /* success   */
--accent-primary: #007F4E;   /* brand     */
--vb-green:       #007F4E;   /* brand     */
--ring:           157 100% 25%;  /* focus ring = brand = success */
```

Brand, success, focus ring and sidebar-active are **the same colour value**. Splitting these is
P02's central job: brand → `iris-500`, success → `verdant-500`, focus → `iris-500`, and the two must
never again resolve to one variable.

### Typography and spacing

- Type scale is defined **three times**: `tailwind.config.ts` `fontSize` (10–15px keys), raw element
  selectors in `globals.css` (`h1`–`h5`), and utility classes (`.page-title`, `.card-label`,
  `.table-header-cell`). 2,571 arbitrary px values override all three.
- `tailwind.config.ts` `borderRadius` uses **7px and 10px** (`md: 0.4375rem`, `lg: 0.625rem`) — not
  on the design's 4/6/8/12/16 scale. Every radius needs re-mapping.
- Shadows are **pure black/slate** (`rgba(15,23,42,…)`), not hue-tinted as §3.7 requires.
- `.tabular-nums` exists as a utility but is applied inconsistently.

---

## 6. Tailwind v3 → v4 migration

The decision is to migrate now. This section records the breaking changes and the chosen mitigation.

### 6.1 Mechanical changes

| Change | Action |
|---|---|
| PostCSS plugin moved | `postcss.config.mjs`: `tailwindcss` → `@tailwindcss/postcss`; drop `autoprefixer` (v4 handles prefixing) |
| Directives replaced | `@tailwind base/components/utilities` → `@import "tailwindcss";` |
| JS config no longer auto-loaded | Add `@config "../tailwind.config.ts";` to `globals.css` |

### 6.2 Compatibility strategy

`tailwind.config.ts` is retained and loaded via `@config`. This is deliberate: 1,490 default-palette
classes and every `vbgreen`/`surface`/`sidebar` class in the legacy app resolve through it. Deleting
it would break the running product on day one. It is **frozen legacy** — no new entries — and is
deleted at the end of the revamp when the last legacy component is replaced.

New Ink & Iris tokens are defined with `@theme` in `src/styles/tokens/*.css`, entirely separate from
the legacy config. The two coexist; new components may only use the `@theme` tokens (enforced in §8).

### 6.3 Renamed utilities — measured exposure

v4 renames several utilities. Measured usage in this codebase:

| v3 → v4 | Occurrences | Files | Mitigation |
|---|---:|---:|---|
| `rounded` → `rounded-sm` | 81 | 41 | Pin `borderRadius.DEFAULT` in the legacy config |
| `shadow` → `shadow-sm` | 5 | 5 | Pin `boxShadow.DEFAULT` |
| `blur` → `blur-sm` | 6 | 4 | Pin `blur.DEFAULT` |
| `ring` → `ring-3` | 14 | 6 | **Verify visually** — ring default width changes 3px → 1px |
| `outline-none` → `outline-hidden` | 64 | 42 | **Verify visually** — v4 `outline-none` sets `outline-style:none`; effect on focus rings is near-identical here because `:focus-visible` is overridden globally in `globals.css:171` |
| `space-x/y-*` selector change | 339 | 92 | Low risk — `> * + *` → `:not(:last-child)`; differs only under `flex-row-reverse` |

### 6.4 The change that would have hurt, and why it doesn't

v4 changes the **default border colour from `gray-200` to `currentColor`**, which normally repaints
every border in an app. There are 1,094 bare `border` utilities across 142 files here — this would
have been the single most destructive change.

It is already neutralised: `globals.css:113` applies `* { @apply border-border; }` globally, pinning
every border to `var(--border)` regardless of Tailwind's default. **This reset must be preserved
verbatim through the migration.** It is load-bearing.

### 6.5 Not exposed

`bg-gradient-*`, `bg-opacity-*`, `text-opacity-*`, `flex-shrink/grow`, `overflow-ellipsis`,
`decoration-clone/slice`: **0 occurrences**. No action.

---

## 7. Component inventory — presentation vs. data-coupled

114 `.tsx` components. Classified as `COUPLED` if the file contains `fetch(`, imports `@/lib/api`,
references `apiClient`, or uses `useEffect` (a reliable proxy for imperative data/lifecycle work).

| Class | Count | Meaning for the revamp |
|---|---:|---|
| **PRESENTATION** | 85 | Replaceable 1:1 by a new component with the same props. Safe, parallelisable. |
| **COUPLED** | 29 | Must be re-skinned *in place*, or have data lifted to the route first. |

### 7.1 The 29 coupled components — handle with care

`agent-runs/{AgentBrainTrace, FailureDiagnosisPanel, RunHistoryStats, v2/RunExecutionTimeline,
v2/RunTimelineEventCard}` · `api-keys/api-keys-client` · `architect/ConnectionPickerModal` ·
`auth/{auth-screen, verify-email-screen}` · `billing/billing-dashboard` ·
`dashboard/{dashboard-overview, dashboard-overview-server, infrastructure-dashboard, metric-card,
recent-audit-table, requests-chart}` · `layout/{app-header, app-sidebar, notifications-popover,
telemetry-page-views, workspace-switcher}` · `runs/{RunsHealthBar, tabs/RecoveryTab}` ·
`support/{support-portal, support-widget}` · `ui/bee-loader` ·
`workflow-builder/{AddNodeCommandMenu, NodeInspectorDrawer, nodes/BaseNode}`

`layout/app-sidebar` (520L) is the highest-risk single file: it is both the IA (which §9 of the
design direction restructures) and a data consumer.

### 7.2 The existing `components/ui` primitive set — 24 files

| Keep the file, restyle | Replace outright | Delete after migration |
|---|---|---|
| `button`, `input`, `textarea`, `card`, `badge`, `table`, `tabs`, `dialog`, `dropdown-menu`, `select`, `search-input`, `EmptyState`, `StatusBadge`, `MetricCard`, `JsonBlock` | `page-kit` (272L god-component), `app-select`, `provider-icon`, `Logo`, `toaster` | `bee-loader`, `trust-bar`, `rollout-status`, `theme-provider` (rewritten) |

`components/ui/button.tsx` is representative of the whole problem — CVA is used correctly, but every
one of its nine variants is a literal hex:

```ts
primary: "bg-[#007F4E] text-white … hover:bg-[#006B45]"
outline: "border border-[#E0E3E6] bg-white text-[#4B5563] …"
```

The *structure* is sound and worth keeping; only the values are wrong. That is true of most of the
primitive layer and is the single most encouraging finding in this audit.

### 7.3 Partial prior redesigns — do not mistake for finished work

- `components/agent-runs/v2/**` (20 files) — a second-generation run detail that co-exists with
  `components/agent-runs/**` (5 files) and `components/runs/**` (15 files). **Three generations of
  run UI ship simultaneously.** P12 must pick one and delete the other two.
- `components/icons/vectorbea-icons.tsx` (381L) — an existing bespoke icon start. Review against the
  28 domain marks in design §6.1; it is a seed, not a replacement.
- `components/brand/**` — `bee-logo`, `canvas-mock` (416L), `signature`. The literal bee imagery is
  explicitly out of scope per design §2.

---

## 8. UI dependency ledger

| Package | Version | Verdict | Rationale |
|---|---|---|---|
| `next` | 15.5.15 | **keep** | Target framework |
| `react` / `react-dom` | 19.2.6 → **19.2.8** | **keep** | Range was `^19.0.0`; a transitive update pulled `react` to 19.2.8 while `react-dom` stayed at 19.2.6, which Next rejects at build time. Both floors raised to `^19.2.8` so they can never resolve apart again. |
| `tailwindcss` | 3.4.19 → **4.x** | **upgrade** | Design §13 |
| `@tailwindcss/postcss` | new | **add** | v4 requirement |
| `autoprefixer` | 10.4.20 | **remove** | Built into v4 |
| `@tailwindcss/typography` | 0.5.19 | **keep** | Used by `/docs`; v4-compatible |
| `class-variance-authority` | 0.7.1 | **keep** | Target |
| `tailwind-merge` | 2.6.1 | **keep** | Target; `cn()` already correct |
| `clsx` | 2.1.1 | **keep** | Used by `cn()` |
| `next-themes` | 0.4.6 | **keep** | Target — but unforce light, see §9.1 |
| `@radix-ui/react-{dialog,dropdown-menu,tabs}` | 1.x | **keep** | Expand set |
| `@radix-ui/*` (16 new) | — | **add** | Primitive layer for P04 |
| `@phosphor-icons/react` | new | **add** | Design §6 |
| `motion` | new | **add** | Design §13; supersedes `framer-motion` |
| `framer-motion` | 12.38.0 | **remove (deferred)** | Only 2 files; migrate to `motion`, then drop |
| `lucide-react` | 0.468.0 | **remove** | Design §6 — **117 files**, largest single migration |
| `recharts` | 2.15.0 | **replace** | → visx. Only 3 files |
| `@xyflow/react` | 12.10.2 | **keep** | Design §13; custom renderers required |
| `mermaid` | 11.14.0 | **review** | Docs-only; heavy. Not design-critical |
| `canvas-confetti` + types | 1.9.4 | **remove** | Decorative; violates motion law §7 |
| `sonner` | 2.0.7 | **review** | Toasts — restyle or replace with a Radix-based toast |
| `storybook` + `@storybook/nextjs` + addon-a11y/themes | new, **9.x** | **add** | DoD #8. v9 not v8 — see §9.6 |
| `@playwright/test` | new | **add** | DoD #3/#4 |
| `prettier` + `prettier-plugin-tailwindcss` | new | **add** | `format` script |
| `@tanstack/react-table`, `@tanstack/react-virtual` | — | **add at P11** | Not needed before Runs |
| `@visx/*`, `uplot` | — | **add at P10** | Not needed before Control |

Non-UI packages (`@supabase/*`, `@prisma/client`, `bullmq`, `ioredis`, `stripe`, `jose`, `zod`,
`pg`, `bcryptjs`, `@lemonsqueezy/*`, `@neondatabase/serverless`, `nodemailer`, `@mdx-js/*`) are
**out of scope** and untouched.

---

## 9. What will make this harder than the plan assumes

Five findings, ordered by how much schedule risk they carry.

### 9.1 There is no dark theme. At all. ⚠️ Highest impact

```tsx
// components/ui/theme-provider.tsx
<NextThemesProvider attribute="class" defaultTheme="light" forcedTheme="light" enableSystem={false}>
```

- `forcedTheme="light"` hard-pins the app.
- **Zero `dark:` utility classes exist in the entire codebase** (measured: 0 occurrences, 0 files).
- `globals.css` declares `color-scheme: light` and defines no `.dark` block.
- `components/layout/theme-toggle.tsx` is a **6-line stub**.

The design direction makes **dark the product default** (§3.2) and the Definition of Done requires
*"both light and dark themes visually verified"* on every one of the 21 prompts. This is not a
migration — it is building an entire second theme from nothing, for every screen, and it roughly
doubles the token and QA work in P02 and in every screen prompt thereafter.

**Recommendation:** treat dark as the primary build target from P02 and derive light second, rather
than the reverse. Budget P02 at double the nominal estimate.

### 9.2 Eleven routes are 450–1,789-line monoliths

`/workflows/new/architect` (1789L), `/workflows/[id]/builder` (1581L), `/workflows/import` (1215L),
`/connections/[id]` (1042L), `/connections/new` (1035L), `/settings/sdk` (762L), `/agents/[id]`
(724L), `/runs` (681L), `/tools/[id]` (635L), `/workflows/[id]` (624L), `/settings/members` (523L).

These interleave data fetching, business logic and JSX with no component boundary. The constraint
*"do not change any API call or business logic"* means each must be **carefully split** before it can
be re-skinned — a refactor the plan does not budget for. Roughly 10,600 lines of route code.

**Recommendation:** add an explicit "extract logic to hooks, leave calls identical" step at the head
of P11, P14, P15 and P18, and verify with a diff that no `fetch` URL, method or body changed.

### 9.3 Three generations of run UI ship simultaneously

`components/runs/**` (15 files), `components/agent-runs/**` (5), `components/agent-runs/v2/**` (20).
P12 is scoped as "build run detail" but is really "build run detail **and** delete two abandoned
implementations, having confirmed which routes still reference them." `/agent-runs/*` routes are
7–9-line stubs, which suggests `v2` is orphaned — **confirm before deleting.**

### 9.4 Lint is advisory, so the constitution is unenforceable today

`npx next lint || true` in CI means no rule can currently fail a build, and ESLint extends only
`next/core-web-vitals`. Until §10's guardrails land *and* the `|| true` is removed, every hard rule
in `CLAUDE.md` is a convention, not a constraint. With 4,698 existing hex values, the rules must be
scoped to new directories only — a repo-wide ban would fail on day one.

### 9.5 The token layer is three overlapping systems, one of which cannot be themed

shadcn HSL vars, a parallel hex var set, and literal hex inside `tailwind.config.ts`. The third
cannot respond to a theme class at all, so any component using `bg-vbgreen`, `bg-surface-1` or
`bg-sidebar` is **structurally incapable of supporting dark mode** — which compounds §9.1. These
classes must be treated as migration blockers, not merely as legacy.

### 9.6 Storybook 8 cannot run against Next 15.5 — resolved by using Storybook 9

The execution plan specifies Storybook 8. Installed against this repo it builds the manager but
crashes building the preview:

```
SB_BUILDER-WEBPACK5_0002 (WebpackInvocationError):
Module not found: TypeError: Cannot read properties of undefined (reading 'tap')
  at @storybook/builder-webpack5 … at next/dist/compiled/webpack/bundle5.js
```

`@storybook/nextjs` v8 taps webpack hooks that Next 15.5's bundled webpack no longer exposes.
Storybook 9 is the supported pairing and builds cleanly, so **Storybook 9.x is installed instead of
8.x**. Practical differences: `@storybook/addon-essentials` and `@storybook/react` are folded into
the core and are no longer separate dependencies; `Preview`/`Meta` types are imported from
`@storybook/nextjs`. Nothing in the design direction or the Definition of Done depends on the major
version. Flagged here rather than silently absorbed — revert if you specifically need 8.x, but that
would require pinning Next below 15.5.

### 9.7 The `apps/web` lockfile was stale, and CI installs from it

CI runs `npm ci` **inside `apps/web`** against `apps/web/package-lock.json`, but npm workspaces
hoists installs to the root and updates the **root** lockfile. `apps/web/package-lock.json` was four
months out of date at the start of this work, so any dependency added at the root would have been
invisible to CI and the build would have failed there while passing locally.

It has been regenerated with `npm install --package-lock-only` from `apps/web`. **Both lockfiles must
be committed together from now on**, or CI drifts from local again. The duplicate lockfiles are also
why `next build` warns about inferring the workspace root; that warning predates this work and is
left alone because changing `outputFileTracingRoot` would alter the `output: "standalone"` layout
that Vercel deploys.

### 9.8 Eight legacy CSS variables collided with the new semantic token names

Resolved in P02, recorded here because the reasoning is not obvious from the diff.

The Ink & Iris semantic layer uses `--bg-app`, `--border-subtle`, `--border-strong`, `--accent`,
`--status-success`, `--status-waiting`, `--status-cancelled` and `--status-queued`. All eight already
existed in the legacy `:root` block in `app/globals.css`, with 34 `var()` uses across 11 files.

This was a live-breakage risk, not a style question. The new tokens are declared in an **unlayered**
`:root`, and unlayered declarations beat anything inside `@layer base` regardless of source order — so
the new values would have silently replaced the legacy ones everywhere, and would then have flipped
with the theme on screens that have no dark styling. `--accent` was the worst case: legacy stores it
as HSL channels for `hsl(var(--accent))`, so a hex value there produces `hsl(#4644d6)` and every
legacy `bg-accent` would have failed to parse.

The legacy declarations and their uses were renamed to `--legacy-*` (mechanical, verified to zero
residual references). Legacy therefore no longer responds to the theme class at all, which is what
makes enabling dark mode safe before the screens are migrated.

**Do not reintroduce any of these eight names into `app/globals.css` or `tailwind.config.ts`.**

### 9.9 A bare `:focus-visible` in legacy globals paints green over the new focus token

Found in P09. `app/globals.css:188` declares an **unscoped** global:

```css
:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px #FFFFFF, 0 0 0 4px rgba(0,127,78,0.40);
}
```

It applies to every element on every page, including `src/**`. Any new component that does not
declare its own ring gets the legacy green one — that is hard rule 11 violated (success green
indicating focus) on a surface the rule was written for, and it is invisible to
`check-design-tokens.mjs` because the offending hex lives in a legacy file that is already exempt.

It also hard-codes white as the inner ring, so on a dark surface the ring reads as a white halo.

**Why it is not fixed yet.** The rule is doing real work for ~70 legacy routes with no focus styling
of their own. Removing it would leave those routes with no visible focus at all — a worse
accessibility outcome than a wrong-hued ring. It cannot be scoped by selector either: there is no
marker class separating the legacy tree from the new one.

**Current mitigation.** `@utility focus-ring` sets `box-shadow: var(--elev-focus)` and sits in
Tailwind's utilities layer, so it wins wherever it is applied. Every `src/**` component must
therefore carry `focus-visible:focus-ring` explicitly on each focusable element — relying on the
browser default silently inherits the legacy green.

**Retire it** at the end of the migration, together with the rest of the legacy base layer. Until
then, treat a missing `focus-visible:focus-ring` in `src/**` as a bug, not an omission.

### Also worth knowing

- **8 emoji literals in 2 files** violate hard rule 4 on contact.
- **861 inline `style={{}}`** bypass Tailwind entirely and are invisible to any class-based lint rule.
- `next.config.ts` sets `typedRoutes: true`, so new routes require `as Route` casts (already the
  pattern in the redirect stubs).
- Six routes are redirect stubs that the new IA should absorb or formally retire.

---

## 10. Dependency-ordered migration sequence

Each step is safe to merge on its own and leaves the app shippable.

**Stage 0 — Foundation (this PR).** Tailwind v4 + `@theme`; `src/**` structure; token files; `cn()`;
Storybook; Playwright; guardrail lint rules scoped to `src/**`; CI enforcement. Legacy config frozen
and loaded via `@config`. No visual change. ✅ *delivered here*

**Stage 1 — Tokens and theme (P02).** Define Ink & Iris in `@theme`. **Build the dark theme.** Remove
`forcedTheme`, implement a real theme toggle, add the no-flash script. Legacy `:root` untouched, so
old screens keep working.

**Stage 2 — Type and icons (P03).** Load Cabinet Grotesk / Switzer / JetBrains Mono. Build the
domain icon set. Do *not* mass-replace Lucide yet — replace per screen so each change is reviewable.

**Stage 3 — Primitives (P04).** New `src/components/ui/**` on Radix + CVA, dark-first, every state,
every one with a Storybook story. Legacy `components/ui/**` untouched. **Review gate.**

**Stage 4 — Shell and Ribbon (P05–P06).** New shell with the revised IA and environment chrome,
mounted behind a flag or on new routes. Checkpoint Ribbon + fixtures. **Review gate.**

**Stage 5 — Screens (P07–P20).** Per screen, in this order: lift data/logic out of the route → swap
to new primitives → replace Lucide in *that file only* → delete the legacy component → re-measure §5.

**Stage 6 — Decommission.** When §5 raw-hex reaches zero: delete `tailwind.config.ts`, drop the
legacy `:root` block from `globals.css`, uninstall `lucide-react`, `recharts`, `framer-motion`,
`canvas-confetti`, `autoprefixer`; widen the lint guardrails from `src/**` to the whole app.

**Ordering rule.** Nothing in Stage 5 may begin until Stages 0–4 are merged, per the execution
plan's non-negotiable ordering rule.

---

## 11. Re-measuring

`scripts/check-design-tokens.mjs` is the authoritative, repeatable measure. Run it after each stage:

```bash
node scripts/check-design-tokens.mjs --report
```

It **enforces** zero violations in `apps/web/src/**` (excluding `src/styles/tokens/`) and **reports**
the legacy baseline. It runs in CI on every push touching `apps/web`.

### Baseline at P01 — the numbers to drive to zero

| Rule | Occurrences | Files |
|---|---:|---:|
| raw hex colour | 4,733 | 106 |
| `rgb()` / `hsl()` colour | 146 | 33 |
| default Tailwind palette class | 1,490 | 75 |
| `lucide-react` import | 117 | 117 |
| emoji | 90 | 18 |

> These differ slightly from §5 because the scopes differ, and both are correct. §5 measures
> `.ts`/`.tsx` across `app`, `components` **and** `lib` (4,698 hex). The script measures `.ts`,
> `.tsx` **and `.css`** across `app` and `components` only — it picks up `globals.css` and drops
> `lib`. Use the script's numbers for tracking, since they are the ones CI prints.

Targets: `src/**` stays at 0 throughout (enforced, non-negotiable); `lucide-react` → 0 by the end of
Stage 5; every legacy count → 0 by Stage 6, at which point the guardrail scope widens from `src/**`
to the whole of `apps/web`.
