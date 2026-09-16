import type { contracts } from "@vectorbea/shared";

/* ══════════════════════════════════════════════════════════════════════════════
   AN INCIDENT, IN WORDS

   The list rendered `category · component · code`, which for most real failures
   was `UNKNOWN · n-new-agent-2 · UNKNOWN`: a classifier enum, a node id and the
   same enum again. This turns the record into a title, a kind, where it happened
   and what to do — from the classification when there is one, and from the
   stored failure message when the record predates a classifier that knew it.
══════════════════════════════════════════════════════════════════════════════ */

export interface IncidentWords {
  /** "Agent ran out of token budget". */
  title: string;
  /** "Limit reached". Short, for a column. */
  kind: string;
  /** The step or agent the failure happened in, when the record says. */
  where: string | null;
  /** One sentence on how to fix it. */
  fix: string;
  /** A stable key for grouping: the same problem in the same step. */
  groupKey: string;
}

type Known = { title: string; kind: string; fix: string };

const BY_CODE: Record<string, Known> = {
  AGENT_TOKEN_BUDGET_EXCEEDED: { title: "Agent ran out of token budget", kind: "Limit reached", fix: "Raise Total tokens under Step limits on this step, or give the agent less to read." },
  AGENT_TOOL_CALL_LIMIT: { title: "Agent reached its tool call limit", kind: "Limit reached", fix: "Raise Tool calls under Step limits on this step." },
  AGENT_ITERATION_LIMIT: { title: "Agent reached its step limit", kind: "Limit reached", fix: "Raise Max iterations on the agent, or narrow the task." },
  AGENT_COST_LIMIT: { title: "Agent reached its cost limit", kind: "Limit reached", fix: "Raise Cost under Step limits on this step." },
  AGENT_COULD_NOT_FINISH: { title: "Agent could not complete its task", kind: "Agent stopped", fix: "Open the run's Debug tab to see what the agent was given and why it stopped." },
  AGENT_TOOL_RESULT_TRUNCATED: { title: "Agent was shown only part of a tool result", kind: "Limit reached", fix: "The tool returned more text than one result may carry, so the agent stopped rather than guess. Fetch a smaller slice in the step, or raise AGENT_TOOL_RESULT_MAX_CHARS on the worker." },
  TOOL_INPUT_MISSING: { title: "A tool ran without a required value", kind: "Missing input", fix: "Check the step's Inputs: the value it maps from was empty." },
  STEP_TYPE_UNSUPPORTED: { title: "Workflow has a step that cannot run", kind: "Workflow error", fix: "Replace or remove that step in the builder." },
  LLM_TIMEOUT: { title: "Model call timed out", kind: "Timeout", fix: "Retry the run. If it keeps happening, shorten the input or raise the step's time limit." },
  HTTP_TIMEOUT: { title: "Request timed out", kind: "Timeout", fix: "Retry the run, or raise the step's time limit if the service is slow." },
  DB_TIMEOUT: { title: "Database did not answer in time", kind: "Timeout", fix: "Check the database is reachable, then retry." },
  DB_STATEMENT_TIMEOUT: { title: "Query took too long", kind: "Timeout", fix: "Narrow the query or add an index, then retry." },
  LLM_AUTH_FAILED: { title: "Model provider rejected the API key", kind: "Credentials", fix: "Update the key on the connection and test it." },
  AUTH_FAILED: { title: "A service rejected the credentials", kind: "Credentials", fix: "Update the connection's credentials and test it." },
  DB_AUTH_FAILED: { title: "Database rejected the credentials", kind: "Credentials", fix: "Update the database connection and test it." },
  SECRET_MISSING: { title: "A connection has no credentials", kind: "Credentials", fix: "Add the credentials on the connection and test it." },
  LLM_RATE_LIMIT: { title: "Model provider rate limit", kind: "Rate limit", fix: "Retry later, or raise the limit with the provider." },
  LLM_PROVIDER_ERROR: { title: "Model provider returned an error", kind: "Provider error", fix: "Usually temporary. Retry the run." },
  LLM_PROVIDER_BLOCKED: { title: "Model provider blocked the request", kind: "Provider error", fix: "Review the instructions and inputs for content the provider refuses." },
  LLM_JSON_PARSE_FAILED: { title: "Model reply could not be read", kind: "Invalid output", fix: "Retry the run. If it repeats, simplify the output fields." },
  LLM_SCHEMA_VALIDATION_FAILED: { title: "Model reply did not match the output fields", kind: "Invalid output", fix: "Check the step's output fields, then retry." },
  LLM_CONTEXT_LENGTH_EXCEEDED: { title: "Input too large for the model", kind: "Limit reached", fix: "Send less input to the step, or choose a model with a larger context." },
  JSON_PATH_NOT_FOUND: { title: "A mapped value was not in the earlier step's output", kind: "Missing input", fix: "Fix the step's Inputs to point at a field that exists." },
  TEMPLATE_RENDER_FAILED: { title: "A step's input could not be filled in", kind: "Missing input", fix: "Check the step's Inputs." },
  UNKNOWN_STEP_REFERENCE: { title: "An input points at a step that does not exist", kind: "Workflow error", fix: "Fix the step's Inputs." },
  INVALID_FUTURE_STEP_REFERENCE: { title: "An input points at a later step", kind: "Workflow error", fix: "Map the input from a step that runs earlier." },
  MAPPING_TYPE_MISMATCH: { title: "An input has the wrong type", kind: "Missing input", fix: "Check the step's Inputs." },
  CONNECTION_DISABLED: { title: "A connection is switched off", kind: "Connection", fix: "Enable the connection, then retry." },
  CONNECTION_REFUSED: { title: "A service refused the connection", kind: "Connection", fix: "Check the service is up and reachable, then retry." },
  CONNECTION_UNREACHABLE: { title: "A service could not be reached", kind: "Connection", fix: "Check the address and network access, then retry." },
  DNS_FAILED: { title: "A service address could not be found", kind: "Connection", fix: "Check the connection's address." },
  TLS_FAILED: { title: "Secure connection failed", kind: "Connection", fix: "Check the service's certificate." },
  WHITELIST_REQUIRED: { title: "The service blocks our network", kind: "Connection", fix: "Allow Vectorbea's outbound addresses on the service." },
  PRIVATE_RUNNER_REQUIRED: { title: "The service is only reachable privately", kind: "Connection", fix: "Run this workflow on a private runner." },
  DB_CONNECTION_REFUSED: { title: "Database refused the connection", kind: "Connection", fix: "Check the database is up and allows connections." },
  DB_TABLE_NOT_FOUND: { title: "A database table does not exist", kind: "Database", fix: "Check the table name in the query." },
  DB_COLUMN_NOT_FOUND: { title: "A database column does not exist", kind: "Database", fix: "Check the column names in the query." },
  DB_UNIQUE_CONSTRAINT: { title: "A write would create a duplicate", kind: "Database", fix: "Check the values being written." },
  DB_FOREIGN_KEY_CONSTRAINT: { title: "A write references a missing record", kind: "Database", fix: "Check the values being written." },
  DB_READ_ONLY_VIOLATION: { title: "A write was blocked on a read-only connection", kind: "Database", fix: "Use a connection that allows writes." },
  APPROVAL_REJECTED: { title: "An approval was rejected", kind: "Approval", fix: "Review the rejection note, then retry if appropriate." },
  APPROVAL_TIMEOUT: { title: "An approval was not answered in time", kind: "Approval", fix: "Answer approvals sooner, or extend the approval deadline." },
  WORKER_CRASHED: { title: "The run was interrupted", kind: "Interrupted", fix: "Retry the run; completed steps are not repeated." },
  JOB_STUCK: { title: "The run stopped making progress", kind: "Interrupted", fix: "Retry the run." },
  QUEUE_DELIVERY_FAILED: { title: "The run could not be started", kind: "Interrupted", fix: "Retry the run." },
};

/** For records classified UNKNOWN: read the stored failure message the same way the worker now does. */
const BY_MESSAGE: Array<[RegExp, string]> = [
  [/exceeded max token budget|budget exceeded.*token/i, "AGENT_TOKEN_BUDGET_EXCEEDED"],
  [/exceeded max tool calls/i, "AGENT_TOOL_CALL_LIMIT"],
  [/exceeded max iterations|max_iterations/i, "AGENT_ITERATION_LIMIT"],
  [/exceeded max cost/i, "AGENT_COST_LIMIT"],
  [/(agent stopped and reported|stopReason=AGENT_FAILED)[\s\S]*truncat/i, "AGENT_TOOL_RESULT_TRUNCATED"],
  [/agent stopped and reported|stopReason=AGENT_FAILED/i, "AGENT_COULD_NOT_FINISH"],
  [/needs .+ and got nothing/i, "TOOL_INPUT_MISSING"],
  [/unsupported node type/i, "STEP_TYPE_UNSUPPORTED"],
  [/llm call .*(timed out|timeout)|HttpTimeoutException/i, "LLM_TIMEOUT"],
  [/timed out|timeout/i, "HTTP_TIMEOUT"],
  [/invalid_api_key|incorrect api key|\b401\b/i, "AUTH_FAILED"],
  [/rate limit|\b429\b/i, "LLM_RATE_LIMIT"],
];

export function describeIncident(incident: contracts.FailureIncident): IncidentWords {
  const message = incident.technicalSummary ?? incident.summary ?? "";
  const code = incident.code && incident.code !== "UNKNOWN"
    ? incident.code
    : BY_MESSAGE.find(([pattern]) => pattern.test(message))?.[1] ?? "UNKNOWN";
  const known = BY_CODE[code];
  const where = whereFrom(message);

  return {
    title: known?.title ?? "Step failed",
    kind: known?.kind ?? "Failure",
    where,
    fix: known?.fix ?? incident.recommendedAction ?? "Open the failed run to see what happened.",
    groupKey: [code, incident.failedNodeId ?? incident.failedToolId ?? incident.failedConnectionId ?? where ?? ""].join(":"),
  };
}

/**
 * The step or agent, from the failure message. Newer messages start
 * `Step 'Review changes' failed:`; older ones `Node n-x (agent) failed: Agent 'Code reviewer' failed:`.
 */
function whereFrom(message: string): string | null {
  const step = /Step '([^']{1,80})' failed/.exec(message)?.[1];
  if (step) return step;
  const agent = /Agent '([^']{1,80})' failed/.exec(message)?.[1];
  if (agent) return agent;
  const tool = /^'([^']{1,80})' needs /.exec(message)?.[1];
  return tool ?? null;
}

/** The failure reason itself, without the step and agent prefixes. */
export function failureReason(incident: contracts.FailureIncident): string | null {
  const message = incident.technicalSummary ?? null;
  if (!message) return null;
  return message
    .replace(/^Step '[^']*' failed:\s*/, "")
    .replace(/^Node \S+ \([^)]*\) failed:\s*/, "")
    .replace(/^Agent '[^']*' failed:\s*/, "")
    .replace(/\s*\(stopReason=[A-Z_]+, iterations=\d+\)\s*$/, "")
    .trim() || null;
}
