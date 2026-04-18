import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { rawDb } from "@/lib/supabase";

// ── Runtime config ────────────────────────────────────────────────────────────
// This route receives server-to-server HTTP from the Kotlin sidecar.
// Browser CORS does not apply, but we still set headers so:
//   1. Internal tooling / curl probes from the telemetry subdomain work cleanly.
//   2. Any future browser-based debug panel can hit the health endpoint.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// ── CORS constants ────────────────────────────────────────────────────────────
// Allowed origins for pre-flight / browser callers. Kotlin sidecars never send
// an Origin header, so these headers do not affect their requests at all.
const ALLOWED_ORIGINS = new Set([
  "https://dev-telemetry.vectorbea.com",
  "https://telemetry.vectorbea.com",
  // Localhost variants for integration tests and local dev
  "http://localhost:3001",
  "http://localhost:3000",
]);

function corsHeaders(req: NextRequest): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  return {
    "Access-Control-Allow-Origin":  ALLOWED_ORIGINS.has(origin) ? origin : "",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age":       "86400",
    // Vary so CDN / proxies don't serve the wrong origin header to other callers
    "Vary": "Origin",
  };
}

// ── OPTIONS preflight (required for any browser caller) ──────────────────────
export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req) });
}

// ── Request schema ────────────────────────────────────────────────────────────

const MetricSchema = z.object({
  name:  z.enum(["cpu_usage", "memory_usage", "latency", "network_hops"]),
  value: z.number().finite(),
});

const PromptExecutionSchema = z.object({
  promptName: z.string().min(1).max(500),
  latencyMs:  z.number().nonnegative(),
  tokensUsed: z.number().int().nonnegative().default(0),
});

const IngestBodySchema = z.object({
  environment:       z.enum(["dev", "prod"]),
  proxyHostId:       z.string().min(1).max(255),
  // workspaceId is optional in the payload: if omitted, we populate it from
  // the agent record so the sidecar doesn't need to know its own workspace UUID.
  workspaceId:       z.string().uuid().optional(),
  metrics:           z.array(MetricSchema).max(200).default([]),
  promptExecutions:  z.array(PromptExecutionSchema).max(500).default([]),
});

export type IngestBody = z.infer<typeof IngestBodySchema>;

// ── Response helpers ──────────────────────────────────────────────────────────

function json(body: unknown, status: number, req: NextRequest) {
  return NextResponse.json(body, { status, headers: corsHeaders(req) });
}

// ── POST /api/ingest ──────────────────────────────────────────────────────────
//
// Auth model
// ──────────
// The sidecar presents its VECTORBEA_KEY (= deployment_agents.api_token) as
// the Bearer token. We validate it against the vectorbea.deployment_agents
// table — the same lookup that /api/proxy/audit/batch and
// /api/proxy/prompts/:name use. This means:
//   • One credential per agent (no separate TELEMETRY_INGEST_KEY secret).
//   • Revoking or deleting the deployment_agent row immediately stops telemetry.
//   • The workspaceId is derived server-side from the agent record, so the
//     sidecar never needs to know its own workspace UUID.

export async function POST(req: NextRequest) {
  // ── 1. Extract Bearer token ───────────────────────────────────────────────
  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";

  if (!token) {
    return json(
      { error: "Authorization header with Bearer token is required" },
      401, req,
    );
  }

  // ── 2. Validate token against deployment_agents ───────────────────────────
  // Status is NOT checked — a freshly-registered agent (status = 'offline')
  // must be able to push telemetry immediately. Its first heartbeat flips it
  // to 'online'. Mirroring the exact same policy as /api/proxy/audit/batch.
  const supabase = rawDb();

  const { data: agent, error: agentError } = await supabase
    .schema("vectorbea")
    .from("deployment_agents")
    .select("id, workspace_id")
    .eq("api_token", token)
    .maybeSingle();

  if (agentError) {
    console.error("[ingest] deployment_agents lookup error:", agentError.message);
    return json({ error: "Internal server error" }, 500, req);
  }

  if (!agent) {
    // Intentionally vague — don't confirm whether the token format was valid.
    return json({ error: "Invalid agent token" }, 401, req);
  }

  const agentId    = agent.id as string;
  const agentWsId  = agent.workspace_id as string | null;

  // ── 3. Parse + validate body ──────────────────────────────────────────────
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return json({ error: "Body must be valid JSON" }, 400, req);
  }

  const parsed = IngestBodySchema.safeParse(raw);
  if (!parsed.success) {
    return json({ error: "Invalid payload", detail: parsed.error.flatten() }, 400, req);
  }

  const {
    environment,
    proxyHostId,
    metrics,
    promptExecutions,
  } = parsed.data;

  // Prefer workspace from payload (explicit override); fall back to agent's
  // registered workspace. This allows multi-workspace sidecars in the future
  // while keeping single-workspace deployments zero-config.
  const workspaceId = parsed.data.workspaceId ?? agentWsId;

  const now = new Date().toISOString();

  // ── 4. Insert telemetry_event (carries context for all metric_points) ─────
  const { data: eventRow, error: eventError } = await supabase
    .schema("vectorbea")
    .from("telemetry_events")
    .insert({
      timestamp:     now,
      environment,
      workspace_id:  workspaceId,
      proxy_host_id: proxyHostId,
    })
    .select("id")
    .single();

  if (eventError || !eventRow) {
    console.error("[ingest] telemetry_event insert failed:", eventError?.message);
    return json({ error: "DB write failed (telemetry_event)" }, 500, req);
  }

  const eventId = eventRow.id as string;

  // ── 5. Bulk-insert metric_points + prompt_executions in parallel ──────────
  const jobs: Promise<void>[] = [];

  if (metrics.length > 0) {
    const metricRows = metrics.map((m) => ({
      event_id:     eventId,
      metric_name:  m.name,
      metric_value: m.value,
      recorded_at:  now,
    }));

    jobs.push(
      supabase
        .schema("vectorbea")
        .from("metric_points")
        .insert(metricRows)
        .then(({ error }) => {
          if (error) console.error("[ingest] metric_points insert failed:", error.message);
        }),
    );
  }

  if (promptExecutions.length > 0) {
    const execRows = promptExecutions.map((pe) => ({
      timestamp:    now,
      environment,
      workspace_id: workspaceId,
      prompt_name:  pe.promptName,
      latency_ms:   pe.latencyMs,
      tokens_used:  pe.tokensUsed,
    }));

    jobs.push(
      supabase
        .schema("vectorbea")
        .from("prompt_executions")
        .insert(execRows)
        .then(({ error }) => {
          if (error) console.error("[ingest] prompt_executions insert failed:", error.message);
        }),
    );
  }

  await Promise.all(jobs);

  return json(
    {
      accepted:           true,
      eventId,
      agentId,
      workspaceId,
      metricsIngested:    metrics.length,
      executionsIngested: promptExecutions.length,
    },
    200,
    req,
  );
}
