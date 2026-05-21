import "server-only";

import type { PromptMetricRow, TimeWindow, WorkspaceMetricsSummary } from "@/lib/api";
import { createVectorBeaAdminClient } from "@/lib/supabase-admin";
import { normalizeTraceMetadataV1 } from "@/lib/trace-metadata";

type AuditRow = {
  id: string;
  prompt_name: string | null;
  proxy_latency_ms: number | null;
  llm_latency_ms: number | null;
  token_count: number | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

function windowToMs(window: TimeWindow): number {
  if (window === "1h") return 60 * 60 * 1000;
  if (window === "24h") return 24 * 60 * 60 * 1000;
  return 7 * 24 * 60 * 60 * 1000;
}

function isRuntime(row: AuditRow): boolean {
  const meta = row.metadata ?? {};
  const tags = (meta.tags as Record<string, unknown>) ?? {};
  const custom = (meta.custom as Record<string, unknown>) ?? {};
  if (tags.use_type === "runtime" || tags.use_type === "audit") return tags.use_type === "runtime";
  const action = String(custom.action ?? "");
  if (action === "evaluation_run" || action === "evaluation_approval" || action === "evaluation_review" || action === "promote_candidate_version") return false;
  const trace = (meta.trace as Record<string, unknown>) ?? {};
  return trace.kind === "runtime_execution" || !!meta.executor || !!meta.model;
}

function getStatus(row: AuditRow): string {
  const meta = normalizeTraceMetadataV1(row.metadata ?? {});
  const s = meta.trace?.status;
  if (s === "success" || s === "warning" || s === "error" || s === "partial") return s;
  return "success";
}

function getCacheHit(row: AuditRow): boolean {
  const meta = normalizeTraceMetadataV1(row.metadata ?? {});
  return meta.cache?.status === "hit";
}

function getEvalScore(row: AuditRow): number | null {
  const meta = normalizeTraceMetadataV1(row.metadata ?? {});
  const score = meta.evaluation?.score;
  if (typeof score === "number" && Number.isFinite(score)) return score;
  return null;
}

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

export async function getWorkspaceMetrics(
  workspaceId: string,
  window: TimeWindow,
  promptFilter?: string | null,
  environmentFilter?: string | null,
): Promise<WorkspaceMetricsSummary> {
  const supabase = createVectorBeaAdminClient();
  const since = new Date(Date.now() - windowToMs(window)).toISOString();

  let query = supabase
    .from("audit_logs")
    .select("id, prompt_name, proxy_latency_ms, llm_latency_ms, token_count, metadata, created_at")
    .eq("workspace_id", workspaceId)
    .gte("created_at", since)
    .order("created_at", { ascending: true })
    .limit(5000);

  if (promptFilter) query = query.eq("prompt_name", promptFilter);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const rows = ((data ?? []) as AuditRow[])
    .filter(isRuntime)
    .filter((row) => {
      if (!environmentFilter || environmentFilter === "all") return true;
      const normalized = normalizeTraceMetadataV1(row.metadata ?? {});
      const env = String(normalized.trace?.environment ?? "").trim().toLowerCase();
      return env === environmentFilter.trim().toLowerCase();
    });

  if (rows.length === 0) {
    return {
      window,
      totalRequests: 0,
      successRate: 0,
      errorRate: 0,
      avgLatencyMs: 0,
      p95LatencyMs: null,
      cacheHitRate: 0,
      evalScoreAvg: null,
      byPrompt: [],
      latencyTrend: [],
    };
  }

  const latencies = rows.map((r) => (r.proxy_latency_ms ?? 0) + (r.llm_latency_ms ?? 0));
  const successCount = rows.filter((r) => getStatus(r) === "success").length;
  const errorCount = rows.filter((r) => getStatus(r) === "error").length;
  const cacheHitCount = rows.filter(getCacheHit).length;
  const evalScores = rows.map(getEvalScore).filter((s): s is number => s !== null);

  // Group by prompt
  const byPromptMap = new Map<string, AuditRow[]>();
  for (const row of rows) {
    const name = row.prompt_name ?? "unknown";
    if (!byPromptMap.has(name)) byPromptMap.set(name, []);
    byPromptMap.get(name)!.push(row);
  }

  const byPrompt: PromptMetricRow[] = Array.from(byPromptMap.entries()).map(([name, pRows]) => {
    const pLatencies = pRows.map((r) => (r.proxy_latency_ms ?? 0) + (r.llm_latency_ms ?? 0));
    const pSuccess = pRows.filter((r) => getStatus(r) === "success").length;
    const pErrors = pRows.filter((r) => getStatus(r) === "error").length;
    const pCacheHits = pRows.filter(getCacheHit).length;
    const pEvalScores = pRows.map(getEvalScore).filter((s): s is number => s !== null);
    const avgTokens = pRows.map((r) => r.token_count ?? 0).filter((t) => t > 0);
    return {
      promptName: name,
      requestCount: pRows.length,
      successRate: pRows.length > 0 ? pSuccess / pRows.length : 0,
      errorRate: pRows.length > 0 ? pErrors / pRows.length : 0,
      avgLatencyMs: pLatencies.length > 0 ? pLatencies.reduce((s, v) => s + v, 0) / pLatencies.length : 0,
      p95LatencyMs: percentile(pLatencies, 95),
      cacheHitRate: pRows.length > 0 ? pCacheHits / pRows.length : 0,
      evalScoreAvg: pEvalScores.length > 0 ? pEvalScores.reduce((s, v) => s + v, 0) / pEvalScores.length : null,
      tokenAvg: avgTokens.length > 0 ? avgTokens.reduce((s, v) => s + v, 0) / avgTokens.length : null,
    };
  });

  // Latency trend — bucket by hour for 24h/7d, by 10min for 1h
  const bucketMs = window === "1h" ? 10 * 60 * 1000 : window === "24h" ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
  const trendMap = new Map<string, number[]>();
  for (const row of rows) {
    const t = new Date(row.created_at).getTime();
    const bucketStart = Math.floor(t / bucketMs) * bucketMs;
    const key = new Date(bucketStart).toISOString();
    if (!trendMap.has(key)) trendMap.set(key, []);
    trendMap.get(key)!.push((row.proxy_latency_ms ?? 0) + (row.llm_latency_ms ?? 0));
  }
  const latencyTrend = Array.from(trendMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([bucket, vals]) => ({
      bucket,
      avgMs: vals.reduce((s, v) => s + v, 0) / vals.length,
      count: vals.length,
    }));

  return {
    window,
    totalRequests: rows.length,
    successRate: successCount / rows.length,
    errorRate: errorCount / rows.length,
    avgLatencyMs: latencies.reduce((s, v) => s + v, 0) / latencies.length,
    p95LatencyMs: percentile(latencies, 95),
    cacheHitRate: cacheHitCount / rows.length,
    evalScoreAvg: evalScores.length > 0 ? evalScores.reduce((s, v) => s + v, 0) / evalScores.length : null,
    byPrompt,
    latencyTrend,
  };
}
