# Skills

A granted capability, like a tool — except what it grants is competence.

---

## 1. The gap this closes

An agent granted an MCP video generation tool does not know how to make a good
video. The tool gives it capability; nothing gives it competence. That gap is why
multi-step creative and operational pipelines underperform: every step can reach
its API, and none of them knows what good looks like.

The obvious fix is to paste the competence into `agents.instructions`. It works
exactly once:

- it cannot be reused by a second agent;
- it cannot be versioned independently of the agent that happens to hold it;
- nothing records that a behaviour change came from the paste rather than from
  the agent.

Three agents doing related work end up with three divergent copies and no way to
tell which one somebody improved.

So a **skill** is a first-class entity: a named, versioned bundle of instructions
for a domain, the tools it requires, an output contract, and worked examples.
Workspace-scoped, granted per agent, composed into the prompt when granted, and
versioned independently of the agent.

---

## 2. It inherits the tool discipline, not a new one

Nothing below is novel machinery. It is the existing grant model applied to a
second kind of callable, deliberately:

| Rule | Where it comes from |
|---|---|
| The grant check is runtime code against a database | Invariant 1 — a list in a prompt is documentation, not enforcement |
| The VERSION is the unit of change | Invariant 14's argument: a grant to an id whose behaviour changed underneath it is a grant to something nobody reviewed |
| Lookups are workspace-scoped at the same boundary, failing closed | Invariant 8 |
| Authored text is sanitized at the WRITE boundary | Invariant 4 |
| The composition is bounded, and every cut is recorded | `ContextAssembler`'s argument, one layer out |
| The save path and the run path share one implementation | Invariant 16's lesson — `RunIngress` exists because a sequence was reimplemented from memory |

That last one is why `packages/skills-kotlin` is a module and not two copies. The
whole point of refusing a grant at save time is that the author learns what the
runtime will do; a second implementation of the composer makes that promise false
the first time one of them changes.

---

## 3. A skill grants nothing

Worth stating first, because everything else reads more clearly after it.

`SkillLoader` reads a grant table and could be mistaken for a permission. It is
not one. `AgentSafetyGuard.validateToolAllowed` reads `allowed_tool_ids` and
`validateAgentAllowed` reads `canDelegateTo`; **neither takes a skill as input**,
and both would behave identically if the whole skills feature were deleted.

The worst a corrupted, malicious or hallucinated skill row can do is waste a
prompt. `SkillInjectionTest` asserts this the honest way round: the skill text is
NOT sanitized, it says exactly what an attacker would want it to say, the model
believes it and acts on it — and the runtime refuses anyway.

---

## 4. Granting is refused when it cannot work

**The acceptance criterion.** Granting a skill without its required tools is
refused at save time, with the missing list.

A skill's instructions say "call the video generation tool with a shot list". An
agent holding that skill and not that tool does exactly what it was taught, is
refused by the runtime (invariant 1, correctly), and presents as an agent that
hallucinated a tool. It did not. Somebody granted it a bundle naming tools it does
not have, and that was knowable the moment they pressed save.

```
PUT /api/agents/:id/skills   →  422 SKILL_TOOLS_MISSING
{
  "error": {
    "code": "SKILL_TOOLS_MISSING",
    "message": "This agent is missing tools that its skills require: video-production
                needs Video generation. Grant those tools to the agent, or remove the
                skills that need them.",
    "details": { "missing": [ { "skillId": "…", "skillName": "video-production",
                               "missingTools": [ { "toolId": "…", "label": "Video generation" } ] } ] }
  }
}
```

Three things about that refusal:

- **Every missing tool at once.** An author who granted three skills and is
  missing four tools should fix four things once, not discover them one save at a
  time.
- **The label rides on the requirement**, rather than being looked up, so the
  message still names a tool after the tool row is deleted — which is precisely
  when the id alone is least useful.
- **An empty `allowed_tool_ids` is not read as "everything".**
  `validateToolAllowed` treats it as "any tool", a documented fail-open kept
  because tightening it would change behaviour for agents that run today.
  Inheriting that reading here would make the refusal vacuous for exactly the
  agents most likely to be misconfigured: the ones nobody has finished setting up.

### And it runs again at execution time

Save time is where the check is USEFUL; it is not where it is enforced. A tool can
be revoked a minute after a grant is saved — V042's note says why the pin covers
the definition and not the grant. So `SkillLoader` calls the same
`SkillGrant.check` on every activation and DROPS any skill whose tools are gone,
rather than teaching an agent to call something the runtime will refuse.

Every drop is logged and recorded. That is the whole discipline: the failure this
feature is most likely to cause is an agent that "ignored" a skill it was never
shown.

---

## 5. Composition is bounded and ordered

### Where skills sit

After the agent's own instructions, before anything the run produced.

The position is the precedence claim, and it is not configurable. The agent's
instructions are **who it is**; a skill is **how it does one kind of work**; an
observation is **what happened**. Putting a skill above the instructions would let
a shared bundle override the agent somebody configured; putting it below the
observations would let a tool result outrank the method.

Within the block, skills appear in GRANT order (`agent_skills.position`), because
an author who lists "research, then script, then video" is describing a pipeline
and re-sorting by name would silently discard that.

### The budget

Skills get a **share of the context budget** — a quarter, floored at 2,000
characters — rather than a knob of their own. The system prompt has never been
budgeted; skills are the first part of it that is. An independent variable would
mean an operator who raises `AGENT_CONTEXT_CHAR_BUDGET` because prompts are being
truncated still gets skills truncated, and has to discover a second setting.

When the budget bites, in this order:

1. **worked examples are dropped** — the instructions are the competence, an
   example is a demonstration of it, and an agent with the instructions and no
   example is a working agent;
2. **the instructions are cut short**, with a marker, while there is room for a
   coherent instruction;
3. **below that floor the skill is dropped whole** — a fragment reads to the model
   as a complete but wrong instruction, and it will follow it.

Every one of those is named in the span attributes and in
`agent_activation_skills`. The budget is ordinary; **the bookkeeping is the
feature.** An agent that "ignored" a skill it was never shown is the hardest agent
failure to diagnose, because every artefact looks correct: the prompt is well
formed, the skill is granted, the row is there.

### Three skills that do not fit is a design-time error

`SkillComposer.wouldNotFit` runs at save time, from the same module, at the same
budget, and refuses the grant with a sentence naming what would be lost. An author
who saves without a warning is an author whose agent will see every skill they
granted.

---

## 6. A customer-authored skill is untrusted

Its text reaches the model's prompt. That is the same surface an MCP tool
description is ([MCP.md §4](./MCP.md)), and worse in one respect: a description is
a sentence, a skill is a page, granted deliberately and read by the model as
authoritative guidance about how to work.

**Two claims, and only one is the security boundary.** It matters to say which:

- **The grant check stops injection, and the sanitizer does not.** No string in
  any prompt is an input to `validateToolAllowed` or `validateAgentAllowed`.
  `SkillSanitizer` could be deleted and an injected skill still could not widen a
  tool list or a roster.
- **The sanitizer is defence in depth** against the rest of the damage: a bundle
  that wastes the budget, impersonates a system instruction, or derails reasoning
  without escalating permissions. Real, worth preventing, not the boundary.

Conflating them is how a team ends up believing a content filter is a permission
system, so `SkillInjectionTest` and `SkillSanitizerTest` never merge.

What the sanitizer does: caps instructions at 8,000 characters (a skill IS a
page — capping it at a tool description's 500 would defeat the feature), caps
each example and the NUMBER of examples (twenty legitimate examples is a budget
attack assembled from pieces that are each under their own cap), strips control
characters, collapses blank-line runs while PRESERVING paragraph structure, and
replaces frame-impersonation phrases with `[removed]` — a marker rather than a
deletion, so a reviewer can see something was there.

It is **never used to reject a skill.** A false positive would refuse a
customer's own bundle on their own agent, which is worse than a defanged
sentence. `flagged_for_review` surfaces it instead.

The prompt block also carries a frame telling the model a skill cannot grant a
tool, add an agent to a roster, or change an output schema. That is defence in
depth too, and explicitly not the boundary: an agent that spends its whole
iteration budget being refused is a wasted run even though nothing was breached.

---

## 7. The library

`skill_catalog_entries` is global and has **no workspace column**. That is what
makes a first-party skill first-party: there is no row a customer can write, and
no `provenance` field on any request that sets `first_party`.

A platform skill cannot name a customer's tool uuids, so it declares
**capabilities** (`video.generate`), and installing it into a workspace is the act
that binds each capability to one of that workspace's tools.

**The binding step is the product, not a formality.** It is where an operator sees
exactly which of their tools a platform skill is about to start instructing their
agents to call, before any agent holds it. A library that installed itself
silently would be us adding instructions to somebody's production agent.

Every declared capability must be bound. A partial install would produce a skill
with an incomplete requirement list, and an incomplete requirement list makes the
grant check pass for an agent that will fail at iteration four — the exact failure
this feature removes.

Re-installing is an **upgrade in place**: a second row with the same text and a
different id would silently split every grant in the workspace across two skills.

---

## 8. Versions

A skill version exists for `tool_versions`' reason, in a softer place. A tool
version exists because a re-import can widen a parameter under a grant; a skill
version exists because an author can rewrite the instructions under one. The
consequence differs in kind — a widened tool spends money, a rewritten skill
changes behaviour — but the diagnostic problem is identical: **an agent that
behaved differently last Tuesday, with no change to the agent.**

A grant may pin (`agent_skills.skill_version_id`) or follow (NULL, the default).
Following is the default because a skill is guidance rather than a signature, and
because the version that actually ran is recorded per activation either way.

Writing a version returns `affectedAgents`. That is the useful default — fix the
wording once, every agent improves — and also a blast radius an author should be
told about rather than discover from a run.

Archiving stops a skill composing immediately and **keeps the grant rows**, the
same call `McpDiscovery` makes about a withdrawn tool: deleting would shrink every
holding agent's configuration with no record that it happened.

---

## 9. Traceability

Which skills were active on an activation is answerable two ways, deliberately.

**A span attribute** (`skills_active: ["video-production@v3", …]`, plus
`skills_dropped`, `skills_truncated`, `skills_degraded`) on the activation span
and on each iteration span. This is the answer for a TRACE, and it is what makes a
behaviour change attributable to a skill VERSION rather than merely to a skill.

**A row** in `agent_activation_skills`, written from the same composition result
at the same moment. This is the answer for the Debug tab, for two reasons:

- Invariant 7 allows a span to be DROPPED under back-pressure. A skills panel that
  is empty because a span was dropped reads as a product that lost your data.
- "Which runs used `research-brief@v3`" is a row scan here and a trace-store scan
  there.

The row is authoritative for the UI; the span is authoritative for the trace. The
key is `(run, step, activation, skill)` — no iteration number, no attempt, no
timestamp — and the write is an upsert, so a resumed run overwrites its own row
rather than accumulating one per attempt (invariant 2).

The Debug tab's agents view renders them per activation, **including the ones that
were dropped**, struck through, with the reason. Hiding those would remove the
answer to the question the panel exists for.

---

## 10. Schema

| Table | What it is |
|---|---|
| `skill_catalog_entries` | The curated first-party library. Global, workspace-less by construction. |
| `skills` | A skill in a workspace. Identity, provenance, pointer to the live version. |
| `skill_versions` | The definition. A snapshot, not a diff. Already sanitized. |
| `agent_skills` | The grant: which agent, which skill, in what order, at which version. |
| `agent_activation_skills` | What was actually composed, and what the budget did to it. |

`agent_skills` is a ROW and not an array column, unlike `allowed_tool_ids` and the
roster, because a grant carries three things an array cannot: the order it was
granted in (which is the order it composes in), the version it was pinned to, and
who granted it.

Migration: `V073__agent_skills.sql`.

---

## 11. Flag

`AGENT_SKILLS_ENABLED`, default OFF, per the standing convention for new runtime
behaviour. Off, the loop is byte-for-byte what it was: no query, no prompt
section, no rows, no span attributes.

---

## 12. What is not built yet

Stated here rather than left to be discovered:

- **No skills UI beyond the Debug tab.** The API is complete — list, create,
  version, install, grant — and the grant refusal renders as a normal form error,
  but there is no skills screen and no picker on the agent editor. The grant is
  set through the API today.
- **The async-tool leg of the worked scenario is not in the pipeline test.** An
  async tool ends the tick and parks the run on a `run_waits` row, so a pipeline
  including one becomes a test of suspend-and-resume with a pipeline attached —
  a different subject, already covered by `AsyncToolProtocolTest`.
- **No entitlement on skill count.** `max_skills` is not a plan key. Nothing about
  skills is metered, and the composition budget is the only real bound.

---

## 13. Where each claim is asserted

| Claim | Test |
|---|---|
| Granting a skill without its tools is refused with the missing list | `SkillGrantAcceptanceTest` (API, real Postgres) |
| The research → script → video → deliver pipeline runs end to end | `SkillPipelineAcceptanceTest` (worker, real Postgres, real sockets) |
| Active skills are visible per activation | `SkillPipelineAcceptanceTest`, `ConstellationRoutes` |
| A skill's text cannot alter the granted tool list or the roster | `SkillInjectionTest` — asserted on the grant check, which takes no skill as input |
| Composition is ordered, bounded, and records every cut | `SkillCompositionTest` |
| The save-time warning and the runtime composition agree | `SkillCompositionTest` — both call the same composer at the same budget |
| Authored text is defanged without being rejected | `SkillSanitizerTest` |
| A revoked tool drops its skill rather than composing it | `SkillInjectionTest` |
| A re-executed step does not accumulate a row per attempt | `SkillPipelineAcceptanceTest` |
