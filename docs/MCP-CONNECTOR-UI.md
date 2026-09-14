# MCP — the connector UI

How a person connects an MCP server, sees what it offers, and grants one of its
tools to an agent.

Companion to [MCP.md](./MCP.md), which describes the runtime. That document ends
at §9 with "the granting UI … is web work". This is that work, specified —
including the backend it cannot be built without.

> **Revised.** §5's four-step wizard (Server → Credential → Verify → Discover)
> is superseded by `connect-mcp-dialog.tsx`: **Server → Connect → Tools →
> Agents**. The person pastes a URL; `POST /api/mcp/probe` decides between
> connected, sign in (OAuth, see MCP.md §4a) and paste a token; tools are
> discovered on the way in; and the last step adds them to chosen agents by
> writing N explicit tool ids into each agent's `allowedToolIds` through the
> ordinary agent PATCH. That is the same convenience §8 already allowed ("Select
> all 12"), offered at the moment the tools appear — it still creates no
> server-level grant, and the button names the count. The connection's Tools tab
> gains "Sign in again" for signed-in servers.
>
> **Status: built.** All ten items in §11 are implemented. Discovery ships behind
> `MCP_DISCOVERY_ENABLED`, off by default, per the conventions — reading
> `mcp_tools_available` is deliberately not gated, so a workspace that already
> has discovered tools keeps seeing them. §1 and §2 below are kept in the past
> tense they were written in: they record the state this work started from, and
> §2.2 in particular is the bug that made every other item necessary.

---

## 1. The answer to "how would a person connect?" today

**They cannot.** Not through the UI, and not usefully through the API either.

The runtime is real: `McpClient`, `McpSanitizer`, `McpDiscovery` and
`McpToolExecutor` exist in `apps/worker-kotlin`, are dispatched from
`ToolNodeExecutor`'s type `when` (`ToolNodeExecutor.kt:244`), and are covered by
`McpToolPathTest`, `McpDiscoveryTest` and `McpSanitizerTest`. The schema is real:
`V058__mcp_tools.sql` adds the three `tools.mcp_*` columns, the
`mcp_server_manifests` cache and the `mcp_tools_available` view.

What is missing is everything between a person and that runtime:

| Step a person would take | What happens |
|---|---|
| Open the connect wizard, look for MCP | Not there. `INTEGRATION_SEEDS` has no MCP entry, and `apiTypeFor()` returns only `llm`, `database` or `http`. |
| `POST /api/connections` with `type: "tool"` and a server URL | Works — this is the only door that exists. |
| Press "Test" | **Fails on a correct server.** See §2.1. |
| Wait for the tools to appear | Nothing appears, ever. `syncTools` has no production caller — only tests. |
| Grant a tool to an agent | There is nothing to grant. No `tools` row was ever written. |

So the feature is complete from `tools/list` inward and absent from the person
outward. **Discovery is the hinge.** Until something calls `syncTools`, no MCP
tool row exists, nothing is grantable, and no UI has anything to render.

---

## 2. Backend audit

### 2.1 Built, and correct

| Piece | Where | Note |
|---|---|---|
| JSON-RPC over streamable-http | `McpClient` | `tools/list`, `tools/call`, `resources/list`, `resources/read`. Bearer auth. `OutboundHttp` timeout and byte caps. SSE refused with a sentence, not downgraded. |
| Write-boundary sanitization | `McpSanitizer` | Caps names/descriptions, strips control characters, collapses whitespace runs, replaces frame-impersonation phrases with `[removed]`. Never rejects a tool. |
| Manifest cache | `McpDiscovery.manifestFor` | 5-minute TTL (`MCP_MANIFEST_TTL_MS`), stale-on-failure, `last_error` kept alongside. |
| One `tools` row per remote tool | `McpDiscovery.syncTools` | Namespaced `mcp-<conn8>.<name>`. Withdrawn tools keep their row and grants. Locally-authored result contracts are not overwritten. |
| Execution | `McpToolExecutor` | Same events, spans, approval gate and idempotency key as an HTTP tool. Unreachable server → tool error, not run failure. |
| Reachability test dispatch | `ConnectionTester.testMcp` | Accepts `tool`, `mcp`, `mcp_server`; resolves `serverUrl`/`server_url`/`url`/`baseUrl`/`base_url`. |
| Entitlement | `EntitlementKeys.MCP_TOOLS`, `GraphPlanCheck` | `mcp_tools` feature, enforced on graph save for `mcp`/`mcp_tool` nodes. |
| Vectorbea **as** an MCP server | `api/mcp/McpServer.kt`, `McpRoutes` | The inverse direction. Already shipped. Not this document. |

### 2.2 The connection test fails against a correct server

`testMcp` calls `HttpTester.test`, which issues **HEAD, then GET**
(`HttpTester.kt:159`). An MCP streamable-http endpoint is a POST-only JSON-RPC
URL. The spec's own answer to a GET it cannot stream is **405**, and 405 lands in
`doRequest`'s final `else`:

```
ConnectionTestResult.failed(latency, "UNEXPECTED_STATUS", "HTTP HEAD returned 405")
```

Vectorbea's own `/api/mcp` returns 405 on GET, deliberately and correctly
(`McpRoutes.noStream`). **Vectorbea cannot pass its own MCP connection test.**

This is not cosmetic. The connect wizard's entire claim is "nothing is saved
until it has been proven to work" — a verify step that fails on every
correctly-implemented server turns that claim into a wall, and the only way past
it is the override path, which is meant for the unusual case and would become
the normal one.

**Fix:** `testMcp` must not be a reachability probe. It must POST `tools/list`
and report what came back. That is both the correct test *and* a strictly better
one: a HEAD proves a host is up, while `tools/list` proves the endpoint speaks
MCP, that the credential was accepted, and how many tools the server advertises —
which is the number the next screen is about to show.

### 2.3 Missing — the gaps the UI is blocked on

1. **No discovery trigger.** `syncTools` has zero non-test callers. Accepted and
   named in MCP.md §9, but it is the difference between a working feature and an
   unreachable one.

2. **No API surface.** `apps/api-kotlin` never reads `mcp_tools_available`,
   `mcp_server_manifests` or any `mcp_*` column. `ToolRepository.cols` omits all
   three and the `Tool` model has no MCP fields — so even after discovery, the
   tools list cannot tell the UI which server a tool came from, when it was last
   seen, or whether the server is currently answering.

3. **`McpDiscovery` is in the wrong module.** It lives in `apps/worker-kotlin`,
   which the API cannot call. Reimplementing discovery in the API to serve a
   "Discover" button would be a second implementation of the thing whose
   correctness the UI is reporting on — invariant 21's lesson, and invariant
   16's before it. See §3.1.

4. **`CONNECTION_TYPES` has no `mcp`.** `Validation.kt:40` is
   `llm | database | http | tool | vector_store | object_storage`; the web maps
   `mcp_server` → `tool` (`lib/repository/connections.ts:11`). An MCP server is
   therefore a `tool` connection with a free-text provider, indistinguishable in
   a list from anything else typed `tool`.

5. **`TOOL_TYPES` has no `mcp`.** `Validation.kt:54` is
   `http | database | code | builtin | llm_generate | custom`, while `syncTools`
   inserts `type = 'mcp'` through raw SQL. The two agree today only because
   discovery never goes through the create-tool route.

6. **`toToolType` maps MCP backwards.** `use-registry-data.ts:203` maps API
   `custom` → `"mcp"` and lets everything unrecognised fall through to `"http"`.
   A genuinely discovered tool arrives as API type `"mcp"` and would render in
   the registry as **HTTP**.

7. **`McpConnectionConfig.transport` promises what the worker refuses.**
   `types/connections.ts:139` offers `"http" | "sse" | "stdio"`. The worker
   implements streamable-http only and refuses the rest by name.

8. **Private servers have no path.** `SsrfGuard` blocks RFC1918 and loopback, and
   an internal MCP server is a common case. Invariant 20's answer already exists —
   `egress_policy = 'private_allowed'` plus a non-empty `allowed_hosts` — but no
   UI reaches it, so the error a person hits is a dead end.

---

## 3. Backend work this UI requires

Ordered. Each is small; together they are the difference between a screen that
works and a screen that lies.

### 3.1 Extract `packages/mcp-kotlin`

Move `McpClient`, `McpSanitizer` and `McpDiscovery` out of `apps/worker-kotlin`
into a shared build, exactly as `packages/skills-kotlin` was extracted so that the
save path and the run path share one composer.

The reason is the same reason. The connect wizard is about to tell a person "this
server advertises 12 tools, here they are". If that sentence is produced by a
second implementation of discovery, it is a claim about code that will not run
their tools — and the first time the two disagree, the wizard's number is the one
they will trust. One implementation, called from both sides.

Nothing else moves. `McpToolExecutor` stays in the worker: it is execution, and
the API has no business holding it.

### 3.2 `POST /api/connections/{id}/mcp/discover`

The operator-triggered discovery MCP.md §9 describes. Calls `syncTools`, returns
what it wrote.

```
POST /api/connections/{id}/mcp/discover
  → 200 {
      toolsFound: 12,
      toolsWritten: 12,
      toolsFlagged: 1,          // descriptionWasAltered
      resourcesFound: 3,
      fetchedAt, stale, lastError
    }
```

- Workspace-scoped and fail-closed on the connection lookup, like every other
  lookup (invariant 8).
- Behind `EntitlementGuard.requireFeature(workspaceId, MCP_TOOLS)`, resolved from
  the workspace's billing account (invariant 11).
- RBAC: a write. `Permission.CONNECTION_WRITE` in `RbacGuard`.
- Feature-flagged off by default until the phase is signed off, per the
  conventions.

### 3.3 `GET /api/connections/{id}/mcp/tools`

`mcp_tools_available`, filtered to one connection. This is the view's stated
purpose and nothing reads it yet.

```
→ 200 { items: [{
      toolId, name, mcpToolName, description,
      lastSeenAt, possiblyWithdrawn,
      grantedToAgentIds: []
    }],
    manifest: { fetchedAt, stale, lastError, lastErrorAt } }
```

`grantedToAgentIds` is what makes the screen answer "what breaks if this server
goes away", and it is a join the client cannot do cheaply.

### 3.4 Widen the tool contract

Add `mcpServerConnectionId`, `mcpToolName` and `mcpLastSeenAt` to
`ToolRepository.cols`, the `Tool` model and the API response. Nullable
everywhere; the columns already exist and already default to NULL, so the API and
worker tolerate skew in both directions.

### 3.5 Fix `testMcp`

POST `tools/list` through the shared `McpClient` (available after §3.1) and
report the tool count. Failure messages come from the existing error mapping
(MCP.md §7), so "the server returned HTTP 401" and "MCP transport 'sse' is not
supported" reach the wizard as themselves rather than as `UNEXPECTED_STATUS`.

### 3.6 Vocabulary

Add `mcp` to `CONNECTION_TYPES` and to `TOOL_TYPES`. Keep `tool` accepted
forever — rows exist. `ConnectionTester` already treats the three spellings as
one, and `ToolNodeExecutor` already accepts `mcp` and `mcp_server`.

**Not in scope:** a discovery scheduler. MCP.md §9 is right that it is a
scheduler decision, and an operator-triggered refresh plus the 5-minute
run-path TTL covers the product until somebody asks.

---

## 4. Where MCP lives in the product

**No top-level "MCP" section.** It goes where every other tool goes:

```
Integrations → Connections     a server is a credential and an endpoint
Build       → Tools            what that server advertises, one row each
Build       → Agents           the grant, one tool at a time
```

This is not an IA preference. MCP.md §2 says MCP is a tool type and not a
subsystem, and the schema makes a server-level grant *inexpressible* rather than
merely discouraged. A dedicated MCP area in the nav would teach the opposite —
that these are a different kind of tool, with their own rules, plausibly granted
server-at-a-time. The IA has to say what the runtime says.

The one MCP-specific surface is a **tab on the connection detail sheet**, because
"what does this server offer and is it still answering" is a question about a
connection and has nowhere else to live.

---

## 5. Surface 1 — connecting a server

Extends `create-connection-dialog.tsx`. The existing three steps become four, and
the fourth is the point.

```
  Server  →  Credential  →  Verify  →  Discover
```

### 5.1 Catalogue entry

One `INTEGRATION_SEEDS` entry, `id: "mcp"`, category `generic`, alongside
"Generic HTTP" and "Outbound webhook":

> **MCP server** — Connect a Model Context Protocol server and use the tools it
> advertises. Each tool is granted to an agent individually.

That second sentence is doing work. It is the first place a person meets the
grant model, and it is cheaper to say here than to explain after they expected a
switch.

### 5.2 Step 1 — Server

| Field | Notes |
|---|---|
| Name | Free text. Prefills from the URL host. This becomes the tool prefix people read all day, so it is asked for first, not last. |
| Server URL | Required. `https://` enforced. Inline hint: *the streamable-HTTP endpoint, usually ending `/mcp`.* |
| Transport | A `Select` with **one** option: Streamable HTTP. Disabled, with a `ModalNote`: *SSE and stdio are not supported. A streamable-HTTP endpoint is a single URL that answers JSON-RPC over POST.* |
| Environment | Existing field, unchanged. |

A one-option disabled select is deliberate rather than an omission. Leaving the
field out entirely means a person carrying an SSE URL discovers the refusal at
verify, as a failure. Showing the field with the answer already in it means they
discover it while reading the form, as a fact.

**Private host.** If the URL resolves to RFC1918 or loopback, do not fail. Show
an inline `ModalNote` at the field with the real path:

> This is a private address. Reaching it needs egress set to *private allowed*
> and this host named in the allow-list. Configure that on the connection's
> Network tab after saving.

Refusing without naming the setting is the dead end §2.3.8 describes.

### 5.3 Step 2 — Credential

Bearer token or none. `AUTH_LABEL` already covers both. Masked input, never
echoed back, never logged — the existing behaviour, unchanged.

### 5.4 Step 3 — Verify

`POST /api/connections/test-unsaved`, after §3.5 makes it a real `tools/list`.

The result copy is the whole difference between this connector and a generic one:

- **Pass:** *Connected. This server advertises 12 tools.*
- **Auth:** *The server rejected the token (HTTP 401). Check that it is current
  and has not been scoped to a different workspace.*
- **Not MCP:** *The server answered, but not with an MCP tool list. Check the URL
  points at the MCP endpoint rather than the application root.*
- **Unreachable:** *Could not reach the server. Vectorbea calls it from the
  public internet — if it is on a private network, see the note on step 1.*

Never "Something went wrong". Every message names what happened and what to do,
per the copy rules.

The existing **override** behaviour stays exactly as it is: a failing test turns
the primary action secondary and renames it, so saving an unverified server is
deliberate rather than drifted into.

### 5.5 Step 4 — Discover

New, and only for MCP. It runs §3.2 against the now-saved connection and shows
the manifest.

```
┌─────────────────────────────────────────────────────────────────┐
│  12 tools registered from Acme Internal                          │
│  Each one is now a tool in your registry. None is granted to an  │
│  agent yet — grant them individually from an agent's Grants tab. │
├─────────────────────────────────────────────────────────────────┤
│  acme.searchAccounts     Search accounts by name or domain       │
│  acme.createTicket       Open a support ticket             ⚠     │
│  acme.readInvoice        Fetch an invoice by id                  │
│  … 9 more                                                        │
├─────────────────────────────────────────────────────────────────┤
│  ⚠ One description was altered before it was stored. Review it.  │
└─────────────────────────────────────────────────────────────────┘
```

Three rules for this step:

1. **It registers; it does not grant.** The sentence under the count is not
   reassurance, it is the product's grant model stated at the only moment the
   person is definitely reading. There is no "grant all" control here, or
   anywhere.

2. **A sanitized description is shown, marked, and not hidden.** `⚠` on the row,
   and the stored text — `[removed]` markers visible — in the row's expansion.
   MCP.md §4 says the flag is for the log *and the UI*; a marker a person cannot
   see is only for the log. The tooltip says what it means and what it does not:
   *Part of this description looked like an instruction to the model and was
   replaced. The tool still works, and this does not affect what it is allowed to
   do.*

3. **Zero tools is a state, not a failure.** *This server is reachable and
   advertises no tools. Nothing to register yet — rediscover after the server
   publishes some.* Secondary action: Rediscover.

Skippable. **Discover later** closes the wizard with the connection saved; the
connection sheet carries the same action.

---

## 6. Surface 2 — the connection's Tools tab

A seventh tab on the connection detail sheet, rendered only when the connection
is MCP. Reads §3.3.

### 6.1 Header

```
  12 tools   ·   Discovered 4 minutes ago   ·   [ Rediscover ]
```

When the manifest is stale, a banner **above** the list — never in place of it:

> ⚠ Last refresh failed 6 minutes ago: could not reach the MCP server
> (ConnectException). Showing the tools from the last successful discovery.
> Calls to them will fail until the server answers.

Serving stale is deliberate (MCP.md §6). A UI that replaced the list with an
error would undo the decision at the last inch — the person needs to see both
facts, which is the same shape as `delivery_status` beside a run status
(invariant 17).

### 6.2 The table

| Column | Content |
|---|---|
| Tool | `acme.searchAccounts`, mono. |
| Remote name | `searchAccounts` — what the server calls it. Mono. |
| Description | Sanitized, one line, truncated. `⚠` if altered. |
| Granted to | `3 agents`, or `Not granted`. Click filters the agents list. |
| Last seen | Relative. |
| State | `Live` · `Not advertised`. |

Numbers use `tabular-nums`. `Live` uses a status token, never brand iris.

### 6.3 A withdrawn tool

`possibly_withdrawn` from the view. The row keeps its place, dimmed, state
`Not advertised`, and expands to:

> The server stopped advertising this tool on 3 March. Its grants are unchanged —
> two agents may still call it, and those calls now fail with "the server no
> longer advertises this tool". Revoke the grants, or ask the server's owner.

The copy is load-bearing. MCP.md §3 keeps the row precisely so that a redeployed
server does not silently shrink an agent's tool list; a UI that showed it as
"deleted", or hid it, would restore the ambiguity the schema paid to remove.

### 6.4 Removing a server

Deleting the connection is the one server-level action, expressed as removing the
credential — `mcp_server_connection_id` is an FK. The destructive confirm names
the blast radius:

> Delete **Acme Internal**? 12 discovered tools stop working. 4 agents hold
> grants to them and will start failing at the next run that calls one.

Uses the existing `destructive-confirm-dialog`.

### 6.5 Collection states

| State | What it shows |
|---|---|
| Empty | *No tools discovered yet.* + Discover. |
| Loading | Skeleton in the table's shape — six rows, six columns. |
| Error | The API failed, not the server. *Could not load this server's tools.* + Retry. Distinct from the stale banner, which is the server failing. |
| Partial | The stale banner over a full list. |
| Permission denied | *You need connection write access to discover tools. Ask a workspace admin.* The list still renders read-only. |

---

## 7. Surface 3 — the tools registry

MCP tools are ordinary rows in `tools-view.tsx`. Three changes.

1. **Fix `toToolType`.** Map API `"mcp"` → `"mcp"`. Keep `custom` → `mcp` for the
   pre-existing rows that relied on it. Today a discovered tool renders as HTTP.

2. **A Source column.** `—` for a locally-authored tool, the server name for a
   discovered one, linking to the connection. Without it, twelve rows named
   `mcp-1a2b3c4d.*` are unreadable — the namespacing in `syncTools` exists so two
   servers' `search` tools are distinguishable, and the table has to complete
   that thought.

3. **Filter by source.** `All · Local · MCP`, and by server.

Everything else — risk, approval, versions, the detail sheet — is unchanged,
because an MCP tool is a tool.

---

## 8. Surface 4 — granting

`create-agent-dialog.tsx` already lists every tool from `api.tools.list` on its
Grants step, so discovered tools appear there the moment they exist. Two
additions.

**Group MCP tools under their server**, with the server as a non-interactive
heading:

```
  ▸ Acme Internal · MCP                              [ Select all 12 ]
      ☐ acme.searchAccounts      low
      ☑ acme.createTicket        high    approval required
```

**"Select all 12" is allowed, and its label is the reason.** It ticks twelve
checkboxes and writes twelve ids into `allowedToolIds`. It does not create a
server-level grant, because there is nothing to create one in — and the label
says "12", not "this server", so what the person is doing matches what is stored.
The heading itself is never a checkbox; a tri-state control at the server level
is exactly the affordance that would teach the wrong model.

The existing footnote stays and is more true here than anywhere:

> Grants are enforced by the engine. An ungranted tool cannot be called, whatever
> the prompt says.

For MCP that is the security argument in one line (MCP.md §4): the grant check
reads uuids from our own database and takes no description as input, so a
customer server cannot widen anything by writing prose.

---

## 9. Entitlement

`mcp_tools` is a plan feature and `GraphPlanCheck` already enforces it on save.
The UI gates in three places, all resolved from the workspace's billing account,
never the signed-in user's plan (invariant 11):

| Place | Behaviour |
|---|---|
| Catalogue tile | Shown, with a plan badge. Never hidden — a feature you cannot see is one you cannot decide to buy. |
| Discover | Disabled, tooltip: *MCP tools are on Pro. Upgrade to connect your own servers.* |
| Grants | Existing MCP grants keep rendering read-only if a workspace downgrades. Silently dropping a grant list is a permission change nobody decided. |

---

## 10. Constitution compliance

- Tokens only. `Live` and `Not advertised` use status tokens; brand iris never
  indicates state (hard rule 11).
- Phosphor icons only. `Plugs` for a server, `WarningCircle` for an altered
  description, `CloudSlash` for withdrawn. No Lucide, no emoji.
- Tool ids and remote names are mono, middle-truncated, click-to-copy
  (`mono-id.tsx`).
- Counts and latencies are `tabular-nums`.
- Every control defines hover, active, focus-visible, disabled and loading —
  Discover has a real loading state, because it is an outbound call to a server
  that may be slow.
- Every collection in §6.5 defines empty, loading, error, partial and
  permission-denied.
- Only transform and opacity animate; the disclosure rows respect
  `prefers-reduced-motion`.
- Copy is active voice, sentence case, and the verb on the button is the verb in
  the toast: **Discover** → *Discovered 12 tools from Acme Internal.*

---

## 11. Build order

Backend first, because every screen here reads something that does not exist yet.

| # | Work | Unblocks | Where it landed |
|---|---|---|---|
| 1 | Extract `packages/mcp-kotlin` (§3.1) | Everything | `packages/mcp-kotlin/**`, plus `WorkerMcpTransport` and `ApiMcpTransport` |
| 2 | Fix `testMcp` to POST `tools/list` (§3.5) | The verify step, and connecting at all | `connector/McpTester.kt` |
| 3 | `POST …/mcp/discover` (§3.2) | Tools existing | `routes/McpConnectorRoutes.kt` |
| 4 | `GET …/mcp/tools` (§3.3) | The Tools tab | `repository/McpToolRepository.kt` |
| 5 | Widen the tool contract (§3.4), vocabulary (§3.6) | The registry's Source column | `ToolRepository`, `ToolRoutes`, `Validation.kt`, `contracts/registry.ts` |
| 6 | Catalogue entry + steps 1–3 (§5.1–5.4) | Connecting | `content/integrations.ts`, `create-connection-dialog.tsx` |
| 7 | Discover step (§5.5) | The connect flow end to end | `DiscoverStep` in the same file |
| 8 | Connection Tools tab (§6) | Operating a server | `connectivity/mcp-tools-panel.tsx` |
| 9 | Registry source column + `toToolType` fix (§7) | Reading the registry | `tools-view.tsx`, `use-registry-data.ts`, `lib/query.ts` |
| 10 | Grant grouping (§8) | Granting at scale | `create-agent-dialog.tsx` |

Discovery ships behind `MCP_DISCOVERY_ENABLED`, default off, per the
conventions. Step 2 was worth doing first regardless of the rest: the connection
test contradicted our own MCP server.

### What the extraction changed, for a reader of `packages/mcp-kotlin`

Two things moved rather than being copied verbatim, and both are load-bearing:

- **`McpClient` takes an `McpTransport`** instead of reaching for
  `OutboundHttp` directly. The worker passes `WorkerMcpTransport` (its pool, its
  clamped budget, its byte cap); the API passes `ApiMcpTransport` (its SSRF
  guard, `Redirect.NEVER`, a tighter ceiling because a person is waiting on a
  page). The protocol is shared; the egress is not, and neither service's
  egress policy should silently apply to the other's calls.
- **`RemoteTool.resultContract` became `resultContractJson`** — the canonical
  `{"version":1,"fields":[…]}` document as a string. The module has no opinion
  about result contracts, neither reading nor applying one; it transcribes the
  server's annotations into the shape `ToolResultContract.parse` already reads,
  and the worker parses it where it is used. Holding the parsed type would drag
  the result-contract layer into a protocol module to store a value it
  immediately re-serialises.

`McpToolExecutor` stayed in the worker. It is execution — node results, error
observations, the circuit breaker — and the API has no business holding it.

---

## 12. Not in this design

- **A discovery scheduler.** MCP.md §9 is right; operator-triggered plus the
  run-path TTL is enough until asked.
- **Resources in the UI.** `resources/list` works and `resourceUri` is passed to
  a tool call, but there is no screen for browsing them. The Tools tab reports
  the COUNT, so a server offering them is not invisible; browsing them is a real
  gap and a separate one.
- **SSE and stdio.** Refused by name, surfaced as a fact in the form.
- ~~**OAuth to an MCP server.**~~ Built — MCP.md §4a.

---

## 13. Verified

- Both themes, looked at rather than inferred: the connect wizard's discover
  step and the connection's Tools tab in light and dark.
- `npm run typecheck && npm run lint && npm run build` clean;
  `npm run check:contrast` reports 0 failures across both themes and holds the
  brand/status disjointness rule.
- Both Kotlin services compile, and their unit tiers pass. `McpSanitizerTest`
  runs green against the extracted module.
- **Not run here:** `McpDiscoveryTest` and `McpToolPathTest`. Both are
  `@Tag("integration")` and need a real Postgres, which this machine has no
  container runtime for. They compile against the moved code and their
  assertions are unchanged; CI's integration tier is what actually exercises
  them.
- Mock mode carries an MCP server fixture, four discovered tools (one with an
  altered description, one withdrawn) and a `POST /api/connections` handler that
  returns a real id — added because the discover step discovers against the
  connection it has just created, and the catch-all `{ ok: true }` gave it
  nothing to work with.
