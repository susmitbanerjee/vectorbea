/**
 * Vectorbea Connection Types
 *
 * A Connection = configured, named access to an external system or provider.
 * Agents and Tools reference connections by ID — never store raw secrets.
 */

// ─── Connection category ──────────────────────────────────────────────────────

export type ConnectionType =
  | "llm_provider"
  | "database"
  | "http_api"
  | "saas"
  | "mcp_server"
  | "vector_store"
  | "object_storage";

// ─── Provider enums per type ──────────────────────────────────────────────────

export type LlmProvider =
  | "openai"
  | "anthropic"
  | "azure_openai"
  | "google_gemini"
  | "mistral"
  | "aws_bedrock"
  | "openai_compatible";

export type DatabaseProvider =
  | "postgresql"
  | "mysql"
  | "sqlserver"
  | "mongodb"
  | "snowflake"
  | "bigquery"
  | "redshift";

export type SaasProvider =
  | "gmail"
  | "salesforce"
  | "hubspot"
  | "zendesk"
  | "jira"
  | "github";

export type VectorStoreProvider =
  | "pinecone"
  | "weaviate"
  | "qdrant"
  | "pgvector"
  | "redis";

export type ObjectStorageProvider =
  | "s3"
  | "gcs"
  | "azure_blob"
  | "r2"
  | "minio";

// ─── Auth types ───────────────────────────────────────────────────────────────

export type AuthType =
  | "api_key"
  | "bearer"
  | "basic"
  | "oauth2"
  | "mtls"
  | "custom"
  | "connection_string"
  | "none";

// ─── Connection status ────────────────────────────────────────────────────────

export type ConnectionStatus =
  | "connected"
  | "not_tested"
  | "failed"
  | "needs_whitelist"
  | "missing_secret"
  | "disabled";

export type NetworkStatus =
  | "reachable"
  | "blocked"
  | "unknown"
  | "private_runner_required"
  | "whitelist_required";

// ─── Type-specific config (no secrets here — config only) ─────────────────────

export interface LlmConnectionConfig {
  provider: LlmProvider;
  baseUrl?: string;
  organizationId?: string;
  projectId?: string;
  defaultModel: string;
  allowedModels: string[];
  requestTimeoutMs: number;
  tokenBudgetLimit?: number;
  rateLimitRpm?: number;
  rateLimitTpm?: number;
}

export interface DatabaseConnectionConfig {
  provider: DatabaseProvider;
  connectionMode: "connection_string" | "host_port" | "cloud_iam";
  host?: string;
  port?: number;
  database?: string;
  username?: string;
  sslRequired: boolean;
  readOnly: boolean;
  allowedSchemas: string[];
  allowedTables: string[];
  queryTimeoutMs: number;
  maxRows: number;
}

export interface HttpApiConnectionConfig {
  baseUrl: string;
  authType: AuthType;
  authHeaderName?: string;
  defaultHeaders: Record<string, string>;
  allowedPaths: string[];
  blockedPaths: string[];
  requestTimeoutMs: number;
  retryAttempts: number;
}

export interface SaasConnectionConfig {
  provider: SaasProvider;
  baseUrl?: string;
  workspace?: string;
  allowedResources: string[];
  healthPath?: string;
}

export interface McpConnectionConfig {
  serverUrl: string;
  transport: "http" | "sse" | "stdio";
  allowedTools: string[];
}

export interface VectorStoreConnectionConfig {
  provider: VectorStoreProvider;
  indexName: string;
  embeddingModel?: string;
  /** Index host / API endpoint used to reach (and test) the store. */
  endpoint?: string;
  healthPath?: string;
}

export interface ObjectStorageConnectionConfig {
  provider: ObjectStorageProvider;
  bucket: string;
  region?: string;
  prefix?: string;
  /** Bucket or service endpoint URL used to reach (and test) the store. */
  endpoint?: string;
  /** Non-secret access key id (the secret key is stored via the secrets backend). */
  accessKeyId?: string;
}

export type ConnectionConfig =
  | LlmConnectionConfig
  | DatabaseConnectionConfig
  | HttpApiConnectionConfig
  | SaasConnectionConfig
  | McpConnectionConfig
  | VectorStoreConnectionConfig
  | ObjectStorageConnectionConfig;

// ─── Network policy ───────────────────────────────────────────────────────────

export interface NetworkPolicy {
  allowedHosts?: string[];
  allowedIPs?: string[];
  requireWhitelist: boolean;
  privateRunnerRequired: boolean;
  networkStatus: NetworkStatus;
  lastReachabilityTestAt?: string;
  lastReachabilityTestResult?: "ok" | "failed" | "timeout";
  reachabilityError?: string;
}

// ─── Core Connection entity ───────────────────────────────────────────────────

export interface Connection {
  id: string;
  name: string;
  slug: string;
  type: ConnectionType;
  provider: string;           // e.g. "openai", "postgresql", "slack"
  environment: "development" | "staging" | "production";
  status: ConnectionStatus;
  authType: AuthType;
  secretRef: string | null;   // reference name only — never the raw secret
  secretMasked: string | null; // e.g. "sk-...xxxx" — last 4 chars only
  config: ConnectionConfig;
  networkPolicy: NetworkPolicy;
  lastTestedAt: string | null;
  lastTestStatus: "ok" | "failed" | "skipped" | null;
  lastTestLatencyMs: number | null;
  /** Error message from the last test — present if lastTestStatus is "failed" */
  lastTestError: string | null;
  /** API field name for lastTestError (from Kotlin serialization) */
  lastTestErrorMessageSanitized: string | null;
  lastTestErrorCode: string | null;
  /** Whether a secret has been configured (API returns secretConfigured, not secretRef) */
  secretConfigured?: boolean;
  usedByAgentIds: string[];
  usedByToolIds: string[];
  createdAt: string;
  updatedAt: string;
}

// ─── Compatibility map ────────────────────────────────────────────────────────

export const CONNECTION_TOOL_COMPAT: Record<string, ConnectionType[]> = {
  http:             ["http_api"],
  database_read:    ["database"],
  database_write:   ["database"],
  // Slack/email/crm are HTTP tools backed by SaaS connections.
  // SaaS connections are stored as type "http" in the backend and
  // normalized to "http_api" by the frontend — NOT "saas".
  slack:            ["http_api"],
  email:            ["http_api"],
  crm:              ["http_api"],
  mcp_tool:         ["mcp_server"],
  imported_tool:    ["mcp_server", "http_api"],
  custom_function:  [],
};

export const CONNECTION_AGENT_COMPAT: Record<string, ConnectionType[]> = {
  native_llm_agent:             ["llm_provider"],
  router_agent:                 ["llm_provider"],
  tool_agent:                   [],
  approval_agent:               [],
  imported_langgraph_node:      ["llm_provider"],
  external_instrumented_agent:  [],
};

// ─── LLM model catalog ────────────────────────────────────────────────────────

export const LLM_PROVIDER_MODELS: Record<LlmProvider, string[]> = {
  openai:            ["gpt-4.1", "gpt-4.1-mini", "gpt-4o", "gpt-4o-mini", "o3", "o4-mini"],
  anthropic:         ["claude-opus-4", "claude-sonnet-4-5", "claude-haiku-3-5"],
  azure_openai:      ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo"],
  google_gemini:     ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-1.5-pro"],
  mistral:           ["mistral-large-latest", "mistral-medium-latest", "mistral-small-latest"],
  aws_bedrock:       ["anthropic.claude-3-5-sonnet", "amazon.titan-text-express-v1"],
  openai_compatible: ["custom"],
};

// ─── Vectorbea outbound IPs (placeholder — real values from infra team) ───────

export const VECTORBEE_OUTBOUND_IPS = [
  "34.102.136.180",
  "34.102.136.181",
  "34.102.136.182",
  "34.102.136.183",
];

// ─── Private IP detection ─────────────────────────────────────────────────────

export function isPrivateHost(host: string): boolean {
  if (!host) return false;
  const h = host.toLowerCase().replace(/^https?:\/\//, "").split("/")[0]?.split(":")[0] ?? "";
  if (h === "localhost" || h === "127.0.0.1" || h === "::1") return true;
  if (h.endsWith(".internal") || h.endsWith(".local")) return true;
  if (/^10\.\d+\.\d+\.\d+$/.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/.test(h)) return true;
  if (/^192\.168\.\d+\.\d+$/.test(h)) return true;
  return false;
}
