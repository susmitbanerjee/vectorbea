/**
 * POST /api/platform/workflows/:id/nodes/:nodeId/test
 *
 * Execute a single workflow node in isolation with a provided test context.
 * Useful for testing node config before deploying a workflow.
 *
 * Body: {
 *   testInput: Record<string, unknown>   — values for inputMapping
 *   workflowInput?: Record<string, unknown>  — simulate workflow.input.*
 *   stepOutputs?: Record<string, unknown>    — simulate steps.*.output.*
 *   dryRun?: boolean                         — resolve but don't call services
 * }
 *
 * SECURITY: Secrets are resolved server-side. They never appear in the response.
 */

import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@/lib/generated/prisma";
import { db } from "@/server/db";
import { getSecretForRuntime } from "@/lib/server/secret-service";
import { checkSSRF } from "@/lib/server/ssrf-protection";
import { makeRunContext, resolveMapping, resolveTemplate } from "@/lib/workflow-runtime/mapping-resolver";
import { processOutput } from "@/lib/workflow-runtime/output-extractor";
import { validateSchema, repairJson } from "@/lib/workflow-runtime/schema-validator";
import type { WorkflowGraph, StepOutputEntry } from "@/types/workflow-graph";

interface TestBody {
  testInput?: Record<string, unknown>;
  workflowInput?: Record<string, unknown>;
  stepOutputs?: Record<string, unknown>;
  dryRun?: boolean;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; nodeId: string }> },
) {
  const workspaceId = request.nextUrl.searchParams.get("workspaceId");
  if (!workspaceId) return NextResponse.json({ error: "workspaceId required" }, { status: 400 });

  const { id: workflowId, nodeId } = await params;

  let body: TestBody = {};
  try { body = await request.json() as TestBody; } catch { /* empty body ok */ }

  const workflowInput = body.workflowInput ?? {};
  const stepOutputsRaw = body.stepOutputs ?? {};
  const dryRun = body.dryRun !== false; // default true for node tests (safe)

  // ── Load graph ────────────────────────────────────────────────────────────
  const graphRows = await db.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
    SELECT graph_json FROM vectorbea.workflow_graphs
    WHERE workflow_id = ${workflowId}::uuid
    ORDER BY created_at DESC LIMIT 1
  `).catch(() => [] as Record<string, unknown>[]);

  const graphJson = graphRows[0]?.graph_json as WorkflowGraph | null;
  if (!graphJson) return NextResponse.json({ error: "Workflow graph not found" }, { status: 404 });

  const node = graphJson.nodes.find((n) => n.id === nodeId);
  if (!node) return NextResponse.json({ error: `Node ${nodeId} not found` }, { status: 404 });

  // ── Build test context ────────────────────────────────────────────────────
  const context = makeRunContext({
    runId: `test-${Date.now()}`,
    workspaceId,
    workflowId,
    startedAt: new Date().toISOString(),
    triggerType: "manual",
    workflowInput,
  });

  // Populate simulated step outputs
  for (const [key, value] of Object.entries(stepOutputsRaw)) {
    context.steps[key] = {
      raw: value,
      extracted: value,
      status: "succeeded",
    } as StepOutputEntry;
  }

  // ── Resolve inputs ────────────────────────────────────────────────────────
  const inputMapping = node.data.inputMappingJson ?? {};
  const resolvedInputs = Object.keys(inputMapping).length > 0
    ? resolveMapping(inputMapping, context)
    : (body.testInput ?? {});

  // Input schema validation
  const inputSchema = node.data.inputSchemaJson;
  let inputValidation = null;
  if (inputSchema) {
    inputValidation = validateSchema(resolvedInputs, inputSchema);
    if (!inputValidation.valid) {
      return NextResponse.json({
        stage: "input_validation",
        valid: false,
        errors: inputValidation.errors,
        resolvedInputs,
      }, { status: 422 });
    }
  }

  const startMs = Date.now();
  let output: unknown = null;
  let tokensUsed = 0;
  let estimatedCostUsd = 0;
  let warnings: string[] = [];

  // ── Execute node ──────────────────────────────────────────────────────────
  try {
    switch (node.type) {
      case "llm": {
        const cfg = node.data.llmConfig;
        if (!cfg) throw new Error("Missing llmConfig");

        const userPrompt = cfg.userPromptTemplate
          ? String(resolveTemplate(cfg.userPromptTemplate, context))
          : String(resolvedInputs.userPrompt ?? "");
        const systemPrompt = cfg.systemPrompt
          ? String(resolveTemplate(cfg.systemPrompt, context))
          : String(resolvedInputs.systemPrompt ?? "");

        if (dryRun) {
          output = { __dryRun: true, resolvedSystemPrompt: systemPrompt, resolvedUserPrompt: userPrompt, model: cfg.model };
          break;
        }

        // Load connection and secret server-side
        let apiKey: string | null = null;
        let provider = cfg.provider ?? "openai";
        let baseUrl: string | null = null;

        if (cfg.connectionId) {
          const connRows = await db.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
            SELECT type, config_json, secret_ref, base_url FROM vectorbea.connections
            WHERE id = ${cfg.connectionId}::uuid AND workspace_id = ${workspaceId}::uuid AND status = 'active'
            LIMIT 1
          `).catch(() => []);
          const conn = connRows[0];
          if (conn) {
            apiKey = conn.secret_ref ? await getSecretForRuntime(String(conn.secret_ref)) : null;
            provider = String((conn.config_json as Record<string, unknown>)?.providerType ?? provider);
            baseUrl = typeof conn.base_url === "string" ? conn.base_url : null;
          }
        }

        if (!apiKey) {
          warnings.push("No API key found — returning dry-run output");
          output = { __noApiKey: true, resolvedSystemPrompt: systemPrompt, resolvedUserPrompt: userPrompt };
          break;
        }

        const { executeResolvedPrompt } = await import("@/lib/server/execution");
        const result = await executeResolvedPrompt({
          workspaceId,
          promptVersionId: null,
          promptName: "node-test",
          versionTag: "v1",
          templateText: systemPrompt,
          variables: resolvedInputs as Record<string, unknown>,
          inputText: userPrompt,
          renderedPrompt: systemPrompt,
          providerConfig: { providerType: provider, apiKey, baseUrl, model: cfg.model, configId: "" },
        });

        let parsed: unknown = result.outputText;
        if (cfg.outputSchema) {
          try { parsed = repairJson(result.outputText); } catch { /* leave as string */ }
        }
        output = parsed;
        tokensUsed = result.tokenCount;
        estimatedCostUsd = +(result.tokenCount * 0.000003).toFixed(6);
        break;
      }

      case "http_tool": {
        const cfg = node.data.httpToolConfig;
        if (!cfg) throw new Error("Missing httpToolConfig");

        const url = cfg.urlTemplate ? String(resolveTemplate(cfg.urlTemplate, context)) : "";
        const headers: Record<string, string> = {};
        if (cfg.headers) {
          for (const [k, v] of Object.entries(cfg.headers)) {
            headers[k] = String(resolveTemplate(v, context));
          }
        }
        const body2 = cfg.bodyTemplate ? resolveTemplate(cfg.bodyTemplate, context) : undefined;

        if (dryRun) {
          output = { __dryRun: true, method: cfg.method, url, headers: { ...headers, Authorization: "[REDACTED]" }, body: body2 };
          break;
        }

        const ssrf = await checkSSRF(url, false);
        if (!ssrf.allowed) throw new Error(`SSRF_BLOCKED: ${ssrf.reason}`);

        // Load connection auth
        let connSecret: string | null = null;
        let connConfig: Record<string, unknown> = {};
        if (cfg.connectionId) {
          const connRows = await db.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
            SELECT config_json, secret_ref FROM vectorbea.connections
            WHERE id = ${cfg.connectionId}::uuid AND workspace_id = ${workspaceId}::uuid AND status = 'active'
            LIMIT 1
          `).catch(() => []);
          const conn = connRows[0];
          if (conn) {
            connSecret = conn.secret_ref ? await getSecretForRuntime(String(conn.secret_ref)) : null;
            connConfig = (conn.config_json ?? {}) as Record<string, unknown>;
          }
        }

        const finalHeaders: Record<string, string> = { "Content-Type": "application/json", ...headers };
        if (connSecret) {
          const authType = String(connConfig.authType ?? "bearer");
          if (authType === "bearer") finalHeaders["Authorization"] = `Bearer ${connSecret}`;
          else if (authType === "api_key") finalHeaders[String(connConfig.apiKeyHeader ?? "X-API-Key")] = connSecret;
        }

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), cfg.timeoutMs ?? 30_000);
        try {
          const resp = await fetch(url, {
            method: cfg.method,
            headers: finalHeaders,
            body: body2 != null ? (typeof body2 === "string" ? body2 : JSON.stringify(body2)) : undefined,
            signal: controller.signal,
            cache: "no-store",
          });
          const ct = resp.headers.get("content-type") ?? "";
          const respText = await resp.text();
          let respBody: unknown = respText;
          if (ct.includes("application/json")) { try { respBody = JSON.parse(respText); } catch { /* leave as text */ } }
          output = { statusCode: resp.status, body: respBody };
        } finally {
          clearTimeout(timer);
        }
        break;
      }

      case "transform": {
        const cfg = node.data.transformConfig;
        if (!cfg) throw new Error("Missing transformConfig");
        output = resolveTemplate(cfg.expression, context);
        break;
      }

      case "db_read": {
        const cfg = node.data.dbReadConfig;
        if (!cfg) throw new Error("Missing dbReadConfig");
        // Always dry-run for DB reads in test mode unless explicitly enabled
        output = { __dryRun: true, sqlPreview: cfg.sqlTemplate.slice(0, 200), resolvedParams: cfg.parameters ? resolveMapping(cfg.parameters, context) : {} };
        warnings.push("DB queries run in dry-run mode during node tests for safety");
        break;
      }

      default:
        output = { __dryRun: true, nodeType: node.type, resolvedInputs };
    }
  } catch (err) {
    return NextResponse.json({
      stage: "execution",
      error: (err instanceof Error) ? err.message : String(err),
      resolvedInputs,
      durationMs: Date.now() - startMs,
    }, { status: 422 });
  }

  // ── Extract output ────────────────────────────────────────────────────────
  const extractionCfg = node.data.outputExtractionJson;
  const extracted = processOutput(output, extractionCfg);

  // ── Validate output schema ────────────────────────────────────────────────
  const outputSchema = node.data.outputSchemaJson;
  let outputValidation = null;
  if (outputSchema) {
    outputValidation = validateSchema(extracted, outputSchema);
    if (!outputValidation.valid) {
      return NextResponse.json({
        stage: "output_validation",
        valid: false,
        errors: outputValidation.errors,
        raw: output,
        extracted,
        durationMs: Date.now() - startMs,
      }, { status: 422 });
    }
  }

  return NextResponse.json({
    nodeId,
    nodeType: node.type,
    label: node.data.label,
    dryRun,
    resolvedInputs,
    raw: output,
    extracted,
    outputValidation,
    tokensUsed: tokensUsed || undefined,
    estimatedCostUsd: estimatedCostUsd || undefined,
    durationMs: Date.now() - startMs,
    warnings: warnings.length > 0 ? warnings : undefined,
  });
}
