# `src/components/ui` — primitives

Built in **P04**. Radix UI + CVA, restyled so no default shadcn silhouette survives.

## Contract

- **No business logic. No data fetching.** A primitive receives props and renders. If it needs to
  know about a run, an agent or a connection, it belongs in `../app` instead.
- Every component defines **hover · active · focus-visible · disabled · loading**.
- Every collection defines **empty · loading · error · partial · permission-denied**.
- Styling comes only from the tokens in `../../styles/tokens/`. No raw hex, no default Tailwind
  palette names, no radius outside the six-step scale.
- Every component ships a Storybook story covering all variants and states.

See `/CLAUDE.md` for the full rule set.
