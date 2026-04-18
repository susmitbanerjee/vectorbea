import "server-only";
import { rawDb } from "@/lib/supabase";

export type Environment = "dev" | "prod";

// ── Types returned to the dashboard ──────────────────────────────────────────

export interface HourlyMetric {
  hour: string;       // ISO timestamp truncated to hour
  host: string;
  avgValue: number;
}

export interface LatencyPercentiles {
  environment: string;
  p50: number;
  p95: number;
  p99: number;
  avgMs: number;
  sampleCount: number;
}

export interface SlowPrompt {
  promptName: string;
  workspaceId: string | null;
  avgLatencyMs: number;
  execCount: number;
}

export interface NetworkHopsSummary {
  avgHops: number;
  sampleCount: number;
}

// ── Queries ───────────────────────────────────────────────────────────────────

/**
 * Returns hourly averages for a single metric (cpu_usage or memory_usage)
 * across all proxy hosts for the last 24 hours.
 */
export async function getHourlyHostMetrics(
  env: Environment,
  metricName: "cpu_usage" | "memory_usage"
): Promise<HourlyMetric[]> {
  // The view v_hourly_host_metrics already has the aggregation; we query it
  // directly via the REST layer rather than a custom RPC.
  const { data: rows, error: err } = await rawDb()
    .schema("vectorbea")
    .from("v_hourly_host_metrics")
    .select("hour, proxy_host_id, avg_value")
    .eq("environment", env)
    .eq("metric_name", metricName)
    .gte("hour", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
    .order("hour", { ascending: true });

  if (err) {
    console.error(`[technical] getHourlyHostMetrics error:`, err);
    return [];
  }

  return (rows ?? []).map((r) => ({
    hour: r.hour as string,
    host: r.proxy_host_id as string,
    avgValue: Number(r.avg_value),
  }));
}

/**
 * Returns p50 / p95 / p99 latency percentiles from the last 24 hours.
 * Falls back to an empty array if the view returns no rows (i.e. no data).
 */
export async function getLatencyPercentiles(
  env: Environment
): Promise<LatencyPercentiles[]> {
  const { data, error } = await rawDb()
    .schema("vectorbea")
    .from("v_latency_percentiles")
    .select("environment, p50_ms, p95_ms, p99_ms, avg_ms, sample_count")
    .eq("environment", env);

  if (error) {
    console.error("[technical] getLatencyPercentiles error:", error);
    return [];
  }

  return (data ?? []).map((r) => ({
    environment:  r.environment as string,
    p50:          Number(r.p50_ms),
    p95:          Number(r.p95_ms),
    p99:          Number(r.p99_ms),
    avgMs:        Number(r.avg_ms),
    sampleCount:  Number(r.sample_count),
  }));
}

/**
 * Top 10 slowest prompts by average latency over the last 7 days.
 * Powers the "Wall of Shame" table.
 */
export async function getTop10SlowestPrompts(
  env: Environment
): Promise<SlowPrompt[]> {
  // PostgREST doesn't do GROUP BY natively; use a raw SQL query via rpc or
  // a dedicated view. Here we use a raw SQL call through the postgres function
  // created below. For now, fetch recent rows and aggregate in JS — this is
  // fine for up to ~50k rows; add a materialized view for larger datasets.
  const { data, error } = await rawDb()
    .schema("vectorbea")
    .from("prompt_executions")
    .select("prompt_name, workspace_id, latency_ms")
    .eq("environment", env)
    .gte("timestamp", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
    .limit(10_000); // enough for a p95 sample on a small-scale deployment

  if (error) {
    console.error("[technical] getTop10SlowestPrompts error:", error);
    return [];
  }

  // Aggregate in JS
  const map = new Map<string, { sum: number; count: number; workspaceId: string | null }>();
  for (const row of data ?? []) {
    const key = `${row.prompt_name}::${row.workspace_id ?? ""}`;
    const existing = map.get(key) ?? { sum: 0, count: 0, workspaceId: row.workspace_id as string | null };
    existing.sum   += Number(row.latency_ms);
    existing.count += 1;
    map.set(key, existing);
  }

  return Array.from(map.entries())
    .map(([key, { sum, count, workspaceId }]) => ({
      promptName:   key.split("::")[0] ?? key,
      workspaceId,
      avgLatencyMs: Math.round(sum / count),
      execCount:    count,
    }))
    .sort((a, b) => b.avgLatencyMs - a.avgLatencyMs)
    .slice(0, 10);
}

/**
 * Average network hops observed across all sidecars in the last 24 hours.
 */
export async function getAvgNetworkHops(
  env: Environment
): Promise<NetworkHopsSummary> {
  const { data, error } = await rawDb()
    .schema("vectorbea")
    .from("metric_points")
    .select("metric_value, telemetry_events!inner(environment, timestamp)")
    .eq("metric_name", "network_hops")
    .eq("telemetry_events.environment", env)
    .gte("telemetry_events.timestamp", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
    .limit(5_000);

  if (error || !data?.length) {
    return { avgHops: 0, sampleCount: 0 };
  }

  const values = data.map((r) => Number(r.metric_value));
  return {
    avgHops:     Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10,
    sampleCount: values.length,
  };
}

/**
 * Count of distinct active proxy hosts seen in the last 24 hours.
 */
export async function getActiveHostCount(env: Environment): Promise<number> {
  const { data, error } = await rawDb()
    .schema("vectorbea")
    .from("telemetry_events")
    .select("proxy_host_id")
    .eq("environment", env)
    .gte("timestamp", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

  if (error) return 0;
  return new Set((data ?? []).map((r) => r.proxy_host_id)).size;
}
