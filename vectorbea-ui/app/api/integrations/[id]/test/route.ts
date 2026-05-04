/**
 * POST /api/integrations/[id]/test
 *
 * Real connectivity tests — not a staleness check.
 *
 * Per integration type:
 *  sdk / direct_api / opentelemetry
 *    → Write a real test trace through createWorkflowTrace (full DB pipeline).
 *      Returns the trace ID as proof the pipeline is live.
 *
 *  sidecar
 *    → HTTP GET to the proxy health endpoint (config.endpoint_url or localhost:8080).
 *      Verifies the proxy process is actually reachable.
 *
 *  ci_cd
 *    → POST a test evidence event through recordEvidenceSourceEvent (full DB pipeline).
 *
 *  llm_provider
 *    → HTTP POST to the provider's completions endpoint with a 1-token request.
 *      Uses config.api_key / config.base_url if configured.
 *
 *  mcp_server / rag_pipeline / custom_webhook
 *    → HTTP GET/HEAD to config.endpoint_url if set.
 *
 *  manual_upload
 *    → Always passes — no external system involved.
 */

import { NextRequest, NextResponse } from "next/server";

import { assertWorkspaceMember } from "@/lib/server/assert-workspace-member";
import { writeAuditEvent } from "@/lib/server/audit-events";
import { recordEvidenceSourceEvent, getIntegration, updateIntegration } from "@/lib/server/integrations";
import { toSafeApiError } from "@/lib/server/safe-api-errors";
import { createWorkflowTrace } from "@/lib/server/workflow-traces";

export const dynamic = "force-dynamic";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function pass(message: string, detail?: string) {
  return { ok: true, message, detail: detail ?? null };
}

function fail(message: string, detail?: string) {
  return { ok: false, message, detail: detail ?? null };
}

async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs = 5000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ─── Per-type test implementations ────────────────────────────────────────────

async function testIngestPipeline(workspaceId: string, integrationType: string) {
  /**
   * Write a real test trace through the full DB pipeline.
   * Uses createWorkflowTrace directly — no HTTP round-trip needed,
   * and no raw ingest token required (tokens are stored hashed).
   */
  const now = new Date().toISOString();
  const trace = await createWorkflowTrace({
    workspaceId,
    capabilityId: null,
    capabilityVersionId: null,
    provider: null,
    model: null,
    userInput: "_test_connectivity_check_",
    finalResponse: "ok",
    finalAction: null,
    outcomeStatus: "success",
    outcomeReason: null,
    totalLatencyMs: 0,
    totalCostEstimate: null,
    totalTokensInput: null,
    totalTokensOutput: null,
    steps: [],
    metadata: {
      is_test: true,
      test_source: integrationType,
      test_at: now,
    },
  });

  await recordEvidenceSourceEvent({
    workspaceId,
    sourceType: integrationType as "sdk" | "opentelemetry" | "direct_api" | "sidecar",
    sourceId: trace.id,
    aiSystemId: null,
    aiSystemVersionId: null,
    eventType: "agent_run",
    payload: { is_test: true },
    normalizedPayload: { is_test: true, outcome_status: "success" },
  });

  return pass(
    "Pipeline is live — test trace written successfully.",
    `Trace ID: ${trace.id}. This test trace will appear in your trace list tagged is_test=true.`,
  );
}

async function testSidecar(config: Record<string, unknown>) {
  const rawUrl = (config.endpoint_url as string | undefined)?.trim()
    || (config.proxy_url as string | undefined)?.trim()
    || "http://localhost:8080";

  // Normalise — strip trailing slash, try /health
  const base = rawUrl.replace(/\/$/, "");
  const healthUrl = `${base}/health`;

  try {
    const res = await fetchWithTimeout(healthUrl, { method: "GET" }, 5000);
    if (res.ok || res.status === 204) {
      return pass(
        `Proxy reachable at ${base}`,
        `GET ${healthUrl} → HTTP ${res.status}`,
      );
    }
    return fail(
      `Proxy responded with HTTP ${res.status}`,
      `GET ${healthUrl} returned an unexpected status. Check the proxy logs.`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("abort") || msg.includes("timeout")) {
      return fail(
        `Proxy not responding at ${base}`,
        `Connection to ${healthUrl} timed out after 5 s. Is the proxy running?`,
      );
    }
    return fail(
      `Could not reach proxy at ${base}`,
      `${msg}. Check that VECTORBEA_KEY and the proxy address are correct.`,
    );
  }
}

async function testLlmProvider(config: Record<string, unknown>) {
  const apiKey = (config.api_key as string | undefined)?.trim()
    || (config.apiKey as string | undefined)?.trim();
  const provider = ((config.provider as string | undefined) ?? "openai").toLowerCase();
  const baseUrl = (config.base_url as string | undefined)?.trim()
    || (config.baseUrl as string | undefined)?.trim();

  if (!apiKey) {
    return fail(
      "No API key configured",
      "Add an API key in the LLM Providers settings page to enable real connectivity testing.",
    );
  }

  // Endpoint and auth header per provider
  let url: string;
  let authHeader: string;
  let body: Record<string, unknown>;

  if (provider === "openai" || provider.includes("openai")) {
    url = baseUrl ? `${baseUrl}/chat/completions` : "https://api.openai.com/v1/chat/completions";
    authHeader = `Bearer ${apiKey}`;
    body = { model: "gpt-4o-mini", messages: [{ role: "user", content: "ping" }], max_tokens: 1 };
  } else if (provider === "anthropic") {
    url = baseUrl ? `${baseUrl}/messages` : "https://api.anthropic.com/v1/messages";
    authHeader = `x-api-key: ${apiKey}`;  // handled separately below
    body = { model: "claude-haiku-20240307", max_tokens: 1, messages: [{ role: "user", content: "ping" }] };
  } else if (provider === "azure") {
    const deployment = (config.deployment as string | undefined) ?? "gpt-4o-mini";
    const azureBase = baseUrl ?? `https://${config.resource_name as string ?? "your-resource"}.openai.azure.com`;
    url = `${azureBase}/openai/deployments/${deployment}/chat/completions?api-version=2024-02-01`;
    authHeader = `Bearer ${apiKey}`;
    body = { messages: [{ role: "user", content: "ping" }], max_tokens: 1 };
  } else {
    // Generic OpenAI-compatible
    if (!baseUrl) {
      return fail("No base URL configured for this provider", "Add a base_url in the provider config.");
    }
    url = `${baseUrl}/chat/completions`;
    authHeader = `Bearer ${apiKey}`;
    body = { model: (config.model as string) ?? "default", messages: [{ role: "user", content: "ping" }], max_tokens: 1 };
  }

  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (provider === "anthropic") {
      headers["x-api-key"] = apiKey;
      headers["anthropic-version"] = "2023-06-01";
    } else {
      headers["Authorization"] = authHeader;
    }

    const res = await fetchWithTimeout(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    }, 10000);

    if (res.ok) {
      return pass(
        `${provider} API key is valid`,
        `POST ${url} → HTTP ${res.status}. Provider accepted the request.`,
      );
    }
    if (res.status === 401 || res.status === 403) {
      return fail(
        "API key rejected by provider",
        `HTTP ${res.status} — the key may be expired, revoked, or typed incorrectly.`,
      );
    }
    if (res.status === 429) {
      // Rate limited → key is valid!
      return pass(
        `${provider} API key is valid (rate-limited)`,
        "Received HTTP 429 — key is accepted but you've hit a rate limit. This is not a problem.",
      );
    }
    const text = await res.text().catch(() => "");
    return fail(
      `Provider returned HTTP ${res.status}`,
      text.slice(0, 200) || "Unexpected response from provider.",
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("abort") || msg.includes("timeout")) {
      return fail("Provider API timed out", `No response from ${url} within 10 s.`);
    }
    return fail("Could not reach provider API", msg);
  }
}

async function testEndpointUrl(config: Record<string, unknown>, label: string) {
  const url = (config.endpoint_url as string | undefined)?.trim()
    || (config.url as string | undefined)?.trim();

  if (!url) {
    return fail(
      `No endpoint URL configured for ${label}`,
      "Add an endpoint_url in the integration config to enable real connectivity testing.",
    );
  }

  try {
    const res = await fetchWithTimeout(url, { method: "HEAD" }, 5000)
      .catch(() => fetchWithTimeout(url, { method: "GET" }, 5000));

    if (res.ok || res.status === 204 || res.status === 405) {
      return pass(
        `${label} endpoint reachable`,
        `${url} → HTTP ${res.status}`,
      );
    }
    return fail(
      `${label} endpoint returned HTTP ${res.status}`,
      `Check that ${url} is correct and the service is running.`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return fail(`Could not reach ${label} endpoint`, `${url} — ${msg}`);
  }
}

// ─── Route ────────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) return NextResponse.json({ error: "workspaceId required" }, { status: 400 });
    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;
    const { id } = await params;

    const conn = await getIntegration(workspaceId, id);
    if (!conn) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const config = conn.config ?? {};
    let testResult: { ok: boolean; message: string; detail: string | null };

    switch (conn.integrationType) {
      case "sdk":
      case "direct_api":
        testResult = await testIngestPipeline(workspaceId, conn.integrationType);
        break;

      case "opentelemetry":
        testResult = await testIngestPipeline(workspaceId, "opentelemetry");
        break;

      case "sidecar":
        testResult = await testSidecar(config);
        // Also verify the DB pipeline is live regardless of proxy reachability
        if (!testResult.ok) break;
        try {
          await testIngestPipeline(workspaceId, "sidecar");
        } catch {
          // Network reached but DB had an issue — surface it
          testResult = fail("Proxy reachable but ingest pipeline failed", "Check server logs for database errors.");
        }
        break;

      case "ci_cd":
        testResult = await testIngestPipeline(workspaceId, "direct_api");
        if (testResult.ok) {
          testResult = pass(
            "CI/CD ingest pipeline is live",
            testResult.detail ?? undefined,
          );
        }
        break;

      case "llm_provider":
        testResult = await testLlmProvider(config);
        break;

      case "mcp_server":
        testResult = await testEndpointUrl(config, "MCP server");
        break;

      case "rag_pipeline":
        testResult = await testEndpointUrl(config, "RAG pipeline");
        break;

      case "custom_webhook":
        testResult = await testEndpointUrl(config, "webhook");
        break;

      case "manual_upload":
        testResult = pass(
          "Manual upload is always available",
          "No external system — upload a file on the Uploads page to submit evidence.",
        );
        break;

      default:
        testResult = fail(
          "Test not implemented for this integration type",
          `Integration type: ${conn.integrationType}`,
        );
    }

    // Update health status based on real test result
    await updateIntegration({
      workspaceId,
      id,
      healthStatus: testResult.ok ? "healthy" : "degraded",
      lastSeenAt: testResult.ok ? new Date().toISOString() : conn.lastSeenAt,
      lastSuccessAt: testResult.ok ? new Date().toISOString() : conn.lastSuccessAt,
      lastErrorAt: testResult.ok ? conn.lastErrorAt : new Date().toISOString(),
      lastErrorMessage: testResult.ok ? null : testResult.message,
    });

    await writeAuditEvent({
      workspaceId,
      actorUserId: auth.user.id,
      eventType: "integration_tested",
      entityType: "integration_connection",
      entityId: id,
      entityName: conn.name,
      metadata: {
        ok: testResult.ok,
        message: testResult.message,
        integration_type: conn.integrationType,
      },
    });

    return NextResponse.json(testResult);
  } catch (error) {
    console.error("[integrations/test] Error:", error);
    const safe = toSafeApiError(error, "Failed to test integration");
    return NextResponse.json({ error: safe.message }, { status: safe.status });
  }
}
