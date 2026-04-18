import "server-only";
import { rawDb } from "@/lib/supabase";

const SEAT_PRICE = Number(process.env.SEAT_PRICE_USD ?? "19.99");

// ── Types ─────────────────────────────────────────────────────────────────────

export interface FinancialKPIs {
  mrr: number;          // $
  arr: number;          // $ (MRR × 12 × 0.8 annual discount)
  paidSeats: number;    // sum of max_seats on team orgs
  paidOrgs: number;     // count of team orgs
}

export interface GrowthMetrics {
  activeUsersLast7Days: number;
  totalPrompts: number;
  totalWorkspaces: number;
}

export interface ConversionRetention {
  conversionRate: number;  // % free→team
  retentionRate30d: number; // % workspaces active 30 days after creation
}

// ── MRR / ARR ─────────────────────────────────────────────────────────────────

export async function getFinancialKPIs(): Promise<FinancialKPIs> {
  const supabase = rawDb();

  // Fetch all organizations with plan + seat info
  const { data: orgs, error } = await supabase
    .schema("vectorbea")
    .from("organizations")
    .select("id, plan_tier, max_seats");

  if (error) {
    console.error("[business] getFinancialKPIs error:", error);
    return { mrr: 0, arr: 0, paidSeats: 0, paidOrgs: 0 };
  }

  const teamOrgs = (orgs ?? []).filter((o) => o.plan_tier === "team");
  const paidSeats = teamOrgs.reduce((sum, o) => sum + (Number(o.max_seats) || 1), 0);
  const mrr = Math.round(paidSeats * SEAT_PRICE * 100) / 100;
  // Annual billing at 20% discount; ARR = seats × price × 12 × 0.8
  const arr = Math.round(paidSeats * SEAT_PRICE * 12 * 0.8 * 100) / 100;

  return { mrr, arr, paidSeats, paidOrgs: teamOrgs.length };
}

// ── Growth ────────────────────────────────────────────────────────────────────

export async function getGrowthMetrics(): Promise<GrowthMetrics> {
  const supabase = rawDb();
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [profilesRes, promptsRes, workspacesRes] = await Promise.all([
    // Active users: profiles updated (login syncs updated_at) in last 7 days
    supabase
      .schema("vectorbea")
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .gte("updated_at", sevenDaysAgo),

    // Total prompts across all workspaces
    supabase
      .schema("vectorbea")
      .from("prompts")
      .select("id", { count: "exact", head: true }),

    // Total workspaces
    supabase
      .schema("vectorbea")
      .from("workspaces")
      .select("id", { count: "exact", head: true }),
  ]);

  return {
    activeUsersLast7Days: profilesRes.count   ?? 0,
    totalPrompts:         promptsRes.count     ?? 0,
    totalWorkspaces:      workspacesRes.count  ?? 0,
  };
}

// ── Conversion & Retention ────────────────────────────────────────────────────

export async function getConversionRetention(): Promise<ConversionRetention> {
  const supabase = rawDb();

  // ── Free-to-paid conversion ───────────────────────────────────────────────
  // = (team orgs) / (all orgs) × 100
  const { data: allOrgs, error: orgError } = await supabase
    .schema("vectorbea")
    .from("organizations")
    .select("id, plan_tier");

  if (orgError) {
    console.error("[business] getConversionRetention orgs error:", orgError);
    return { conversionRate: 0, retentionRate30d: 0 };
  }

  const totalOrgs = (allOrgs ?? []).length;
  const teamOrgs  = (allOrgs ?? []).filter((o) => o.plan_tier === "team").length;
  const conversionRate = totalOrgs > 0
    ? Math.round((teamOrgs / totalOrgs) * 1000) / 10
    : 0;

  // ── 30-day retention ──────────────────────────────────────────────────────
  // Definition: workspaces created > 30 days ago that had at least one
  // prompt_execution in the window [created_at + 30d, created_at + 31d].
  // We fetch workspaces + prompt_executions and join in JS to avoid a raw
  // SQL RPC.
  const thirtyOneDaysAgo = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
  const thirtyDaysAgo    = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const { data: oldWorkspaces } = await supabase
    .schema("vectorbea")
    .from("workspaces")
    .select("id, created_at")
    .lt("created_at", thirtyOneDaysAgo); // created more than 31 days ago

  if (!oldWorkspaces?.length) {
    return { conversionRate, retentionRate30d: 0 };
  }

  // Build a map of workspace → creation date
  const wsCreated = new Map<string, string>(
    oldWorkspaces.map((w) => [w.id as string, w.created_at as string])
  );

  // Fetch prompt executions in the relevant date range (last 31 days + before 30 days
  // is the overlap window; we fetch a wider range and filter in JS)
  const { data: executions } = await supabase
    .schema("vectorbea")
    .from("prompt_executions")
    .select("workspace_id, timestamp")
    .gte("timestamp", thirtyOneDaysAgo)
    .lte("timestamp", thirtyDaysAgo);

  // Which workspaces had an execution in their [+30d, +31d] window?
  const retained = new Set<string>();
  for (const exec of executions ?? []) {
    const wsId = exec.workspace_id as string | null;
    if (!wsId) continue;
    const created = wsCreated.get(wsId);
    if (!created) continue;

    const createdMs  = new Date(created).getTime();
    const execMs     = new Date(exec.timestamp as string).getTime();
    const offsetDays = (execMs - createdMs) / (1000 * 60 * 60 * 24);

    if (offsetDays >= 30 && offsetDays < 31) {
      retained.add(wsId);
    }
  }

  const retentionRate30d = oldWorkspaces.length > 0
    ? Math.round((retained.size / oldWorkspaces.length) * 1000) / 10
    : 0;

  return { conversionRate, retentionRate30d };
}
