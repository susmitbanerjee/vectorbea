# Cross-agent orchestration: implementation phases and sequential prompts

Status: implementation playbook, 2026-09-07. No phase has been implemented or certified by writing this document. Execute prompts sequentially; each produces reviewable implementation and evidence. This file does not authorize production deployments, package publication, customer messages or changes to prices.

Architecture authority: [Framework adapters and agent telemetry](FRAMEWORK-ADAPTER-AND-AGENT-TELEMETRY-ARCHITECTURE.md). Product/enforcement authority: [Execution model decision](EXECUTION-MODEL-DECISION.md). This playbook governs delivery order. If implementation discovers a conflict, record and resolve it explicitly rather than choosing whichever document permits an easier guarantee.

## The product we are building

The hero feature is **agents written in different frameworks collaborating under one durable execution history, shared budget and approval policy**. A LangGraph/Python supervisor must be able to call a Spring AI/JVM specialist running elsewhere, survive a worker outage, receive the result and continue. The user sees who delegated what, which attempt executed, where time and money went, what was approved and whether recovery is safe.

The gateway provides governed model calls; it is not the entire product. OTel provides interoperable observation; it is not the execution protocol. Framework adapters provide semantics and certified boundaries; they do not replace customer code with a universal interpreter. Native VectorBea agents remain an executor of the same engine. Build one product with multiple execution locations.

The delivery order is LangGraph/Python first, then Spring AI/JVM, then further frameworks individually. Do not build every SDK/framework simultaneously. The reference multi-framework hero must work before investing in catalogue breadth.

## Infrastructure decision

The existing stack can support development and the initial bounded pilot, subject to the capacity/recovery evidence below. This is an architectural fit assessment, not verification of live production configuration.

| Component | Reuse or addition | Initial decision |
|---|---|---|
| Kotlin API and native worker | Reuse | Add bounded modules behind existing boundaries. External customer code stays outside these processes. |
| Postgres | Reuse | Durable run/activation state, protocol idempotency, ledger, outbox and initial facts/rollups. Verify connection budgets, backups and restore. |
| Redis | Reuse | Queue notifications, transport and cache. No authoritative spend or irreversible transition may depend solely on Redis survival. |
| Next.js application | Reuse | Extend agent registry, runs, Debug, approvals, usage and worker onboarding. No second customer dashboard. |
| OTel/Prometheus/Tempo/Grafana setup | Reuse for internal operations | Add authenticated tenant ingest before accepting external SDK data. Do not expose an internal collector as a public tenant API. |
| Model gateway | New software capability | Share policy/ledger code; isolate streaming resources. A separate deployment of the same components may be required by measurements before pilot. |
| Python worker and SDK | New distributable runtime | Customer-deployed process/container with outbound HTTPS; one compatible Python version range initially. |
| JVM worker/starter | New distributable runtime after Python | Customer-deployed service; outer invocation control first. |
| Artifact/checkpoint storage | Verify existing path; extend if needed | Existing archive filesystem is not automatically portable object storage. Small DB artifacts are acceptable if suitable; replacement workers need a truly durable accessible customer store. |
| Secret management | Reuse abstraction, validate custody | Workspace-scoped encrypted provider credentials; encryption keys separate from ciphertext and absent from logs. No second ad hoc key store. |
| CI and test provider | Extend | Python/JVM compatibility jobs and deterministic fake model/tool services. Routine correctness tests must not require paid model calls. |
| Kafka, new Temporal runtime, Kubernetes, ClickHouse | Not prerequisites | Introduce only through a measured later infrastructure decision. Redis/Postgres remain the initial architecture. |

Relevant checked-in starting points: [local Compose](../docker-compose.yml), [monitoring deployment](../ops/monitoring/railway/README.md), [Gradle aggregation](../settings.gradle.kts), [telemetry audit](TELEMETRY-AUDIT.md), [plans](PLANS-AND-ENTITLEMENTS.md), [billing](BILLING.md). Inspect source before treating older findings as current defects; for example, the provider-throttling investigation records that its findings were acted on.

## Non-negotiable execution rules for every prompt

Every phase prompt below incorporates this section. Paste one prompt at a time into an implementation task with access to this repository. Do not ask an agent to execute all phases in one turn. A phase can take multiple turns; its completion gate, not elapsed time or file count, determines completion.

1. Read applicable AGENTS.md files, current source and preceding phase evidence. Preserve unrelated user edits. The repository currently has parallel OpenAPI/tool work; inspect current Git state and migration numbering instead of assuming this snapshot persists. Never overwrite or reset unrelated changes.
2. Reuse existing runtime, policy, billing and trace abstractions. Do not build a second scheduler/ledger or route external work through internal DB credentials. Name which existing paths are extended and why.
3. Use the architecture's three contracts: Observe, Control and Govern. Every feature reports its precise scope and source of evidence. No claim of universal framework coverage, exactly-once external effects, guaranteed hidden token usage or automatic framework continuation.
4. Write versioned schemas/protocol fixtures before depending on them across languages. Use forward-compatible fields, explicit capability negotiation and safe rejection of unsupported strict behavior. Pin dependencies at implementation time; verify current official docs for the chosen versions.
5. Keep transport delivery, logical identity and external effects separate. Stable identities deduplicate control transitions; they do not prove an external side effect happened only once. Lost responses produce uncertainty, not free retries or zero cost.
6. Control state and financial facts must be durably acknowledged before granting dependent work. Diagnostic events may be lossy; ledger/approval/state commits may not. Disabled flags and shadow mode do not count as enforced production behavior.
7. Derive tenant authorization from authenticated credentials. Keep telemetry, worker, administrative and spending permissions distinct. Apply workspace privacy policy before upload and again at ingest; never print secrets, raw environment files or real customer payloads in evidence.
8. Maintain a phase record at the proposed path `docs/implementation/cross-agent/Pxx.md` and a manifest at `docs/implementation/cross-agent/STATUS.md`. Record actual changes, exact supported versions, tests/commands/outcomes, fixtures, flags, remaining limitations and rollback. These files are to be created by implementation phases, not assumed to exist now.
9. Run focused unit/contract tests and real integration tests appropriate to the phase. For distributed guarantees, use real Postgres/Redis and separate worker processes where needed. Do not replace a failure test with a mock asserting its own implementation. Mark unavailable checks as not run, never passed. Repair phase-owned defects before declaring completion.
10. End with a concise implementation report: changed behavior, evidence, limitations, migrations/config, rollback and next unlocked prompt. Do not progress past a failed prerequisite by weakening a guarantee. Technical unsupported capability is an acceptable documented limit; the dependent capability stays unavailable.
11. Production activation and package publication are separate release actions. Prepare artifacts, deployment configuration and exact activation instructions; execute externally consequential release actions only with authorization for the specified target. Normal local/staging verification follows the user's existing permissions.
12. The copied prompt authorizes only its phase, not all future phases. Do not silently perform pricing changes, auto-enable strict enforcement on existing customers, or create recurring jobs in external systems merely because the playbook mentions CI cadence.

## Hero acceptance contract

All phases support this one reference scenario, introduced with Python-only workers and extended to JVM. Use deterministic provider and tool fixtures for mandatory CI; an authorized live-provider smoke test is supplementary.

The scenario is a case-analysis workflow. A LangGraph supervisor delegates document research to a Python specialist and account validation to a Spring AI specialist. The specialists execute in different processes. The supervisor joins their typed results and requests approval before sending a simulated external update. A shared run budget is split across children. The update destination supports an idempotency key and a queryable receipt; another fixture deliberately does not, to demonstrate the uncertain-effect path.

| Invariant | Required evidence |
|---|---|
| H1 — One logical collaboration | One root run; stable child activations and causal edges across Python/JVM; retries add attempts, not sibling activations. |
| H2 — Durable parent wait | Parent releases execution capacity while children run; no open local coroutine is the only record of a wait. A replacement parent can join. |
| H3 — Portable recovery | Kill a worker at documented boundaries and restart on another instance with no shared ephemeral disk. Committed checkpoints/results remain available. |
| H4 — Safe effects | Lost response after the fake update succeeds does not cause a second update when destination idempotency exists. Without it, park uncertain work rather than claim exactly once. |
| H5 — Concurrent budget | Child allocations cannot multiply the parent's remaining budget. Supported gateway calls reserve before dispatch; actual retries are paid once each. Unknown charges remain held. |
| H6 — Approval | No protected update dispatch before approval bound to the exact immutable action. Changing the action requires a new decision. |
| H7 — Tenant isolation | A second tenant cannot poll, fetch artifacts, join, approve, replay or spend another tenant's work by supplying its IDs. |
| H8 — Telemetry fidelity | One Debug graph shows native framework names, attempts, waits, direct/descendant spend, missing data and enforcement coverage without double-counting. |
| H9 — Failure isolation | Telemetry outage does not block B; strict policy/gateway outage does not fail open; worker absence parks within deadline with no wait-minute charge. |
| H10 — Compatibility | Unsupported versions cannot silently advance a controlled run; mixed-version compatible rolling restart preserves identity and state. |
| H11 — Privacy | Metadata-only execution sends no prompt/tool-result content to telemetry. Gateway transit and customer-held storage are labelled accurately. |
| H12 — No duplicate native stack | Native VectorBea and external targets use the same authoritative activation/policy mechanisms. Existing supported native behavior still passes regression checks. |

## Phase map

Numbers are sequential execution prompts, not fixed calendar estimates. Architecture work precedes feature code; failure evidence precedes public claims.

| Phase | Prompts | Outcome |
|---|---|---|
| A — Architecture | P00–P02 | Source-grounded design, frozen initial contracts and proven LangGraph boundaries. |
| B — Foundation | P03–P04 | Durable facts/artifact references and secure OTel ingestion. |
| C — LangGraph/Python and governance | P05–P07 | One meaningful observed graph and narrow, enforceable model spend. |
| D — Durable collaboration | P08–P11 | Customer Python workers, shared orchestration and usable Debug/onboarding. |
| E — Cross-framework hero | P12–P13 | Spring AI/JVM joins the same engine; full hero acceptance evidence. |
| F — Bounded pilot | P14 | Security, billing, capacity and operating gates for the hero cohort. |
| G — Greater depth and breadth | P15–P19 | Fine-grained LangGraph, standalone LangChain, CrewAI, AutoGen, TypeScript in order. |
| H — Enterprise and product completion | P20–P23 | Customer gateway/storage, evaluation, measured scaling and release certification. |

P00–P14 is the first shippable cross-framework hero programme. P15–P23 completes the documented expansion scope; it must not hold the bounded hero pilot hostage. “All major frameworks” is ongoing certification: beyond the named integrations, add one adapter-specific phase per supported framework using the same contract and gates.

## P00 — Establish the architecture baseline and work boundaries

Prerequisites: none. Documentation-only phase.

```text
Apply the execution rules in docs/CROSS-AGENT-IMPLEMENTATION-PROMPTS.md. Implement P00 only, without production code changes.

Audit the current repository against EXECUTION-MODEL-DECISION.md and FRAMEWORK-ADAPTER-AND-AGENT-TELEMETRY-ARCHITECTURE.md. Read runtime scheduling, activation creation, lease/CAS, resume reconciliation, checkpoints, approval gates, hierarchy budgets, capacity controls, entitlements, billing, traces, payload/archive storage and monitoring configuration. Check current source before interpreting historical findings. Do not inspect secret values.

Write docs/implementation/cross-agent/P00.md and initialize STATUS.md. Inventory what is implemented/enabled, implemented/disabled, proposed, missing and unverified in deployment. Provide source links and identify mutation/transaction boundaries, not just filenames. Identify all current callers that would need the external-executor seam. Record unrelated ongoing edits and migration owners without changing them.

Decide initial service boundaries and database/connection pools, external authentication path, customer checkpoint requirements, and whether gateway streaming can safely share the API deployment for the bounded pilot. Reuse Postgres/Redis/Kotlin/Next.js. List required capabilities missing from the existing deployment without assuming a new vendor solves them.

Define one-engine ownership: native and external executors share activation, policy and run state; external frameworks retain local interpretation. Identify native feature work deferred by this programme and reliability/customer obligations retained. Identify measured facts versus product hypotheses, including worker adoption and gateway compatibility.

Exit with a concrete component-change map, risk register, prerequisite gaps, provisional resource/availability assumptions and phase dependency check. Do not call architecture ready if the scope of a lease, transaction, billing identity or checkpoint authority is still ambiguous. Do not invent delivery dates or conversion percentages.
```

## P01 — Specify protocol, state machines and security contracts

Prerequisites: P00 complete. Architecture/schema phase; no runtime rollout.

```text
Apply the playbook execution rules. Implement P01 only, using P00's source map.

Create a versioned protocol specification and machine-readable contract artifacts in a suitable shared package, chosen to fit existing builds. Do not make Python clients import Kotlin classes or overload the existing prompt-management SDK. Specify examples and validation rules before server/client implementation.

Define root run, logical step, activation, attempt, message, external operation, checkpoint, capability, policy version and price version identities. Separate external OTel IDs from internal UUIDs. Specify all allowed run/activation transitions and their actor, precondition, transaction boundary, idempotency behavior and outbox effects. Specify registration, poll, heartbeat, commit, cancellation, drain, reconciliation, delegation, join and artifact access envelopes, including errors and retry instructions.

Define worker leases per executable attempt and coordination with existing run leases, so independent children can execute concurrently without two coordinators owning the same run. Specify fencing after expiry, response to duplicate/conflicting completion, and cancellation/approval/budget races. A heartbeat must not resurrect an expired or replaced lease. Define stable delegation identity independent of retry attempt and one logical parent wakeup.

Specify schema portability for Python/JVM values, maximum sizes, absent versus null, decimal/money representation, framework extensions and unknown fields. Define supported input/output/checkpoint codecs, prohibit executable deserialization in the control plane, and bind agent/code/checkpoint versions. Define timeouts for execution, worker absence, approvals and business deadlines separately.

Threat-model tenant spoofing, stolen worker keys, artifact references, SSRF, forged usage, direct-key bypass and self-approval. Define separate telemetry, worker, spending and admin scopes. Specify standalone gateway calls versus managed-run capability-bound calls. Define privacy policy and authenticated artifact handoff without embedding expiring URLs in durable state.

Record unresolved framework boundary assumptions for P02. Exit with traceable invariants H1–H12, schema examples, state/sequence diagrams and acceptance cases. Contracts may be corrected by P02 before implementation; do not freeze unsupported behavior as a requirement.
```

## P02 — Prove LangGraph execution boundaries before committing to them

Prerequisites: P01 provisional contracts. Isolated executable feasibility fixtures are authorized; no production feature rollout.

```text
Apply the playbook execution rules. Implement P02 only. Select and lock one supported Python/LangGraph version combination from current official documentation and actual dependency resolution. Record why that version was chosen; do not rely on today's latest label without a lock.

Build a small repeatable fixture in the repository's appropriate test/example location using real LangGraph and a deterministic model/tool. Exercise public checkpoint/interrupt/resume hooks, nested graphs, parallel super-steps/reducers, same-node repeated invocations and asynchronous streaming. Test an explicit external-delegation boundary that yields a serializable continuation without leaving a live Python task as the only wait state.

Kill the process before snapshot, after snapshot, after a fake side effect and before completion acknowledgement. Restore on another process using a durable shared checkpoint backend. Show precisely what re-executes. Test whether an interrupt restarts node code, where side effects must be isolated, and whether a failed/late checkpoint permits unintended next work. Test pinning and incompatible state versions. Do not write a replacement graph interpreter or patch framework internals to obtain a passing demo.

Produce an evidence matrix: supported whole-invocation control, explicit delegation/resume boundary, checkpoint granularity, cancellation, unsupported fine-grained constructs and observed metadata. Distinguish whole invocation recovery from per-node recovery. Decide the minimum cooperative integration needed from the caller.

Update P01 contracts and architecture where evidence requires it. If durable explicit delegation cannot be supported with public hooks, narrow the first hero to a VectorBea-owned outer plan calling independent LangGraph agents; retain the richer supervisor contract as blocked, not silently fulfilled. Record that consequence and what would unlock it. Exit only with a reproducible supported boundary and an honest developer integration example.
```

## P03 — Durable identities, transitions, artifact references and outbox

Prerequisites: P02 supported contract established.

```text
Apply the playbook execution rules. Implement P03 only. Extend existing tables/stores where semantics fit; do not recreate runs or agent_activations under new names. Allocate migration identifiers after inspecting current migrations and unrelated work. Preserve old rows and existing native behavior.

Implement the durable identities and transition primitives required by P01: execution attempts and capabilities, immutable checkpoint pointers, command/report deduplication and a transactional outbox. Financial reservation operations are P06; define only necessary integration contracts now. Commit status, checkpoint pointer and outbox events atomically. Add uniqueness and tenant checks at the persistence boundary, not only in UI validation.

Implement safe artifact reference metadata and an initial durable storage path: small existing-store artifacts where suitable and customer checkpoint references using P02's proven backend. Validate immutable digest/version, tenant and authorized readers. Upload-before-commit failures leave reclaimable orphans; commit-before-ack remains recoverable. Reissue short-lived access at read time. Prevent GC from deleting live committed or in-flight references. Do not treat a mounted local directory as portable across unrelated customer machines.

Implement outbox claims, per-aggregate sequence handling, idempotent projection checkpoints, bounded retries and poison-record isolation. Redis delivery may repeat or disappear; reconcile from Postgres. Do not block all tenants on one poison event or impose one global consumer order.

Use real Postgres tests for competing transitions, duplicate report with identical/different body, lease replacement, crash/replay of outbox application, old/new migration compatibility and cross-tenant artifact access. Demonstrate a transition cannot succeed without its durable outbox record. Record safe rollout, backward compatibility and rollback that does not discard durable state.
```

## P04 — Secure first-class OTLP ingestion and normalized agent facts

Prerequisites: P03; P01 identity contracts.

```text
Apply the playbook execution rules. Implement P04 only. Add tenant-authenticated OTLP/HTTP observation ingestion and the minimal native semantic envelope needed for agent relationships. Reuse existing tracing/projection components where possible. Do not route customer agent data into internal product analytics or expose the internal monitoring collector directly.

Issue scoped ingestion credentials independently of general API/worker entitlements. Derive workspace/environment from authentication, validate claimed IDs and constrain size, compressed expansion, batches, attributes and rate. Honor metadata-only/redacted/full/customer-held payload policy and sanitize errors. Preserve exact incoming trace/span IDs and causal links through an explicit mapping; do not truncate UUIDs.

Normalize run/activation/model/tool records with provenance, schema version, source operation identity, occurrence/receipt time and completeness. Deduplicate repeated batches, tolerate out-of-order/missing parents and distinguish client assertions from committed state. Define ingest acknowledgement as durable acceptance of the declared accepted records; handle OTLP partial success explicitly. Sample/drop diagnostic detail only under documented policies, with loss accounting.

Implement minimal tenant query endpoints for a normalized graph and usage facts with source/coverage labels. Gate expensive queries. Do not derive billing or strict budget from sampled data. Prove a native trace and imported trace can be represented consistently without losing framework extensions.

Implement the versioned metric catalogue and idempotent fact/rollup projection for available signals: run/activation outcomes, waits, model/tool attempts, usage, collaboration and telemetry loss. Define seconds/bytes/token units, cohort denominators, missing values and bounded dimensions. Compute exclusive/active time from interval unions, leaf spend without parent duplication and aggregate percentiles from distributions. Financial projections consume P06 receipts when available rather than estimating authoritative spend now. Test late/corrected facts, duplicate projection and rebuild agreement; unsupported semantic signals are explicitly unavailable.

Test authentic OTLP fixtures, invalid/oversized input, tenant spoofing, duplicate/redelivered batches, parent arriving late, receiver outage and payload opt-out. Verify accepted facts can be queried, not merely that POST returned 200. Record schema support and unsupported metrics/log types; do not advertise full OTLP signal support if only traces are implemented.
```

## P05 — Python SDK and LangGraph observation, end to end

Prerequisites: P04; P02 version selection.

```text
Apply the playbook execution rules. Implement P05 only. Build a small Python SDK core and an optional LangGraph observation integration for the pinned version. Package independently of JVM and TypeScript work. Do not change the customer's global OTel provider or install all agent frameworks transitively.

Provide simple initialization/registration, scoped configuration, async context propagation, redaction, bounded batching and optional policy-approved spool. Instrument LangGraph through public APIs proven in P02. Capture run/activation/node/iteration where exposed, models, tools, nested subgraphs, checkpoint/interrupt metadata and causal relationships. Preserve unavailable fields instead of guessing iterations or usage.

Correlate framework model spans and provider attempts with stable operation IDs. Prevent duplicate instrumentation and duplicate cost from LangChain internals used by LangGraph. Preserve actual provider retries as distinct attempts. Stream without buffering the entire response; aggregate chunk timing and keep content opt-in. Export failures must not throw into observed application code.

Deliver an executable local quickstart using the existing API plus a deterministic model/tool fixture. It must produce a queryable trace with framework names and clear reported/estimated usage. Include no live-provider requirement in default tests. The execution worker is not part of this phase.

Test sync/async, nested graphs, parallel same-name agents/tools, stream cancellation, exceptions, double initialization, provider usage absent, exporter overload and metadata-only policy. Measure hook overhead and end-to-end slowdown on named workloads; report distributions rather than asserting the earlier 1 ms hypothesis. Exit with a distributable local package artifact, compatibility record, documented limitations and a real end-to-end trace.
```

## P06 — Atomic hierarchical reservations and authoritative usage

Prerequisites: P03; P05 provides operation identity fixtures.

```text
Apply the playbook execution rules. Implement P06 only. Inspect existing BudgetLedger, cost attribution, UsageMeter and plan admission behavior. Extend them through one authoritative service rather than creating a parallel source of truth. Preserve commercial admission grace separately from explicit strict resource ceilings.

Implement durable reservation, dispatch marker, settlement, release and uncertain states for unique billable attempts. Reserve atomically across applicable account, workspace, run and parent/child allocations. Use exact decimal/integer units, a pinned price version and one declared currency initially. Define allocation versus actual spend to avoid counting the same money as both a child carve-out and a second account charge. Released child allowance returns once; uncertain spend remains held.

Standalone governed operations authenticate separately from managed-run operations and may not forge activation allocations. Financial idempotency is based on actual operation/attempt identity. Repeated reports do not double-charge; a genuinely repeated model request can charge again. A crashed dispatched request is not automatically refunded by a TTL. Define documented conservative/manual reconciliation with an audit trail.

Implement usage facts and mismatch detection between client reports and authoritative receipts, with tolerances, incident metrics and correction records. Unsupported or unbounded prices cannot pass strict admission. Do not silently count them as zero. Define consistent locking order and account contention behavior; fail closed on authority outage.

With real Postgres and concurrent callers, prove reservations cannot exceed every configured ancestor ceiling, including simultaneous standalone and managed usage. Test crash at each lifecycle boundary, settlement/redelivery, reserve cancellation races, midnight/period rollover, policy downgrade and uncertain hold. Reconcile existing native usage without changing historical invoices. Record the distinction between implementation and runtime activation flags.
```

## P07 — Narrow governed model gateway with streaming fidelity

Prerequisites: P06 and P04–P05 correlation.

```text
Apply the playbook execution rules. Implement P07 only. Select a small provider/endpoint/model matrix supported by existing connectors and current official provider contracts. Start with bounded text generation and explicit output ceilings. Do not promise all endpoints, multimodal modes or base-URL compatibility merely because forwarding HTTP works.

Build the gateway over P06's authoritative ledger. Authenticate virtual workspace credentials; distinguish standalone observed calls from managed capability-bound calls. Reuse encrypted provider-secret storage after verifying tenant scoping, rotation, separate encryption key custody and redaction. Never return provider keys to clients or log inbound credential headers. Restrict upstream destinations to configured providers to prevent SSRF.

Before forwarding, validate model/feature entitlement and reserve a conservative supported cost/token bound, including provider-specific billable categories. If input or output cannot be bounded faithfully, reject strict mode for that feature. Preserve supported provider-specific request/response fields, status and error semantics, cache-control/tool-use data and SSE framing. Do not translate through a lossy universal format.

Mark dispatch durably and settle from authoritative usage. Lost response/usage produces an uncertain hold. Do not infer authoritative billing from streamed token text. Disable automatic retries, fallback and caching in this first slice. A client disconnect does not prove upstream execution stopped. Isolate streams, timeouts and connection pools from run control, and fail closed when the ledger is unavailable.

Test deterministic upstreams for long streams, malformed frames, early disconnect, delayed/absent final usage, 429, provider error, concurrency at the last budget unit, and reserve/dispatch/settle crashes. Verify payload policy and real correlation with a P05 graph, without duplicate cost. Measure routed-versus-direct latency and control API responsiveness under saturation. Record exact supported surface and required egress restrictions. Prepare, but do not publish, a gateway availability contract based on measured behavior.
```

## P08 — External worker registration, leases and commit API

Prerequisites: P03/P06; P01/P02 supported execution boundary.

```text
Apply the playbook execution rules. Implement P08 only. Expose the versioned worker protocol behind existing authoritative run/orchestration state. Customers must not receive Redis URLs, database credentials or arbitrary remote package-install commands.

Implement scoped worker registration, agent/code/capability advertisement, compatible queue routing, bounded long polling, heartbeat, completion commit, cancellation and drain. Work grants identify the attempt and current fencing generation, immutable agent version, policy version, input/checkpoint references and allowed next actions. Reuse status CAS while preserving P01's distinction between run coordinator ownership and independently executable child attempts.

Use one bounded poll strategy per worker process, not one held connection per potential agent. No poll holds a database transaction/connection while waiting. Add tenant and process limits, jitter, reconnect/backoff, idle timeouts and capacity advertising. Prevent a client from increasing its effective entitlements through its own capacity report.

Reject stale/expired attempts and unauthorized continuation proposals. Identical completion retries return the committed response; conflicting bodies are rejected and audited. Atomically commit results/checkpoint pointers and outbox before returning subsequent work. Release resources on waits, preserve deadline semantics, and reconcile missing notifications from Postgres.

Test with a protocol client in a separate process and real stores: two workers race a claim, heartbeat arrives after expiry, lease is replaced, commit acknowledgement is lost, cancel races completion, a incompatible version polls and a forged tenant requests another queue. Saturate idle polls and prove ordinary API/ledger transactions retain capacity. Exit with an interoperable protocol implementation, OpenAPI/protocol docs, metrics and no native-executor regression.
```

## P09 — Customer Python worker and LangGraph controlled invocation

Prerequisites: P08/P05/P02; P07 for governed runs.

```text
Apply the playbook execution rules. Implement P09 only. Build a customer-deployed Python worker using registered local agent functions and P02's supported LangGraph boundary. Ship a local CLI/container recipe with outbound HTTPS, version locking, health information and graceful drain. Do not download or execute arbitrary code supplied in a work item.

Implement registration, poll, bounded execution, heartbeat, fencing-aware requests, checkpoint hydration, immutable artifact commit and completion retry. Propagate run/activation/attempt/OTel identity from grant through all model/tool calls. Use P07 virtual credentials for governed calls without giving the worker raw provider keys. Direct mode must remain visibly advisory.

Support whole-agent invocation and the explicit cooperative delegation/approval continuation proven in P02. An adapter returns a durable waiting outcome and releases its execution slot; it does not keep a sleeping coroutine as its recovery plan. Reload by stable checkpoint/namespace on a replacement worker, never by whichever local snapshot happens to be newest. Ordinary inner effects follow the declared idempotency/retry policy.

Verify missing/corrupt/incompatible checkpoints fail or park clearly rather than starting from scratch. Do not advertise arbitrary node-level resumability; comprehensive fine-grained certification is P15. Honor business and worker-wait deadlines; stop new protected requests on lost authority even if customer code ignores local cancellation.

Run the fixture in two independent worker processes with a customer durable checkpoint store. Kill and replace a worker before/after snapshot, server commit and acknowledgement. Verify known completed work is not logically duplicated, ambiguous effects park, waiting is not metered as active execution, and metadata-only payload rules hold. Deliver a runnable Python-only managed run with a trace, budget receipts and a documented continuation boundary.
```

## P10 — Durable cross-agent delegation, handoff and joins

Prerequisites: P09; shared activation and budget state from P03/P06.

```text
Apply the playbook execution rules. Implement P10 only. This is a hero-feature phase: extend existing AgentHarness, AgentCallExecutor, OrchestrationLoop and ActivationStore through the agreed external-executor seam. Do not build a second scheduler or framework-specific backend engine.

Implement versioned agent registry targets, allowed-peer grants and schema-validated cross-agent calls. Support call-and-return, durable ownership handoff and bounded fan-out with an explicit all/any/quorum join policy. The first fixture uses separately deployed Python agents. Native execution remains available through the same authority. Carry typed input/output or immutable authorized references; no cross-language executable object serialization.

Create each logical child once using a stable parent delegation identity independent of attempt. Reserve shared budget before dispatch. Parent waiting checkpoints, child set, join policy and wakeup identities are durable; a parent releases its worker slot. Handle child completion/retry/cancel races and joining results after parent replacement. Replayed framework code must reattach to the existing delegation/result, not create new children.

Bound total activations, depth, fan-out, messages, transfer cycles and elapsed deadlines. Implement reference/version rules for shared context and conflicts without silently overwriting sibling results. Distinguish causal edges from span containment. A join's losing branches may have spent money already; record cancellation and incurred cost. Cross-workspace targets are denied by default.

For the hero's protected effect, reuse an existing authorized tool executor or implement the narrow protected dispatch boundary that checks the current immutable approval and effect identity before calling the destination. A Python-local approved flag is insufficient. Bind retries to the same destination idempotency key, scope tool credentials away from unauthorized paths in the fixture, and label ordinary direct customer tool calls as observed rather than universally enforced. Approval of a model-proposed tool call is not evidence that the actual destination was invoked.

Use real concurrent workers to test duplicate delegate requests, parent death while waiting, child success with lost acknowledgement, last-child wakeup races, one worker slot per process, quota downgrade during join and cyclic transfers. Demonstrate no capacity deadlock and no budget multiplication. Include an approval-bound simulated effect with idempotent and non-idempotent destinations. Exit with H1–H7/H12 evidence and a reproducible Python collaboration, not just a mocked scheduler test.
```

## P11 — Unified Debug, worker onboarding and truthful usage views

Prerequisites: P10; P04 normalized facts and P06 usage.

```text
Apply the playbook execution rules. Implement P11 only. Extend the existing Next.js registry, run, Debug, approvals and usage surfaces; no separate telemetry product or admin analytics dashboard.

Build a usable agent graph with delegation/handoff/join edges, per-attempt timelines, worker/approval/child/budget waits, framework/version and checkpoint state. Show direct versus descendant spend and reserved/settled/uncertain amounts without adding rollups twice. Every quantity includes source, coverage and freshness where relevant. Missing usage/payloads and partial traces are explicit states, not zeroes or empty successful work.

Add worker setup and capability diagnostics: scoped credentials, compatible agent versions, health, last-seen, missing checkpoint access and unsupported controls. Expose Observe/Control/Govern separately. Metadata policy and gateway transit are understandable; internal lease tokens and stack details do not belong in the main user flow. Approval must identify the immutable action and authenticated decision maker; changed arguments invalidate it.

Implement resumable persisted live-update cursors, tenant authorization on queries and actions, and clear recorded playback versus continuation versus fresh rerun semantics. Reuse canonical entitlement APIs and distinguish collection quota from execution quota. Do not change public prices or claim feature availability merely because a UI control exists.

Validate UI against the P10 real run, not only fixtures. Verify parallel agents, long waits, failed join, missing parent spans, denied approval, uncertain effect, incompatible worker and payload opt-out. Test keyboard/navigation and stale live reconnect behavior. Supply view screenshots or existing UI verification output, normalized API examples and tests for financial display/tenant isolation. Exit with a developer able to diagnose and resume the supported Python collaboration from the product.
```

## P12 — Spring AI/JVM observation and outer worker execution

Prerequisites: P11; stable language-neutral contracts. Spring AI is the second framework/language milestone.

```text
Apply the playbook execution rules. Implement P12 only. Select one compatible Spring Boot/Spring AI/JDK combination from current official docs and pin it. Add a JVM core/starter and worker integration without restructuring the repository's independent Gradle builds or coupling customers to the native worker application.

Use Micrometer/OTel and public Advisor/model/tool hooks; coexist with customer observation configuration. Preserve async/Reactor/executor context, and test actual streaming HTTP context propagation for the chosen release rather than assuming it works. Correlate ChatClient, model, HTTP and gateway records to a single billable attempt. Prompt/tool payload logging remains disabled under metadata-only policy.

Expose a registered agent operation as an outer controlled invocation. No arbitrary Java-stack continuation or customer-written state codec required for the advertised integration. The specialist's result is durable after server commit; interruption before that follows explicit whole-invocation retry/idempotency policy. Make non-retryable effects fail/park safely instead of rerunning silently.

Implement JVM worker protocol, schema/value compatibility, virtual spending credentials, drain and capability reporting using the exact P01 fixtures. Do not fork Python protocol semantics. Build a Spring AI specialist callable by the P10 LangGraph supervisor and optionally able to invoke a granted peer at a declared supported boundary, without advertising broader continuation than implemented.

Test model/tool observations, streaming cancellation, duplicate instrumentation, missing usage, Python/JVM decimal/null/Unicode compatibility, service restart and cross-tenant denial. Execute a real Python-to-JVM call through VectorBea with deterministic models and one linked Debug graph. Record the certified surface as observation plus outer invocation; unsupported fine-grained execution remains unavailable.
```

## P13 — Certify the cross-framework hero end to end

Prerequisites: P12. No new framework scope.

```text
Apply the playbook execution rules. Implement P13 only. Turn the playbook's hero acceptance contract into a reproducible integration environment and end-to-end suite. Use the real API, Postgres, Redis, separate Python and JVM workers, portable checkpoint storage, the gateway, fake provider and two fake effect destinations. Use the same public customer APIs/SDKs as the quickstarts.

Run a LangGraph supervisor, a Python research specialist and a Spring AI validation specialist with shared allocations, join and final approval. Add a native VectorBea target regression scenario to prove shared authority. Never replace orchestration with a fixture that manufactures the expected trace or writes rows directly.

Exercise every H1–H12 invariant. Inject failures before/after child creation, reservation, upstream dispatch, child result commit, parent wakeup and approval. Lose responses, duplicate messages, partition workers, restart on new instances, switch compatible versions and attempt cross-tenant actions. Include both destination-enforced idempotency and an unqueryable non-idempotent effect, with different expected outcomes.

Use a controllable clock for routine timeout tests but preserve a real wall-clock one-hour fleet-outage soak as a pre-pilot check. During it verify parked state, no attempt churn, no active-minute charge, and recovery within declared deadline. Test telemetry outage separately from control/gateway outage. Confirm uncertain provider cost stays held and cannot be reused.

Produce durable evidence: public API transcript with secrets removed, stable IDs, checkpoint refs/digests, ledger entries, effect receipts, run graph screenshots and query assertions. Fix discovered phase-owned defects with regression tests. Classify each invariant pass/fail/not run; do not advertise a hero-ready release with any required invariant unproven. Provide a one-command local demo and a short developer walkthrough, without publishing or deploying publicly.
```

## P14 — Bounded pilot: privacy, billing, security and operations

Prerequisites: P13 passed, including required soak or explicit unreleased status until it passes.

```text
Apply the playbook execution rules. Implement P14 only. Prepare the LangGraph/Spring hero for a bounded pilot rather than expanding framework scope. Choose a documented pilot envelope for tenants, workers, concurrent calls, idle polls, artifact sizes, events, retention and throughput based on measured tests. Do not inherit an unmeasured general-availability SLA.

Verify tenant isolation end to end, credential least privilege/rotation/revocation, metadata-only transit/storage, secret encryption, immutable approval binding, artifact expiry and SSRF protections. Test backup restore with pending runs, uncertain reservations and committed child results. Prove restored state does not double-dispatch protected effects or release uncertain funds. Document RPO/RTO evidence and remaining upstream limitations.

Connect new usage to canonical billing-account entitlements without double-metering retries/resume or charging worker/approval waits. Distinguish subscription admissions from strict gateway budgets. Prepare proposed Observe/Control/Govern entitlements and cost-based limits in shadow/test configuration; do not alter live prices or silently enable refusals. Financial corrections and privacy deletion need audited procedures.

Add runbooks/alerts for worker absence, join starvation, stuck outbox, gateway/ledger outage, usage mismatch, unknown spend, connection saturation, trace loss, schema incompatibility and checkpoint unavailability. Give each an operational owner and response. Isolation tests must show telemetry and long streams cannot exhaust control authority; split deployments/pools if evidence requires it.

Prepare reproducible signed/versioned SDK/container artifacts, dependency inventory, compatibility CI, migration/deployment ordering, drain/rollback and staged activation instructions. Weekly upstream checks belong in repository CI configuration with documented activation, not an unsolicited external automation. Measure onboarding steps and cohort conversion events without collecting payloads. Exit with an evidence-backed release checklist and exact actions requiring target-specific deployment/publication authorization. Keep the pilot disabled until those actions are authorized.
```

## P15 — Certified fine-grained LangGraph control

Prerequisites: P14 evidence; P02 limitations revisited against the pinned supported version.

```text
Apply the playbook execution rules. Implement P15 only. Deepen LangGraph control beyond the coarse and explicit cooperative boundaries already shipped. Preserve existing outer-mode contracts and never silently upgrade a run's execution granularity.

Use public framework hooks to authorize and commit supported graph segments/super-steps. Preserve reducers, fan-out readiness, branch decisions, nested checkpoint namespaces and message state. The framework remains the interpreter; VectorBea owns permission to advance and the committed checkpoint reference. If a construct cannot stop at the required boundary, reject fine-grained registration for it with a clear fallback option rather than patching the interpreter.

Specify retry scope and what code re-executes after each interrupt/checkpoint. Isolate external effects behind known idempotency or protected authorization. Support bounded batching only for declared cheap side-effect-free segments, with cancellation/authorization latency documented. Do not skip paid-call or approval boundaries to improve a benchmark.

Test super-step partial completion, racing branches, deterministic reducer results, nested same-name nodes, interrupt re-entry, resume from incompatible schema, late worker completion and topology/version pinning. Demonstrate worker/control partitions cannot authorize future steps. Compare direct, coarse and fine-grained execution for behavior, extra network time and replayed work.

Publish a capability matrix of certified constructs and limitations. A failing fine-grained certification parks that capability while coarse invocation remains available; it never turns existing strict runs into community execution. Exit with per-construct evidence and migration/rollback rules preserving old checkpoints.
```

## P16 — Standalone LangChain support without duplicate instrumentation

Prerequisites: P15 or its supported-limit decision; stable Python SDK.

```text
Apply the playbook execution rules. Implement P16 only. Add standalone LangChain observation and outer invocation support as a separate certified capability. Audit what the existing LangGraph integration already observes through LangChain to avoid duplicating it.

Select a pinned supported version. Use public Runnable callbacks and agent middleware for models, tools, chains and explicit agent boundaries. For compatible graph-backed agents delegate execution to the existing LangGraph adapter rather than creating another checkpoint runtime. Ordinary runnable/chain functions advertise whole-invocation control and their actual retry limitations.

Coexist with nested LangGraph and provider instrumentation. Preserve one logical model operation with actual retries as attempts. Capture retrieval/memory summaries only when hooks expose them and privacy permits. Unknown token/iteration fields remain unknown. Do not label every chain as a multi-agent orchestration.

Provide a LangChain specialist callable from the certified hero registry. Test standalone sync/async/streaming, nesting under LangGraph, callback exceptions, middleware rejection, double initialization, checkpoint delegation and retries. Run relevant H1–H12 cases plus the Python compatibility suite. Publish the exact observation/control matrix and one executable integration guide. Do not make this phase a general rewrite of Python packaging.
```

## P17 — CrewAI observation and outer collaboration

Prerequisites: P16; core cross-framework suite remains green.

```text
Apply the playbook execution rules. Implement P17 only. Add a version-pinned CrewAI integration using its public event listener and execution interfaces. Start with crew/task/agent/model/tool observation plus outer crew invocation as a registered target.

Keep crew-internal collaboration events separate from VectorBea-managed child activations. The UI may show native crew topology without claiming each inner agent is individually controlled. If native checkpoint/Flow facilities are used, prove recovery semantics for the pinned version; state persistence alone is not permission to dispatch the next task. Do not advertise fine-grained certification in this phase.

Map role, task, delegation and stop/failure events with stable invocation identities and namespaced native fields. Ensure listener lifecycle/registration does not leak or duplicate events across multiple crews in one process. Correlate model usage with the shared gateway and preserve all actual retries. Honor metadata-only storage throughout events/errors.

Add a CrewAI research target to the existing hero using the same worker registry, budget and join protocol. Test concurrent crews with repeated agent names, process death, outer retry policy, nested native delegation, absent usage, listener failure and cancellation. Do not replay an uncertain external tool effect automatically. Ship compatibility evidence, clear control scope and a runnable guide; no new backend scheduler or plan code.
```

## P18 — AutoGen native OTel and certified outer execution

Prerequisites: P17.

```text
Apply the playbook execution rules. Implement P18 only. Begin with native AutoGen OTel export into the existing ingest path; add enrichment only for missing agent/message/team semantics. Select and pin the actual package family/version. Treat AgentChat and Core runtime support as separate capability entries; no assumption that an integration for one certifies the other.

Support a registered outer agent/team invocation as a collaboration target. Preserve message producer/recipient/delivery identity and use span links for messaging and fan-in. Correlate model-client usage through existing operation IDs. Native save/load state is not an atomic snapshot of all pending messages; limit recovery claims to tested boundaries and do not create a distributed message broker implicitly.

Where a runtime's agent/tool spans are already complete, reuse them rather than adding duplicate wrappers. Normalize termination and handoff information without inventing hidden reasoning. Metadata-only mode must sanitize framework messages/logs as well as span attributes.

Add an AutoGen reviewer to a cross-framework scenario. Test native OTel ingestion, multi-turn state, delivery redelivery, lost result, multiple named agents, streaming cancellation, unknown usage and unsupported state versions. Use stable control identities for outer retries, parking ambiguous inner effects. Certify the chosen initial surface only; mark additional runtime modes observational or unsupported until separately tested. Publish package/version coverage and the actual code-free onboarding path where native OTel suffices.
```

## P19 — TypeScript core and LangGraph JavaScript parity

Prerequisites: P18; contract schema stable across Python/JVM.

```text
Apply the playbook execution rules. Implement P19 only. Add TypeScript observation/worker support without replacing the existing JavaScript prompt-management SDK or breaking its public API. Choose a compatible distribution layout and pin Node/framework versions after inspecting repository conventions.

Implement the shared wire contract, async context, privacy filtering, bounded export and operation identity with the same golden fixtures as Python/JVM. Add one LangGraph JavaScript integration at its actually supported observation/outer execution boundaries. Python LangGraph certification does not transfer automatically; public JS continuation hooks need their own proof before deeper control.

Keep external trace IDs, exact monetary strings/integers, absent/null values and schema evolution compatible across all languages. Browser environments should not receive worker/admin/provider credentials; distinguish server SDK from any future browser telemetry helper.

Add a TypeScript target to the existing collaboration suite and test nested/parallel execution, stream abort, retries, event-loop context, duplicate instrumentation and worker replacement. Produce a language conformance report and a package migration guide. Stop at certified TypeScript capabilities; do not add unrelated framework/language integrations in the same phase.
```

## P20 — Enterprise gateway and customer-held data boundary

Prerequisites: P14 operating contract and existing governed request identity; run after the framework expansion sequence for a single serial programme.

```text
Apply the playbook execution rules. Implement P20 only. Add one explicitly selected enterprise gateway integration and customer-held artifact mode through existing transport/policy abstractions, not a second ledger. Choose a gateway with a testable authorization/receipt contract; do not call every OpenAI-compatible endpoint an enforcing gateway.

The customer gateway keeps provider keys and payloads in the customer boundary. VectorBea receives minimal scoped authorization metadata and verifiable receipts. Define trust, replay protection, shared reservation identity, bounded supported charges, outages, cancellations and reconciliation. A signed usage record proves its source, not that workers could not bypass it; document customer IAM/egress requirements.

Implement customer artifact/checkpoint references with scoped retrieval, integrity/version checks, replacement-worker portability and UI access that does not silently proxy payloads through our backend. No persistent pre-signed bearer URL in run state. Apply separate live-checkpoint and diagnostic-retention policies and handle revoked storage access explicitly.

Test that prompts/tool results/provider keys never reach VectorBea in the selected no-transit mode, including logs/errors and traces. Test customer gateway outage, forged/replayed receipt, lost settlement, inaccessible checkpoint, cross-tenant reference and concurrent reservations across hosted/customer routes. Fail closed or downgrade the selected route's claim before admission when required enforcement support is absent; do not fail open mid-run.

Deliver a deployment contract, data-flow evidence, key rotation and incident runbooks, plus one real end-to-end integration fixture. Private networking/regions are configured only for the authorized target; prepare rather than purchase or deploy unsolicited infrastructure.
```

## P21 — Agent quality and business-outcome telemetry

Prerequisites: P20; normalized facts and privacy controls.

```text
Apply the playbook execution rules. Implement P21 only. Extend agent telemetry with explicit quality/business outcomes without implying that runtime success equals task success or that hidden reasoning is observable.

Implement a versioned evaluation record: evaluator identity/version, rubric/dataset version, input/output evidence refs, score/verdict, sample/coverage, execution time and evaluation cost. Support deterministic schema/business validators and human labels first; optional model evaluators must use their own covered budget and may require payload consent. Customer-local evaluators can report outcomes while keeping payloads local, marked as customer assertions.

Add comparison queries/UI for framework/agent versions, accepted outcome rate, rework/escalation, groundedness where measured, and clearly defined cost per accepted outcome. Keep operational failures, evaluation failures and negative quality verdicts distinct. Display sample size, denominator and evaluator provenance. Do not rank frameworks from unrelated workloads or average per-worker percentiles.

Use fixed labelled fixtures and late/corrected evaluation records to test idempotency, denominator selection, zero-success cohorts, sampled/missing payloads and deletion. Ensure evaluations cannot mutate run success or retroactively change invoices. Demonstrate the hero's useful result can be accepted/rejected independently from execution status, with the evaluation's own spend attributable.
```

## P22 — Measured scaling, retention and infrastructure decisions

Prerequisites: P21; use actual adapter-generated workloads rather than fixed synthetic row counts alone.

```text
Apply the playbook execution rules. Implement P22 only. Measure light, typical and heavy collaboration scenarios across the certified adapters: agents, iterations, tool calls, parallel fan-out, events/spans/payload sizes, pending waits, polls, provider streams and query patterns. Reconcile the old eight-spans example and 50–200x event estimate by measuring both on the same workloads.

Load-test peak tenant bursts, idle worker connections, outbox lag, ledger account contention, storage growth and Debug query latency. Prove telemetry/payload pressure cannot starve control or corrupt strict reservations. Size Postgres pools, partitions, indexes, ingest queues and streaming limits from the results. Measure full-loop network overhead and batching only where guarantees permit it.

Benchmark existing retention/archive paths, restore and customer-held references. Specify storage amplification for indexes, replicas, backups and exports; estimate cost per workload/retention cohort from measured bytes and documented infrastructure prices. Do not derive financial truth from a sampled trace store or optimize by weakening audit retention silently.

Keep the current stack when it meets declared pilot/next-stage limits. If it does not, produce and implement the smallest justified isolation change, such as separate gateway deployment or telemetry database. A columnar projection requires replay/idempotency/deletion/tenant-query tests and a measured need. Do not introduce Kafka, Kubernetes or a new workflow engine as a default scaling response.

Exit with reproducible load scripts, p50/p95/p99 and saturation points, an operating envelope, scale triggers, rollback and updated cost assumptions. Any infrastructure procurement/deployment follows target-specific authorization; prepare concrete configuration beforehand.
```

## P23 — Final compatibility, migration and release certification

Prerequisites: P22 and all capabilities selected for release passed their gates. Unimplemented capabilities remain explicitly out of release scope.

```text
Apply the playbook execution rules. Implement P23 only. Audit the full implemented product against the two architecture documents, phase evidence and H1–H12. Resolve documentation/source drift; do not mark a feature shipped because a planned package or matrix row exists.

Run the required compatibility and hero suites across pinned certified versions, supported execution modes, provider matrix and customer-gateway mode. Verify rolling upgrade/rollback with parked runs, versioned checkpoints, queued work, in-flight leases and uncertain reservations. Verify native regressions, tenant isolation, payload policy, billing reconciliation, backup restore, outbox recovery and gateway availability limits.

Publish a release manifest in the repository: exact package/container versions, supported capabilities per framework, unsupported features, deployment/migration ordering, flags, default-off/new-customer policies, signing/checksum inventory, licensing/dependency review, secrets setup, monitoring owners and runbooks. Create customer onboarding and troubleshooting guides for Python, Spring AI and each certified later integration.

Replace provisional marketing/price claims with evidence-backed proposed wording and limits for review, without changing live subscriptions or pricing. The hero demonstration must disclose outer versus fine control, gateway coverage and privacy mode. Never claim all frameworks or exactly-once arbitrary effects.

Prepare a staged release with explicit target, cohort, measurable health gates, abort criteria and rollback preserving durable state. If production deployment, package publication or customer communication is not authorized, stop after the complete reviewable release package and name the remaining action. If authorized, follow the approved target-specific sequence, verify the deployed artifacts and observe its gates. No phase completion can be inferred from exhausted time or tests that were not run.
```

## Decisions intentionally left to evidence

Initial exact package/provider versions are chosen in P02/P07/P12 and pinned, not guessed now. Initial pilot scale, latency commitments and uptime contract are set by P13–P14 evidence. Observe-to-Control conversion and willingness to pay are measured, not invented. Exact public pricing and irreversible release actions remain product decisions on a concrete release package.

A new framework beyond this list must demonstrate native OTel coverage first, then justify a semantic adapter, then certify outer control, and only then claim finer continuation. A generic custom agent operation can already participate at its declared boundary; adding a logo does not require a new backend engine.

The programme is complete for a release only when its selected framework/version/capability matrix and hero invariants have evidence. Framework breadth will continue to evolve; the authoritative runtime, accounting and telemetry contracts must remain coherent as it does.
