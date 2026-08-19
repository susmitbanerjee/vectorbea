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
