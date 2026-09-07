/**
 * The subprocessor list.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * EVERY ENTRY IS A THIRD PARTY THIS CODEBASE ACTUALLY SENDS DATA TO.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * A subprocessor list is not marketing copy. It is a representation about where
 * a customer's data goes, it is the thing a DPA incorporates by reference, and
 * in the EU it is the basis on which a controller decides whether they may use
 * this product at all. An omission is not an oversight; it is a false statement
 * in a contract.
 *
 * So each row carries the evidence: the file that makes the call. If a row has
 * no `evidence`, it does not belong here — and if code starts calling something
 * that has no row, this list is wrong and the DPA is wrong with it.
 *
 * ── THE MODEL PROVIDERS ARE SUBPROCESSORS, AND ARE NAMED ────────────────────
 * This is the one that gets left off. A platform that runs an agent sends the
 * customer's prompt — which contains whatever the customer put in it — to a
 * model provider, and that provider is processing personal data on their behalf.
 * Calling it "your own API key, your own relationship" is a real distinction and
 * is not a reason to leave it out: the request is made BY US, from our
 * infrastructure, under our TLS session. It is named.
 *
 * ── BRING-YOUR-OWN-KEY CHANGES THE CATEGORY, NOT THE DISCLOSURE ─────────────
 * When a customer supplies their own provider key, they are the account holder
 * with that provider and their agreement governs retention and training. That
 * is worth saying — it materially changes what the provider may do — and it is
 * said in the `note`, next to the name, rather than instead of it.
 */

export type SubprocessorCategory =
  | "infrastructure" | "model-provider" | "communications" | "observability";

export interface Subprocessor {
  name: string;
  /** What it does for us, in one clause. */
  purpose: string;
  /** What actually leaves our systems. Not "data" — the specific data. */
  dataProcessed: string;
  category: SubprocessorCategory;
  /** Where the processing happens, as far as we control it. */
  location: string;
  /** The file that makes the call. A row without one is a row that is guessing. */
  evidence: string;
  /**
   * Set when the customer's own agreement with the provider governs, because
   * they supplied the credential.
   */
  note?: string;
  /**
   * Set when the integration exists but is not enabled by default — so the list
   * is accurate for a customer whose deployment has it switched off.
   */
  optional?: string;
}

export const CATEGORY_LABEL: Record<SubprocessorCategory, string> = {
  infrastructure: "Infrastructure",
  "model-provider": "Model providers",
  communications: "Communications",
  observability: "Observability",
};

export const SUBPROCESSORS: Subprocessor[] = [
  /* ── Infrastructure ─────────────────────────────────────────────────────── */
  {
    name: "Vercel Inc.",
    purpose: "Hosts the web application and its API routes.",
    dataProcessed:
      "Everything a signed-in user's browser sends and receives: account identifiers, workspace "
      + "contents, and request logs.",
    category: "infrastructure",
    location: "United States, with edge points of presence worldwide",
    evidence: "apps/web is deployed to Vercel; see ops/ and the deployment notes.",
  },
  {
    name: "Railway Corp.",
    purpose: "Runs the API and worker services.",
    dataProcessed:
      "Workflow definitions, run state, event payloads and connection secrets in encrypted form, "
      + "for as long as a request is being served.",
    category: "infrastructure",
    location: "United States",
    evidence: "apps/api-kotlin and apps/worker-kotlin are deployed to Railway.",
  },
  {
    name: "Neon Inc.",
    purpose: "Managed Postgres — the durable store for every run.",
    dataProcessed:
      "Workflows, versions, runs, events, spans, payloads, approvals, audit rows, and "
      + "AES-256-GCM ciphertext for connection secrets. This is the primary data store.",
    category: "infrastructure",
    location: "United States",
    evidence: "The Flyway migrations in apps/api-kotlin/src/main/resources/db/migration.",
  },
  {
    name: "Upstash Inc.",
    purpose: "Managed Redis — the run queue and the cache.",
    dataProcessed:
      "Queue messages naming a run, workspace and version. Cached API responses, which can "
      + "include workflow and run metadata. Short-lived.",
    category: "infrastructure",
    location: "United States",
    evidence: "The queue and cache clients in apps/api-kotlin and apps/worker-kotlin.",
  },
  {
    name: "Supabase Inc.",
    purpose: "Authentication — sign-in, sessions and password reset.",
    dataProcessed: "Email address, hashed credential, session tokens and sign-in metadata.",
    category: "infrastructure",
    location: "United States",
    evidence: "apps/web/src/lib/supabase and the auth routes.",
  },

  /* ── Model providers ────────────────────────────────────────────────────── */
  {
    name: "OpenAI, L.L.C.",
    purpose: "Executes model calls for agent and model-call steps.",
    dataProcessed:
      "The assembled prompt — which contains whatever the workflow put in it, including the "
      + "run's input — and the model's response.",
    category: "model-provider",
    location: "United States",
    evidence:
      "apps/worker-kotlin/.../runtime/executor/LlmNodeExecutor.kt (api.openai.com/v1/chat/completions).",
    note:
      "Reached with the API key you supply on a connection. Your agreement with OpenAI governs "
      + "retention and whether your data may be used for training; ours does not override it.",
  },
  {
    name: "Anthropic PBC",
    purpose: "Executes model calls for agent and model-call steps.",
    dataProcessed: "The assembled prompt and the model's response.",
    category: "model-provider",
    location: "United States",
    evidence: "apps/worker-kotlin/.../runtime/executor/LlmNodeExecutor.kt (api.anthropic.com/v1/messages).",
    note: "Reached with the API key you supply on a connection. Your agreement with Anthropic governs.",
  },
  {
    name: "Google LLC (Gemini API)",
    purpose: "Executes model calls for agent and model-call steps.",
    dataProcessed: "The assembled prompt and the model's response.",
    category: "model-provider",
    location: "United States",
    evidence:
      "apps/worker-kotlin/.../runtime/executor/LlmNodeExecutor.kt "
      + "(generativelanguage.googleapis.com).",
    note: "Reached with the API key you supply on a connection. Your agreement with Google governs.",
  },
  {
    name: "Mistral AI SAS",
    purpose: "Executes model calls where a Mistral connection is configured.",
    dataProcessed: "The assembled prompt and the model's response.",
    category: "model-provider",
    location: "France",
    evidence: "apps/api-kotlin/.../connector/LlmTester.kt (api.mistral.ai/v1).",
    note: "Reached with the API key you supply on a connection. Your agreement with Mistral governs.",
    optional: "Only when you create a Mistral connection.",
  },
  {
    name: "Any provider you point a custom connection at",
    purpose:
      "A model connection accepts a base URL, so a self-hosted or third-party OpenAI-compatible "
      + "endpoint can be used instead of the providers above.",
    dataProcessed: "The assembled prompt and the response, sent to the host you named.",
    category: "model-provider",
    location: "Wherever you point it",
    evidence: "The `baseUrl` override in LlmNodeExecutor.kt and LlmTester.kt.",
    note:
      "We cannot name this one for you, and we do not control it. It is listed so the list is "
      + "complete rather than convenient.",
  },

  /* ── Communications ─────────────────────────────────────────────────────── */
  {
    name: "Resend, Inc.",
    purpose:
      "Sends transactional email — sign-in, invitations, alerts, and the built-in email step in a "
      + "workflow.",
    dataProcessed:
      "Recipient address, subject and body. For a built-in email step, the body is whatever the "
      + "workflow put in it.",
    category: "communications",
    location: "United States",
    evidence: "apps/web/app/api/email/send and lib/server/email-templates.ts.",
  },

  /* ── Observability ──────────────────────────────────────────────────────── */
  {
    name: "Your OpenTelemetry collector",
    purpose: "Receives exported run spans, if you configure an export.",
    dataProcessed:
      "Span names, timings, statuses and attributes for runs. Not payload bodies.",
    category: "observability",
    location: "Wherever your collector runs",
    evidence: "apps/worker-kotlin/.../events/otel/RunTraceExporter.kt.",
    optional:
      "Off unless you configure an export AND the deployment has OTEL_TRACE_EXPORT_ENABLED set. "
      + "It is off by default.",
  },
];

/** The date this list was last verified against the code, not against a calendar. */
export const SUBPROCESSORS_REVIEWED = "2026-09-07";

export function byCategory(): { category: SubprocessorCategory; rows: Subprocessor[] }[] {
  const order: SubprocessorCategory[] = [
    "infrastructure", "model-provider", "communications", "observability",
  ];
  return order
    .map((category) => ({ category, rows: SUBPROCESSORS.filter((s) => s.category === category) }))
    .filter((group) => group.rows.length > 0);
}
