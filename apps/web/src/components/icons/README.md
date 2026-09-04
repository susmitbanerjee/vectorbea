# `src/components/icons` — domain icon set

Built in **P03**. Design direction §6.

- **Base set is Phosphor** (`@phosphor-icons/react`), Regular at 16/20px, Bold only for active or
  filled states. Never mix weights inside one hierarchy level.
- **Lucide is banned** and is enforced by ESLint. See `/docs/audit/CURRENT-STATE.md` §5 — it is
  imported by 117 legacy files and is removed screen by screen, not in one pass.
- **No emoji**, anywhere, ever.

## The bespoke marks

28 domain glyphs Phosphor cannot supply, drawn on a 24×24 grid with a 1.5px stroke and hex-derived
geometry: durability, queue, graph, human, failure and execution families (design §6.1), plus the
12 builder node marks (§6.2).

`apps/web/components/icons/vectorbea-icons.tsx` is an earlier legacy attempt. Treat it as a seed to
review, not as the deliverable.
