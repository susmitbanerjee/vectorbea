/**
 * The integration catalogue — which providers Vectorbea speaks to, how each one
 * authenticates, what it can be granted, and how to get a credential for it.
 *
 * THIS IS PRODUCT CONTENT, NOT A FIXTURE, and that distinction is why it lives
 * here rather than in ~/mocks. Nothing below describes a tenant: there are no
 * connections, no health, no usage. It is the same list in mock mode and in
 * production, it is what the /integrations page is FOR, and the connect dialog
 * needs it to build a real credential form — which it could not do while the
 * fixture ban (correctly) kept ~/mocks out of shipping code.
 *
 * ~/mocks/connectivity re-exports these and layers the fabricated per-tenant
 * parts (which connections exist, blast radius) on top.
 */
import type { ProviderId } from "~/components/ui/provider-logo";

export type IntegrationCategory =
  | "ai" | "database" | "messaging" | "crm" | "productivity" | "developer" | "generic";

export const INTEGRATION_CATEGORY_LABEL: Record<IntegrationCategory, string> = {
  ai: "AI models",
  database: "Databases",
  messaging: "Messaging",
  crm: "CRM and sales",
  productivity: "Productivity",
  developer: "Developer",
  generic: "Generic",
};

export type AuthMethod = "oauth" | "api-key" | "connection-string" | "none";

export const AUTH_LABEL: Record<AuthMethod, string> = {
  oauth: "OAuth 2.0",
  "api-key": "API key",
  "connection-string": "Connection string",
  none: "No credentials",
};

export interface IntegrationRecord {
  id: ProviderId;
  name: string;
  category: IntegrationCategory;
  description: string;
  /** Tool names this integration supplies. */
  tools: string[];
  authMethods: AuthMethod[];
  scopes: { name: string; description: string; required: boolean }[];
  setup: string[];
  /** Existing connections in this workspace. */
  connectionNames: string[];
}

export const INTEGRATION_SEEDS: {
  id: ProviderId;
  name: string;
  category: IntegrationCategory;
  description: string;
  auth: AuthMethod[];
  scopes: { name: string; description: string; required: boolean }[];
  setup: string[];
}[] = [
  {
    id: "postgres", name: "Postgres", category: "database",
    description: "Read and write against a Postgres database, with parameters bound rather than interpolated.",
    auth: ["connection-string"],
    scopes: [
      { name: "read", description: "SELECT against the tables you grant.", required: true },
      { name: "write", description: "INSERT and UPDATE. Leave off for a read-only connection.", required: false },
    ],
    setup: [
      "Create a role for Vectorbea rather than reusing an application role.",
      "Grant it only the tables the workflows need.",
      "Allow the Vectorbea egress range, or use a private runner if the database is not reachable from the internet.",
      "Paste the connection string. It is encrypted at rest and never shown again.",
    ],
  },
  {
    id: "slack", name: "Slack", category: "messaging",
    description: "Post messages, reply in threads and look up users in a Slack workspace.",
    auth: ["oauth"],
    scopes: [
      { name: "chat:write", description: "Post messages as the app.", required: true },
      { name: "channels:read", description: "Resolve channel names to ids.", required: true },
      { name: "users:read", description: "Look up a user by email.", required: false },
    ],
    setup: [
      "Authorise the Vectorbea app in your Slack workspace.",
      "Choose the channels it may post to — the grant is per channel, not workspace-wide.",
      "Send a test message before saving.",
    ],
  },
  {
    id: "hubspot", name: "HubSpot", category: "crm",
    description: "Read contacts, companies and deals, and write back deal stages.",
    auth: ["oauth", "api-key"],
    scopes: [
      { name: "crm.objects.contacts.read", description: "Read contacts and their companies.", required: true },
      { name: "crm.objects.deals.write", description: "Update deal stages and properties.", required: false },
    ],
    setup: [
      "Authorise through HubSpot's OAuth flow, or paste a private app token.",
      "Select the object types the workflows need.",
      "Test against a known contact id.",
    ],
  },
  {
    id: "gmail", name: "Gmail", category: "productivity",
    description: "Send mail from a workspace mailbox and search existing threads.",
    auth: ["oauth"],
    scopes: [
      { name: "gmail.send", description: "Send mail as the connected mailbox.", required: true },
      { name: "gmail.readonly", description: "Search and read threads.", required: false },
    ],
    setup: [
      "Authorise a shared mailbox rather than a personal one — a personal account leaves with the person.",
      "Grant send, and read only if a workflow needs to search.",
      "Send a test message to yourself before saving.",
    ],
  },
  {
    id: "github", name: "GitHub", category: "developer",
    description: "Open issues, read pull requests and comment on both.",
    auth: ["oauth", "api-key"],
    scopes: [
      { name: "repo", description: "Read and write issues and pull requests.", required: true },
      { name: "read:org", description: "Resolve team names.", required: false },
    ],
    setup: [
      "Install the Vectorbea GitHub app on the organisation.",
      "Choose the repositories it may act on.",
      "Test by reading a pull request.",
    ],
  },
  {
    id: "notion", name: "Notion", category: "productivity",
    description: "Create pages and query databases in a Notion workspace.",
    auth: ["oauth", "api-key"],
    scopes: [
      { name: "content.read", description: "Query databases and read pages.", required: true },
      { name: "content.write", description: "Create and update pages.", required: false },
    ],
    setup: [
      "Create an internal integration in Notion.",
      "Share the specific databases with it — Notion grants access per page, not per workspace.",
      "Paste the integration token.",
    ],
  },
  {
    id: "airtable", name: "Airtable", category: "productivity",
    description: "Read and upsert records in an Airtable base.",
    auth: ["api-key"],
    scopes: [
      { name: "data.records:read", description: "Read records.", required: true },
      { name: "data.records:write", description: "Create and update records.", required: false },
    ],
    setup: ["Create a personal access token scoped to one base.", "Paste it and pick the base."],
  },
  {
    id: "openai", name: "OpenAI", category: "ai",
    description: "Bring your own OpenAI key so model spend is billed to you rather than the workspace.",
    auth: ["api-key"],
    scopes: [{ name: "models", description: "Invoke chat and embedding models.", required: true }],
    setup: [
      "Create a key scoped to a project rather than an organisation.",
      "Set a spend limit on the key — Vectorbea's cost ceilings are a second line, not the first.",
      "Paste it and run a test completion.",
    ],
  },
  {
    id: "anthropic", name: "Anthropic", category: "ai",
    description: "Bring your own Anthropic key for Claude models.",
    auth: ["api-key"],
    scopes: [{ name: "models", description: "Invoke Claude models.", required: true }],
    setup: ["Create a key in the Anthropic console.", "Set a spend limit.", "Paste it and run a test completion."],
  },
  {
    id: "gemini", name: "Google Gemini", category: "ai",
    description: "Bring your own Google AI key for Gemini models.",
    auth: ["api-key"],
    scopes: [{ name: "models", description: "Invoke Gemini models.", required: true }],
    setup: ["Create a key in Google AI Studio.", "Paste it and run a test completion."],
  },
  {
    id: "mistral", name: "Mistral", category: "ai",
    description: "Bring your own Mistral key.",
    auth: ["api-key"],
    scopes: [{ name: "models", description: "Invoke Mistral models.", required: true }],
    setup: ["Create a key in the Mistral console.", "Paste it and run a test completion."],
  },
  {
    id: "mysql", name: "MySQL", category: "database",
    description: "Read and write against a MySQL database.",
    auth: ["connection-string"],
    scopes: [
      { name: "read", description: "SELECT against granted tables.", required: true },
      { name: "write", description: "INSERT and UPDATE.", required: false },
    ],
    setup: ["Create a dedicated role.", "Grant only the needed tables.", "Paste the connection string."],
  },
  {
    id: "jira", name: "Jira", category: "developer",
    description: "Create tickets and move them through a workflow.",
    auth: ["oauth", "api-key"],
    scopes: [
      { name: "write:jira-work", description: "Create and transition issues.", required: true },
      { name: "read:jira-work", description: "Read issues and projects.", required: true },
    ],
    setup: ["Authorise the Atlassian app.", "Pick the projects it may write to.", "Test by reading a project."],
  },
  {
    id: "google-sheets", name: "Google Sheets", category: "productivity",
    description: "Read ranges and append rows to a spreadsheet.",
    auth: ["oauth"],
    scopes: [
      { name: "spreadsheets", description: "Read and write the sheets you share with it.", required: true },
    ],
    setup: ["Authorise with Google.", "Share the specific spreadsheets with the service account.", "Test a read."],
  },
  {
    id: "webhook", name: "Outbound webhook", category: "generic",
    description: "Send a signed POST to any HTTPS endpoint you control.",
    auth: ["none", "api-key"],
    scopes: [],
    setup: [
      "Give the destination URL. It must be HTTPS.",
      "Copy the signing secret and verify the signature at your end — an unverified webhook endpoint is an open door.",
    ],
  },
  {
    id: "http", name: "Generic HTTP", category: "generic",
    description: "Call any HTTP API with headers and a body you define.",
    auth: ["none", "api-key"],
    scopes: [],
    setup: [
      "Define the base URL and any static headers.",
      "Store the credential as a workspace secret rather than inlining it in the header.",
    ],
  },
];

/** The catalogue entry for a provider id, or undefined for an unknown one. */
export function catalogueEntry(id: string) {
  return INTEGRATION_SEEDS.find((seed) => seed.id === id);
}
