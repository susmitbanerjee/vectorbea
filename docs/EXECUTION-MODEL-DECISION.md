# Execution model decision

Date: 2026-09-07. Status: proposed product decision; not a claim that the client-worker protocol or hard spend enforcement has shipped. This document changes no code or plan configuration.

Detailed follow-up: [Framework adapters, agent telemetry and durable multi-agent orchestration](FRAMEWORK-ADAPTER-AND-AGENT-TELEMETRY-ARCHITECTURE.md) defines the cross-framework adapter contracts, metrics, worker protocol and rollout.

Implementation order was refined after independent review: [Cross-agent implementation prompts](CROSS-AGENT-IMPLEMENTATION-PROMPTS.md) starts with architecture, one LangGraph/Python integration and early governed model calls, then proves durable collaboration with Spring AI/JVM before adding framework breadth. The hero feature is cross-framework agent orchestration with one causal history, shared budget and approval policy.

**Choose C, durable control, as the primary product. Ship B, SDK-observed, as the free on-ramp and an explicitly observational option on paid plans. Defer A to a narrow, paid managed-worker convenience built on a sandbox vendor; do not build a general-purpose hosting platform.**

The defensible product is ownership of authorized progress across failures: scheduling, decisions, durable state, budgets and evidence, while customers retain their code and infrastructure. Hosting arbitrary code duplicates much of Modal or Lambda. Observation alone cannot deliver the promised enforcement. C fits the existing architecture, but owning workflow state is not the same as controlling every action a customer process can take.

## Three contracts behind one sentence

`vectorbea.run(my_langgraph_agent)` hides materially different integration and trust contracts. The mode must be explicit in onboarding, workspace settings, run records and commercial claims.

| Model | What the developer gets | What it cannot promise |
|---|---|---|
| A — Hosted | Upload/build/deploy code; we provide execution capacity, schedule and recover supported work, and control its sandbox. | Arbitrary dependency compatibility, zero cold starts, automatic node-level durability for opaque code, prevention of already-committed side effects, or a hard external spend ceiling with unrestricted direct provider access. |
| B — SDK-observed | Their deployment emits traces, reported costs and outcomes; we provide history, alerts, policy evaluations and audit records of what was submitted. | Deployment of their process, guaranteed scheduling/execution, crash recovery, complete evidence, or mandatory runtime quota, budget, approval and feature enforcement. |
| C — Durable control | We admit runs, persist progress, schedule authorized steps, park waits and retry recoverable work. Their workers execute steps and retain application dependencies and credentials. | Running without workers, stopping arbitrary off-protocol code, proving a worker's report truthful, exactly-once external effects, or hard direct-key LLM spending limits. |

For C, “deployment” initially means registering a versioned agent/graph and routing work to compatible customer-deployed workers. It does not mean provisioning their compute. Customers still operate and patch workers. B can observe a local scheduler, but cannot guarantee that a schedule runs while their infrastructure is absent.

A generic wrapper around an opaque LangGraph invocation yields one opaque step. Fine-grained C requires a supported adapter exposing node boundaries, branch decisions, interrupts, serializable continuation state and stable node/version identities. The customer keeps business logic but adopts this execution contract. Arbitrary closures, background threads and hidden nested agent loops do not become durable through a one-line wrapper. Avoid competing checkpoint authorities: the adapter maps framework checkpoints to our committed step sequence; the local framework cannot advance the authoritative run independently.

## Existing boundary and remaining work

The repository already assumes that VectorBea owns state and an executor does work. A client worker is a new executor behind that boundary, not a new runtime. Moving the boundary across an untrusted network still requires substantial protocol and security work.

| Existing mechanism and evidence | Reuse in C | Qualification |
|---|---|---|
| [RunLeaseManager](../apps/worker-kotlin/src/main/kotlin/com/vectorbea/worker/durable/RunLeaseManager.kt) | Exclusive ownership, heartbeat and crash detection; current default lease TTL is 60 seconds. | Customer workers must receive scoped capabilities, not database access. Stale leases must fence every state-changing report and protected request. Lease expiry cannot kill a remote process. |
| [ResumeReconciler](../apps/worker-kotlin/src/main/kotlin/com/vectorbea/worker/durable/ResumeReconciler.kt) and status CAS | Reconcile durable waits and reject duplicate/stale progress. | Compare-and-set protects our state, not the external system a worker calls. |
| [WorkflowRuntime](../apps/worker-kotlin/src/main/kotlin/com/vectorbea/worker/runtime/WorkflowRuntime.kt), [CheckpointStore](../apps/worker-kotlin/src/main/kotlin/com/vectorbea/worker/runtime/checkpoint/CheckpointStore.kt) | Checkpoint/resume and explicit waiting outcomes. | Remote step completion needs a durable commit acknowledgement. Best-effort telemetry or checkpoint failure cannot count as committed progress. |
| [ApprovalStore](../apps/worker-kotlin/src/main/kotlin/com/vectorbea/worker/runtime/checkpoint/ApprovalStore.kt) | Authoritative approval state before downstream dispatch. | Approval must bind to the exact action/version; changing its arguments invalidates approval. |
| [BudgetLedger](../apps/worker-kotlin/src/main/kotlin/com/vectorbea/worker/agents/budget/BudgetLedger.kt) | Hierarchical allocation, reservation and settlement semantics. | It is in memory per tick, hydrated from activation rows. Its over-allocation result explicitly acknowledges that a completed model call has already spent money. This is not yet an atomic cross-worker account spend service. |
| [ActivationStore](../apps/worker-kotlin/src/main/kotlin/com/vectorbea/worker/agents/orchestration/ActivationStore.kt) and [SideEffectGuard](../apps/worker-kotlin/src/main/kotlin/com/vectorbea/worker/durable/SideEffectGuard.kt) | Stable activation/effect identities across retries. | Deduplicating activation creation does not deduplicate an external payment or model request whose response was lost. |

The new surface needs outbound long polling, workspace/environment/queue-scoped worker identities, key rotation, protocol versions, worker compatibility routing, fenced attempts, durable report deduplication, payload references and fair dispatch across tenants. Credentials must never authorize another workspace's queue. Rate-limit polls, reports and payload sizes; isolate tenant backlog and ledger contention. Audit records distinguish server decisions, gateway receipts and worker assertions. A compromised worker must not approve its own work or expand its own budget.

## 1. Enforcement: specify the controlled resource

“Hard” means refusing authorization before consumption at a boundary we control. It does not mean undoing an operation, immediately terminating all remote computation, or controlling resources outside that boundary.

| Control | A — Hosted | B — SDK-observed | C — Durable control |
|---|---|---|---|
| Run admissions and concurrent execution | Hard at our queue/sandbox scheduler, with atomic admission and capacity reservations. | Hard only for our ingestion/API allowances. An over-quota customer process keeps running. | Hard for managed run admission and step leases. Cannot count or stop independent local runs. |
| Compute/time quota | Sandbox resource/time limits can terminate local execution; reserve capacity/time for strict cumulative ceilings. | Reported/advisory. | Hard for dispatched work/time authorizations; remote CPU use is reported and remote cancellation cooperative. Do not sell customer CPU metering as independently verified. |
| Token quota or dollar ceiling | Hard only through a mandatory, bounded model gateway path with bypass prevented. Killing a sandbox after a direct call does not recover its cost. | No in pure B. SDK checks can be removed and reports delayed or falsified. | No for direct-key calls. Hard for supported calls through the enforcement gateway, with atomic reservations and no bypass in the governed scope. |
| Approval gate | Hard before protected dispatch or through an enforced tool/model path; arbitrary code inside an unrestricted sandbox can skip SDK gates. | A request and recorded decision. The process may ignore it; approval is a suggestion. | Hard before issuing the next gated step. Hard protection of the actual side effect additionally requires a tool/resource gateway or customer IAM that honors the authorization. |
| Feature entitlement | Hard for our services and controlled runtime capabilities, not for arbitrary algorithms customers implement themselves. | Hard for our export, retention and API services; not for local delegation, tools, replay or scheduling. | Hard for managed delegation, dispatch, replay and service endpoints. Cannot prohibit equivalent features implemented inside an opaque customer step. |

A C worker holding unrestricted tool credentials can perform a disallowed effect before asking for its next step. Therefore “hard approval” must name its scope: **no gated managed step is dispatched before approval**. A stronger “this tool cannot be invoked before approval” claim requires credentials unavailable outside the protected tool path, or customer-enforced short-lived action capabilities. A lease alone is not that protection. Revocation blocks future authorizations; previously authorized in-flight effects may complete.

### S1 plan tiers and the current entitlement system

Map the requested S1 commercial tiers onto the repository's canonical Free/Pro/Team/Enterprise catalogue. The current implementation document is titled [Plans and entitlements (S3)](PLANS-AND-ENTITLEMENTS.md); [marketing plans](../apps/web/lib/marketing/plans.ts) mirror database entitlements. There is also a divergent older [pricing data file](../apps/web/lib/pricing-data.ts); do not introduce its Plus tier into this decision.

| Tier | Proposed execution packaging | Honest governance claim |
|---|---|---|
| Free — $0 | B by default; limited telemetry/history and local SDK policy checks. | Soft governance: visibility, alerts and submitted approval evidence. No enforced external execution limits. |
| Pro — current catalogue $49/month, one seat | C for individual production use; B remains selectable. Optional LLM gateway. | Enforced managed admission and approval boundaries. Direct-key spending remains advisory; gateway use alone does not imply the full hard-governance contract. |
| Team — current catalogue $99/seat/month | C plus the hard-governance package: shared reservations, policy administration and enforced resource paths. | Hard ceilings only for supported, exclusively routed resources. Gateway participation is required for the spend guarantee. |
| Enterprise — custom | C, customer AI-gateway integration, private connectivity/region agreements and customer-held payload options. | Same technical enforcement conditions as Team, with negotiated operating commitments; a contract does not make telemetry authoritative. |

These dollar figures describe the checked-in catalogue, not validated future prices or a promise to include model spend. Keep account-wide seats and shared monthly quotas; resolve entitlements from the workspace's billing account, never the requesting user's plan. Price additional managed execution/gateway volume with published included allowances and a separately metered overage or prepaid ceiling. Hard governance costs more because it adds a critical-path service and operational obligation, not because its warning banner is different.

Free currently has no general API keys/API access entitlement. B onboarding therefore needs a narrowly scoped telemetry credential and explicit ingestion allowance, not a silent grant of the paid API. Existing Free quotas must describe captured/observed usage, not falsely imply we stop their agent. No catalogue changes are made here.

Current plan quotas use admission-only grace, cached usage comparisons, terminal usage reporting and reconciliation; `ENTITLEMENTS_ENFORCED` defaults to false. This is not a strict aggregate in-flight spend ceiling. Preserve the existing commercial grace policy unless explicitly changed, but add a separate strict policy for governed resources: atomically reserve against account, workspace and run limits before dispatch/call, including all concurrent branches. Strict budgets take precedence over admission grace; no support grace silently bypasses a customer's explicit ceiling. Entitlement changes require a policy version/invalidation boundary for strict decisions, not a stale cached approval. Refuse subsequent work on downgrade; do not claim retroactive cancellation.

## 2. The model proxy decision

**Offer an optional LLM gateway for ordinary C. Require an enforcement gateway for the Team/Enterprise hard-spend guarantee.** The gateway can be ours or a supported customer-controlled enterprise AI gateway. Pure B remains observation; adding an enforced gateway makes model spending governed through that component, without making the rest of the process durable or controlled.

When code calls Anthropic or OpenAI directly using its own key, we know only what it reports. Even perfectly implemented reporting arrives after spending. Token budgets are advisory forever for that path. A provider billing export can reconcile costs later but cannot authorize calls in advance. Display coverage per run: managed steps, gateway-covered calls and unverified direct usage. Do not label a mixed-routing workspace “all spend hard-capped.”

The enforceable request path must:

1. Authenticate the workspace, run, step, attempt and current authorization. Check model/provider entitlement and applicable approval before forwarding.
2. Atomically reserve a conservative upper bound against every relevant token and dollar pool. Include input, maximum output, billable reasoning/media/tool charges where applicable, and versioned pricing. Disable unsupported/unbounded billing modes in strict mode; an estimate is not a guarantee.
3. Bound the provider request to the reservation and settle from authoritative usage. Keep uncertain calls reserved until reconciled. Every retry/fallback requires its own covered reservation; do not blindly retry after an ambiguous provider acknowledgement.
4. Fail closed when policy, ledger or gateway is unavailable. Never silently fall back to a direct key. Stop new requests when capacity is exhausted; cutting a stream is not proof that upstream billing stopped.

The guarantee covers supported request charges under the recorded price schedule, excluding taxes, unrelated provider services and off-path calls. If a provider violates a documented bound, stop further dispatch, reconcile and apply the agreed commercial remedy; do not claim perfect control over a third-party invoice. Strict accounts cannot borrow the same unspent balance simultaneously across workers or gateway regions.

For C, customers must enforce routing with their network/IAM configuration: provider credentials held by the gateway, direct provider egress denied for governed workers, and no alternate spend credentials. We cannot impose those controls on their infrastructure ourselves. An enterprise gateway qualifies only if it supports authoritative authorization/reservation, identity propagation, bounded requests and usage reconciliation. Signed receipts alone prove who reported usage, not that bypass was impossible. If it cannot meet the contract, downgrade the spend claim to advisory.

Being a gateway and being a client of an enterprise gateway share a model-request envelope, provider adapters, streaming transport, authentication, cancellation, normalized usage, reservation identity and audit receipts. Reuse that transport/policy seam in both directions. They do not have identical trust: forwarding to a customer gateway requires its enforcement contract; being the gateway makes us responsible for that contract. Configure private upstream routes with destination allowlists and tenant-scoped credentials to avoid turning the proxy into cross-tenant access or SSRF.

Gateway latency is approximately the difference between the routed and direct network paths, plus policy/ledger work. As planning scenarios, allow 5–25 ms extra for colocated routing and 50–200 ms for a cross-region detour, then measure p50/p95 under streaming and fan-out. Stream immediately after authorization; do not buffer the whole completion. Provider time-to-first-token remains separate. A hard guarantee cannot use an asynchronous ledger to hide this cost.

Operating the gateway puts prompts, completions and potentially keys in our transient data path even when storage is disabled. It increases exposure to sensitive-data incidents, availability failures, incorrect budget decisions, provider abuse and disputed charges. Launch with customer-billed provider credentials where possible; reselling with our own provider account adds credit/fraud exposure and should be a separate later decision. Credential isolation, regional processing commitments, provider terms, incident response and explicit limits of the spending promise are launch requirements, not a claim of legal immunity. Enterprises that prohibit payload transit use an approved gateway in their boundary; we receive only policy metadata and receipts.

## 3. Durability and the hour-long outage

In B, process death loses unflushed telemetry and in-memory agent state. Mark a missing-heartbeat run unknown/interrupted, not successfully completed or definitively failed. We can alert but cannot resume it. Recovery comes from the customer's supervisor and LangGraph checkpoint store; an SDK trace is not a restorable continuation. Retrying the entire invocation may duplicate effects. Bill our accepted telemetry/storage only; any customer/provider costs remain theirs.

In C, commit each completed boundary before authorizing dependent work. Store code/graph version, checkpoint identity, branch decisions, attempt identity and policy version. Pin continuation to a compatible worker version; unavailable old versions park until restored or explicitly migrated. Use customer-accessible durable checkpoint storage when payloads stay outside our boundary.

Proposed default outage policy:

| Event | Run behavior | Billing |
|---|---|---|
| No eligible workers before dispatch | Park as waiting for worker; alert after 5 minutes. | Admission counts once. No agent execution minutes, step attempts or gateway charges for polls/waiting. |
| Worker disappears mid-step | Expire heartbeat/lease; fence its reports, preserve uncertain spend reservations, and reconcile the effect before retrying. | Record actual covered consumption; avoid billing duplicate delivery as a new logical run. |
| Fleet absent for an hour | Run remains parked and resumes on compatible worker return if its deadline permits. Do not burn retries because nobody polled. | No execution charge for that hour. Subscription and contracted durable-storage allowance still apply; customer compute bills remain external. |
| Worker-wait exceeds default 24-hour deadline | Timeout with an explicit worker-unavailable reason; retain resumable evidence according to policy. | No idle execution charge. An explicit resume retains the original logical admission identity. |
| Approval or durable timer wait | Release execution capacity; apply a separate explicit approval/timer deadline. | No agent minutes while parked. |

The 5-minute alert and 24-hour worker-wait deadline are proposed defaults, not existing settings. Customers may choose longer finite deadlines. Indefinite waits require an explicit retention/storage agreement and pending-run cap; they are not the default. Preserve recovery state for the live run's agreed lifetime even if the Debug payload retention window is shorter. Absolute business deadlines can expire during any wait and must be visible at admission. Paused runs consume pending-state capacity, not active-worker concurrency.

A crash after an external effect succeeds but before its result commits remains ambiguous. Delivery is at least once; use stable idempotency keys honored by the destination or reconcile by an external operation ID. For non-idempotent effects without reconciliation, park for operator decision instead of automatically repeating them. Lease/CAS/activation idempotency protect state, not exactly-once real-world effects. Temporal's [activity execution](https://docs.temporal.io/activity-execution) and [failure detection](https://docs.temporal.io/encyclopedia/detecting-activity-failures) documentation provide the relevant model of durable scheduling, retries and distinct timeout scopes; adopting this shape does not imply Temporal feature parity or require replacing the existing runtime with Temporal.

The control plane itself needs durable storage, backup/restore, reconciliation and recovery objectives. During its outage, workers may finish only already-authorized bounded work; they cannot start unapproved next steps. A database outage must not turn into fail-open execution. Customer and control-plane outages are separate SLA events.

## 4. Workspace data boundary and Debug

Offer an explicit per-workspace storage policy, inherited by runs and snapshotted into their audit metadata. Default new external-worker workspaces to metadata-only. Enforce minimization at the SDK/worker before upload; server redaction is defense in depth, not a substitute for keeping data out of transit.

| Workspace choice | What we store | What Debug can do |
|---|---|---|
| Metadata only | Opaque run/step IDs, timing, status, policy decisions, safe error codes, reported usage and gateway receipts. No prompts, results, stack locals or raw exceptions. | Timeline, retries, waits, policy and cost coverage. Cannot inspect semantic failures or promise payload replay. |
| Redacted payloads | Customer-allowlisted fields after local redaction, with size caps and optional sampling. | Inspect retained fields; label omissions and sampling. Reproduction may be incomplete. |
| Full payloads, explicit opt-in | Prompts, model/tool results and selected errors, with encryption, access controls and audit of reads. | Rich Debug and recorded replay where inputs and required outputs exist; no guarantee of deterministic fresh model responses. |
| Customer-held payloads | Opaque, non-secret references to versioned objects/checkpoints in their storage; our metadata as above. | Authorized browser/local tooling retrieves payloads on demand from customer storage. Our backend must not silently fetch them. Unavailable/expired objects appear as unavailable. |

Use separate retention periods for runs, events, traces and payloads, bounded by plan entitlements and shortened at customer choice. Live recovery checkpoints need their own lifecycle. Define deletion including exports, caches and backup expiry; a policy change affects future ingestion and offers an explicit purge of prior retained data. Disable payload capture in logs, traces and gateway diagnostics when the workspace forbids it. URLs, model arguments, error text and low-entropy hashes can leak data too; prefer opaque references and sanitized summaries.

“Not stored” differs from “never reaches us.” Our gateway processes payloads transiently. A customer gateway plus customer-held checkpoints can preserve the stronger boundary. C still needs minimal control metadata, including branch outcomes, to schedule the graph; keeping the whole branch interpreter opaque trades away internal control. Approval reviewers may inspect action details inside the customer environment and approve a digest bound to the immutable action. We can enforce that approval identity without seeing the payload, but cannot independently evaluate content policies against hidden content.

## 5. Step latency and useful batching

For a serial graph, approximate added C overhead as N × (R + D + Q), where N is remote boundaries, R is worker/control-plane RTT, D is durable commit and policy time, and Q is dispatch delay. This assumes a completion report can return the next authorized step. Separate report and claim calls can approach 2N RTTs, plus initial admission and final acknowledgement. Long polling avoids fixed poll-interval delays; a one-second periodic poll adds about 0.5 seconds per boundary on average, or 10 seconds over 20 steps.

Illustrative 20-node graph, D = 5 ms and Q = 0; these are scenarios, not measurements:

| RTT | Added RTT time | Added time including commits | Relative to 20 × 1-second nodes | Relative to 20 × 5-ms nodes |
|---|---|---|---|---|
| 5 ms | 100 ms | 200 ms | 1% | 200% |
| 25 ms | 500 ms | 600 ms | 3% | 600% |
| 75 ms | 1.5 s | 1.6 s | 8% | 1,600% |
| 150 ms | 3.0 s | 3.1 s | 15.5% | 3,100% |

Gateway detours are additional per model request; they are not included above. Queue contention, checkpoint upload size and retries can dominate tail latency. Parallel graphs pay synchronization along the critical path, although total request/storage load still scales with all boundaries. Benchmark p50/p95/p99 by worker region and payload size before making latency claims.

Batch consecutive cheap, deterministic, side-effect-free transformations into one bounded local segment. Twenty transforms grouped into four segments at 75 ms RTT and 5 ms commit cost add about 320 ms instead of 1.6 seconds. Commit only at segment boundaries; a crash re-executes the entire segment, and intermediate telemetry is diagnostic rather than authoritative. Limit segment execution time, memory and node count so cancellation and policy refresh have bounded delay.

Never batch across approval gates, paid model calls, external side effects, entitlement-sensitive delegation or newly determined budget allocations. A short-lived preauthorized segment capability may reserve a bounded allowance, but cannot authorize unknown downstream effects. Disconnected execution beyond that capability is B semantics. Local fast paths cannot preserve per-node hard guarantees while skipping every authority check. Colocate the control plane/gateway with worker regions where practical; use the monolithic-step option only with visibly coarser recovery and governance.

## A: security, economics and blast radius

Hosted execution makes customer code and dependency installers adversarial inputs. The build plane is part of the attack surface: install hooks can execute before a run ever starts. Use separate unprivileged build sandboxes, no production secrets, digest-pinned base images and lockfiles, artifact provenance/SBOMs, dependency scanning, admission policy and controlled rebuilds. Scanning cannot establish that a dependency is safe. Resolve dependencies per immutable deployment, not in a shared mutable environment or during every invocation. Native libraries, Python versions, CUDA/system packages and private indexes create compatibility and support work; initially support one pinned Python/LangGraph profile.

Runtime isolation needs a maintained sandbox boundary stronger than ordinary shared-process execution, tenant-scoped short-lived secrets, blocked cloud metadata/control-plane access, default-deny network policy and separate administrative credentials. Bound CPU, memory, processes, disk, network, concurrency and run duration. Fair queues and tenant capacity pools limit noisy neighbors, but shared kernel, host I/O, registry and networking remain operational concerns. Dedicated tenant pools reduce shared exposure at higher cost. Modal's [sandbox security documentation](https://modal.com/docs/guide/sandbox-networking) describes gVisor isolation and network controls, illustrating a category of infrastructure to buy rather than casually recreate.

Cold start includes scheduling, image pull, interpreter/import initialization and customer initialization. Planning scenarios are hundreds of milliseconds to seconds for cached small images, and tens of seconds or minutes for large/native dependency images or builds; validate on representative workloads. Prebuilding and warm pools reduce delay but add idle cost. Suspension during approval waits requires a real checkpoint; retaining a sleeping process continues to occupy paid capacity. Sandbox restart alone is not durable agent recovery.

If a customer dependency is compromised, the expected first blast radius is that deployment: accessible prompts/results, injected credentials, reachable customer systems and spending within its permissions. If the dependency is shared across customers, many isolated tenants can be compromised independently without any sandbox escape. A build-cache poisoning or image-signing compromise spreads through deployments; a sandbox escape, overprivileged shared credential or control-plane vulnerability can cross tenant boundaries. Our availability, reputation and incident-response burden are implicated even when containment works. Kill/quarantine deployments, revoke credentials, block affected artifact digests, preserve evidence and rebuild cleanly; none of this reverses exfiltration or completed tool actions.

### Planning estimates, not vendor quotes or commitments

Assume fully loaded engineering cost of $20k–$30k per engineer-month. Ranges include engineering and operational hardening but exclude sales, financing, taxes, customer compute and provider token charges. These are decision estimates with substantial uncertainty, not a detailed staffing plan.

| Scope from today's base | Build effort and labor estimate | Ongoing staffing |
|---|---|---|
| B production observation SDK | 2 engineers × 2–3 months: $80k–$180k | 0.5–1 engineering/SRE equivalent, about $10k–$30k/month |
| C production client-worker product | 4–6 engineers × 4–6 months: $320k–$1.08m | 2–3 engineering/SRE equivalents, about $40k–$90k/month |
| Governed gateway addition to C | 2–3 engineers × 3–4 months: $120k–$360k | 1–2 security/SRE/backend equivalents, about $20k–$60k/month; some staffing can overlap C |
| Narrow vendor-backed A addition | 2–3 engineers × 3–4 months: $120k–$360k | 1–2 additional equivalents plus vendor charges and security review |
| Broad self-operated A platform | 6–10 engineers × 9–12 months: $1.08m–$3.6m | 3–5 platform/security/SRE equivalents, about $60k–$150k/month |

At a pilot workload of 100k runs/month, 20 steps/run and metadata-only capture, budget roughly $1k–$4k/month infrastructure for B and $3k–$10k/month for C's managed database, queues, API, backups and monitoring. Allow another $1k–$5k/month for a modest gateway footprint excluding provider spend. These are assumed capacity envelopes to validate with load tests, not per-run measured costs. For example, 2m steps at 2 KiB metadata each are about 4 GiB raw; at 50 KiB payload each they become about 100 GiB before indexes, replicas, backups and retention. Payload policy materially changes margins.

For a hosted compute comparison, assume those 100k runs each keep one 2-GiB sandbox active for 60 seconds: 6m active seconds. Modal's published sandbox rates are $0.00003942 per physical core-second and $0.00000667 per GiB-second. At one fully billed physical core per sandbox, compute is 6m × ($0.00003942 + 2 × $0.00000667), approximately **$317/month**. Ten times the duration makes it approximately $3,166. This is only a resource example, excluding builds, warm capacity, plan fees, storage, networking and our control plane. [Modal pricing](https://modal.com/pricing), accessed 2026-09-07.

For orientation, at the published Lambda first-tier x86 duration rate of $0.0000166667/GB-second and $0.20/million requests, the same nominal 12m GB-seconds cost about **$200 plus $0.02 requests**, before free allowances and extras. CPU allocation, invocation restrictions and billing behavior differ, so this is not a performance-equivalent bid. [AWS Lambda pricing](https://aws.amazon.com/lambda/pricing/), accessed 2026-09-07.

The decisive A cost is not a few hundred dollars of pilot compute. It is secure builds, patching, abuse handling, incident response, dependency support and operating a second infrastructure product. At this scale, reserve an additional $2k–$8k/month non-labor allowance for vendor-backed build/registry/security/warm-capacity overhead; a self-operated small fleet could require $10k–$30k/month before workload growth, depending heavily on isolation and redundancy. External security assessments need a separate quote. A broadly marketed A is substantially Modal/Lambda plus an agent control layer; our differentiated work is the control layer.

## Shipping decision and what could overturn it

Ship B as a low-friction acquisition path through first-class OTel ingestion and one deep LangGraph/Python adapter, with accurate “reported usage” and “policy advisory” language. Bring narrow gateway enforcement into the same initial vertical slice instead of waiting for a broad adapter catalogue. B stays available on paid plans for teams that deliberately want observation. It does not become hard governance because the customer pays more.

Make C the product investment: one supported LangGraph adapter, outbound worker protocol, durable state/attempt semantics, customer-held checkpoint option and clear waiting behavior. Prove Python-to-Spring-AI collaboration through the same activation engine before expanding frameworks. The native platform remains another first-class executor of that engine. Add the governed gateway before selling hard token/dollar ceilings; whole-invocation control does not depend on universal fine-grained continuation. Price enforcement separately from observation, and make resource coverage visible. Validate with duplicate completions, expired workers, an hour-long fleet outage, simultaneous budget reservations, uncertain provider responses, policy changes, forbidden egress and payload capture disabled. These are future release acceptance criteria; this documentation task does not implement or run them.

Defer A until demand demonstrates that provisioning a worker is blocking adoption. Then ship a paid “managed worker” executor for the same C state machine through an established sandbox provider: pinned supported dependencies, finite resources, controlled networking, no privileged containers or arbitrary GPUs/native environments at launch. Charge compute/build usage separately and release capacity during durable waits. Do not ship broad self-operated arbitrary hosting under this decision; revisit only as an explicit infrastructure strategy with matching funding and security ownership.

C loses if representative buyers only need post-hoc tracing and refuse the worker/graph contract; then B should be the primary product and governance claims must shrink. It also loses for predominantly sub-second graphs whose unavoidable remote boundaries break measured latency targets, or if existing Temporal users see no value in the agent-specific policy/gateway layer. Validate those cases with design partners before broad rollout. A becomes more attractive only if supported managed execution is the dominant purchase requirement and a vendor-backed service has credible margins; that does not justify building a sandbox platform from scratch.

The current evidence supports the user's prior, with two conditions: C offers hard control over authorized workflow progress, not arbitrary customer behavior; and hard model spending requires an exclusive, bounded gateway path. Those conditions belong in the product contract, pricing matrix and Debug UI, not only in architecture documentation.
