# HTTP tools

How a tool calls an HTTP service, and how one API document becomes many tools.

Read this before changing anything under `worker/tools/http`, `worker/tools/httpspec`
or `api/openapi`. As with the rest of `docs/`, most of what follows exists because
of a specific failure, and the failure is named.

---

## 1. What was wrong

`tools.config_json` held a handful of loose keys — `url`, `method`, `headers`,
`body` — that `HttpNodeExecutor` read directly. Four consequences followed, and
each ruled out a category of API rather than merely making it awkward.

**The body was an accident.** Whatever the tool row happened to hold was
JSON-serialised with `Content-Type: application/json` hard-coded. Stripe takes
`application/x-www-form-urlencoded`; every file upload takes multipart. Neither
was expressible, so POST worked only against services that happen to accept JSON.

**Auth was a field, not a decision.** `connections.auth_type` was turned into
exactly one header each:

```
"api_key"       -> "x-api-key" to secret
"bearer", "jwt" -> "Authorization" to "Bearer $secret"
"basic"         -> "Authorization" to "Basic $encoded"
else            -> "Authorization" to "Bearer $secret"
```

Every name in that table is a decision the *service* makes, taken on its behalf.
A service reading `api_key` — the single most common name in published OpenAPI
documents — received nothing, and the failure surfaced as a 401 whose text blamed
the credential. The `else` branch is worse: an unknown auth type silently became
a bearer token, so a misconfiguration was indistinguishable from a bad key.

**The agent's vocabulary was the wire's.** There was one name per parameter, so
`starting_after` had to be described to the model as `starting_after`, and a
header parameter could not be produced from an argument at all.

**The model saw the whole response.** There was no extraction step, so the
projection layer (V056) had nothing upstream shaping what it projected.

---

## 2. The spec

`tools.http_spec_json` is one versioned document describing the whole call.
`HttpToolSpec.kt` is its reader, and it is **compiled by both services** —
`api-kotlin/build.gradle.kts` adds the `httpspec` directory as a source root —
so the API cannot generate a document the worker will not execute. A second
reader would let the importer emit a body encoding or an auth strategy the
runtime silently ignores, and the symptom of that is a tool that saves cleanly,
validates cleanly, and sends the wrong request.

```jsonc
{
  "specVersion": 1,
  "request": {
    "method": "POST",
    "path": "/v1/customers/{id}/notes",
    "inputs": [
      { "name": "customerId", "in": "path",  "wireName": "id", "required": true },
      { "name": "noteBody",   "in": "body",  "wireName": "body" },
      { "name": "visibility", "in": "query", "wireName": "vis", "default": "team" }
    ],
    "body": { "encoding": "json", "contentType": "application/json" }
  },
  "auth":       { "strategy": "api_key_header", "header": "api_key" },
  "response":   { "extract": { "engine": "jsonpath", "expression": "$.envelope.result" } },
  "pagination": { "strategy": "cursor", "cursorParam": "starting_after",
                  "nextCursorPath": "data[-1].id", "hasMorePath": "has_more",
                  "itemsPath": "data", "maxPages": 5, "maxItems": 200 },
  "retry":      { "maxAttempts": 3, "jitter": "full", "retryWrites": false },
  "idempotency":{ "mode": "auto", "header": "Idempotency-Key" },
  "transport":  { "sni": "internal.example.com" }
}
```

`NULL` means *no spec*: the tool keeps the legacy keys and behaves exactly as it
did. That is the whole migration. `ToolNodeExecutor` chooses between
`HttpToolResolver` and `HttpNodeExecutor` on the presence of that column and
nothing else — no flag, no environment variable, no per-workspace rollout switch,
because all three would let the two paths diverge for the *same* tool between one
run and the next.

### 2.1 The two names

`name` is what the model is shown; `wireName` is what the service is sent. They
are separate because they answer to different audiences: `cursor` is a good
argument name and `starting_after` is what Stripe reads. Collapsing them — which
is what having only one did — means either the model reads the vendor's
abbreviations or the vendor never receives the parameter.

`constant` is an input the **author** bound. It is not in the model's schema,
cannot be supplied by the model, and is always sent. That is how a tool becomes
"list *my* organisation's repositories", and it is the difference between a tool
that is safe to grant and one that is not. `RequestAssembler` gives it precedence
over any argument, so an agent cannot talk a tool out of its scope.

### 2.2 Bodies

`json` · `form` · `multipart` · `raw` · `passthrough` · none.

Body inputs are assembled mechanically from their `bodyPath`, so
`customer.address.line1` builds the nesting and an OpenAPI import produces a
working POST with nobody editing JSON. A template exists for the shapes that are
not a projection of arguments — an RFC 2822 message, a GraphQL document.

Form bodies use Stripe's bracket form (`metadata[order_id]=42`), which is the only
way a form-encoded body can express a nested object.

A JSON template keeps **types**: a placeholder standing alone in a string position
is replaced by the bound value with its own type, so `{"qty": "{{quantity}}"}`
sends `3` and not `"3"`. A placeholder inside surrounding text stays a string.

### 2.3 Auth strategies

`inherit` (the default, and what every existing tool gets) · `none` ·
`api_key_header` · `api_key_query` · `bearer` · `basic` ·
`oauth2_client_credentials` · `oauth2_authorization_code` · `hmac` · `custom`.

Every name is configurable. Nothing in the spec holds a credential: each strategy
names **fields** of the connection's secret bundle, and the resolver looks them up
through `SecretService` at call time. `SpecSecretScan` refuses a document carrying
anything credential-shaped, because `http_spec_json` is returned by the list
endpoint, rendered in a form, snapshotted into every `tool_versions` row and shown
in re-import diffs — a secret in it would be a secret in all four.

**OAuth2 tokens are cached per connection**, never per tool: ten tools on one
connection share one token by construction. Client-credentials tokens are
memory-only (they are re-mintable). Authorization-code tokens are persisted to
`connection_oauth_tokens`, encrypted with the same workspace-bound AES-GCM as
everything else, because many providers **rotate** refresh tokens — keeping one
only in memory means the next process refreshes with a token the provider has
already retired, and a user who connected months ago is told to reconnect because
of a restart.

`custom` templates see `{{secret.<field>}}` and nothing else. An auth header built
from a model-supplied value is a header the model controls; anything the agent
should influence is an `InputMapping` with `in = header`.

### 2.4 Response

`expectedStatus` declares what counts as success, because it is not always 2xx: a
404 can be a correct answer to a lookup, and a 200 with `{"ok": false}` has not
succeeded. The Slack check that used to be hard-coded inside the executor — where
it applied to every HTTP tool in the product and could not be turned off — is now
an ordinary `whenBodyFalse` error rule on the Slack tool.

**Extraction and projection are two layers.** Extraction narrows the *document*
(`$.data`, unwrapping an envelope); `ResultProjection` narrows the *fields* within
it. Collapsing them would force a bad choice either way: envelopes in the contract
means writing `body.data.records.` in front of every field path, and fields in the
extractor means one JSONPath per field and no collection summary.

Two engines, JSONPath and JMESPath, because the two communities do not overlap and
neither expression translates. An expression that matches nothing returns the
**whole body** with `applied = false`, never an empty document — an empty
projection reads to a model as "the tool found nothing", which is silent,
confident, and wrong in the direction of doing nothing.

### 2.5 Pagination

`none` · `cursor` · `offset` · `page` · `link_header`, each with a hard
`maxPages` **and** `maxItems`. Both are needed: the first bounds requests (an API
with ten-item pages), the second bounds tokens (an API with thousand-item pages).

An agent handed a `next_cursor` follows it — it cannot know how many pages there
are and does not feel the cost of finding out, so the natural behaviour is to keep
going until the context window ends the run. Moving the loop into the runtime
makes the bound a number rather than a judgement call.

When a cap fires, the merged document carries `truncated` and a note. A model
shown a cut-off list with no marker reasons as though it saw everything.

Every page re-runs the SSRF check, because a `next` link is supplied by the remote
server — following one unchecked would let a response redirect the runtime at an
internal address.

### 2.6 Retry, idempotency, transport

Jitter is not a refinement: without it every worker that failed at the same moment
retries at the same moment, and a provider recovering from a blip is knocked over
by its own clients.

**A write is never retried without an idempotency key.** `retryWrites` alone does
not authorise it; the resolver enforces the pairing, because a POST that timed out
may have been received and retrying it is how one payment becomes two. The key
comes from `SideEffectGuard` — derived from `(run, node, attempt_group)`, durable
across re-execution by construction (invariant 2). Nothing may add an attempt
number, timestamp or random component to it.

Transport covers mTLS, a private CA, an egress proxy, and SNI/`Host` when they
differ. Certificate material is a `secretRef`, never a value. There is deliberately
**no `insecureSkipVerify`** — every such flag is added "temporarily" against
staging and is still there years later on the production tool, accepting any
certificate including the proxy reading the traffic. An operator with a private CA
has the supported path: give us the CA.

Clients are cached by configuration, so a workspace with one mTLS integration has
two clients for the life of the process, and a default-transport tool gets the
shared client unchanged.

---

## 3. Secrets never leave

The acceptance criterion is that a secret appears in no span, event, log or
exported trace, and it is asserted by
`HttpToolResolverTest.no event, result or log line carries the credential`.

The threat is not malice, it is convenience. Nobody writes `log.info(apiKey)`.
What happens is that somebody adds "log the request that failed", and the request
contains a header. The old executor had exactly that: `resolvedInputs` were logged
wholesale at INFO on every call, so a credential passed as a workflow input was in
the log forever and nothing in the code looked wrong.

Two mechanisms, and the second is the one that matters:

1. **Nothing is put in.** Events and spans carry method, host, path template,
   status and duration, all built from the *spec* rather than from the request.
   When a credential rides in a query string the query is dropped **whole** —
   redacting named parameters needs a list of every parameter any vendor uses for
   a credential, and that list is wrong the first time a vendor invents one.
2. **`SecretScope` scrubs everything on the way out.** Every credential the call
   resolves is registered at the moment it is decrypted — `protect` returns its
   argument so registration cannot be forgotten separately from use — along with
   its base64, URL-encoded and basic-auth forms, which are what actually appear
   on a wire. A redactor applied only where a leak is expected catches only leaks
   that were expected.

The test asserts the absence in the node result, in every emitted event, and in a
Logback appender attached to the **root** logger — so it catches a log line added
later, in a class the test does not know about. It also asserts the events remain
useful, because a redactor that produced empty summaries would pass the first
assertion while destroying the timeline.

---

## 4. Importing an API document

`POST /api/tool-specs/import` → list operations → select → tools.

**Importing creates nothing.** GitHub's document describes about nine hundred
operations and a customer wants four; an import that created a tool per operation
would have made the registry unusable in one click, with no undo.

Postman collections are **converted** to OpenAPI and then take the same path.
Everything downstream — the operation walk, parameter mapping, contract
generation, fingerprinting, diffing — works on an OpenAPI document, and a second
pipeline would be a second copy of all of it that drifts. `PostmanConverter` is
the only file in the importer that knows what Postman is. What a collection cannot
give you (declared types, optionality, response schemas) is stated at import time
rather than discovered later.

### 4.1 What "good enough to use unedited" means

* Required parameters are required; optional ones carry their defaults.
* Path parameters land in the path, query in the query, headers in headers, body
  properties at their nested position — with the wire name preserved.
* The body encoding matches the operation's declared content type.
* The result contract is **trimmed** to ten ranked fields. An untrimmed one
  reproduces the problem V056 was written for. Widening is safe and obvious;
  narrowing fifty-six fields to ten is what nobody does unprompted.
* Pagination is detected from the parameter names the industry uses — and only
  when **both** halves are present, the request parameter *and* the response
  field. A wrong strategy is worse than none.
* Risk errs **upward**: reads low, writes medium, DELETE high, and anything whose
  path or summary names money, permissions or users high. Importing too high costs
  one click; too low costs money.

### 4.2 Security schemes

Read from the document, including the exact header or parameter name — the fact
the old resolver could not act on. One scheme is chosen (the one most operations
require) and the credential is prompted for **once**, at connection level;
prompting per operation would make importing forty tools a forty-step wizard.

A connection is asked for **only when the document needs one**, which is two
cases and not "HTTP tools have connections":

* **A relative or absent `servers` entry.** The document describes its paths
  relative to wherever it was served from, so it never says which host to call,
  and the connection's base URL is the only other source of one.
* **A declared security scheme.** Every strategy but `inherit` and `none` names
  *fields* of a connection's secret bundle (§2.3), so without a bundle there is
  nothing to read them from.

A document with an absolute server and no security produces tools that need
neither, and the wizard skips the credential step and says so on the operations
step. It refused them until this was fixed, which was the same mistake
`toolRequiresConnection` had already been corrected for and reached through a
different button: the skip fired on "no security", the Create button still
demanded a connection, and the step that would have set one was no longer on
screen. `ApiSpecRoutes.connectionRequirement` is the copy that counts, and it
names the operation and which of the two reasons applies — "these tools need a
credential" is the wrong sentence for a document that declared none.

External `$ref`s are refused with a message naming `redocly bundle`. Following one
would make the API process fetch an address the document chose. The URL fetch
itself re-runs the SSRF guard on **every redirect hop**, with
`Redirect.NEVER` on the client — a public URL that 302s to `169.254.169.254` is
the standard bypass, and checking only the first URL is the standard mistake.

### 4.3 Re-import produces a diff and never mutates

`agents.allowed_tool_ids` grants a tool by UUID. If a re-import rewrote tools in
place, an agent granted `create_refund` — scoped by a bound maximum amount — could
be regranted a wider version by somebody pasting a URL, and nothing in the product
would have said so.

So a re-import writes `tool_versions` rows with `review_state = 'pending'` and
stops. `ToolVersionRepository.apply` is the only writer of the live definition, it
takes a person, and it records who. The rule is *never mutate*, not "not when
granted" — a rule with an exception is a rule somebody's edge case walks through,
and a grant can be added a minute after an import.

The **fingerprint** covers method, path, parameters, request body schema and
security — not descriptions, examples, tags or `x-` extensions. That line is the
difference between a feature and a nuisance: a vendor rewording prose across nine
hundred operations would otherwise present as nine hundred reviews, and a review
that long is one nobody performs, which leaves the one real change unnoticed among
them.

The diff says *what* changed in the terms a reviewer decides on — "new REQUIRED
parameter `account_id`", "`status` accepts new values: archived" — and marks the
changes that touch a tool an agent currently holds. A pending change to an
ungranted tool is a chore; to a granted one it is a security review, and the queue
sorts and colours them apart because a list that mixes them puts the review below
the chores.

A **removed** operation is the most dangerous and least obvious entry: the tool
keeps working, because it is our row, right up until the vendor turns the endpoint
off weeks later.

Rejected versions are kept, so the same declined change is not re-proposed on
every re-import until people stop reading the queue.

---

## 4a. Catalogue operations and messaging

Most people never write a spec. They pick an app on the first step of **Register a
tool** — Slack, Microsoft Teams, Google Chat, Discord, and any other catalogue app
the workspace has connected — then what the tool does there. That produces a legacy
`type: "http"` tool (no `http_spec_json`) whose config the worker reads directly:

| `config` key | Meaning |
|---|---|
| `method`, `url` | The vendor's method and PATH. The host comes from the connection. |
| `operationId` | Which catalogue operation (`slack.post`, `teams.post`…). Also what lets `POST /api/tools/test-unsaved` accept a path rather than an absolute URL. |
| `boundParameters` | Values fixed at registration (a Slack channel, an email recipient). |
| `body` | Optional body template (`{{param}}` placeholders) when the vendor's body is not the parameters by name — a Teams Adaptive Card. |

**Fixed values win.** `ToolNodeExecutor.withBoundParameters` merges
`boundParameters` OVER the caller's inputs. A channel fixed on the tool is the
operator deciding where it may post; an agent that could pass its own `channel`
would make that decision decorative. Before this, `boundParameters` was written
and never read, so a Slack tool with its channel fixed posted without one.

**Body templates are filled as values, once.** `resolveTemplateValue` walks the
template at any depth: a string that is exactly `{{x}}` becomes the value itself, a
template inside a longer string is interpolated, and a key whose whole-string
template resolves to nothing is dropped (an optional parameter left out is absent,
not empty). The map is then serialised once — the old top-level-only pass escaped
quotes and newlines twice.

**The auth header matches the connection test.** `authHeaderFor` in
`HttpNodeExecutor.kt` follows `HttpTester.applyAuth`: a header named on the
connection (`authHeaderName`) wins; Slack, Gmail, Sheets, GitHub, Notion,
Airtable, HubSpot and Linear keys go as `Authorization: Bearer`; anything else keeps
`x-api-key`. Notion calls also carry `Notion-Version`. Previously every `api_key`
went as `x-api-key`, so a Slack bot token passed its test and then failed every call
with `not_authed`.

### 4a.1 Channel webhooks — the URL is the credential

Teams, Google Chat and Discord connect with `auth_type = 'webhook_url'`: the
channel's incoming webhook URL, stored encrypted as the connection's secret, never
in `config_json`. One URL posts to one channel, so a workspace connects the app once
per channel. Posting only — reading and replying need each vendor's bot API.

* **The URL is the only destination.** The worker posts to the secret and ignores
  `config.url` and any `url` input; an agent cannot redirect the channel's
  messages. The operations have an empty path and no channel parameter.
* **It is never written down.** Events, logs and failure messages show
  `https://<host>/…` only — Discord's token is a path segment and Teams / Google
  Chat sign the query string. Request failures report the exception class, not its
  message, because an HTTP client's message can carry the URI.
* **Testing does not post.** `WebhookUrlTester` checks https, the vendor's host and
  webhook path, and the SSRF guard. Discord is genuinely verified with a GET, which
  Discord answers without posting; Teams and Google Chat can only be proven by
  posting into the channel, so their result says `verified: false` and the dialog
  says the URL is well-formed rather than "connected".
* **Flag.** Posting through a webhook connection is behind
  `MESSAGING_WEBHOOKS_ENABLED` on the worker, default off. Off, the call fails with a
  sentence naming the variable and sends nothing.

### 4a.2 Registering from an app, and the test message

Starting from the app picker switches **Register a tool** to a three-step path —
App, Details, Test and register — because choosing "Slack → Post a message" has
already answered the adapter, connection and contract questions. Details asks only
for the operation's parameters (what is set once, what each run fills in) and the
name; there is no operation list to re-pick and no JSON. Risk and timeout keep the
catalogue defaults under "More options". The long five-step path is unchanged for
hand-built tools, except that a catalogue operation no longer shows the generated
schema or the additional-configuration editor — its parameters are its contract.

`POST /api/tools/test-message` (`ToolTestMessageRoutes`, `TestMessageSender`) posts
**one real message** — a deliberate side effect, kept separate from the
side-effect-free `test-unsaved`, because the failures that matter for a message
tool (bot not in the channel, wrong channel ID, missing `chat:write`, a deleted
webhook) are only reported when something is posted. It accepts only
`slack.post`, `teams.post`, `google-chat.post` and `discord.post`, builds the
request itself from the channel and text (the browser never supplies a request),
maps Slack's error codes to a fix ("invite the bot with /invite"), never returns a
webhook URL or a raw response body, is gated at `TOOL_WRITE` (a developer who can
register the tool can already make it post by running it), and writes a
`tool.test_message` audit row whether or not it was delivered. Webhook posts honour
`MESSAGING_WEBHOOKS_ENABLED` read on the API too, so a test cannot pass on a
deployment whose worker would refuse the same post. Tests: `TestMessageSenderTest`.

Adapters the worker cannot run (`code`, `builtin`, `llm_generate`, `custom`) are
shown disabled with the reason rather than registered and failed on first call. MCP
tools come from connecting the server, not from this dialog.

Tests: `MessagingDeliveryTest` (worker), `WebhookUrlTesterTest` and `TestMessageSenderTest` (API).

---

## 5. Schema

`V064__http_tool_spec_and_openapi_import.sql`:

| Object | What it holds |
|---|---|
| `tools.http_spec_json` | The declarative call. NULL = legacy behaviour. |
| `tools.current_version` | Which `tool_versions.version` is live. |
| `tool_versions` | Immutable snapshots. `pending` until somebody applies one. |
| `api_spec_imports` | The imported document, **whole** — a diff needs both sides. |
| `api_spec_operations` | Every operation, selected or not, with its fingerprint. |
| `connection_oauth_tokens` | Rotated refresh tokens, workspace-bound ciphertext. |
| `tool_versions_pending_review` | The review queue, with `is_granted`. |

The document is stored whole because reconstructing the old side of a diff from
the tools it produced cannot work: a tool may have been edited since, so "what
changed in the spec" would come back as "what changed in the spec, plus everything
you did".

Not-selected operations are kept because the diff has three answers — added,
changed, removed — and all three need the previous *operation* set. A customer who
made four tools out of nine hundred operations still needs to be told when one of
the four changed.

`connection_oauth_tokens` is the **one** table the worker writes ciphertext to;
`encrypted_secrets` remains the API's alone. `SecretService.sealForWorkspace` /
`openForWorkspace` is the narrow pair that does it, over the same shared
`Encryption` object, with the workspace id as associated data.

---

## 6. Tests

| Suite | What it proves |
|---|---|
| `HttpToolResolverTest` | The wire, against a real `com.sun.net.httpserver`. Acceptance 1 and 3. |
| `RealSpecImportTest` | Four real vendor documents import to specs that round-trip. Acceptance 2. |
| `SpecDiffTest` | The diff notices behaviour and ignores prose. Acceptance 4. |
| `PostmanConverterTest` | A collection converts, and its author's live token does not. |

The resolver suite talks to a **real socket** because every claim in the brief is
about what goes on the wire; a stubbed `HttpClient` asserts that the code under
test restates its own intent. It binds to `127.0.0.2`, not `127.0.0.1`: the test
task grants `SSRF_ALLOWED_TEST_HOSTS` for it, and exempting `127.0.0.1` made
`SsrfGuardTest` and `HttpNodeExecutorTest` — which assert that address is blocked —
pass vacuously.

The import fixtures in `apps/api-kotlin/src/test/resources/openapi/` are verbatim
excerpts of the vendors' published documents, trimmed to a handful of operations
and their `$ref` closure because the full ones are 12 MB (GitHub) and 8 MB
(Stripe). Nothing is hand-written: a hand-written spec tests the importer against
what its author expected, which is the one input it is guaranteed to handle.

Four shapes, chosen for what they break:

* **Petstore** — YAML, multipart upload, an API key in a header named `api_key`.
* **GitHub** — deep path nesting, `Link`-header pagination, huge descriptions.
* **Stripe** — form-encoded bodies, cursor pagination on `starting_after` with
  `has_more`. The shape the old resolver could not express at all.
* **Twilio** — form bodies under Basic auth, page pagination, and PascalCase wire
  names including `DateSent<` and `DateSent>`, which have to survive onto the wire
  while producing agent-facing names a model can use as JSON keys.

---

## 7. Things to be careful about

* **The spec reader is total.** `HttpToolSpec.parse` returns null for anything it
  cannot fully understand and never throws, and it refuses a document whose
  `specVersion` is newer than the build **whole**. Dropping the fields a newer
  writer added is how a tool quietly stops sending its auth header.
* **Adding a spec field** means the writer, the reader, the round-trip assertion in
  `RealSpecImportTest`, and the editor. The editor passes unknown keys through
  untouched, so an older UI editing a newer document does not delete half of it.
* **Do not add a second reader.** Not in TypeScript, not in the API. The browser
  treats the document as opaque JSON and reaches in through `~/lib/tools/http-spec`
  for exactly this reason.
* **Do not widen `SpecTemplate`.** It sees the declared inputs and the bindings the
  caller passes, and nothing else. A template that could reach a sibling node's
  output would let a tool's request body be steered by data its author never saw.
* **The idempotency key is `SideEffectGuard`'s.** See invariant 2 in CLAUDE.md and
  §2.6 above.
