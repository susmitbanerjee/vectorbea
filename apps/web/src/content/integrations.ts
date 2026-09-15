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
 *
 * ── WHAT IS DELIBERATELY NOT HERE ───────────────────────────────────────────
 * Slack, HubSpot, Gmail, GitHub, Notion, Airtable, Jira and Google Sheets were
 * all first-class entries and have been removed. Every one of them is reached
 * through its own MCP server now, and that is the better answer for all of
 * them: the vendor maintains the tool list, it stays current without a release
 * from us, and the customer's own credential and scopes apply.
 *
 * Keeping both would have been worse than picking either. Two doors to GitHub —
 * one an adapter with the six operations we happened to implement, the other a
 * server with everything GitHub ships — is a choice a person has to make
 * without the information needed to make it, and the adapter is the wrong
 * answer almost every time it is chosen.
 *
 * WHAT STAYS, and why each is not an MCP case:
 *   · LLM providers — a model connection is billing and capacity, not a tool
 *     list. There is nothing to discover.
 *   · Postgres and MySQL — the runtime speaks the wire protocol directly,
 *     with parameters bound rather than interpolated and a read-only guard the
 *     engine enforces. Going through a server would lose both.
 *   · Generic HTTP and outbound webhook — the escape hatch for an endpoint
 *     nobody has wrapped in anything. MCP-only would mean a customer with a
 *     plain REST API has to build a server first, which is a worse product for
 *     a protocol preference (MCP.md §1).
 *   · MCP itself — the door to all of the above.
 *
 * The removed vendors keep their MARKS in `provider-logo.tsx`. A logo is for
 * recognition, and recognising GitHub on a discovered tool list is exactly what
 * this change makes more likely, not less.
 */
import type { ProviderId } from "~/components/ui/provider-logo";

/**
 * `messaging`, `crm`, `productivity` and `developer` are retained with no
 * members. They are the shape of the removed entries, and a catalogue that
 * grows a first-class adapter again — for something genuinely not MCP-shaped —
 * should not have to re-litigate the taxonomy to add it. Empty groups are
 * filtered out at render.
 */
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

/**
 * `webhook-url` is a channel's incoming webhook — Microsoft Teams, Google Chat,
 * Discord. The URL is the credential: anyone holding it can post to the channel,
 * so it is stored encrypted as the connection's secret (`auth_type =
 * 'webhook_url'`) and never in config. See `WebhookUrlTester.kt`.
 */
export type AuthMethod = "oauth" | "api-key" | "connection-string" | "webhook-url" | "none";

export const AUTH_LABEL: Record<AuthMethod, string> = {
  oauth: "OAuth 2.0",
  "api-key": "API key",
  "connection-string": "Connection string",
  "webhook-url": "Webhook URL",
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
  /** What the credential is called for this provider, when "API key" is the wrong word. */
  credentialLabel?: string;
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
    /*
     * ── SLACK IS BACK, AND THE REMOVAL WAS WRONG ────────────────────────────
     *
     * It went out with GitHub and HubSpot under "reachable through MCP". That
     * is TRUE of Slack and it is not the whole story: a bot token in a Slack
     * app is the thing most teams already have, the bot is how a workflow gets
     * TRIGGERED (a mention in a channel) as well as how it reports back, and
     * requiring somebody to stand up an MCP server before an agent can post a
     * message is the "wrap your REST endpoint first" failure that MCP.md §1
     * names as a worse product for a protocol preference.
     *
     * The rule the catalogue actually wants is narrower than the one applied:
     * remove an adapter when the MCP server is STRICTLY BETTER — richer, and
     * maintained by the vendor. For GitHub and HubSpot it is. For Slack, the
     * two operations below plus the message read are what a workflow needs, a
     * bot token is five minutes of setup, and the connection doubles as the
     * identity a trigger listens on.
     */
    id: "slack", name: "Slack", category: "messaging",
    description: "Post messages, read a channel or thread, and look up users — as a bot in your workspace.",
    /* One method. Slack's "Bot User OAuth Token" is what both of the old
       choices ended up asking for, and offering "API key" and "OAuth 2.0" side
       by side sent people looking for two different credentials. */
    auth: ["api-key"],
    credentialLabel: "Bot token",
    scopes: [
      { name: "chat:write", description: "Post messages as the bot.", required: true },
      { name: "channels:history", description: "Read messages in channels the bot is in.", required: false },
      { name: "app_mentions:read", description: "Receive the mention events that can trigger a workflow.", required: false },
      { name: "users:read.email", description: "Resolve an email address to a Slack user.", required: false },
    ],
    setup: [
      "Create a Slack app in your workspace and add a bot user.",
      "Give it chat:write, plus channels:history if an agent needs to READ messages and app_mentions:read if a mention should start a workflow.",
      "Install it and paste the Bot User OAuth token — it starts xoxb-.",
      "Invite the bot to each channel it works in. Slack grants per channel, not per workspace.",
    ],
  },
  {
    /*
     * ── TEAMS, GOOGLE CHAT AND DISCORD CONNECT BY WEBHOOK URL ───────────────
     *
     * Each of them offers a bot API, and each bot API is an afternoon: an Azure
     * app registration and Graph permissions an admin must consent to, a Google
     * Cloud project with a Chat app, a Discord application with a gateway. What a
     * workflow actually needs from them is "post this into that channel", and all
     * three hand that out as one URL, per channel, from the channel's own
     * settings — two minutes, no admin. Reading and replying is out of reach by
     * this route, and the descriptions say so rather than letting somebody find
     * out after connecting.
     */
    id: "teams", name: "Microsoft Teams", category: "messaging",
    description: "Post messages into one Teams channel through the channel's Workflows webhook. Posting only.",
    auth: ["webhook-url"],
    scopes: [],
    setup: [
      "In Teams, open the channel, choose the three dots next to its name, then Workflows.",
      "Pick \"Post to a channel when a webhook request is received\" and finish the template.",
      "Copy the URL it gives you and paste it here. Anyone with that URL can post to the channel, so it is stored encrypted and never shown again.",
      "One URL posts to one channel. Connect Teams again for each channel an agent should reach.",
    ],
  },
  {
    id: "google-chat", name: "Google Chat", category: "messaging",
    description: "Post messages into one Google Chat space through the space's incoming webhook. Posting only.",
    auth: ["webhook-url"],
    scopes: [],
    setup: [
      "In Google Chat, open the space, choose its name at the top, then Apps & integrations.",
      "Choose Add webhooks, give it a name such as Vectorbea, and save.",
      "Copy the webhook URL and paste it here. It is stored encrypted and never shown again.",
      "One URL posts to one space. Connect Google Chat again for each space an agent should reach.",
    ],
  },
  {
    id: "discord", name: "Discord", category: "messaging",
    description: "Post messages into one Discord channel through the channel's webhook. Posting only.",
    auth: ["webhook-url"],
    scopes: [],
    setup: [
      "In Discord, open the channel's settings (Edit Channel), then Integrations, then Webhooks.",
      "Choose New Webhook, name it, and choose Copy Webhook URL.",
      "Paste it here. Vectorbea checks it with Discord without posting anything.",
      "One URL posts to one channel. Connect Discord again for each channel an agent should reach.",
    ],
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
  {
    id: "mcp", name: "MCP server", category: "generic",
    /*
     * The second sentence is doing work. It is the first place anybody meets
     * the grant model, and it is far cheaper to say here than to explain after
     * somebody expected a single switch and found twelve checkboxes.
     */
    description:
      "Paste a Model Context Protocol server's URL, sign in if it asks, and its tools " +
      "are ready to hand to your agents.",
    auth: ["oauth", "none", "api-key"],
    scopes: [],
    setup: [
      "Paste the server's URL — the streamable-HTTP endpoint, usually ending in /mcp.",
      "Sign in if the server uses sign-in. Vectorbea registers itself with the server, so there is no OAuth app to create and no token to copy.",
      "Its tools are discovered as soon as it is connected. Pick the agents that should use them.",
    ],
  },
];

/** The catalogue entry for a provider id, or undefined for an unknown one. */
export function catalogueEntry(id: string) {
  return INTEGRATION_SEEDS.find((seed) => seed.id === id);
}

/* ══════════════════════════════════════════════════════════════════════════════
   WHERE THE DATABASE LIVES, AND HOW IT IS REACHED

   "Postgres" and "MySQL" are protocols, not products. What a user actually has
   is Supabase, Neon, Aiven, RDS, Azure or a server their platform team runs —
   and the difference decides the port, the username shape, whether TLS is
   mandatory, and above all WHICH POOLER sits in front.

   POOLING IS NOT A PREFERENCE. A transaction pooler hands its backend back at
   COMMIT, so server-side prepared statements cannot survive it. The JDBC driver
   promotes a statement to a named one on its fifth identical execution, which
   means a workflow node succeeds four times and then starts failing with
   `prepared statement "S_1" already exists`. Nothing about that error mentions
   pooling, and by the time it appears the connection has been green for days.
   Asking one question here is what prevents it.

   THIS FILE IS PRESENTATION ONLY. It carries labels, notes and placeholders —
   the words a person needs in order to choose correctly. It carries no TLS
   decision and no driver parameter: those live in `DbProviders.kt`, which both
   backend services compile, and the server never takes the client's word for
   them. The contract between the two is the `poolingMode` string, and nothing
   else.
══════════════════════════════════════════════════════════════════════════════ */

export type PoolingMode = "direct" | "session_pooler" | "transaction_pooler";

export const POOLING_LABEL: Record<PoolingMode, string> = {
  direct: "Direct connection",
  session_pooler: "Session pooler",
  transaction_pooler: "Transaction pooler",
};

export interface DbHostingOption {
  /** Sent as `config.dbHosting`, and matched by `DbProviders.byName` server-side. */
  id: string;
  label: string;
  wire: "postgres" | "mysql";
  modes: PoolingMode[];
  /** One line per mode, in the vendor's own words. */
  modeNotes: Partial<Record<PoolingMode, string>>;
  /** The screen the connection string is on. */
  whereToFind?: string;
  /** A realistic connection string for this product. */
  placeholder?: string;
  /** Anything that will otherwise cost the user an hour. */
  caution?: string;
}

export const DB_HOSTING: DbHostingOption[] = [
  {
    id: "postgresql", label: "Self-hosted or enterprise", wire: "postgres",
    modes: ["direct", "session_pooler", "transaction_pooler"],
    modeNotes: {
      direct: "Straight to Postgres. Full session semantics.",
      session_pooler: "Through PgBouncer or pgpool in session mode. Session state survives.",
      transaction_pooler: "Through PgBouncer or pgpool in transaction mode. Prepared statements are disabled for you.",
    },
    placeholder: "postgresql://user:password@host:5432/database",
  },
  {
    id: "supabase", label: "Supabase", wire: "postgres",
    modes: ["session_pooler", "transaction_pooler", "direct"],
    modeNotes: {
      direct:
        "db.<ref>.supabase.co:5432. IPv6-only unless the project has the IPv4 add-on — Vectorbea dials over IPv4, so this usually cannot be reached from here.",
      session_pooler:
        "aws-0-<region>.pooler.supabase.com:5432, user postgres.<project-ref>. Dual-stack and full session semantics. Start here.",
      transaction_pooler:
        "aws-0-<region>.pooler.supabase.com:6543. Highest connection ceiling, no prepared statements, no SET, no temp tables.",
    },
    whereToFind: "Project Settings → Database → Connection string",
    placeholder: "postgresql://postgres.<ref>:password@aws-0-<region>.pooler.supabase.com:5432/postgres",
    caution:
      "The pooler takes the username postgres.<project-ref>. The plain postgres only works against the direct host.",
  },
  {
    id: "neon", label: "Neon", wire: "postgres",
    modes: ["direct", "transaction_pooler"],
    modeNotes: {
      direct: "ep-<endpoint>.<region>.aws.neon.tech. Full session semantics.",
      transaction_pooler:
        "ep-<endpoint>-pooler.<region>.aws.neon.tech — PgBouncer in transaction mode. Note the -pooler suffix.",
    },
    whereToFind: "Dashboard → Connection details, with “Pooled connection” toggled on",
    placeholder: "postgresql://user:password@ep-xxx.eu-central-1.aws.neon.tech/neondb",
    caution:
      "Neon suspends idle computes. The first connection after a suspend takes a few seconds — that is a slow success, not a failure.",
  },
  {
    id: "aiven_postgresql", label: "Aiven for PostgreSQL", wire: "postgres",
    modes: ["direct", "transaction_pooler"],
    modeNotes: {
      direct: "The service URI on the Overview tab. The port is per-service, never 5432.",
      transaction_pooler: "A PgBouncer pool created under Pools. It has its own port and its own URI.",
    },
    whereToFind: "Service → Overview → Connection information",
    placeholder: "postgres://avnadmin:password@pg-xxx.a.aivencloud.com:23861/defaultdb?sslmode=require",
    caution:
      "Aiven allowlists client IPs per service. Add the Vectorbea egress addresses under Service settings → Allowed IP addresses.",
  },
  {
    id: "rds_postgresql", label: "Amazon RDS / Aurora", wire: "postgres",
    modes: ["direct", "session_pooler", "transaction_pooler"],
    modeNotes: {
      direct: "The instance or cluster endpoint.",
      session_pooler: "An RDS Proxy endpoint with session pinning.",
      transaction_pooler: "An RDS Proxy endpoint in the default transaction mode.",
    },
    whereToFind: "RDS console → Databases → Connectivity & security",
    placeholder: "postgresql://user:password@db.abc123.eu-west-1.rds.amazonaws.com:5432/app",
    caution:
      "The instance must be publicly accessible and its security group must allow inbound 5432 from the Vectorbea egress addresses.",
  },
  {
    id: "azure_postgresql", label: "Azure Database for PostgreSQL", wire: "postgres",
    modes: ["direct", "transaction_pooler"],
    modeNotes: {
      direct: "Port 5432 on the server endpoint.",
      transaction_pooler:
        "Flexible Server ships PgBouncer on 6432. Enable pgbouncer.enabled under Server parameters first.",
    },
    whereToFind: "Server → Settings → Connection strings",
    placeholder: "postgresql://user:password@server.postgres.database.azure.com:5432/app",
    caution:
      "Single Server (the retired tier) needs the username as user@servername. Flexible Server takes the plain username.",
  },
  {
    id: "cloudsql_postgresql", label: "Google Cloud SQL / AlloyDB", wire: "postgres",
    modes: ["direct"],
    modeNotes: { direct: "The instance's public IP. AlloyDB is VPC-only and needs a private runner." },
    whereToFind: "Instance → Overview → Connect to this instance",
    placeholder: "postgresql://user:password@34.10.0.1:5432/app",
    caution:
      "Cloud SQL rejects anything outside Authorized networks. Add the Vectorbea egress addresses under Connections → Networking.",
  },
  {
    id: "timescale", label: "Timescale Cloud", wire: "postgres",
    modes: ["direct", "transaction_pooler"],
    modeNotes: {
      direct: "The service URL.",
      transaction_pooler: "The connection pooler port shown beside it in the console.",
    },
    whereToFind: "Service → Connection info",
    placeholder: "postgres://tsdbadmin:password@xxx.tsdb.cloud.timescale.com:31234/tsdb?sslmode=require",
  },
  {
    id: "cockroachdb", label: "CockroachDB Cloud", wire: "postgres",
    modes: ["direct"],
    modeNotes: { direct: "The cluster's SQL endpoint on port 26257." },
    whereToFind: "Cluster → Connect → General connection string",
    placeholder:
      "postgresql://user:password@cluster.aws-eu-west-1.cockroachlabs.cloud:26257/defaultdb?sslmode=verify-full",
  },
  {
    id: "digitalocean_postgresql", label: "DigitalOcean", wire: "postgres",
    modes: ["direct", "transaction_pooler"],
    modeNotes: {
      direct: "The primary connection details, port 25060.",
      transaction_pooler:
        "A pool from the Connection Pools tab. It has its own port and its own database name.",
    },
    placeholder:
      "postgresql://doadmin:password@db-postgresql-lon1-1.db.ondigitalocean.com:25060/defaultdb?sslmode=require",
    caution: "Add the Vectorbea egress addresses to the database's trusted sources.",
  },
  {
    id: "mysql", label: "Self-hosted or enterprise", wire: "mysql",
    modes: ["direct", "session_pooler", "transaction_pooler"],
    modeNotes: {
      direct: "Straight to MySQL.",
      session_pooler: "Through ProxySQL or MySQL Router with session affinity.",
      transaction_pooler: "Through ProxySQL in multiplexing mode. Prepared statements are disabled for you.",
    },
    placeholder: "mysql://user:password@host:3306/database",
  },
  {
    id: "aiven_mysql", label: "Aiven for MySQL", wire: "mysql",
    modes: ["direct"],
    modeNotes: {
      direct:
        "The service URI on the Overview tab — user avnadmin, database defaultdb, and a per-service port that is never 3306.",
    },
    whereToFind: "Service → Overview → Connection information",
    placeholder: "mysql://avnadmin:password@mysql-xxx.a.aivencloud.com:23861/defaultdb?ssl-mode=REQUIRED",
    caution:
      "Aiven allowlists client IPs per service, and refuses cleartext. Paste the URI exactly as Aiven gives it — Vectorbea applies the TLS setting that the JDBC driver would otherwise ignore.",
  },
  {
    id: "planetscale", label: "PlanetScale", wire: "mysql",
    modes: ["transaction_pooler"],
    modeNotes: {
      transaction_pooler:
        "PlanetScale is Vitess — every connection is pooled and there is no direct mode. It has no session state to lose.",
    },
    whereToFind: "Database → Connect → General",
    placeholder: "mysql://user:password@aws.connect.psdb.cloud/database?ssl-mode=VERIFY_IDENTITY",
  },
  {
    id: "rds_mysql", label: "Amazon RDS / Aurora", wire: "mysql",
    modes: ["direct", "session_pooler", "transaction_pooler"],
    modeNotes: {
      direct: "The instance or cluster endpoint.",
      session_pooler: "An RDS Proxy endpoint with session pinning.",
      transaction_pooler: "An RDS Proxy endpoint in the default transaction mode.",
    },
    placeholder: "mysql://user:password@db.abc123.eu-west-1.rds.amazonaws.com:3306/app",
    caution:
      "The instance must be publicly accessible and its security group must allow inbound 3306 from the Vectorbea egress addresses.",
  },
  {
    id: "azure_mysql", label: "Azure Database for MySQL", wire: "mysql",
    modes: ["direct"],
    modeNotes: { direct: "Port 3306 on the server endpoint." },
    placeholder: "mysql://user:password@server.mysql.database.azure.com:3306/app",
    caution:
      "Single Server (the retired tier) needs the username as user@servername. Flexible Server takes the plain username.",
  },
  {
    id: "cloudsql_mysql", label: "Google Cloud SQL", wire: "mysql",
    modes: ["direct"],
    modeNotes: { direct: "The instance's public IP." },
    placeholder: "mysql://user:password@34.10.0.1:3306/app",
    caution: "Cloud SQL rejects anything outside Authorized networks.",
  },
  {
    id: "tidb", label: "TiDB Cloud", wire: "mysql",
    modes: ["transaction_pooler"],
    modeNotes: { transaction_pooler: "TiDB Serverless is reached through its gateway on port 4000." },
    placeholder: "mysql://user:password@gateway01.eu-central-1.prod.aws.tidbcloud.com:4000/test",
  },
  {
    id: "mariadb", label: "MariaDB", wire: "mysql",
    modes: ["direct", "session_pooler"],
    modeNotes: {
      direct: "Straight to MariaDB. It speaks the MySQL wire protocol.",
      session_pooler: "Through MaxScale or ProxySQL with session affinity.",
    },
    placeholder: "mysql://user:password@host:3306/database",
  },
];

/** Hosting options for a wire protocol, in the order they should be offered. */
export function hostingFor(wire: "postgres" | "mysql"): DbHostingOption[] {
  return DB_HOSTING.filter((entry) => entry.wire === wire);
}

export function hostingEntry(id: string | null | undefined): DbHostingOption | undefined {
  return DB_HOSTING.find((entry) => entry.id === id);
}

/**
 * The host and port of a connection string, split by structure rather than grammar.
 *
 * THE ORDER OF THESE TWO STEPS IS THE WHOLE THING. The credential boundary is
 * found FIRST — the LAST `@`, because a password may contain `@` and a host may
 * not — and only then does the authority end at the first `/`, `?` or `#` that
 * follows it. Doing it the other way round truncates the string inside the
 * password, so `p@ss/word` produced no host at all and the vendor went
 * unrecognised on exactly the connection strings most likely to need the
 * guidance.
 *
 * `new URL()` cannot be used for the same reason, and worse: it returns a null
 * host for several ordinary password shapes and throws outright on others. The
 * server reaches the identical conclusion at length in `ConnectionUrl.kt`,
 * where seven of nine realistic passwords failed to parse.
 */
function hostPortOf(url: string): { host: string; port: number } {
  const afterScheme = url.includes("://") ? url.slice(url.indexOf("://") + 3) : url;
  const at = afterScheme.lastIndexOf("@");
  const rest = at >= 0 ? afterScheme.slice(at + 1) : afterScheme;
  const authority = rest.split(/[/?#]/)[0];
  // A bracketed IPv6 literal keeps its colons; everything after `]` is the port.
  const hostPart = authority.startsWith("[")
    ? authority.slice(1, authority.indexOf("]"))
    : authority.split(":")[0];
  const portPart = authority.startsWith("[")
    ? authority.slice(authority.indexOf("]") + 1).replace(":", "")
    : authority.split(":")[1];
  return { host: hostPart.toLowerCase(), port: Number(portPart) };
}

/**
 * Guess the hosting product from a pasted connection string.
 *
 * The point of the picker is the guidance behind it, and someone who has
 * already pasted their URL should not have to answer a question the URL just
 * answered. Returns null when the hostname says nothing, which is the ordinary
 * case for a self-hosted database.
 */
export function detectHosting(url: string, wire: "postgres" | "mysql"): DbHostingOption | null {
  const host = hostPortOf(url).host;
  if (!host) return null;

  const patterns: [RegExp, string][] = [
    [/\.pooler\.supabase\.com$|^db\.[a-z0-9]+\.supabase\.co$/, "supabase"],
    [/\.neon\.tech$/, "neon"],
    [/^pg-.*\.aivencloud\.com$/, "aiven_postgresql"],
    [/^mysql-.*\.aivencloud\.com$/, "aiven_mysql"],
    [/\.psdb\.cloud$/, "planetscale"],
    [/\.tidbcloud\.com$/, "tidb"],
    [/\.rds\.amazonaws\.com$/, wire === "mysql" ? "rds_mysql" : "rds_postgresql"],
    [/\.postgres\.database\.azure\.com$/, "azure_postgresql"],
    [/\.mysql\.database\.azure\.com$/, "azure_mysql"],
    [/\.tsdb\.cloud\.timescale\.com$/, "timescale"],
    [/\.cockroachlabs\.cloud$/, "cockroachdb"],
    [/\.db\.ondigitalocean\.com$/, "digitalocean_postgresql"],
  ];
  for (const [pattern, id] of patterns) {
    const match = hostingEntry(id);
    if (pattern.test(host) && match?.wire === wire) return match;
  }
  return null;
}

/**
 * The pooling mode a pasted URL implies, where the product makes it unambiguous.
 *
 * Returns null rather than guessing. A wrong guess is worse than none: claiming
 * a direct connection is transaction-pooled silently disables prepared
 * statements, and claiming the reverse re-arms the failure the picker exists to
 * prevent. Mirrors `DbProviders.detectMode` on the server.
 */
export function detectPoolingMode(url: string, hosting: DbHostingOption | null): PoolingMode | null {
  if (!hosting) return null;
  const { host, port } = hostPortOf(url);

  switch (hosting.id) {
    case "supabase":
      if (host.endsWith(".pooler.supabase.com")) return port === 6543 ? "transaction_pooler" : "session_pooler";
      return host.startsWith("db.") ? "direct" : null;
    case "neon":
      return host.includes("-pooler.") ? "transaction_pooler" : "direct";
    case "planetscale":
    case "tidb":
      return "transaction_pooler";
    case "rds_postgresql":
    case "rds_mysql":
      return host.includes(".proxy-") ? "transaction_pooler" : "direct";
    case "azure_postgresql":
      return port === 6432 ? "transaction_pooler" : "direct";
    default:
      return null;
  }
}

/* ══════════════════════════════════════════════════════════════════════════════
   WHAT EACH CONNECTION CAN ACTUALLY DO

   A connection is a credential. A tool is one specific thing that credential is
   allowed to do. Until now the gap between the two was a blank form: picking a
   Gmail connection for an HTTP tool asked for a METHOD and a URL, so registering
   "send an email" meant knowing that Gmail's send endpoint is
   `POST /gmail/v1/users/me/messages/send` and that the body is a base64url RFC
   2822 blob. Nobody who is not already a Gmail API developer gets that right,
   and the ones who do get it right resent being asked.

   THE FROM/TO DECISION IS THE POINT, NOT THE FORM. Every parameter here declares
   where it is BOUND:

     · `config` — fixed when the tool is registered. The agent cannot change it.
     · `input`  — supplied on every call. The agent chooses it.

   That is a blast-radius decision wearing a form field's clothes. A Gmail tool
   whose `to` is bound at registration can email exactly one address, forever; the
   same tool with `to` on input can email anyone the model can be talked into
   naming. `bindable: true` marks the parameters where both answers are
   legitimate, so the dialog can ask — once, in words, at the moment the decision
   is actually being made.

   THE CATALOGUE IS NOT THE LIMIT. Every provider keeps a "custom request"
   escape hatch, because a catalogue that cannot be escaped is a ceiling. What it
   removes is the requirement to start from one.
══════════════════════════════════════════════════════════════════════════════ */

export type OperationParamType = "string" | "email" | "text" | "number" | "boolean" | "json";

export interface OperationParam {
  name: string;
  label: string;
  type: OperationParamType;
  required: boolean;
  /** Where the value comes from. See the header. */
  binding: "config" | "input";
  /** True when fixing it at registration and letting the agent choose are both sensible. */
  bindable?: boolean;
  help?: string;
  placeholder?: string;
}

export interface ProviderOperation {
  id: string;
  provider: ProviderId;
  label: string;
  /** One line. What it does, in the user's words rather than the vendor's. */
  description: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** Appended to the connection's base URL. */
  path: string;
  /** True when it changes something at the other end. */
  writes: boolean;
  /** Default risk tier. The operator may raise it; the dialog will not lower it. */
  risk: "low" | "medium" | "high" | "critical";
  params: OperationParam[];
  /** Concrete: what somebody actually builds with this. Shown after connecting. */
  useCase: string;
  /**
   * The request body, with `{{param}}` where each parameter goes.
   *
   * Only for operations whose body is not simply the parameters by name — a
   * Teams message is an Adaptive Card with the text four levels down. Filled at
   * any depth by the worker (`ToolNodeExecutor.resolveTemplateValue`); a key whose
   * whole value is a template the caller left empty is dropped.
   */
  bodyTemplate?: Record<string, unknown>;
  /**
   * Offers "Send test message" when registering the tool. Only operations the
   * API's `TestMessageSender` knows how to post — it builds the request itself
   * rather than taking one from the browser.
   */
  sendsTestMessage?: boolean;
}

const RECIPIENT: OperationParam = {
  name: "to",
  label: "To",
  type: "email",
  required: true,
  binding: "config",
  bindable: true,
  placeholder: "ops@yourcompany.com",
  help: "Fixed here, this tool can only ever email this address. Left to the agent, it can email anyone it decides to.",
};

export const PROVIDER_OPERATIONS: ProviderOperation[] = [
  /* ── Gmail ──────────────────────────────────────────────────────────────── */
  {
    id: "gmail.send",
    provider: "gmail",
    label: "Send an email",
    description: "Sends mail as the connected mailbox.",
    method: "POST",
    path: "/gmail/v1/users/me/messages/send",
    writes: true,
    risk: "high",
    useCase: "Email the on-call address when a run fails, or send a customer the summary an agent just wrote.",
    params: [
      {
        name: "from",
        label: "From",
        type: "email",
        required: true,
        binding: "config",
        placeholder: "notifications@yourcompany.com",
        help: "Must be the connected mailbox or an alias it is allowed to send as. Gmail rejects anything else.",
      },
      RECIPIENT,
      {
        name: "subject",
        label: "Subject",
        type: "string",
        required: true,
        binding: "input",
        bindable: true,
        help: "Usually written by the agent. Fix it here if every message should carry the same subject.",
      },
      { name: "body", label: "Body", type: "text", required: true, binding: "input" },
    ],
  },
  {
    id: "gmail.search",
    provider: "gmail",
    label: "Search threads",
    description: "Finds messages matching a Gmail search query.",
    method: "GET",
    path: "/gmail/v1/users/me/messages",
    writes: false,
    risk: "medium",
    useCase: "Pull the last reply from a customer thread before an agent drafts the next one.",
    params: [
      {
        name: "q",
        label: "Search query",
        type: "string",
        required: true,
        binding: "input",
        bindable: true,
        placeholder: "from:billing@acme.com is:unread",
        help: "Gmail's own search syntax. Fix it here to give the agent one fixed inbox view rather than free rein.",
      },
      { name: "maxResults", label: "Maximum results", type: "number", required: false, binding: "config" },
    ],
  },

  /* ── Microsoft Teams, Google Chat, Discord ──────────────────────────────────
     Posting through a channel webhook. The path is empty because the
     connection's URL IS the destination, and the worker refuses to let a tool
     or an agent send it anywhere else. There is no channel parameter for the
     same reason: the URL was issued for one channel. */
  {
    id: "teams.post",
    sendsTestMessage: true,
    provider: "teams",
    label: "Post a message",
    description: "Posts a card with your message into the connected Teams channel.",
    method: "POST",
    path: "",
    writes: true,
    risk: "medium",
    useCase: "Post a daily summary into the team's channel, or tell a channel a run needs someone to look at it.",
    params: [
      {
        name: "text",
        label: "Message",
        type: "text",
        required: true,
        binding: "input",
        help: "Markdown works: **bold**, _italic_, lists and [links](https://example.com).",
      },
    ],
    bodyTemplate: {
      type: "message",
      attachments: [
        {
          contentType: "application/vnd.microsoft.card.adaptive",
          content: {
            $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
            type: "AdaptiveCard",
            version: "1.4",
            body: [
              { type: "TextBlock", text: "{{text}}", wrap: true },
            ],
          },
        },
      ],
    },
  },
  {
    id: "google-chat.post",
    sendsTestMessage: true,
    provider: "google-chat",
    label: "Post a message",
    description: "Posts your message into the connected Google Chat space.",
    method: "POST",
    path: "",
    writes: true,
    risk: "medium",
    useCase: "Drop a run's findings into the space the team already reads.",
    params: [
      {
        name: "text",
        label: "Message",
        type: "text",
        required: true,
        binding: "input",
        help: "Google Chat formatting works: *bold*, _italic_, ~strike~ and <https://example.com|links>.",
      },
    ],
    bodyTemplate: { text: "{{text}}" },
  },
  {
    id: "discord.post",
    sendsTestMessage: true,
    provider: "discord",
    label: "Post a message",
    description: "Posts your message into the connected Discord channel.",
    method: "POST",
    path: "",
    writes: true,
    risk: "medium",
    useCase: "Announce a release or an incident update in the community's channel.",
    params: [
      {
        name: "content",
        label: "Message",
        type: "text",
        required: true,
        binding: "input",
        help: "Up to 2,000 characters. Markdown works: **bold**, *italic*, `code` and lists.",
      },
      {
        name: "username",
        label: "Post as",
        type: "string",
        required: false,
        binding: "config",
        bindable: true,
        placeholder: "Vectorbea",
        help: "The name shown on the message. Leave empty to use the webhook's own name.",
      },
    ],
    bodyTemplate: { content: "{{content}}", username: "{{username}}" },
  },

  /* ── Slack ──────────────────────────────────────────────────────────────── */
  {
    id: "slack.post",
    sendsTestMessage: true,
    provider: "slack",
    label: "Post a message",
    description: "Posts to a channel as the Vectorbea app.",
    method: "POST",
    path: "/chat.postMessage",
    writes: true,
    risk: "medium",
    useCase: "Announce a completed run in #ops, or ask a human to approve something in the channel they already watch.",
    params: [
      {
        name: "channel",
        label: "Channel",
        type: "string",
        required: true,
        binding: "config",
        bindable: true,
        placeholder: "C0123456789 or #ops-alerts",
        help: "The channel ID (in Slack, open the channel details — it's at the bottom) or the #channel-name. Invite the bot first by typing /invite @your-bot in the channel.",
      },
      {
        name: "text",
        label: "Message",
        type: "text",
        required: true,
        binding: "input",
        help: "Slack formatting works: *bold*, _italic_, <https://example.com|links> and <@U0123> mentions.",
      },
      {
        name: "thread_ts",
        label: "Reply in thread",
        type: "string",
        required: false,
        binding: "input",
        help: "The parent message timestamp. Leave empty to post at top level.",
      },
    ],
  },
  {
    /*
     * Reading was missing, and it is half of what a Slack bot is for.
     *
     * The catalogue had post and user-lookup, so an agent could announce and
     * mention and could not read a word — which makes "an agent that answers
     * the question somebody asked in #support" unbuildable, and that is the
     * first thing anybody tries.
     *
     * `conversations.history` needs `channels:history` (and `groups:history`
     * for private channels), which is why the seed above asks for it
     * separately: it is a materially larger grant than posting and should be a
     * separate decision.
     */
    id: "slack.read",
    provider: "slack",
    label: "Read recent messages",
    description: "Reads the most recent messages in one channel.",
    method: "GET",
    path: "/conversations.history",
    writes: false,
    risk: "medium",
    useCase: "Let an agent answer from what was already said in the channel, rather than asking the question again.",
    params: [
      {
        name: "channel",
        label: "Channel",
        type: "string",
        required: true,
        binding: "config",
        bindable: true,
        placeholder: "C0123456789",
        help: "The channel ID, not the #name — conversations.history takes an id. Fixed here, so the tool can only ever read this one channel.",
      },
      {
        name: "limit",
        label: "How many messages",
        type: "number",
        required: false,
        binding: "config",
        bindable: true,
        placeholder: "20",
        help: "Bound it. A channel's whole history in a prompt is the observation-size problem, and the agent reads the newest first anyway.",
      },
      {
        name: "oldest",
        label: "Since",
        type: "string",
        required: false,
        binding: "input",
        help: "A Slack timestamp. Leave empty for the most recent messages.",
      },
    ],
  },
  {
    /*
     * A thread, rather than a channel. Separate from `slack.read` because the
     * common shape — a mention starts a workflow, the agent reads the thread it
     * was mentioned in — needs the parent timestamp and nothing else, and
     * making somebody configure a channel filter for that is asking the wrong
     * question.
     */
    id: "slack.thread",
    provider: "slack",
    label: "Read a thread",
    description: "Reads every reply under one message.",
    method: "GET",
    path: "/conversations.replies",
    writes: false,
    risk: "medium",
    useCase: "The bot is mentioned in a thread. This is how the agent reads what was said before it was called in.",
    params: [
      { name: "channel", label: "Channel", type: "string", required: true, binding: "input", help: "The channel id from the event that started the run." },
      { name: "ts", label: "Parent message", type: "string", required: true, binding: "input", help: "The thread's parent timestamp, from the triggering event." },
    ],
  },
  {
    id: "slack.lookup",
    provider: "slack",
    label: "Find a user by email",
    description: "Resolves an email address to a Slack user id.",
    method: "GET",
    path: "/users.lookupByEmail",
    writes: false,
    risk: "low",
    useCase: "Turn the email on a support ticket into an @mention so the right person is pinged.",
    params: [{ name: "email", label: "Email", type: "email", required: true, binding: "input" }],
  },

  /* ── GitHub ─────────────────────────────────────────────────────────────── */
  {
    id: "github.createIssue",
    provider: "github",
    label: "Open an issue",
    description: "Creates an issue in one repository.",
    method: "POST",
    path: "/repos/{owner}/{repo}/issues",
    writes: true,
    risk: "medium",
    useCase: "File a bug from a support conversation, with the triage notes an agent already wrote.",
    params: [
      {
        name: "owner",
        label: "Owner",
        type: "string",
        required: true,
        binding: "config",
        placeholder: "your-org",
        help: "Bound at registration on purpose — an agent that can choose the owner can file issues in anyone's repository.",
      },
      { name: "repo", label: "Repository", type: "string", required: true, binding: "config", placeholder: "platform" },
      { name: "title", label: "Title", type: "string", required: true, binding: "input" },
      { name: "body", label: "Body", type: "text", required: false, binding: "input" },
    ],
  },
  {
    id: "github.readPr",
    provider: "github",
    label: "Read a pull request",
    description: "Fetches one pull request and its metadata.",
    method: "GET",
    path: "/repos/{owner}/{repo}/pulls/{number}",
    writes: false,
    risk: "low",
    useCase: "Let an agent summarise what changed before it writes release notes.",
    params: [
      { name: "owner", label: "Owner", type: "string", required: true, binding: "config" },
      { name: "repo", label: "Repository", type: "string", required: true, binding: "config" },
      { name: "number", label: "Pull request number", type: "number", required: true, binding: "input" },
    ],
  },
  {
    id: "github.comment",
    provider: "github",
    label: "Comment on an issue or pull request",
    description: "Adds a comment to an existing thread.",
    method: "POST",
    path: "/repos/{owner}/{repo}/issues/{number}/comments",
    writes: true,
    risk: "medium",
    useCase: "Post an agent's triage findings back onto the issue that prompted them.",
    params: [
      { name: "owner", label: "Owner", type: "string", required: true, binding: "config" },
      { name: "repo", label: "Repository", type: "string", required: true, binding: "config" },
      { name: "number", label: "Issue or PR number", type: "number", required: true, binding: "input" },
      { name: "body", label: "Comment", type: "text", required: true, binding: "input" },
    ],
  },

  /* ── Notion ─────────────────────────────────────────────────────────────── */
  {
    id: "notion.queryDatabase",
    provider: "notion",
    label: "Query a database",
    description: "Reads pages from one Notion database.",
    method: "POST",
    path: "/v1/databases/{database_id}/query",
    writes: false,
    risk: "low",
    useCase: "Look up the runbook entry that matches an alert before an agent acts on it.",
    params: [
      {
        name: "database_id",
        label: "Database ID",
        type: "string",
        required: true,
        binding: "config",
        help: "Notion grants access per page. This must be a database you shared with the integration.",
      },
      { name: "filter", label: "Filter", type: "json", required: false, binding: "input" },
    ],
  },
  {
    id: "notion.createPage",
    provider: "notion",
    label: "Create a page",
    description: "Adds a page to one Notion database.",
    method: "POST",
    path: "/v1/pages",
    writes: true,
    risk: "medium",
    useCase: "Write an incident write-up into the incidents database as soon as a run fails.",
    params: [
      { name: "database_id", label: "Parent database ID", type: "string", required: true, binding: "config" },
      { name: "title", label: "Title", type: "string", required: true, binding: "input" },
      { name: "properties", label: "Properties", type: "json", required: false, binding: "input" },
    ],
  },

  /* ── Airtable ───────────────────────────────────────────────────────────── */
  {
    id: "airtable.listRecords",
    provider: "airtable",
    label: "List records",
    description: "Reads records from one table.",
    method: "GET",
    path: "/v0/{base_id}/{table}",
    writes: false,
    risk: "low",
    useCase: "Read the customer list an agent needs to segment before it writes anything.",
    params: [
      { name: "base_id", label: "Base ID", type: "string", required: true, binding: "config", placeholder: "appXXXXXXXXXXXXXX" },
      { name: "table", label: "Table", type: "string", required: true, binding: "config" },
      { name: "filterByFormula", label: "Filter formula", type: "string", required: false, binding: "input" },
    ],
  },
  {
    id: "airtable.createRecord",
    provider: "airtable",
    label: "Create a record",
    description: "Adds one record to a table.",
    method: "POST",
    path: "/v0/{base_id}/{table}",
    writes: true,
    risk: "medium",
    useCase: "Log every processed lead into the tracker your team already lives in.",
    params: [
      { name: "base_id", label: "Base ID", type: "string", required: true, binding: "config" },
      { name: "table", label: "Table", type: "string", required: true, binding: "config" },
      { name: "fields", label: "Fields", type: "json", required: true, binding: "input" },
    ],
  },

  /* ── HubSpot ────────────────────────────────────────────────────────────── */
  {
    id: "hubspot.findContact",
    provider: "hubspot",
    label: "Find a contact",
    description: "Searches contacts by email or another property.",
    method: "POST",
    path: "/crm/v3/objects/contacts/search",
    writes: false,
    risk: "medium",
    useCase: "Pull the account history behind an inbound email before an agent replies to it.",
    params: [{ name: "email", label: "Email", type: "email", required: true, binding: "input" }],
  },
  {
    id: "hubspot.updateDeal",
    provider: "hubspot",
    label: "Update a deal stage",
    description: "Moves one deal to a different stage.",
    method: "PATCH",
    path: "/crm/v3/objects/deals/{deal_id}",
    writes: true,
    risk: "high",
    useCase: "Advance a deal when the signed contract lands, without anyone retyping it.",
    params: [
      { name: "deal_id", label: "Deal ID", type: "string", required: true, binding: "input" },
      {
        name: "dealstage",
        label: "Target stage",
        type: "string",
        required: true,
        binding: "config",
        bindable: true,
        help: "Fixed here, this tool can only ever move deals to one stage — which is usually what you want from an automation.",
      },
    ],
  },

  /* ── Google Sheets ──────────────────────────────────────────────────────── */
  {
    id: "sheets.appendRow",
    provider: "google-sheets",
    label: "Append a row",
    description: "Adds a row to the end of a sheet.",
    method: "POST",
    path: "/v4/spreadsheets/{spreadsheet_id}/values/{range}:append",
    writes: true,
    risk: "medium",
    useCase: "Keep a running log of everything a workflow decided, somewhere finance can read it.",
    params: [
      { name: "spreadsheet_id", label: "Spreadsheet ID", type: "string", required: true, binding: "config" },
      { name: "range", label: "Range", type: "string", required: true, binding: "config", placeholder: "Sheet1!A:D" },
      { name: "values", label: "Row values", type: "json", required: true, binding: "input" },
    ],
  },
  {
    id: "sheets.readRange",
    provider: "google-sheets",
    label: "Read a range",
    description: "Reads cells from a sheet.",
    method: "GET",
    path: "/v4/spreadsheets/{spreadsheet_id}/values/{range}",
    writes: false,
    risk: "low",
    useCase: "Read the config table a non-technical teammate maintains, instead of hard-coding it.",
    params: [
      { name: "spreadsheet_id", label: "Spreadsheet ID", type: "string", required: true, binding: "config" },
      { name: "range", label: "Range", type: "string", required: true, binding: "input", bindable: true },
    ],
  },

  /* ── Jira ───────────────────────────────────────────────────────────────── */
  {
    id: "jira.createIssue",
    provider: "jira",
    label: "Create an issue",
    description: "Files an issue in one project.",
    method: "POST",
    path: "/rest/api/3/issue",
    writes: true,
    risk: "medium",
    useCase: "Turn an alert into a ticket in the project the team actually triages.",
    params: [
      {
        name: "project",
        label: "Project key",
        type: "string",
        required: true,
        binding: "config",
        placeholder: "OPS",
        help: "Bound at registration — an agent that can pick the project can file into any project the token can see.",
      },
      { name: "issuetype", label: "Issue type", type: "string", required: true, binding: "config", placeholder: "Task" },
      { name: "summary", label: "Summary", type: "string", required: true, binding: "input" },
      { name: "description", label: "Description", type: "text", required: false, binding: "input" },
    ],
  },
];

/** Operations a provider supplies, in the order they should be offered. */
export function operationsFor(provider: string | null | undefined): ProviderOperation[] {
  if (!provider) return [];
  const key = normaliseProvider(provider);
  return PROVIDER_OPERATIONS.filter((op) => normaliseProvider(op.provider) === key);
}

export function operationById(id: string | null | undefined): ProviderOperation | undefined {
  return PROVIDER_OPERATIONS.find((op) => op.id === id);
}

/**
 * The stored `provider` value and the catalogue's `ProviderId` are not spelled
 * the same: the API stores `google_sheets`, the catalogue says `google-sheets`.
 * Matching them by raw equality silently produced "this connection supplies no
 * operations" for a provider that supplies two.
 */
export function normaliseProvider(provider: string): string {
  return provider.trim().toLowerCase().replace(/_/g, "-");
}

/**
 * The JSON Schema for the parameters the agent supplies at call time.
 *
 * Only `input`-bound parameters appear. A `config`-bound one is not a schema
 * property at all — it is a value the engine substitutes, and putting it in the
 * schema would invite the model to override the very binding that constrains it.
 */
export function inputSchemaFor(
  operation: ProviderOperation,
  bindings: Record<string, "config" | "input">,
): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const param of operation.params) {
    if ((bindings[param.name] ?? param.binding) !== "input") continue;
    properties[param.name] = {
      type: param.type === "number" ? "number" : param.type === "boolean" ? "boolean" : param.type === "json" ? "object" : "string",
      ...(param.type === "email" ? { format: "email" } : {}),
      description: param.help ?? param.label,
    };
    if (param.required) required.push(param.name);
  }
  return { type: "object", properties, ...(required.length ? { required } : {}) };
}
