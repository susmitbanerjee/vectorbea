# Vectorbea Revamp — Execution Plan
### 21 prompts · 6 phases · sequenced for Claude Code

---

## How I arrived at 21

Prompt granularity is the main variable that determines whether an agentic build holds together. Too coarse and Claude Code loses coherence halfway through, inventing components it already built. Too fine and you lose a day to context re-establishment.

The right unit is **one coherent, independently reviewable slice — roughly 90 minutes to 3 hours of agent work, ending in something you can look at.** That gives:

| Phase | Prompts | What it delivers |
|---|---|---|
| **0 · Foundation** | P01–P04 | Constitution, tokens, type + icons, primitives |
| **1 · Systems** | P05–P06 | App shell + the data/state system incl. the Ribbon |
| **2 · Public** | P07–P09 | Landing, auth, docs |
| **3 · Observe** | P10–P13 | Control, Runs, Run detail, Approvals + Incidents |
| **4 · Build** | P14–P18 | Workflows, Canvas, Inspector, Registries, Architect |
| **5 · Connect & Govern** | P19–P20 | Integrations/Connections/Triggers, Admin |
| **6 · Hardening** | P21 | A11y, perf, responsive, visual regression |

**Non-negotiable ordering rule:** do not start Phase 2 until P01–P06 are complete and reviewed. Phases 0–1 are the entire design system. If you build the landing page first, every later screen inherits improvised decisions and you end up with the same problem you have now.

---

## Dependency graph

```
P01 Constitution
 └─ P02 Tokens ──┬─ P03 Type & Icons ──┬─ P04 Primitives ──┬─ P05 Shell ──┬─ P06 Data & Ribbon
                 │                     │                   │              │
                 └─────────────────────┴───────────────────┴──────────────┴──── everything below

  Phase 2 (parallel-safe)      Phase 3 (sequential)        Phase 4 (sequential)
  ├─ P07 Landing               ├─ P10 Control              ├─ P14 Workflows
  ├─ P08 Auth                  ├─ P11 Runs                 ├─ P15 Canvas
  └─ P09 Docs                  ├─ P12 Run detail  ←P06     ├─ P16 Inspector   ←P15
                               └─ P13 Approvals+Incidents  ├─ P17 Agents+Tools
                                                           └─ P18 Templates+Architect ←P15

  Phase 5                                     Phase 6
  ├─ P19 Integrations/Connections/Triggers    └─ P21 Hardening  ← everything
  └─ P20 Admin
```

**Parallelisable in separate worktrees:** P07/P08/P09 · P10/P11 · P17/P19/P20.
**Strictly sequential:** P15 → P16 (inspector needs node contracts) · P11 → P12 (shared run primitives) · P15 → P18 (Architect materialises onto the canvas).

---

## Standing instructions — put this in `CLAUDE.md` before P01

Every prompt below assumes this file exists at repo root. P01 creates it. It is what stops you repeating design rules 21 times.

```md
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
- `pnpm typecheck && pnpm lint && pnpm build` clean
```

---

## Definition of done — applies to every prompt

A prompt is complete when **all** of these are true. Tell Claude Code to self-verify against this list before reporting back.

1. TypeScript strict, zero `any`, zero suppressions
2. `pnpm typecheck && pnpm lint && pnpm build` pass clean
3. Both light and dark themes visually verified with screenshots
4. Responsive at 1920 / 1440 / 1280 / 1024 / 768 / 390
5. Keyboard-only operable; visible focus ring on every interactive element
6. Every state implemented — including empty, loading, error, permission-denied
7. Reduced-motion variant verified
8. Storybook story for every new component with all variants
9. No new dependency added without justification in the PR description
10. Zero hard-coded strings that should be tokens; zero hard-coded colours, full stop

---

## Running this well

**Fixture data first.** Before Phase 3, generate a realistic fixture set from the screenshots you sent: 163 runs with the real 58/83/22 split, 11 workflows, 17 agents, 32 tools, 6 connections with 3 failed, the Postgres Answers failure and its incident. Building against realistic data is what prevents layouts that only work with three tidy rows. P06 covers this.

**Screenshot after every prompt.** Claude Code can drive Playwright. Instruct it to capture both themes at 1440 and 390 and attach them. A picture catches what a description hides.

**Review gates.** Stop and look after P04, P06, P12, P16. Those are the four points where a wrong decision compounds most expensively.

**One prompt per branch.** `revamp/p07-landing`. Squash-merge. Keeps bisecting sane when something regresses.

**When a prompt is too big.** If Claude Code starts skipping states or stubbing components, the prompt is too large for its context. Split at the natural seam listed in each prompt's "Split here if needed" note.

---

## What ships when

| Milestone | After | You can show |
|---|---|---|
| **Design system review** | P06 | Storybook + shell. Enough to validate the direction with stakeholders before spending on screens. |
| **Fundraise / marketing ready** | P09 | Landing, auth, docs. Public surface complete. |
| **Demo-ready product** | P13 | The full operator story: dashboard → runs → failure → diagnosis → approval. This is the demo that wins against Zapier. |
| **Feature-complete revamp** | P20 | Every screen replaced. |
| **Production ready** | P21 | Hardened, accessible, tested. |

If you need to cut scope, cut Phase 5 (P19–P20) before Phase 3. Admin screens rarely close deals; the run-failure-recovery story always does.
