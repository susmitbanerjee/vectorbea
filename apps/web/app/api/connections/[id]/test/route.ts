import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@/lib/generated/prisma";
import { db } from "@/server/db";
import { getSecretForRuntime } from "@/lib/server/secret-service";
import { checkSSRF } from "@/lib/server/ssrf-protection";
import { cacheSet, cacheGet, CacheKeys, TTL } from "@/lib/server/cache";
import { redactErrorMessage, redactConnectionString } from "@/lib/server/redact";

// ─── Failure categories ───────────────────────────────────────────────────────

type FailureCode =
  | "SECRET_MISSING"
  | "AUTH_FAILED"
  | "NETWORK_UNREACHABLE"
  | "DNS_FAILED"
  | "TLS_FAILED"
  | "TIMEOUT"
  | "WHITELIST_REQUIRED"
  | "PRIVATE_NETWORK_UNREACHABLE"
  | "PRIVATE_RUNNER_REQUIRED"
  | "PERMISSION_DENIED"
  | "INVALID_CONFIG"
  | "PROVIDER_ERROR"
  | "UNKNOWN_ERROR";

interface TestResult {
  status: "connected" | "failed";
  latencyMs: number | null;
  errorCode: FailureCode | null;
  errorMessage: string | null;
  testedAt: string;
}

// ─── LLM Provider test ────────────────────────────────────────────────────────

async function testLLMProvider(
  provider: string,
  config: Record<string, unknown>,
  secret: string | null,
): Promise<TestResult> {
  if (!secret) {
    return { status: "failed", latencyMs: null, errorCode: "SECRET_MISSING", errorMessage: "API key is not configured.", testedAt: new Date().toISOString() };
  }

  const t0 = Date.now();
  const timeout = parseInt(process.env.CONNECTION_TEST_TIMEOUT_MS ?? "10000");

  try {
    let url: string;
    let headers: Record<string, string>;

    // Normalize provider
    const p = provider.toLowerCase().replace(/[^a-z]/g, "");
    const baseUrl = typeof config.baseUrl === "string" ? config.baseUrl.replace(/\/$/, "") : null;

    if (p.includes("openai") || p.includes("azure")) {
      url = baseUrl ? `${baseUrl}/models` : "https://api.openai.com/v1/models";
      headers = { Authorization: `Bearer ${secret}` };
    } else if (p.includes("anthropic")) {
      url = baseUrl ? `${baseUrl}/models` : "https://api.anthropic.com/v1/models";
      headers = { "x-api-key": secret, "anthropic-version": "2023-06-01" };
    } else if (p.includes("google") || p.includes("gemini")) {
      // SECURITY: key must go in header, never in URL query param (would appear in logs/proxies)
      url = `https://generativelanguage.googleapis.com/v1beta/models`;
      headers = { "x-goog-api-key": secret };
    } else {
      // Generic: try to reach base URL with auth header
      if (!baseUrl) {
        return { status: "failed", latencyMs: null, errorCode: "INVALID_CONFIG", errorMessage: "Base URL is required for this provider.", testedAt: new Date().toISOString() };
      }
      url = `${baseUrl}/models`;
      headers = { Authorization: `Bearer ${secret}` };
    }

    // SSRF check uses URL without query-param secrets (Google key is now header-only; others are header-only too)
    const ssrfUrl = url.split("?")[0]!;
    const ssrf = await checkSSRF(ssrfUrl);
    if (!ssrf.allowed) {
      const code = (ssrf.reason ?? "").includes("PRIVATE") ? "PRIVATE_NETWORK_UNREACHABLE" : "NETWORK_UNREACHABLE";
      return { status: "failed", latencyMs: null, errorCode: code as FailureCode, errorMessage: ssrf.reason ?? "Network blocked.", testedAt: new Date().toISOString() };
    }

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    const resp = await fetch(url, { method: "GET", headers, signal: ctrl.signal });
    clearTimeout(timer);

    const latencyMs = Date.now() - t0;

    if (resp.status === 401) return { status: "failed", latencyMs, errorCode: "AUTH_FAILED", errorMessage: "Invalid API key or authentication failed.", testedAt: new Date().toISOString() };
    if (resp.status === 403) return { status: "failed", latencyMs, errorCode: "PERMISSION_DENIED", errorMessage: "API key does not have permission to access this endpoint.", testedAt: new Date().toISOString() };
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      return { status: "failed", latencyMs, errorCode: "PROVIDER_ERROR", errorMessage: `Provider returned HTTP ${resp.status}. ${redactErrorMessage(body.slice(0, 200))}`, testedAt: new Date().toISOString() };
    }

    return { status: "connected", latencyMs, errorCode: null, errorMessage: null, testedAt: new Date().toISOString() };
  } catch (e: unknown) {
    const latencyMs = Date.now() - t0;
    const msg = e instanceof Error ? e.message : "Unknown error";
    if (msg.includes("aborted") || msg.includes("timeout")) {
      return { status: "failed", latencyMs, errorCode: "TIMEOUT", errorMessage: `Connection timed out after ${timeout}ms.`, testedAt: new Date().toISOString() };
    }
    if (msg.includes("ENOTFOUND") || msg.includes("getaddrinfo")) {
      return { status: "failed", latencyMs, errorCode: "DNS_FAILED", errorMessage: redactErrorMessage(msg), testedAt: new Date().toISOString() };
    }
    if (msg.includes("certificate") || msg.includes("SSL") || msg.includes("TLS")) {
      return { status: "failed", latencyMs, errorCode: "TLS_FAILED", errorMessage: "TLS/SSL certificate error.", testedAt: new Date().toISOString() };
    }
    return { status: "failed", latencyMs, errorCode: "UNKNOWN_ERROR", errorMessage: redactErrorMessage(msg.slice(0, 300)), testedAt: new Date().toISOString() };
  }
}

// ─── Database connection test ─────────────────────────────────────────────────

async function testDatabaseConnection(
  provider: string,
  config: Record<string, unknown>,
  secret: string | null,
): Promise<TestResult> {
  const t0 = Date.now();
  const timeout = parseInt(process.env.CONNECTION_TEST_TIMEOUT_MS ?? "10000");

  // Reconstruct connection string from config
  const connString = secret ?? (typeof config.connectionString === "string" ? config.connectionString : null);
  if (!connString) {
    return { status: "failed", latencyMs: null, errorCode: "SECRET_MISSING", errorMessage: "Database connection string or credentials are not configured.", testedAt: new Date().toISOString() };
  }

  // Check SSRF before attempting connection
  try {
    const url = new URL(connString.includes("://") ? connString : `postgres://${connString}`);
    const ssrf = await checkSSRF(`http://${url.hostname}:${url.port || 5432}`);
    if (!ssrf.allowed) {
      // Private database — indicate this
      return {
        status: "failed",
        latencyMs: null,
        errorCode: "PRIVATE_RUNNER_REQUIRED",
        errorMessage: `${ssrf.reason ?? "This database appears to be on a private network."} Configure a private runner to reach internal databases.`,
        testedAt: new Date().toISOString(),
      };
    }
  } catch {
    // Can't parse URL — proceed anyway
  }

  const p = provider.toLowerCase();
  const isPostgres = p.includes("postgres") || p.includes("pg") || p.includes("neon") || p.includes("supabase");
  const isMySQL    = p.includes("mysql") || p.includes("mariadb");
  const isMongo    = p.includes("mongo");

  if (isPostgres) {
    try {
      const { Client } = await import("pg");
      const client = new Client({ connectionString: connString, connectionTimeoutMillis: timeout });
      await client.connect();
      await client.query("SELECT 1");
      await client.end();
      return { status: "connected", latencyMs: Date.now() - t0, errorCode: null, errorMessage: null, testedAt: new Date().toISOString() };
    } catch (e: unknown) {
      const msg = (e instanceof Error ? e.message : String(e));
      const safeMsg = redactConnectionString(redactErrorMessage(msg.slice(0, 300)));
      const code = msg.includes("ENOTFOUND") ? "DNS_FAILED" : msg.includes("timeout") ? "TIMEOUT" : msg.includes("password") || msg.includes("auth") ? "AUTH_FAILED" : "NETWORK_UNREACHABLE";
      return { status: "failed", latencyMs: Date.now() - t0, errorCode: code as FailureCode, errorMessage: safeMsg, testedAt: new Date().toISOString() };
    }
  }

  // MySQL / other — basic TCP check
  if (isMySQL || isMongo) {
    return { status: "failed", latencyMs: null, errorCode: "INVALID_CONFIG", errorMessage: `Direct ${p} connection tests are not yet supported. Use a PostgreSQL connection for now.`, testedAt: new Date().toISOString() };
  }

  return { status: "failed", latencyMs: null, errorCode: "INVALID_CONFIG", errorMessage: "Unknown database provider.", testedAt: new Date().toISOString() };
}

// ─── HTTP/API connection test ─────────────────────────────────────────────────

async function testHTTPConnection(
  config: Record<string, unknown>,
  secret: string | null,
  authType: string,
): Promise<TestResult> {
  const t0 = Date.now();
  const timeout = parseInt(process.env.CONNECTION_TEST_TIMEOUT_MS ?? "10000");

  const baseUrl = typeof config.baseUrl === "string" ? config.baseUrl.replace(/\/$/, "") : null;
  const healthEndpoint = typeof config.healthEndpoint === "string" ? config.healthEndpoint : "";
  const privateRunner = config.privateRunnerRequired === true;

  if (!baseUrl) {
    return { status: "failed", latencyMs: null, errorCode: "INVALID_CONFIG", errorMessage: "Base URL is not configured.", testedAt: new Date().toISOString() };
  }

  const targetUrl = healthEndpoint ? `${baseUrl}${healthEndpoint}` : baseUrl;

  const ssrf = await checkSSRF(targetUrl, privateRunner);
  if (!ssrf.allowed) {
    const code = (ssrf.reason ?? "").includes("PRIVATE") ? "PRIVATE_RUNNER_REQUIRED" : "NETWORK_UNREACHABLE";
    return { status: "failed", latencyMs: null, errorCode: code as FailureCode, errorMessage: ssrf.reason ?? "Network blocked.", testedAt: new Date().toISOString() };
  }

  const headers: Record<string, string> = {};
  if (authType === "bearer_token" && secret) {
    headers["Authorization"] = `Bearer ${secret}`;
  } else if (authType === "api_key" && secret) {
    const headerName = typeof config.apiKeyHeader === "string" ? config.apiKeyHeader : "X-API-Key";
    headers[headerName] = secret;
  } else if (authType === "basic_auth" && secret) {
    headers["Authorization"] = `Basic ${Buffer.from(secret).toString("base64")}`;
  }

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    const resp = await fetch(targetUrl, { method: "HEAD", headers, signal: ctrl.signal });
    clearTimeout(timer);

    // If HEAD not allowed, try GET
    if (resp.status === 405) {
      const ctrl2 = new AbortController();
      const timer2 = setTimeout(() => ctrl2.abort(), timeout);
      const resp2 = await fetch(targetUrl, { method: "GET", headers, signal: ctrl2.signal });
      clearTimeout(timer2);
      return classifyHttpResponse(resp2, Date.now() - t0);
    }

    return classifyHttpResponse(resp, Date.now() - t0);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("aborted")) return { status: "failed", latencyMs: Date.now() - t0, errorCode: "TIMEOUT", errorMessage: `Timed out after ${timeout}ms.`, testedAt: new Date().toISOString() };
    if (msg.includes("ENOTFOUND")) return { status: "failed", latencyMs: Date.now() - t0, errorCode: "DNS_FAILED", errorMessage: redactErrorMessage(msg.slice(0, 200)), testedAt: new Date().toISOString() };
    if (msg.includes("certificate") || msg.includes("SSL")) return { status: "failed", latencyMs: Date.now() - t0, errorCode: "TLS_FAILED", errorMessage: "TLS/SSL error.", testedAt: new Date().toISOString() };
    return { status: "failed", latencyMs: Date.now() - t0, errorCode: "NETWORK_UNREACHABLE", errorMessage: redactErrorMessage(msg.slice(0, 200)), testedAt: new Date().toISOString() };
  }
}

function classifyHttpResponse(resp: Response, latencyMs: number): TestResult {
  const ts = new Date().toISOString();
  if (resp.status === 401) return { status: "failed", latencyMs, errorCode: "AUTH_FAILED", errorMessage: "Authentication failed (HTTP 401). Check credentials.", testedAt: ts };
  if (resp.status === 403) return { status: "failed", latencyMs, errorCode: "PERMISSION_DENIED", errorMessage: "Access forbidden (HTTP 403). Check API key permissions.", testedAt: ts };
  if (resp.ok || resp.status === 302 || resp.status === 301) return { status: "connected", latencyMs, errorCode: null, errorMessage: null, testedAt: ts };
  return { status: "failed", latencyMs, errorCode: "PROVIDER_ERROR", errorMessage: `HTTP ${resp.status}`, testedAt: ts };
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const workspaceId = request.nextUrl.searchParams.get("workspaceId");
  if (!workspaceId) return NextResponse.json({ error: "workspaceId required" }, { status: 400 });

  // Check cache first
  const cacheKey = CacheKeys.connectionTest(id);
  const cached = await cacheGet<TestResult>(cacheKey);
  if (cached && request.nextUrl.searchParams.get("force") !== "1") {
    return NextResponse.json({ ...cached, cached: true });
  }

  // Fetch connection from DB
  const rows = await db.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
    SELECT id, workspace_id, type, provider, status, auth_type, secret_ref, config, network_policy
    FROM vectorbea.connections
    WHERE id = ${id}::uuid AND workspace_id = ${workspaceId}::uuid
    LIMIT 1
  `);

  const conn = rows[0];
  if (!conn) return NextResponse.json({ error: "Connection not found" }, { status: 404 });

  const type       = String(conn.type ?? "");
  const provider   = String(conn.provider ?? "");
  const authType   = String(conn.auth_type ?? "none");
  const secretRef  = conn.secret_ref as string | null;
  const config     = (conn.config ?? {}) as Record<string, unknown>;
  const netPolicy  = (conn.network_policy ?? {}) as Record<string, unknown>;
  const privateRunner = netPolicy.privateRunnerRequired === true;

  // Resolve secret server-side
  let secret: string | null = null;
  if (secretRef) {
    secret = await getSecretForRuntime(secretRef);
  }

  let result: TestResult;

  if (type === "llm_provider") {
    result = await testLLMProvider(provider, config, secret);
  } else if (type === "database") {
    result = await testDatabaseConnection(provider, config, secret);
  } else if (type === "http_api" || type === "saas") {
    result = await testHTTPConnection(config, secret, authType);
  } else if (type === "mcp_server") {
    // MCP: try to reach the endpoint
    result = await testHTTPConnection(
      { baseUrl: config.url ?? config.mcpUrl, healthEndpoint: "/tools" },
      secret,
      authType,
    );
  } else {
    result = {
      status: "failed",
      latencyMs: null,
      errorCode: "INVALID_CONFIG",
      errorMessage: `Connection type '${type}' does not support automated testing yet.`,
      testedAt: new Date().toISOString(),
    };
  }

  // Override for private network detection
  if (result.errorCode === "PRIVATE_NETWORK_UNREACHABLE" && privateRunner) {
    result = {
      ...result,
      errorCode: "PRIVATE_RUNNER_REQUIRED",
      errorMessage: "This system is on a private network. Vectorbea Cloud cannot reach it. Configure a private runner.",
    };
  }

  // Persist test result to DB and return the updated connection row so the
  // client can update its Connection state directly (no second round-trip).
  const updated = await db.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
    UPDATE vectorbea.connections SET
      status               = ${result.status === "connected" ? "connected" : "failed"},
      last_tested_at       = now(),
      last_test_status     = ${result.status === "connected" ? "ok" : "failed"},
      last_test_latency_ms = ${result.latencyMs},
      last_test_error      = ${result.errorMessage},
      updated_at           = now()
    WHERE id = ${id}::uuid AND workspace_id = ${workspaceId}::uuid
    RETURNING
      id, workspace_id, name, slug, type, provider, environment, status,
      auth_type, secret_ref, secret_masked, config, network_policy,
      last_tested_at::text    AS last_tested_at,
      last_test_status,
      last_test_latency_ms,
      last_test_error,
      used_by_agent_ids,
      used_by_tool_ids,
      created_at::text        AS created_at,
      updated_at::text        AS updated_at
  `);

  const updatedRow = updated[0];

  // Cache result
  await cacheSet(cacheKey, result, TTL.CONNECTION_TEST);
  // Invalidate list cache
  const { cacheDel, CacheKeys: CK } = await import("@/lib/server/cache");
  await cacheDel(CK.connections(workspaceId));

  if (!updatedRow) return NextResponse.json(result);

  return NextResponse.json({
    id:                 updatedRow.id,
    workspaceId:        updatedRow.workspace_id,
    name:               updatedRow.name,
    slug:               updatedRow.slug,
    type:               updatedRow.type,
    provider:           updatedRow.provider,
    environment:        updatedRow.environment,
    status:             updatedRow.status,
    authType:           updatedRow.auth_type,
    secretRef:          updatedRow.secret_ref ?? null,
    secretMasked:       updatedRow.secret_masked ?? null,
    secretConfigured:   updatedRow.secret_ref != null,
    config:             updatedRow.config ?? {},
    networkPolicy:      updatedRow.network_policy ?? {},
    lastTestedAt:       updatedRow.last_tested_at ?? null,
    lastTestStatus:     updatedRow.last_test_status ?? null,
    lastTestLatencyMs:  updatedRow.last_test_latency_ms ?? null,
    lastTestError:      updatedRow.last_test_error ?? null,
    usedByAgentIds:     updatedRow.used_by_agent_ids ?? [],
    usedByToolIds:      updatedRow.used_by_tool_ids ?? [],
    createdAt:          updatedRow.created_at,
    updatedAt:          updatedRow.updated_at,
  });
}
