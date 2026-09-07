/**
 * The claim register.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * THE RULE THAT DECIDES EVERY ROW
 * ══════════════════════════════════════════════════════════════════════════════
 * A FEATURE BEHIND A DEFAULT-OFF FLAG IS NOT SHIPPED.
 *
 * It may be built, tested, documented and merged. If the executor reads an
 * environment variable that defaults to false, a customer on a default
 * deployment cannot use it, and a sentence on the marketing site that says they
 * can is false. The same is true one level up for plans: a capability only some
 * plans include is not "in the product" for the reader of an unqualified
 * sentence.
 *
 * Both are still worth describing — a hidden feature is indistinguishable from a
 * feature we do not have, and nobody buys what they cannot see. What is not
 * acceptable is describing them WITHOUT the qualification.
 *
 * ── WHY RELIABILITY CLAIMS ARE THE WORST ONES TO GET WRONG ──────────────────
 * Uptime, SLA and certification claims are the first things a serious buyer
 * verifies, and the first one they find to be untrue is the last claim of ours
 * they believe. Everything else on the site is then re-read as marketing. So the
 * register treats them as a category of their own, and the guard test refuses
 * them outright rather than asking for a qualification.
 *
 * ── HOW THIS IS ENFORCED ────────────────────────────────────────────────────
 * `__tests__/marketing-claims.test.ts` reads the marketing sources and:
 *   · refuses a forbidden pattern anywhere it is not being explicitly denied;
 *   · requires each gated capability's qualifier to be present on every page
 *     that mentions the capability at all.
 *
 * A register without a test is a document that goes stale in a fortnight.
 */

export type Verdict =
  /** Shipped, on by default, on every plan. Needs no qualification. */
  | "true"
  /** Built and merged, but behind a runtime flag that defaults to off. */
  | "true-behind-a-flag"
  /** Shipped, but only on some plans. */
  | "true-on-some-plans"
  /** True in a narrower sense than the wording implies. */
  | "partially-true"
  /** Not true. Removed from the site. */
  | "false";

export interface Claim {
  id: string;
  /** What the site says, or said. */
  claim: string;
  verdict: Verdict;
  /** The file that settles it. A verdict without one is an opinion. */
  evidence: string;
  /** What was done about it, for anything not `true`. */
  action?: string;
}

/**
 * Capabilities whose mention on a page obliges that page to qualify it.
 *
 * `mentions` are the words that count as raising the subject; `qualifier` is a
 * substring the page must then also contain. Deliberately a substring and not a
 * regex: a qualification that has been reworded until it no longer says the
 * thing is a qualification that has stopped working, and the test should notice.
 */
export interface GatedCapability {
  id: string;
  mentions: RegExp;
  qualifier: string;
  why: string;
}

export const GATED_CAPABILITIES: GatedCapability[] = [
  {
    id: "replay",
    /*
     * ── THE WORD USED AS A CAPABILITY, NOT THE WORD ────────────────────────
     *
     * A bare /replay/ was the first version and it was wrong in both
     * directions. It matched "session-replay" — a category of third-party tool
     * we do NOT use, in a sentence saying so — and it matched the ordinary verb
     * in "the run resumes at step 7; it does not replay the six steps that
     * already worked" and "0 nodes replayed", which describe RESUME and are
     * true on every plan. Demanding a plan qualification beside those would be
     * a false correction, and a guard that cries wolf is one somebody switches
     * off.
     *
     * So this matches replay used as a thing the customer GETS: replayable,
     * run replay, replaying a run, replaying it, or the word standing alone
     * inside a <Term>. "replay the failure" (an animation control) and "not
     * replay the steps" (resume, negated) are deliberately outside it.
     */
    mentions: /\breplayable\b|\brun replay\b|\breplay (?:a|any|the|one|every)\s+runs?\b|\breplay (?:it|them)\b|>replay</i,
    qualifier: "Pro and above",
    why:
      "`RunRoutes.replayRun` calls `requireFeature(REPLAY)`, and `replay` is false on the free "
      + "plan in V060. The homepage's own CTA sells Free.",
  },
  {
    id: "agent-teams",
    mentions: /\bagent teams?\b/i,
    qualifier: "off by default",
    why:
      "`AgentTeamNodeExecutor` reads AGENT_TEAMS_ENABLED, which defaults to false, and fails the "
      + "node with a sentence saying teams are switched off. The `teams` entitlement is also false "
      + "on Free and Pro.",
  },
  {
    id: "otel-export",
    mentions: /\bopentelemetry\b/i,
    qualifier: "off by default",
    why:
      "`RunTraceExporter` is gated on OTEL_TRACE_EXPORT_ENABLED, default false, and `otel_export` "
      + "is false on Free and Pro.",
  },
];

/**
 * Patterns that may not appear on the marketing site unless they are being
 * denied in the same breath.
 *
 * The guard reads a window around each match and requires a denial in it. That
 * is why the pricing page and the legal set can say "we hold no SOC 2
 * certification" while nothing can say "SOC 2 compliant".
 */
export const FORBIDDEN_PATTERNS: { id: string; pattern: RegExp; why: string }[] = [
  {
    id: "uptime-figure",
    pattern: /\b9\d(?:\.\d+)?%\s*(?:uptime|availability)|\buptime\s+of\s+9\d/i,
    why: "There is no uptime measurement and no status page. A percentage would be invented.",
  },
  {
    id: "sla",
    pattern: /\b(?:service level agreement|SLA)\b/i,
    why: "No SLA exists. The word may only appear where it is being denied.",
  },
  {
    id: "soc2",
    pattern: /\bSOC\s?2\b/i,
    why: "No SOC 2 audit has been performed.",
  },
  {
    id: "iso27001",
    pattern: /\bISO\s?27001\b/i,
    why: "No ISO 27001 certification exists.",
  },
  {
    id: "hipaa",
    pattern: /\bHIPAA\b/i,
    why: "No BAA is offered and the service is not designed for PHI.",
  },
  {
    id: "pci",
    pattern: /\bPCI[-\s]?DSS\b/i,
    why: "No PCI-DSS attestation exists.",
  },
  {
    id: "audited",
    pattern: /\b(?:independently|third[-\s]party)\s+audited\b/i,
    why: "No third-party security audit has been performed.",
  },
  {
    id: "guarantee",
    pattern: /\bwe guarantee\b|\bguaranteed\s+(?:uptime|delivery|availability)\b/i,
    why: "Nothing here is contractually guaranteed. The Terms disclaim it explicitly.",
  },
];

/** Words that count as denying a forbidden pattern in the same sentence. */
export const DENIAL_MARKERS = [
  "no ", "not ", "none", "never", "hold no", "offer no", "there is no",
  "we do not", "do not claim", "has been performed", "cannot satisfy",
  "is not yet", "answer today is no", "session-replay",
];

/**
 * The register. Ordered by how much a wrong answer would cost a buyer.
 */
export const CLAIMS: Claim[] = [
  /* ── Reliability and durability ─────────────────────────────────────────── */
  {
    id: "checkpoint-every-node",
    claim: "Every node checkpoints as it runs.",
    verdict: "true",
    evidence:
      "WorkflowRuntime.writeCheckpoint is called after each completed node when "
      + "`node.checkpointPolicy.enabled`, and CheckpointPolicy defaults to enabled=true. A "
      + "checkpoint is additionally written unconditionally on a yield and before an approval park.",
  },
  {
    id: "resume-not-restart",
    claim: "A failed step resumes from the last checkpoint rather than restarting the run.",
    verdict: "true",
    evidence:
      "RunProcessor loads `checkpointStore.loadLatest` on a RESUME_RUN; the resume reconciler is "
      + "on by default (RESUME_RECONCILER_ENABLED defaults to true unless explicitly \"false\").",
  },
  {
    id: "approval-does-not-pin-a-worker",
    claim: "An approval gate suspends the run without keeping a worker alive.",
    verdict: "true",
    evidence:
      "WorkflowRuntime writes a checkpoint before parking on an approval and returns; the run is "
      + "re-enqueued on the decision. Team wall-clock limits explicitly exclude parked time.",
  },
  {
    id: "event-history-immutable",
    claim: "Every tool call, model response, retry and approval is recorded as an immutable event.",
    verdict: "true",
    evidence: "RunEventStore appends with an assigned sequence; nothing rewrites a row.",
  },
  {
    id: "zero-events-lost",
    claim: "0 lost events.",
    verdict: "false",
    evidence:
      "RunEventStore applies back-pressure rather than dropping — but the block is bounded by "
      + "AGENT_EVENT_BACKPRESSURE_TIMEOUT_MS, past which it drops loudly and counts the drop. The "
      + "runtime deliberately does not make this guarantee.",
    action: "Replaced with “append-only” on the homepage bento card.",
  },
  {
    id: "uptime",
    claim: "(none made)",
    verdict: "true",
    evidence:
      "No uptime or availability figure appears anywhere on the site, and none should: there is no "
      + "status page and no measurement. The Terms and the pricing page state the absence.",
  },

  /* ── Observability and debugging ────────────────────────────────────────── */
  {
    id: "run-timeline",
    claim: "A run timeline with every node, tool call and model request, inputs and outputs.",
    verdict: "true",
    evidence: "DebugRoutes serves per-node inputs and outputs; the Debug tab renders them.",
  },
  {
    id: "tokens-and-cost",
    claim: "Live tokens and cost per run.",
    verdict: "partially-true",
    evidence:
      "Tokens are counted. The cost figure is derived from a model-price table and "
      + "docs/COST-ATTRIBUTION-FINDINGS.md records it as wrong by between 1.8x and 29x depending "
      + "on the model string — which is why V062 caps members in TOKENS rather than in cents.",
    action:
      "Token claims stand. No cost-accuracy claim is made anywhere, and the per-member cap on the "
      + "pricing page is stated in tokens, as the platform enforces it.",
  },
  {
    id: "replay",
    claim: "Replay any run.",
    verdict: "true-on-some-plans",
    evidence: "RunRoutes.replayRun requires the REPLAY entitlement; false on `free` in V060.",
    action:
      "Reworded to “Replay a run — Pro and up” on the homepage; every page that mentions replay "
      + "carries an availability strip naming the plan.",
  },
  {
    id: "root-cause",
    claim: "Root-cause attribution on a failed run.",
    verdict: "true",
    evidence: "run_failure_class (V053) plus the Debug tab's root-cause banner.",
  },

  /* ── Multi-agent ────────────────────────────────────────────────────────── */
  {
    id: "multi-agent-steps",
    claim: "Multi-step, multi-agent workflows.",
    verdict: "true",
    evidence:
      "Several `agent` nodes in one graph run today, sequentially or in parallel, each with its "
      + "own model, tool grants and budget.",
  },
  {
    id: "agent-teams",
    claim: "Teams of agents that delegate to each other.",
    verdict: "true-behind-a-flag",
    evidence:
      "AgentTeamNodeExecutor reads AGENT_TEAMS_ENABLED (default false) and fails the node with "
      + "“teams are switched off here”. AGENT_ACTIVATIONS_ENABLED is also default false.",
    action:
      "Named explicitly on the orchestration page and in the availability strips, and marked on "
      + "the pricing matrix with the environment variable.",
  },
  {
    id: "delegation-guards",
    claim: "Delegation with a roster grant, a depth limit and a cost ceiling.",
    verdict: "true-behind-a-flag",
    evidence:
      "AgentSafetyGuard enforces the roster; TeamLimits bounds depth, activations, repeated "
      + "handoffs and wall clock; BudgetVector bounds spend and a child is never allocated more "
      + "than its parent's remainder.",
    action: "Same flag qualification as agent teams.",
  },

  /* ── Integrations and models ────────────────────────────────────────────── */
  {
    id: "byok",
    claim: "Bring your own OpenAI, Anthropic or Gemini keys.",
    verdict: "true",
    evidence:
      "LlmNodeExecutor targets api.openai.com, api.anthropic.com and "
      + "generativelanguage.googleapis.com, with a per-connection baseUrl override.",
  },
  {
    id: "integration-logos",
    claim: "(none made)",
    verdict: "true",
    evidence:
      "The site shows no third-party integration logos. Nothing claims a partnership or a "
      + "pre-built connector that does not exist; tools are HTTP, database and MCP, described as "
      + "such.",
  },
  {
    id: "http-callable-agents",
    claim: "Orchestrates HTTP-callable agents, including LangGraph or CrewAI ones.",
    verdict: "true",
    evidence: "An `http` tool or an external agent step calls any HTTP endpoint.",
  },

  /* ── Failure analysis ───────────────────────────────────────────────────── */
  {
    id: "failure-clustering",
    claim: "Failure clustering by signature — yes, on the homepage comparison table.",
    verdict: "partially-true",
    evidence:
      "Incidents carry a signature and the screen groups on it, but the server-side GROUP BY does "
      + "not exist (GAP-04) and the clustering band is behind `failureClustering`, default off. "
      + "Grouping client-side over a capped page silently UNDER-COUNTS, which is the one thing a "
      + "cluster count must not do.",
    action:
      "The comparison cell was changed from “yes” to “partial”, with a note naming which half is "
      + "missing.",
  },

  /* ── Security ───────────────────────────────────────────────────────────── */
  {
    id: "encrypted-at-rest",
    claim: "Keys and secrets encrypted at rest.",
    verdict: "true",
    evidence:
      "EncryptedSecretService uses AES-256-GCM with the workspace id as additional authenticated "
      + "data, so a ciphertext moved between tenants fails to decrypt.",
  },
  {
    id: "tls-and-payload-encryption",
    claim: "TLS 1.3 on every hop. Run payloads, node inputs and outputs are encrypted at rest.",
    verdict: "false",
    evidence:
      "Neither half is ours to assert. The TLS version is negotiated per hop with providers we do "
      + "not control, and nothing in our code encrypts a run payload — it sits in managed Postgres, "
      + "whose disk encryption belongs to the provider. Both are close enough to true to be "
      + "tempting and specific enough to be checkable.",
    action:
      "Replaced on the live landing page with “TLS on every hop” plus what actually happens to a "
      + "payload: managed Postgres with the provider's disk encryption, deleted at the retention "
      + "window.",
  },
  {
    id: "private-runners",
    claim: "Run workers inside your VPC so payloads never leave your network.",
    verdict: "false",
    evidence:
      "No private runner exists. There is no runner artifact, no deployment path and no "
      + "documentation — only `SsrfGuard.privateRunnerMode`, a switch the API would need if one "
      + "did. A deployment model is the first thing a security reviewer checks.",
    action:
      "The card was removed from the live landing page and replaced with cross-workspace "
      + "isolation, which is implemented and is the question every multi-tenant buyer asks. The "
      + "same sentence was removed from the hero and from the signed-in auth shell.",
  },
  {
    id: "soc2-in-progress",
    claim: "SOC 2 is in progress; we will say so here when it is done and not before.",
    verdict: "false",
    evidence:
      "No audit has been commissioned, no auditor engaged and no readiness work started. Nothing "
      + "in the repository or the docs refers to one. “In progress” was aspiration written in the "
      + "present tense.",
    action:
      "Removed. The live landing page now states that no certification is held and no third-party "
      + "audit has been performed, and says so before a procurement review does.",
  },
  {
    id: "compliance",
    claim: "(none made, after the removal above)",
    verdict: "true",
    evidence:
      "No SOC 2, ISO 27001, HIPAA or PCI claim now appears. The Terms, the Privacy Policy, the DPA "
      + "and the pricing page each state the absence rather than leaving it to be inferred, and "
      + "`marketing-claims.test.ts` refuses the words un-denied.",
  },

  /* ── Performance ────────────────────────────────────────────────────────── */
  {
    id: "latency-figure",
    claim: "fetch-renewals ok 284ms",
    verdict: "false",
    evidence: "No benchmark has been run. 284ms was an illustration read as a measurement.",
    action: "The number was removed from the homepage console mock.",
  },

  /* ── Pricing ────────────────────────────────────────────────────────────── */
  {
    id: "pricing-matches-plans",
    claim: "The published limits are the limits the platform enforces.",
    verdict: "true",
    evidence:
      "`lib/marketing/plans.ts` is compared against V060/V061/V062 by "
      + "`__tests__/pricing-consistency.test.ts`, which fails the build on any drift.",
  },
];

export function claimsByVerdict(verdict: Verdict): Claim[] {
  return CLAIMS.filter((c) => c.verdict === verdict);
}
