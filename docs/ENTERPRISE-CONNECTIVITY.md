# Enterprise connectivity

How Vectorbea reaches a customer's models and services when those things are not
on the public internet, and how work executes when it is not allowed to leave
their network.

Companion to `docs/HTTP-TOOLS.md` (the tool transport this builds on),
`docs/PLANS-AND-ENTITLEMENTS.md` (the budgets a customer gateway has to keep
working against) and `docs/INGRESS.md` (where a pinned run is stamped).

---

## 1. What the connection model assumed, and where that broke

The model assumed the thing on the other end is a vendor we know, on a public
address, at our list price. Four consequences:

| Assumption | Where it breaks |
|---|---|
| `provider` names the vendor AND the wire protocol | A customer gateway called `acme-ai` speaking OpenAI's format reached the OpenAI branch by falling off the end of a `when` — correct by accident |
| Price is a `when` over model-name substrings | An enterprise is on a negotiated rate; we over-report their spend, which is the number they reconcile first |
| Anything reachable is public | mTLS existed and was unreachable: `SsrfGuard` blocks every RFC1918 address, and a service demanding a client certificate is not on a public one |
| A worker can read our Postgres and Redis | A self-hosted runner cannot, and asking for it fails the procurement review that requested the runner |

A fifth, found while building: **the LLM path ran no egress check at all.**
`baseUrl` came out of `config_json` and went straight into a request, so a
workspace member could point a connection at `http://169.254.169.254` and the
cloud metadata service would answer, with the connection's own Authorization
header attached. It went unnoticed because the field existed for Azure OpenAI
and nobody typed anything else into it. Fixed in the same change that makes
private gateways a supported thing, because encouraging the field without
guarding it would have been worse than either.

---

## 2. Customer-hosted AI gateway

### The protocol, separated from the provider

`connections.provider` keeps its meaning — **whose** capacity, credential,
circuit breaker and price. A customer's gateway genuinely is its own pool of all
four, and the capacity bucket is keyed on a fingerprint of their key
(`capacity:{acct:<fp>}:<provider>:<model>`), so it already worked.

`connections.protocol` is new and answers a different question: what the request
body looks like. `openai`, `anthropic` or `gemini`; unset infers from the
provider, so every connection that predates V070 behaves identically.

Most enterprise gateways speak OpenAI's shape whatever is behind them — that is
what an OpenAI-compatible shim is for — so `openai` is the common answer.

### The price they actually pay

`connection_model_prices`, per connection, quoted the way contracts are quoted:

```
PUT /api/connections/:id/prices
{"model": "acme-llm-large*", "inputUsdPerMillion": 0.50, "outputUsdPerMillion": 1.50}
```

Three deliberate choices:

- **Per connection, not per workspace.** A connection is the credential and the
  credential is what the contract attaches to. One workspace routinely holds a
  negotiated enterprise agreement for production and a personal key for a
  scratch environment, at different rates for the same model name.
- **Input and output separately.** Output is typically 3–5× input, so a blended
  rate is correct at exactly one input/output ratio — and an agent loop and a
  summarisation node sit at opposite ends of that range.
- **Longest pattern wins.** `gpt-4o-mini` beats `gpt-4o*` beats `*`. A catch-all
  added for convenience must not silently override the specific rates configured
  before it, and "whichever row the index returned first" is not an ordering
  anybody can reason about when their invoice disagrees with our dashboard.

The list-price path is **unchanged**. There are two calculations, not one
generalised one: no override gives byte-identical numbers to what shipped
before; an override takes the split path. Generalising the first into the second
would have moved every historical figure on every dashboard for a refactor
nobody asked for.

`currency` is stored and constrained to USD. The column exists because the
question is asked in the first procurement call; the constraint refuses the
answer we cannot honour, because converting a EUR rate without a stated FX rate
and date would misprice a customer's whole history by whatever the pair moved.

### Why an override is effectively required for a gateway

A gateway serves model names we have never seen. Every one of them falls to the
`$2.00/M` default, which is a defensible guess for a self-serve user who typed
an unfamiliar model and **is not a number to put in front of an enterprise**. In
the acceptance test the gap is 3.6× on one call.

---

## 3. Vectorbea as a gateway — the decision, not built

The same component from the other direction: customer code calls us, we call the
provider, and token budgets stop being advisory.

**Recommendation: build it, and make it OPTIONAL for the governance tier rather
than required.**

The case for required is real — a budget you cannot enforce is a report — and it
is outweighed by two things:

1. **It puts us on their critical path.** Today a Vectorbea outage stops
   Vectorbea workflows. As a required gateway it stops their application's model
   calls, and the blast radius of our worst day becomes their worst day. That is
   a different product with a different SLA, and selling it accidentally as a
   governance feature is how a company acquires an obligation it did not price.
2. **The enforcement it buys is narrower than it looks.** It governs calls that
   go through us. An engineer with the provider's key and a laptop is outside it,
   and a governance story that a curl command defeats is not one to build a tier
   on.

What is worth building instead, in order: **spend attribution** by routing what
already flows through us; then **an optional gateway** for teams that want the
enforcement and accept the coupling; then, only if a customer asks for it in a
contract, a required mode with an SLA attached and priced.

Note also that `docs/DEPLOYMENT.md` documents a `vectorbea-proxy` sidecar with a
Docker Compose stanza and a Helm chart. **No such component exists in this
repository.** That documentation should be corrected or the component built;
today it is an enterprise-shaped promise with nothing behind it.

---

## 4. Private network access — the recommended sequence

Four rungs, in increasing order of cost. **Build the first two; offer the third
only against a signed deal; do not build the fourth yet.**

### Rung 1 — Static egress IPs (deployment, not code)

The cheapest thing that unblocks the most deals. A customer's firewall
allowlists our egress addresses and their internal service is reachable without
anything else changing.

It is a deployment property — a NAT gateway with reserved addresses per region —
and it needs one thing from the product that does not exist yet: **a documented,
stable list of those addresses, versioned, with a change process.** A customer
who allowlists an address we later recycle has an outage they cannot debug.

### Rung 2 — mTLS with customer-issued certificates ✅ built

Already implemented in `HttpTransport`: client certificate and key from the
secret store, private CA bundle, proxy, SNI override, TLS protocol pinning, with
clients cached by configuration so one workspace's mTLS integration does not
share an `SSLContext` with a public API.

There is **no `insecureSkipVerify`, and the omission is the feature.** Every such
flag is added "temporarily" against a staging host and is still there years
later, on the production tool, silently accepting any certificate — including
the proxy reading the traffic. An operator with a private CA has the supported
path.

What was missing was not the transport but the **egress policy** (§5), without
which the guard refused every host the transport existed to reach.

Together, rungs 1 and 2 cover most of the market: an allowlisted source address
and a client certificate is what a bank's network team asks for.

### Rung 3 — An outbound tunnel agent

A small process the customer runs that dials out to us and forwards to named
internal services. Removes the inbound firewall rule entirely.

**Recommendation: defer, and prefer the self-hosted runner instead.** They solve
overlapping problems, and the runner solves strictly more: a tunnel still sends
prompts and results across the perimeter, so it satisfies the network review and
not the data-residency one. A customer who needs a tunnel usually needs a runner
a quarter later, and shipping both means operating two long-lived connection
protocols into customer networks.

### Rung 4 — Full private connectivity (PrivateLink / Private Service Connect)

Per-cloud, per-region, with a per-customer endpoint to provision and bill.
**Do not build until a customer contract requires it by name.** It is
weeks of work per cloud, permanent operational surface, and it is asked for far
more often than it is a genuine blocker — rung 1 usually turns out to be what
they meant.

---

## 5. The egress policy

The piece that makes rung 2 usable, and closes the LLM-path hole in §1.

`connections.egress_policy` is `public` (default) or `private_allowed`. It is
**useless on its own**, deliberately: `private_allowed` without a non-empty
`allowed_hosts` reaches nothing, refused by the schema at the write and by
`SsrfGuard` at the call. "Allow private" and "these three internal hostnames"
are one decision, and splitting them is how a temporary allowance becomes a
permanent hole.

Cloud metadata addresses are refused **under every policy**. That block is not
something anybody can turn off, and an operator who genuinely needs to call
`169.254.169.254` from a workflow does not exist.

Who enabled it, and when, is recorded on the connection itself
(`egress_policy_set_by_user_id`, `egress_policy_set_at`) as well as in the audit
log — this is the setting a security review asks about, and an incident asks
about louder.

---

## 6. Self-hosted runners

### Why the existing worker cannot simply be shipped

It is the same executable and the same code. What it cannot be is deployed the
same way: a worker gets work by reading a Redis stream or claiming from
Postgres, and both need credentials for **our** datastores, reachable from
**their** network. Handing a customer a role on the multi-tenant control plane
fails the review that asked for the runner.

### The protocol

One outbound HTTPS connection, initiated by them. We never connect in, and hold
nothing that can reach in.

```
POST /api/runner/lease       long-poll: "anything for my pool?"
POST /api/runner/heartbeat   "still working on it"
POST /api/runner/events      progress, as metadata
POST /api/runner/report      terminal status, timings, counts
```

Below the lease, **nothing changes**: same `RunProcessor`, same
`WorkflowRuntime`, same executors, same checkpoint and wait primitives.
Invariant 9 — a self-hosted runner is a policy over the existing engine, not a
second one.

### The runner needs its own database, and that is the point

The runtime writes checkpoints, events, step outputs and waits to Postgres. A
runner's Postgres is **theirs**, inside their network, and that is where every
prompt and every tool result stays.

The trade is real and worth stating plainly to a customer: **their runs are
inspectable in full only from inside their network.** §6.4 is how we make that
legible rather than broken.

### Two doors, both closed

A run pinned to a pool must not execute on our infrastructure, and there are two
ways it could:

1. **The Postgres claim.** `PostgresClaim` now carries `runner_pool_id IS NULL`,
   in the candidate scan and again on the locked row — the two are separate
   reads and the gap between them is where a re-pinned run would slip through.
   `agent_runs_platform_claimable_idx` is the matching partial index.
2. **The Redis stream.** Easier to miss, because that path never reads
   `agent_runs` at all. `RunIngress` does not enqueue a pinned run: it is left
   `queued` in Postgres for its runner to lease.

### The redaction boundary

`RunnerReport` is an **allow-list**, enforced **at our end**.

An allow-list because a deny-list is a list of the leaks somebody thought of. A
runner reporting a field we have not named gets it dropped — a degraded feature.
The reverse is a customer's data in our database and a broken commitment,
discovered by them.

At our end because a runner is software the customer deploys: an old build, a
patched build, or one configured wrong, none of which we can see. **A guarantee
that depends on the remote side having redacted correctly is a hope with a
version number.**

Every permitted field is a number, an identifier or an enum. Titles and
summaries are dropped even though they look harmless — a summary is generated
from the thing it summarises, and "Tool returned 3 rows: alice@example.com, …"
is a summary.

Two policies:

- **`strict`** (default) — metadata only.
- **`metadata_plus_errors`** — additionally accepts sanitized error text, capped
  at 2 KB. A **real widening**, named as one: an error message can carry a
  fragment of the data that caused it. It exists because a failed run with no
  message is close to unsupportable.

A run's **output** has no policy that lets it through, and should not: it is the
most concentrated form of exactly what the runner was deployed to keep inside,
and unlike an error there is no support argument for it — the output is
delivered to wherever they told it to go, by a target inside their own network.

### Degrading legibly

The acceptance criterion names the failure directly, and it is a UI failure:
a Debug tab that renders an empty panel reads as a product that lost your data,
when what happened is the product doing exactly what you bought.

Three mechanisms:

1. **`agent_runs.payloads_withheld`**, set at **creation** — somebody opens the
   Debug tab *while* a run is going to find out why they cannot see anything,
   which is precisely when the flag has to already be true. Stored rather than
   derived, so it stays true after the pool is deleted.
2. **On the list response as well as the detail one** — somebody scanning runs
   needs to know which they can expect to inspect.
3. **A failed run explains the absence.** Under `strict` there is no message, so
   the classification becomes a sentence saying what happened, where the message
   is, and what would change it. The inspector's withheld pane sits *before* the
   "captured nothing" fallthrough, because they are different facts with
   different fixes — and one of them is not a fault at all.

### The lease is held by a machine we cannot see

Short, heartbeat-extended, reclaimed on expiry. A customer's VPN dropping, a pod
evicted or a laptop closing sends no packet, so only the deadline notices — and
the run goes back to `queued`, not `failed`: nothing is known to have gone wrong
with the work, only with the machine.

Reports are refused unless the reporting runner still holds the lease, so a
straggler cannot overwrite the result of the runner that took over.

### The token

A separate table from `api_keys`, and the separation is the security property.
An API key can start runs, read every result, manage connections and read every
payload the workspace has produced. A runner token has three verbs against one
pool. If it leaks out of the customer's network — and it lives on a machine we
cannot see — the blast radius must be "somebody can lease our queued runs", not
"somebody can read everything we have ever run".

That could have been a scope on `api_keys`. A scope is a filter somebody can
forget to apply at one call site; a separate table with no path to the rest of
the API cannot be forgotten.

Prefix `vbr_`, so a runner token in a log is identifiable at a glance.

---

## 7. Data residency — the answer that must be stated

**Today: single region. Runs execute and traces are stored wherever the platform
is deployed, and there is no per-workspace selection.**

That sentence has to be said out loud, because it will be asked in the first
enterprise call and "we haven't thought about it" and "one region, here, and
here is how we would change that" are very different answers.

What exists that partially addresses it:

- A **self-hosted runner** (§6) is the strongest residency answer available now,
  and a better one than a region selector for the customers who ask hardest:
  their payloads never leave their own network, let alone their own region.
- `runner_pools.location_label` is free text the customer writes, shown on the
  runs list. It is a label, not an enforcement, and is documented as one.
- **Retention** (invariant 10) is a deletion, so "how long do you keep it" has a
  real answer even where "where do you keep it" does not.

The recommended sequence, when it becomes a blocker: pin **trace and event
storage** per workspace first (it is the bulk of the data and the easiest to
shard), then **run execution**, then the control plane — which probably never
moves, and does not need to if it holds only metadata.

---

## 8. BYOK, SSO, SCIM, audit export

Assessed, mostly not built. All four are procurement checkboxes whose absence
blocks deals regardless of product quality, and they should be sequenced by how
often they appear in a security questionnaire.

| | State | Recommendation |
|---|---|---|
| **Audit log export** | `audit_log` exists and is written on the paths that matter (connections, secrets, RBAC, now egress policy and runner tokens). No export endpoint. | **Build first.** It is the smallest — a paginated, filterable export of a table that already exists — and it appears in every questionnaire. |
| **SSO (SAML / OIDC)** | Nothing. JWT-based auth only. | **Build second.** The most frequent hard blocker of the four. OIDC first; SAML is what large enterprises actually run, and is the larger job. |
| **SCIM** | Nothing. | **Build third**, and only after SSO. Asked for by organisations above roughly a thousand seats; below that, SSO plus manual invites is accepted. |
| **BYOK for secrets** | `encrypted_secrets` is AES-256-GCM with a `key_version` column — envelope encryption with a platform-held key. The versioning means a customer-held KMS key is a change of key SOURCE, not of scheme. | **Build fourth.** Genuinely useful and the least often a blocker: most customers accept platform-managed keys once they see the encryption is real and the rotation is versioned. |

The `key_version` column is worth noting as prior work that pays off here: BYOK
is not a rewrite, it is a resolver in front of the existing key lookup.

---

## 9. Environment variables

| Variable | Where | Meaning |
|---|---|---|
| `VECTORBEA_RUNNER_TOKEN` | runner | Presence turns a worker into a self-hosted runner |
| `VECTORBEA_HUB_URL` | runner | Where to ask for work |
| `VECTORBEA_RUNNER_NAME` | runner | Display name; defaults to the hostname |
| `VECTORBEA_RUNNER_LEASE_SECONDS` | runner | 30–300, default 60 |
