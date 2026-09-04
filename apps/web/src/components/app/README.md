# `src/components/app` — composed, domain-aware components

Components that know what a run, workflow, agent, tool, connection or approval *is*.

## Contract

- Composed from `../ui` primitives. Never restyle a primitive from here — if a variant is missing,
  add it to the primitive.
- May accept domain types as props; **should not fetch its own data**. Data is loaded in the route
  and passed down, so these stay renderable in Storybook against `../../mocks`.
- The **Checkpoint Ribbon** (design §5) lives here and is built in P06. It is the signature
  component — build it before any screen that displays run state.

See `/CLAUDE.md` for the full rule set.
