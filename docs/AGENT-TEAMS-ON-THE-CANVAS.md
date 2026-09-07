# Agent teams on the canvas (P10)

Companion to `docs/AGENT-HARNESS-ARCHITECTURE.md` §6 and §9, which describe the
runtime. This one describes the half a builder touches: the `agent_team` node,
the design-time guards, the plan gating, and the templates that produce one.

---

## 1. Two bugs verified before anything was built

The brief asked for both to be confirmed rather than assumed. One was already
fixed; one was real.

### The routed builder page reading fixtures — **already fixed**

`apps/web/app/(app)/workflows/[id]/builder/page.tsx` passes the id straight to
`BuilderView`, which loads through `useWorkflowGraph`:
`GET /api/workflows/:id` for the row, `GET /api/workflows/:id/versions` for the
graph, `POST /api/workflows/:id/versions` to save. Test, Run and Debug run all
call real endpoints and save a dirty canvas first, so the run executes the graph
on screen rather than the previously saved one. No further work was needed.

### The Architect leaving `current_version_id` null — **real, and fixed here**

`WorkflowArchitectService.createWorkflow` called `workflowRepo.create(...)` and
`workflowRepo.createVersion(...)` and stopped. `createVersion` inserts into
`workflow_versions` and nothing else — pointing `workflows.current_version_id` at
the new row is a **separate write**, which `WorkflowRoutes.createVersion`
performs and this path did not.

The consequence: every AI-generated workflow was unrunnable from birth.
`RunRoutes` and `DebugRoutes` both resolve the version to execute from that
column and only that column, so each one refused with *"has no current version —
publish a version first"*. Nothing the user could do in the product fixed it: the
Architect is the one creation path that never opens the builder, so the save that
would have set the pointer never happened.

The fix is one call to `workflowRepo.setCurrentVersion(...)`, placed **before**
`repo.saveWorkflowIds` so a failure fails the build loudly rather than recording
a session pointing at a workflow that cannot run.

This mattered for sequencing: teams become generatable in this phase, and a
generated team would have inherited the same defect.

---

## 2. The node

`agent_team` is now a canvas node kind, threaded through `NodeKind` in both the
live contract (`~/lib/architect/blueprint`) and the fixture one (`~/mocks/domain`),
the graph codec, the palette, the node marks and the inspector.

The codec change is the one worth noting. `toNodeKind` falls through to `tool`
for an unrecognised type, and `toStoredGraph` then writes whatever kind is on the
node — so a team the canvas failed to recognise would be **destroyed** by the next
save, not merely mislabelled. `team`, `crew` and `multi_agent` are all mapped,
matching `WorkflowGraph.NodeType.fromString`.

### The config is the runtime's, exactly

`apps/web/src/lib/workflows/team.ts` mirrors `TeamConfig.parse` field for field:
the alias→id resolution, the entry-agent fallback chain, the coercion ranges, and
the split where `maxIterations` and `maxToolCalls` live under `limits` while
`maxTotalTokens` and `maxCostCents` live under `budget`.

That split is not a design; it is where the Kotlin parser looks. Tidying it would
produce a team with an iteration budget of zero — and zero means *unbounded*.
`__tests__/team-config.test.ts` pins it.

The parser **degrades** rather than throwing, which is why matching it matters
more than it looks: a config the canvas got subtly wrong does not fail, it *runs*,
as a different team than the one on the screen.

---

## 3. The delegation graph is drawn on the node

A roster is a graph, and depth, cycles and unreachable members are properties of
its shape. A list of rows cannot show a shape. So the team node renders its
members as chips in columns **by delegation depth**, with the grants as arrows —
the horizontal extent of the drawing *is* the number the depth limit is compared
against, and a cycle is drawn as a dashed red back-edge routed below the chips.

The same component renders inside the inspector while the roster is being edited,
so ticking a grant and watching an arrow appear is what teaches the grant model.

Two things the drawing refuses to guess at, both taken from
`~/lib/workflows/team`:

- **Which member starts.** Named entry → the member whose role leads the policy →
  the first. Reproduced exactly, because a canvas that guessed differently would
  draw a correct-looking team that runs from the wrong place.
- **Which grants count.** For a `pipeline` the edges are the roster *order*:
  `OrchestrationLoop.runPipeline` walks `roster.drop(1)` and never consults a
  grant, so drawing the grants there would draw arrows the run does not follow.

A team node is 296×204 (or 332 tall past three members). Both dimensions satisfy
the lattice congruence in `builder/store.ts` — `width ≡ 200 (mod 16)` and
`height ≡ 76 (mod 16)` — or auto-layout develops a visible sawtooth. `nodeSize()`
is threaded through dagre, the alignment tools and the drag guides so all four
agree.

---

## 4. Design-time validation

`builder/team-validation.ts` runs every §9 guard that can be answered without
executing anything. Each has a runtime counterpart that stays; none is replaced.

| Check | Severity | Why here |
|---|---|---|
| Empty roster; member with no agent | error | `TeamConfig.parse` returns `Invalid` for the first and silently drops the second. |
| Agent not in this workspace | error | Lookups are workspace-scoped and fail closed. |
| Duplicate alias | error | The parser builds `alias → id` as a map; the second write wins and one member becomes unreachable. |
| Duplicate agent across two members | warning | `memberOf` looks up by agent id, so the second row's grants are ignored. |
| Member the entry cannot reach | error | The grant is a whitelist; an agent nobody may delegate to is never activated. |
| Delegation cycle | error (warning on `blackboard`) | Peer-to-peer *is* the blackboard policy; everywhere else a cycle is a hierarchy that eats itself. |
| Chain deeper than `maxDepth` | error | Only where a handoff is a delegation — a transfer is a tail call, so `pipeline` and `router` are flat and are exempt. |
| Pipeline with grants | warning | Nothing reads them; the arrows would not be the path. |
| Router whose specialists route onwards | warning | That is a chain of routers, not a router. |
| Entry not marked with the policy's lead role | warning | Removing the explicit entry would then start the team somewhere else. |
| No cost ceiling | warning | A zero budget means *no* ceiling, not a ceiling of zero. |
| Roster/depth/feature against the plan | error | Mirrors `GraphPlanCheck`, including its `>` (a plan allowing 8 accepts exactly 8). |

The difference this makes is the sentence somebody reads. At run time a roster
cycle surfaces as *"depth limit exceeded"* — true, at 3am, in a workflow that has
been green for a week, to somebody who did not write it. On the canvas the same
fact is *"researcher → writer → researcher"*, with the node lit up.

### Only a cycle refuses the save

Validation is otherwise non-blocking, deliberately: a workflow mid-construction is
invalid by definition, and a builder that refuses to save while you are still
building gets worked around within a day.

A cycle is the exception, and the only one. Every other error describes an
*incomplete* graph — save it and the run fails at that node with a clear message,
which is a normal working loop. A cycle describes a graph that does not
**terminate**, and the version written is one the engine will accept, schedule,
and then spend a budget discovering is unbounded. `blockingIssues()` is that list;
`saveGraph()` is the single choke point, guarding the button, ⌘S, and the
save-before-run that every trigger performs.

---

## 5. Plan awareness

`GET /api/entitlements` already existed and returns the resolved entitlements
themselves. `~/lib/entitlements/use-entitlements` reads it, so a disabled control
in the UI agrees with the refusal the API would have given — rather than the UI
keeping its own table, which is wrong the first time an operator raises a limit
with an override row.

**Unknown is permissive.** Pending, failed, or an API that predates the endpoint
all yield `unknown: true`, and every accessor allows. Gating on an answer we do
not have takes the product away from people whose plan allows it, for a reason the
screen cannot name — and it does so on exactly the deploys where the two services
are skewed, which is normal here because they ship independently. This is safe
because nothing in the web app is enforcement; `EntitlementGuard` and
`GraphPlanCheck` are.

**Nothing is hidden.** `builder/gates.ts` returns a reason and an action, and
distinguishes the two kinds that look identical in a `disabled` prop:

- **plan** — the billing account does not include it. Solved with a credit card,
  and the sentence names the plan that has it.
- **runtime** — the deployment has it switched off. *Not* solved with a credit
  card, and the action names the environment variable.

Runtime is checked **first**. A workspace can be on a plan without teams *and* in
a deployment with teams off; offering the upgrade there would take money for
something the executor still refuses.

---

## 6. Templates

`~/lib/workflows/templates/` is six orchestration patterns — single agent,
supervisor, router, review loop, human-in-the-loop, scheduled batch — each of
which **installs**: creating its agents, then the workflow, then the version that
makes it runnable, then opening the canvas.

The bar is that each runs end to end in a clean workspace with **one** model
connection. That constraint shapes the catalogue:

- No HTTP or database tool in the required path — both need a connection of their
  own, which would make the promise "two connections". Where one helps, it is
  declared as an optional tool, installed only if a compatible connection already
  exists, and named with a sentence saying what the template does without it.
- Sending is a `builtin_email` **node**, not a registered tool.
  `ToolNodeExecutor` checks `config.toolType == "builtin_email"` before it
  validates `toolId`, so that step needs neither a tool row nor a connection.
- Tool types are the **worker's**, not the API's. The API accepts `builtin`,
  `code`, `custom` and `llm_generate`; `ToolNodeExecutor` has no branch for any of
  them and ends at *"not yet supported by the worker"*. A template creating one
  would install cleanly and fail on its first run — the worst outcome for a
  starter template, because it teaches somebody the product is broken in their
  first minute.

Agents are created **before** the workflow. `AgentNodeExecutor` resolves
`config.agentId` as a UUID and fails without one, so the graph must be built from
real ids; and if agent creation fails on `max_agents`, nothing has been written
that references them. Partial installs are reported rather than rolled back —
there is no transaction across four HTTP calls, and a failing cleanup leaves a
worse mess than the one it was cleaning.

Each template carries its own documentation: what it does, what it needs (first
item is the one connection), what a run costs *as a range with its drivers named*
and the ceiling it ships with, and the first two or three edits to make.
`__tests__/template-catalog.test.ts` asserts all of it, plus every property whose
absence would make "runs end to end" false.

---

## 7. Build and debug are one loop

The top bar carries **Debug last run** — straight to `/runs/:id/debug`, not to the
Runs list. The list is where you go when you do not know which run you mean, and
from inside the builder you always do. Five navigations became one, and none of
them loses the canvas viewport, selection or undo history.

---

## 8. What is still off

`AGENT_TEAMS_ENABLED` and `AGENT_ACTIVATIONS_ENABLED` both default to `false`.
Everything above ships regardless — the node is drawn, validated, gated and
saved — but a run of a team node in a default deployment fails with *"teams are
switched off here"*.

The web app mirrors both in `~/lib/flags` (`agentTeams`, `agentDelegation`) so the
palette can say so before a save rather than after a scheduled run. That mirror is
a duplication an operator must keep in step, and it is the cheaper of two bad
options: the alternative is a canvas that offers a team node, saves it, schedules
it, and fails several minutes and one production incident later.
