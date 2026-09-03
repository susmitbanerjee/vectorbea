# Named queries

The SQL an agent may run: authored by a human, stored with the tool, chosen by
id.

---

## 1. What this replaced

`ToolNodeExecutor` decided whether a database tool was a read or a write by
upper-casing the first whitespace-delimited token of its stored SQL:

```kotlin
val firstWord = sql.split(Regex("\\s+"), limit = 2).firstOrNull()?.uppercase()
if (firstWord == "SELECT") dbReadExecutor else dbWriteExecutor
```

Three problems, and they are not equally severe. Stating them accurately matters,
because two of them are worse than they first look and one is milder.

### 1.1 Classification by keyword prefix — real, and the reason to rebuild

A leading comment, a CTE, or any form the string match did not anticipate lands
on a path its author did not intend, on code that reaches a production database.

**The read path is not trivially reachable by a write.** `DbReadNodeExecutor`
re-checks that the first token is `SELECT`, so `WITH … DELETE …` is refused
there. That is worth saying plainly rather than overstating the exposure.

What remains is still not defensible:

- `SELECT writes_something()` is a write whose first token is `SELECT`. A
  keyword match cannot see it, and no improvement to the keyword match can.
- A read that opens with a CTE is routed to the **write** executor and then
  rejected for not being a write — a correct query that cannot be expressed.
- The classification is a property of a string, so every new SQL form is a new
  chance to be wrong, and the failure is silent in one direction.

The fix is not a better classifier. It is to stop classifying: `access` is
**declared** by the tool author, and nothing in the runtime reads the SQL to
decide.

### 1.2 Parameters were interpolated, not bound — the worst of the three

`{{ expr }}` templates were replaced with SQL literals:

```kotlin
else -> "'${value.toString().replace("'", "''")}'"
```

That is string concatenation with one escape rule, on values that reach it from
an agent's tool input. Named queries use `:name` placeholders, rewritten to `?`
and bound by the driver. `NamedQueryTest` asserts a hostile value passes through
as a value and the statement is unchanged.

### 1.3 Results were bounded by rows, not by bytes — milder than "unbounded"

`DbReadNodeExecutor` already caps at `HARD_MAX_ROWS` (10 000) via
`stmt.maxRows`, so results were never literally unbounded. But `resultSetToList`
materialises every admitted row into a `List<Map>` before anything measures its
size, and ten thousand wide rows is tens of megabytes of worker heap.

Every named query declares its own limit, clamped at **500** — far below the
existing 10 000 precisely because that bound counts the wrong thing.

### 1.4 Schema affordance

The model has no schema, and it does not get one here. It gets something better
for the same problem: it no longer needs to know the schema, because it selects a
**described query** instead of composing SQL against tables it is guessing at.

---

## 2. The design

```json
{
  "version": 1,
  "queries": [{
    "id": "orders_by_customer",
    "description": "Orders for one customer, newest first.",
    "parameters": [
      {"name": "customerId", "type": "string", "required": true,
       "description": "Customer id, as returned by crm.search."}
    ],
    "sql": "SELECT id, status, total_cents FROM orders WHERE customer_id = :customerId",
    "access": "read",
    "maxRows": 25,
    "timeoutMs": 3000,
    "resultContract": { "...": "optional R2 projection" }
  }]
}
```

Stored in `tools.named_queries_json` (V057), so it versions with the tool.

**The agent selects an id and supplies parameters.** It never sees, composes or
modifies a statement. This is the same move as the tool grant list — the model
chooses from a validated set, the runtime executes — applied one level down.

**One tool per named query.** A database tool with a catalogue is not offered as
"a database tool"; each query is a tool in its own right, with its own
description and parameter schema, under a synthetic id `<toolId>#<queryId>`.
Discovery is the same mechanism as every other tool, and there is no affordance
for writing SQL. The **grant** is still on the tool, so a query is reachable
exactly when its tool is — one grant, not two, and no way to grant a write
without granting the tool that owns it.

**A write requires approval on its own account**, whatever the tool's
`requires_approval` says. That flag is a property of a tool, and one database
tool can legitimately expose a dozen reads and one write; inheriting it would
mean gating every read or gating no write.

**An unrecognised `access` is a WRITE.** A misspelled `"raed"` defaulting to READ
would be a write executing unapproved, silently, forever. Defaulting to WRITE
costs an approval prompt somebody notices.

**Results flow through the R2 projection layer** — a query may carry its own
`resultContract`, so a 25-row result is projected to the fields that matter
before the observation cap sees it.

---

## 3. Migration

### 3.1 The survey could not be run here

Item 7 asks how many existing tools use free-form SQL and what they run, because
that set is the initial catalogue.

**There are no database tools in this repository to survey.** The only `tools`
rows are 42 HTTP test fixtures named `gated`, none with a `sqlTemplate`. So the
question ships as a view against real data rather than as a number invented for
it:

```sql
SELECT * FROM database_tools_sql_survey ORDER BY prefix_is_ambiguous DESC, name;
```

`database_tools_sql_survey` (V057) reports, per tool: how it is classified today
(`classified_as`), whether its prefix is one the keyword match can misread
(`prefix_is_ambiguous` — a leading `--`, `/*` or `WITH`), whether it already has
a catalogue, and the first 400 characters of its SQL. That last column is the
worklist: those statements, with parameters extracted, **are** the initial
catalogue.

Start with `prefix_is_ambiguous = true`. Those are the tools whose current
routing is decided by something nobody chose.

### 3.2 Nothing breaks on the deploy

The flag is `allow_freeform_sql`, default **false**, and the distinction that
makes that safe is *whose* SQL it is:

| Case | Needs the flag? | Why |
|---|---|---|
| Tool runs its own stored `sqlTemplate` | **No** | That SQL is the tool author's — which is the property named queries introduce, and such a tool already has it. This is the overwhelming majority of existing tools, and they need no change. |
| Caller supplies `query` / `sql` / `statement` | **Yes** | This is the case that must not be reachable by default. |
| Tool has a catalogue | **Refused regardless** | A tool that has declared what may run has declared that this may not. The flag is a migration path for tools without a catalogue, not an override for tools with one. |

---

## 4. Acceptance

| Criterion | How it is held |
|---|---|
| An agent cannot execute SQL outside the catalogue | `NamedQueryEnforcementTest` — raw SQL, an unknown id, and a missing id are all refused before a connection opens, and the free-form flag does not override a catalogue |
| A CTE-wrapped write cannot masquerade as a read | `NamedQueryTest` — the exact `WITH … DELETE … INSERT` statement, classified WRITE by declaration; and a `SELECT` declared READ, to show the declaration is the whole authority in both directions |
| A write triggers approval | `NamedQueryEnforcementTest` — on a tool whose own `requires_approval` is false; verified to fail when the gate is removed |
| Every result is bounded | `NamedQueryRowBoundTest` — `generate_series(1, 100000)` against a real Postgres returns exactly the declared limit; the catalogue cannot declare more than 500 |
| Existing free-form tools keep working | `NamedQueryEnforcementTest` — stored SQL runs with the flag off; caller SQL is refused with it off and runs with it on |

---

## 5. Authoring a catalogue

1. Read the tool's current SQL out of `database_tools_sql_survey`.
2. Give it an id and a one-line description in the terms the model reasons in —
   this is what it selects on.
3. Replace each interpolated `{{ … }}` with a `:name` placeholder and declare the
   parameter, with a `description` saying where the value comes from
   (`"as returned by crm.search"`). An agent that is told where a value comes
   from does not spend an iteration finding out.
4. Declare `access` explicitly. It is never inferred.
5. Set `maxRows` to what the caller actually needs, not to the ceiling.
6. Add a `resultContract` if the rows are wide — see
   [TOOL-RESULT-CONTRACTS.md](./TOOL-RESULT-CONTRACTS.md).

A malformed catalogue yields **no** queries rather than the half that parsed:
running the half that happened to parse is running a set nobody reviewed.
