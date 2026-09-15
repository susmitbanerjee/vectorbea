# MCP

An additional tool type, beside `http` and `database`.

---

## 1. What MCP is for, and what it is not

**MCP does not improve tool result quality.** A server calling Salesforce makes
the same REST call a direct integration would and returns the same forty fields
of nested JSON. Result quality is the result-contract layer's job
([TOOL-RESULT-CONTRACTS.md](./TOOL-RESULT-CONTRACTS.md)), and MCP results go
through it exactly like an HTTP tool's.

**What MCP is worth building is the product argument.** A customer connects their
own tools without us writing an integration for each, with one story for
discovery, auth and errors.

**It is additive, deliberately.** `http` and `database` are untouched. MCP-only
would leave us unable to call a customer's plain REST endpoint without them
wrapping it in a server first, which is a worse product for a protocol
preference.

---

## 2. It is a tool type, not a subsystem

`ToolNodeExecutor`'s type dispatch exists so that adding a type does not change
the runtime. MCP is one `when` arm:

```kotlin
"mcp", "mcp_server" -> executeMcpTool(tool, resolvedInputs, ctx)
```

Everything around that `when` already ran or will run, identically:

| | Where it comes from |
|---|---|
| Approval gate | The tool boundary's `requires_approval`, before the dispatch |
| `TOOL_CALL_STARTED` / `TOOL_CALL_COMPLETED` | Emitted around the dispatch |
| `tool_call` span, with its existing parent | Opened before the dispatch |
| Idempotency key | The step guard, keyed on `(step, tool, arguments)` |
| Payload store | The agent brain, after the result returns |
| Result contract, error contract | The same layer every tool type uses |

`McpToolPathTest` asserts this by driving a real `ToolNodeExecutor` and checking
the events and the gate — from the same code, not from a parallel
implementation.

---

## 3. Granting is per tool, and a server-level grant is inexpressible

This is the part worth reading carefully.

**Discovery materialises one `tools` row per remote tool** (`McpDiscovery.syncTools`),
each with its own uuid, granted exactly like an HTTP tool. Not a synthetic id
under a server row, and not a flag meaning "this server is allowed".

That makes a server-level grant **structurally impossible** rather than
discouraged:

- `agents.allowed_tool_ids` holds **tool** ids.
- An MCP server is a **connection**.
- There is no column, and no value of any type, that means "every tool from this
  server".

Adding one later would be the change to argue about. Today the schema cannot say
it. `McpSanitizerTest` asserts it on the type: granting a connection id grants
exactly the tool whose id equals it, which is none.

The one server-level action that *should* exist is expressed as removing the
credential: `mcp_server_connection_id` is a FK, so revoking the connection
revokes every tool discovered through it.

**A withdrawn tool is not deleted.** A tool the server stops advertising keeps its
row, its uuid and its grants, and fails at call time with a legible cause
(`-32601` → "the server no longer advertises this tool"). Deleting it would
shrink an agent's tool list because somebody else's server was redeployed — a
change to what an agent may do that nobody decided and nobody can audit.
`mcp_last_seen_at` records the withdrawal; `mcp_tools_available` surfaces it.

---

## 4. A customer server is untrusted

Its tool descriptions reach the model's prompt. That is a direct route from a
third party's string to where the model decides what to do.

**Two claims, and only one is the security boundary.** It matters to say which:

- **The grant check stops injection, and the sanitizer does not.**
  `validateToolAllowed` reads uuids from our own database. No string in any prompt
  is an input to it. `McpSanitizer` could be deleted and an injected description
  still could not widen a tool list — invariant 1: a roster or tool list in a
  prompt is documentation, not enforcement.
- **The sanitizer is defence in depth** against the rest of the damage: a
  description that wastes the budget, impersonates a system instruction, or
  derails reasoning without escalating permissions. Real, worth preventing, not
  the boundary.

Conflating them is how a team ends up believing a content filter is a permission
system, so both are asserted separately.

What the sanitizer does: caps descriptions at 500 characters and names at 100,
strips control characters, collapses whitespace runs (a thousand blank lines is a
budget attack no content filter would catch), and replaces frame-impersonation
phrases with `[removed]` — a marker rather than a deletion, so a reviewer can see
something was there.

It is **never used to reject a tool**. A false positive would remove a customer's
tool from their own agent, which is worse than a defanged sentence.
`looksLikeInjection` flags it for the log and the UI instead.

**Sanitized at the write boundary** (invariant 4), not at render time — otherwise
the sanitizer has to run everywhere the text can reach, and the one place somebody
forgets is the one that matters.

---

## 4a. Authentication: none, a pasted token, or signing in

A server says which it needs; nothing is configured up front.

**Probe first.** `POST /api/mcp/probe` runs the handshake cold. A server that
answers needs no credential. A 401 is not an error but a question: its
`WWW-Authenticate: Bearer resource_metadata="…"` names where the server
describes its sign-in (RFC 9728). If that document — or the well-known fallback,
path-aware per RFC 9728 §3 — names an authorization server whose metadata can be
read (RFC 8414, then OpenID discovery), the answer is **sign in**. Otherwise it is
**paste a token**. The previous connector asked for a token first, and for OAuth
servers the verify step reported "the server rejected the token" for a token
nobody had sent.

**Signing in** is the MCP authorization flow, end to end, with nothing for the
person to create:

1. `POST /api/connections/:id/mcp/oauth/start` discovers the authorization
   server, registers Vectorbea as a client (RFC 7591 dynamic registration —
   public client by preference, PKCE is the protection), generates a PKCE S256
   pair and a 32-byte `state`, and stores the verifier and registration SEALED
   in `mcp_oauth_authorizations` (V074), keyed by SHA-256 of the state. The
   browser only ever holds the state.
2. The person approves at the authorization server. The request carries the
   `resource` indicator (RFC 8707), binding the token to this server.
3. The authorization server redirects the browser to the WEB APP's
   `/mcp/oauth/callback`, which posts `state` and `code` to
   `POST /api/mcp/oauth/complete` (public; the state is the proof). That consumes
   the row with `DELETE … RETURNING` — single use by construction — exchanges the
   code, writes the credential to the connection's secret, sets `auth_type =
   'oauth2'`, clears any refreshed token from a previous sign-in, discovers the
   tools, and returns the outcome for the page to report to the dialog.

**The `redirect_uri` is the web app's origin**, sent by the client and accepted
only if it is a host we own (`*.vectorbea.com`, loopback); anything else falls
back to `PublicUrls.appBase()`. It was originally the public API host, and that
broke sign-in in the first deployment: `devapi.vectorbea.com` had no DNS record,
the browser was sent to a dead hostname, no credential was stored, and every
Discover afterwards failed with "sign in first". It would also have put an OAuth
endpoint on a hostname meant to serve only the run API (`PublicHostGate`). The
old `GET /api/mcp/oauth/callback` remains for sign-ins started before the move.

**`signedIn` means a stored credential**, not `auth_type = 'oauth2'`. The connect
dialog saves the connection as `oauth2` before sign-in; reading the type alone
told the dialog's poll the sign-in had finished three seconds after it started,
and it then discovered against a server it held no credential for.

An authorization server that cannot do S256 is refused rather than downgraded.
One that does not allow dynamic registration gets a sentence saying to paste a
token instead.

**The credential** is a JSON document in the connection's existing secret
(`"kind": "mcp_oauth"`: access and refresh token, expiry, token endpoint, client
id and secret, resource). A secret that is not that document is a bearer token,
exactly as before, so every connection created before sign-in existed is
unchanged. The split is on data, not a flag. A credential never appears in
`config_json`.

**Refreshing** is `McpCredentials` in `packages/mcp-kotlin`, shared by both
services: a token within a minute of expiry is refreshed before use, and a 401 on
a token believed valid triggers one refresh and one retry (safe: a call refused
at the authorization layer never reached the tool). Refreshes are serialised per
connection and re-read the store after taking the lock, so a rotation another
thread or process just persisted is used rather than spent again. The refreshed
credential is persisted to `connection_oauth_tokens` BEFORE it is used — on a
rotating server the refresh token just spent is already dead. The API and the
worker read and write the same row in the same sealed format.

**A sign-in that cannot be refreshed** (revoked, `invalid_grant`, no refresh token)
becomes a tool error with `kind = auth`, `retryable = false`, telling the agent a
person must sign in again. Never a run failure, and never counted by the circuit
breaker — the server answered.

The agent brain's tool executor is now built with the connection resolver's
secret service, the same as a workflow `tool` node's, so an agent can refresh a
sign-in exactly as a workflow step can.

---

## 4b. The streamable-HTTP handshake

`McpClient` originally sent `tools/list` cold with `Accept: application/json`
and read one JSON body. That works against a stateless server that never streams
(our own `/api/mcp`) and fails against most servers built on the reference SDKs,
each way looking like "not an MCP server":

- **`initialize` first**, then `notifications/initialized`. A server without
  `initialize` (JSON-RPC `-32601`) is used session-less.
- **`Accept: application/json, text/event-stream`**, always — required by the
  specification and enforced with 406.
- **Event-stream replies.** A POST may be answered with a one-shot SSE body; the
  response is the last message carrying an `id` and a `result` or `error`,
  skipping notifications.
- **Sessions.** `Mcp-Session-Id` from `initialize` is sent on every later call,
  cached per (connection, url, credential fingerprint). A 404 on a session
  re-initialises once and retries.
- **Pagination.** `tools/list` and `resources/list` follow `nextCursor`, bounded
  at 20 pages.

The legacy HTTP+SSE transport (a long-lived GET stream) is still refused by name;
a streamable-HTTP server that replies with an event stream is not that.

---

## 5. Resources

`resources/list` and `resources/read`, exposed by passing `resourceUri` to an MCP
tool. Read-only context pulled on demand — the `contextRefs` model from the
delegation work, one layer out: pass a pointer and let the callee read what it
needs. The alternative, fetching every resource a server offers and prepending
it, is the observation-size problem again.

---

## 6. Isolation

**Timeouts.** `OutboundHttp`'s clamped total-call ceiling and its streaming byte
cap, the same ones every outbound call uses. A customer's server is exactly as
able to return a gigabyte as anybody else's endpoint.

**Circuit breaker**, per connection — but it sees **transport** failures, not
refusals. A server answering "no such tool" is healthy; a server that cannot be
reached is not. Counting a refusal would let one badly-configured tool take a
working server offline for every other tool on it. Same distinction the provider
429 path makes.

**Failure isolation.** An unreachable server produces a tool **error** — a
`Completed` result carrying an error contract that the agent reasons about —
never a run failure. The message says the blast radius: "This affects only the
tools that server provides."

**The manifest cache is isolation, not a speed-up.** Discovery is an outbound
call that happens whenever an agent's tool list is built; without the cache one
unreachable customer server adds its full timeout to every run that could have
used it. A failed refresh serves the **stale** manifest, because a server down for
a minute must not silently shrink every agent's tool list at exactly the moment
things are already going wrong.

**One transport.** `streamable-http` only. SSE is in the specification and is not
implemented: it needs a long-lived connection held against a worker slot, which
is the shape this runtime spends most of its effort avoiding, and it buys nothing
for request/response tool calls. A connection configured for `sse` is **refused
with that sentence** rather than silently downgraded.

---

## 7. Error mapping

| MCP condition | kind | retryable | Why |
|---|---|:--:|---|
| Unreachable | `server` | yes | Transport, may pass |
| HTTP 4xx/5xx | via `ToolErrorShape.ofStatus` | — | The same status semantics every tool uses |
| `-32601` method not found | `not_found` | **no** | The server does not implement it; retrying cannot change that |
| `-32602` invalid params | `invalid_input` | **no** | The same arguments will be rejected again |
| Other JSON-RPC error | `unknown` | **no** | Unknown fails closed |
| `isError: true` | `invalid_input` | **no** | The tool ran and declined — different from the transport failing |

---

## 8. Acceptance

| Criterion | How it is held |
|---|---|
| Same code path, spans, approval keys as an http tool | `McpToolPathTest` — real `ToolNodeExecutor`, asserting `TOOL_CALL_*` events and that `requires_approval` gates before the server is contacted |
| An injected description cannot change what the agent may call | `McpSanitizerTest` — asserted on the grant check, which takes no description as input, plus the sanitizer separately |
| An unreachable server degrades to a tool error with a legible cause | `McpToolPathTest` — `Completed` with `error=server`, `retryable=true`, and a message naming the blast radius |
| Granting is per tool; a server-level grant is impossible | `McpSanitizerTest` (the type) and `McpDiscoveryTest` (no row is ever created for a server) |
| The handshake, sessions, event-stream replies and pagination | `McpClientProtocolTest` (`packages/mcp-kotlin`) |
| Discovery, registration, PKCE, exchange, refresh, one refresh under concurrency | `McpOAuthTest` (`packages/mcp-kotlin`) |
| A sign-in state works once, is stored hashed and sealed, and expires | `McpOAuthStorageTest` (API, real Postgres) |
| An agent's call on an expired sign-in refreshes and completes; a revoked one is a legible tool error | `McpSignedInToolCallTest` (worker) |

---

## 9. What is not built

- **SSE transport.** Refused explicitly rather than half-implemented.
- **A discovery scheduler.** `syncTools` exists and is correct; nothing calls it
  on a timer yet. Discovery happens when an operator triggers it. A background
  refresh is a scheduler decision, not a protocol one.
- **Pre-registered OAuth clients.** A server whose authorization server does not
  allow dynamic client registration (GitHub's remote server, for one) cannot be
  signed in to; the connect flow says so and offers a token instead. Configuring
  a client id per server is not built.
- **Cross-process refresh locking.** Refreshes are serialised per connection
  within a process and re-read the stored credential after locking; two
  processes refreshing the same rotating token in the same instant can still
  race. A Postgres advisory lock would close it at the cost of holding a pooled
  connection across the token request.
