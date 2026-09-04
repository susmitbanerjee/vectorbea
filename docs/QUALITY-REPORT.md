# Quality report — P21 ship gate

**Status: NOT PASSED. The gate cannot be closed from this environment.**

P21 asks for axe-core on every route, Lighthouse scores, VoiceOver and NVDA
testing, a four-browser matrix, and committed visual-regression baselines. None
of that tooling is present here and three of those items need software this
environment cannot run at all. What follows separates, precisely, what was
measured from what was not — because a ship gate whose report is optimistic is
worse than no gate.

Date of this pass: 2026-08-16. Scope: P01–P20, `apps/web/src/**`.

---

## 1. Summary

| Area | Status | Evidence |
|---|---|---|
| Mechanical checks (types, lint, tokens, contrast, boundaries, build) | **Pass** | Run below, all clean |
| Consistency audit — colour, shadow, Lucide, emoji, z-index | **Pass** | 0 violations in `src/**` |
| Consistency audit — radii | **4 violations** | Listed below, unfixed |
| Consistency audit — spacing lattice | **Unresolved** | 204 findings; needs a design decision, see §4 |
| Keyboard / focus rings | **Partial** | Measured on 4 surfaces; 21 unmeasured |
| Both themes verified | **Partial** | 8 surfaces captured; 12 unverified |
| Automated accessibility (axe) | **Not run** | axe-core not installed |
| Screen reader | **Not run** | No VoiceOver/NVDA available |
| Performance / Lighthouse | **Not run** | Lighthouse not installed |
| Responsive matrix | **Not run** | Only 390 spot-checks on 3 surfaces |
| Cross-browser | **Not run** | Chromium only |
| Visual regression baselines | **Not committed** | See §7 |

---

## 2. What was verified, with evidence

These were run in this pass and are current as of the final commit.

```
npx tsc --noEmit          exit 0
npm run lint              exit 0
npm run check:tokens      ✓ apps/web/src is clean (179 files scanned)
npm run check:contrast    ✓ 0 contrast failures, 0 unresolved tokens,
                            0 rule violations, across both themes
npm run check:boundaries  ✓ No forbidden imports found in frontend code
npm run build             ✓ Compiled successfully
```

`check:contrast` is the meaningful one for WCAG: it grades **every semantic token
pairing in both themes** against 4.5:1 body and 3:1 large/UI, and enforces that
brand (iris) and status hues stay disjoint. That is the §14 contrast requirement
satisfied at the token layer, and it has held green through every prompt.

It is **not** the same as auditing rendered contrast. A token pairing can pass in
isolation and still be misused — text placed on the wrong surface, or an opacity
modifier applied over a tint. That gap is what axe would close.

### Keyboard and focus rings

A runtime audit was run on four surfaces: it focuses every interactive element,
reads the computed `box-shadow`, and flags anything with no ring or with the
legacy green one. Transitions are suppressed during measurement — an earlier
version of this audit read mid-transition values and produced false positives.

| Surface | Focusables | Missing ring | Legacy green |
|---|---|---|---|
| Workflows list (table) | 83 | 0 | 0 |
| Workflows list (cards) | 101 | 0 | 0 |
| Workflow overview | 51 | 0 | 0 |
| Version history | 60 | 0 | 0 |

**One real bug was found and fixed by this audit**: the shared `QueryBar` input
had no focus ring of its own, so the unscoped `:focus-visible` in
`app/globals.css` painted the pre-revamp *green* ring on it — success green
indicating focus, on Runs as well as Workflows. Fixed at source.

The remaining 21 surfaces have not been through this audit.

### Colour independence

Verified by construction rather than by simulation — no protanopia/deuteranopia/
tritanopia simulation was run. Every status, risk and diff encoding carries a
non-colour channel:

- **Run/workflow status** — shape-differentiated dot (filled circle, pause bars,
  dashed ring, archive glyph) plus text label.
- **Risk tiers** — one to four filled bars. The tier is countable in greyscale.
- **Version diff** — `+` / `−` / `~` corner marks on added, removed and modified
  nodes, plus dashed strokes on removed. This was added specifically because
  verdant/signal/ember is the pairing deuteranopia collapses.
- **RBAC matrix** — tick and dash glyphs, each with a spoken label
  (`"Owner can view workflows"`), never colour alone. 160 cells verified.

### Reduced motion

Every animation is authored inside `motion-safe:` and carries `data-motion`. The
blueprint materialisation, checkpoint bloom, gate breathing and edge flow all
collapse to their finished static state rather than to a partial one. Verified by
reading, **not** by running with `prefers-reduced-motion` forced — that check is
outstanding.

---

## 3. Bugs found and fixed during the build

Recorded here because they are the class of defect this gate exists to catch, and
several were found only by measuring rather than by reading.

| # | Defect | Surface | Fixed |
|---|---|---|---|
| 1 | `QueryBar` input painted the legacy green focus ring | Runs, Workflows | Yes |
| 2 | React Flow's default `colorMode="light"` collided with the bare `.light` theme selector, rendering the whole builder canvas white-on-white inside a dark app | Builder | Yes |
| 3 | `ProviderLogo` indexed its mark table unguarded and crashed the builder on any tool from an unrepresented vendor | Builder, Tools | Yes |
| 4 | Autosave commit loop — the inspector's effect depended on a callback the commit itself rebuilt, exceeding React's update depth | Inspector | Yes |
| 5 | Failing-connections banner summed per-connection blast radius and double-counted, reporting "13 workflows" in a workspace with 11 | Connections | Yes |
| 6 | "Ungated high risk" chip counted agents with findings but its query returned all agents with any grant | Agents | Yes |
| 7 | Validate blocked publishing on a *currently failing* connection — which would block the publish that fixes it | Publish flow | Yes |
| 8 | Draft workflow versions reported a success rate despite never having run | Version history | Yes |
| 9 | Self-contradictory readiness copy: "You have nothing connected, but Postgres is not healthy" | Templates | Yes |
| 10 | `toLowerCase()` on a whole sentence mangled `contracts.getUpcomingRenewals` | Overview | Yes |

---

## 4. Consistency audit — before and after

Two scripts. `check:tokens` predates this pass; `check:consistency` is new
(`scripts/check-consistency.mjs`) and covers the §14 rules nothing was checking.

### `check:tokens` — `apps/web/src/**`

| Rule | Before P21 | After |
|---|---|---|
| Raw hex | 0 | 0 |
| `rgb()` / `hsl()` | 0 | 0 |
| Default Tailwind palette class | 0 | 0 |
| `lucide-react` import | 0 | 0 |
| Emoji | 0 | 0 |
| Unknown `z-*` utility | 0 | 0 |

These were already clean — the ESLint rules and this script have been enforcing
them since P02. The legacy layer in `apps/web/{app,components}` is unchanged and
still carries 4,304 raw hex values across 100 files; that is the tracked
migration in `CURRENT-STATE.md §11`, not a regression.

### `check:consistency` — new

| Rule | Count | Status |
|---|---|---|
| Arbitrary colour in a utility | 0 | Pass |
| Shadow that is not a tinted elevation token | 0 | Pass |
| **Arbitrary radius value** | **4** | **Unfixed** |
| Numeric cell without tabular figures | 15 | Advisory, unreviewed |
| Icon-only button with no accessible name | 1 | Advisory, unreviewed |

**The 4 arbitrary radii** are `rounded-[1px]` and `rounded-[2px]` on skeleton
bars and sparkline elements, where the scale's smallest step (`xs`, 4px) is
visibly too round on a 2px-tall bar. They are a real breach of §8's "Nothing
else". Recommendation: add a `2xs: 2px` step to the scale rather than special-
casing, or accept them explicitly in the script. **Not fixed** — either option is
a design decision.

### The spacing lattice — unresolved, needs your decision

The first version of this rule reported **428 violations**. That was the rule
being wrong: §8 defines padding steps as *4 / 6 / 8 / 12 / 16 / 20 / 24*, so 6px
(`py-1.5`) is on the lattice and was being flagged incorrectly.

Corrected, it reports **204 findings**, almost entirely:

- `px-2.5` / `p-2.5` — 10px, used for pill and chip padding
- `py-0.5` / `mt-0.5` — 2px, used for chip vertical padding and the offset under
  a label

These are a **consistent convention applied across all twenty prompts**, not
scattered mistakes. §8's list governs *component padding*; it does not obviously
speak to the internal chrome of a pill or a 2px offset beneath a caption.

I did not rewrite 204 sites. Doing so blind, with no budget left to look at the
result, would very likely have broken layouts across every surface — and the
audit would have reported a clean number while the product got worse. **This
needs a decision:**

1. **Extend §8** to name 2px and 10px as legitimate sub-component steps, and
   encode that in the script. *(Recommended — it matches what was actually built
   and reviewed across twenty prompts.)*
2. **Hold the line** and migrate 204 sites to 4/8/12, with a visual pass on every
   surface afterwards.

Until it is decided, the rule is advisory in the script so CI is not blocked by
an open question.

---

## 5. Not run — and what each needs

| Item | Blocker | To run it |
|---|---|---|
| **axe-core, every route, both themes** | Not installed | `npm i -D @axe-core/playwright`, then a sweep over the ~25 routes × 2 themes. This is the **highest-value missing item** and the one I would do first. |
| **Lighthouse 95+/90+, LCP/CLS/INP** | Not installed | `npx lighthouse` against a production build, or `@lhci/cli` in CI. No performance number in this report is measured. |
| **Screen reader (VoiceOver, NVDA)** | No screen reader in this environment | Manual pass on macOS and Windows. Live regions on run status, log stream and toast are **authored but unverified**. |
| **Cross-browser** | Chromium only | Playwright can drive WebKit and Firefox; real Safari and Edge need manual passes. Safari's `backdrop-filter` on the dialog overlays and SVG animation on the ribbon are the specific risks §5 names. |
| **Responsive 2560→390** | Not run | Only 390 spot-checks on Templates, Overview and Versions. The Builder on tablet is entirely unverified and its desktop-only boundary is undocumented. |
| **10k-row table / 200-node builder / 100k-line log** | Not measured this pass | `perf:runs` exists for the table (`tests/perf/runs-10k.mjs`); nothing equivalent for the builder or log viewer. No 60fps claim in this report is measured. |
| **Bundle analysis** | Not run | Build output shows several app routes at ~200–300 KB First Load JS (`/workflows/[id]/builder` is 303 KB, the largest). That is over the 200 KB gate and needs `@next/bundle-analyzer` to attribute. |
| **Visual regression baselines** | Not committed | See §7. |

---

## 6. Known issues, by severity

**High**

1. **Route bundle sizes exceed the 200 KB gate.** `/workflows/[id]/builder` is
   303 KB First Load JS; several registry routes sit at 199–216 KB. Needs
   attribution before a fix can be planned — React Flow and the table stack are
   the likely bulk.
2. **Live regions unverified.** Run status, log stream and toast have live-region
   markup that no screen reader has exercised.

**Medium**

3. **Builder on tablet is unverified and undocumented.** P15 asked for "readable
   and pannable at minimum, document what is desktop-only". Neither was done.
4. **12 surfaces have never been viewed in light theme.** Agents, Tools,
   Integrations, Connections, Triggers, Usage, Members, Audit, Settings and the
   Architect's later stages were verified in dark only. Token-level contrast
   passes in both, but layout and legibility in light are inferred, which §14
   explicitly forbids.
5. **Blast-radius agent count is uninformative.** It reports 12–14 for nearly
   every connection because most agents hold a grant for at least one tool of any
   provider. Truthful but carries no signal as a column; scope it to agents
   reachable from the affected workflows, or drop it.

**Low**

6. 15 numeric cells may lack tabular figures (advisory, unreviewed).
7. 1 icon-only button may lack an accessible name (advisory, unreviewed).
8. `/api/bootstrap` 404s on every page load (pre-existing, unrelated to the
   revamp).

---

## 7. Deferred, with recommendations

**Visual regression baselines — not committed.** Three capture scripts exist and
work (`capture:workflows` 46 shots, `capture:inspector`, `capture:architect`),
but they are demo captures, not baselines: no `toHaveScreenshot` assertions, no
CI diff check, and no coverage of Agents, Tools, Integrations, Connections,
Triggers or the four GOVERN surfaces.

Recommendation: convert to a single `tests/visual/routes.spec.ts` that enumerates
every route and asserts `toHaveScreenshot` at 1440 and 390 in both themes, run
against a **production build** rather than the dev server. Every flake I hit in
this session — and there were many — traced to the dev server compiling on demand
and clicks landing before hydration. A production build removes that entire class
of problem, and is the single change that would make these scripts trustworthy.

**The capture debt is the largest gap in the handover.** P17 through P20 shipped
with no screenshots at all. That is four prompts' worth of surfaces whose
both-themes verification is asserted from token-level contrast rather than
observed. I flagged it at the end of each of those prompts and it accumulated
rather than being addressed; it should be closed before anything else in this
list.

---

## 8. Recommendation

Do not treat this as passed. The order I would work it:

1. Convert the capture scripts to real visual-regression baselines against a
   production build, covering all routes in both themes. This closes the P17–P20
   debt and gives every later item a stable harness.
2. Install and run axe-core across every route in both themes.
3. Decide the spacing-lattice question in §4 so the consistency script can be
   made fatal in CI.
4. Bundle analysis for the four routes over 200 KB.
5. Manual screen-reader and Safari passes.

Items 1 and 2 together would move this from "not passed" to a defensible gate.
