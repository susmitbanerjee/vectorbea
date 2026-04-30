import { NextRequest, NextResponse } from "next/server";
import { assertWorkspaceMember } from "@/lib/server/assert-workspace-member";
import { createVectorBeaAdminClient } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

/**
 * GET /api/prompts/[id]/gate-checks?workspaceId=&promptVersionId=
 *
 * Returns the most recent rollout gate check for a given prompt version,
 * along with the detailed gate results (behavioral runs, baseline eval, human reviews).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: promptId } = await params;
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    const promptVersionId = request.nextUrl.searchParams.get("promptVersionId")?.trim();

    if (!workspaceId) return NextResponse.json({ error: "workspaceId required" }, { status: 400 });

    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;

    const supabase = createVectorBeaAdminClient();

    // Fetch the latest gate check for this prompt + version
    let query = supabase
      .from("rollout_gate_checks")
      .select("id, status, decision, reasons, risk_score, checked_at, evaluation_run_ids, prompt_version_id")
      .eq("workspace_id", workspaceId)
      .eq("prompt_id", promptId)
      .order("checked_at", { ascending: false })
      .limit(1);

    if (promptVersionId) {
      query = query.eq("prompt_version_id", promptVersionId);
    }

    const { data: gateChecks, error } = await query;
    if (error) {
      if (error.message.includes("does not exist")) return NextResponse.json(null);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const latest = gateChecks?.[0] ?? null;
    if (!latest) return NextResponse.json(null);

    // For each evaluation run ID, fetch a brief summary
    const evalRunIds: string[] = Array.isArray(latest.evaluation_run_ids) ? latest.evaluation_run_ids as string[] : [];
    const gates: Array<{
      name: string;
      status: "passed" | "failed" | "missing" | "needs_review" | "not_required";
      score: number | null;
      runId: string | null;
      reason: string | null;
    }> = [];

    // Fetch behavioral runs for this version
    const [behaviorRes, baselineRes, reviewsRes] = await Promise.all([
      supabase
        .from("behavioral_evaluation_runs")
        .select("id, status, summary, dataset_id")
        .eq("workspace_id", workspaceId)
        .eq("prompt_version_id", latest.prompt_version_id)
        .order("created_at", { ascending: false })
        .limit(10),
      supabase
        .from("trace_set_evaluation_runs")
        .select("id, status, aggregate_score, recommendation")
        .eq("workspace_id", workspaceId)
        .eq("candidate_prompt_version_id", latest.prompt_version_id)
        .order("created_at", { ascending: false })
        .limit(1),
      supabase
        .from("human_review_items")
        .select("id, severity, status")
        .eq("workspace_id", workspaceId)
        .eq("status", "open"),
    ]);

    // Baseline eval gate
    const baselineRun = (baselineRes.data ?? [])[0] as Record<string, unknown> | undefined;
    if (baselineRun) {
      const rec = String(baselineRun.recommendation ?? "");
      const score = typeof baselineRun.aggregate_score === "number" ? baselineRun.aggregate_score : null;
      gates.push({
        name: "Baseline evaluation",
        status:
          rec === "ready_for_rollout" ? "passed"
          : rec === "needs_improvement" ? "needs_review"
          : rec === "blocked" ? "failed"
          : String(baselineRun.status) === "failed" ? "failed"
          : "needs_review",
        score,
        runId: String(baselineRun.id),
        reason: rec ? rec.replaceAll("_", " ") : null,
      });
    } else {
      gates.push({
        name: "Baseline evaluation",
        status: "missing",
        score: null,
        runId: null,
        reason: "No baseline evaluation run found for this version",
      });
    }

    // Behavioral eval gates (one per run)
    const behavioralRuns = (behaviorRes.data ?? []) as Array<Record<string, unknown>>;
    if (behavioralRuns.length > 0) {
      for (const br of behavioralRuns) {
        const summary = (typeof br.summary === "object" && br.summary) ? br.summary as Record<string, unknown> : {};
        const score = typeof summary.score === "number" ? summary.score : typeof summary.overall_score === "number" ? summary.overall_score : null;
        const hardFailures = typeof summary.hard_failure_count === "number" ? summary.hard_failure_count : 0;
        const brStatus = String(br.status);
        let gateStatus: "passed" | "failed" | "missing" | "needs_review" | "not_required";
        let reason: string | null = null;
        if (brStatus === "failed" || brStatus === "cancelled" || brStatus === "timed_out") {
          gateStatus = "failed";
          reason = `Run ${brStatus}`;
        } else if (brStatus !== "completed") {
          gateStatus = "needs_review";
          reason = `Run is ${brStatus}`;
        } else if (hardFailures > 0) {
          gateStatus = "failed";
          reason = `${hardFailures} hard failure(s)`;
        } else if (score !== null && score < 0.7) {
          gateStatus = "needs_review";
          reason = `Score ${Math.round(score * 100)}% below threshold`;
        } else {
          gateStatus = "passed";
        }
        gates.push({
          name: `Behavioral evaluation`,
          status: gateStatus,
          score,
          runId: String(br.id),
          reason,
        });
      }
    } else if (evalRunIds.length === 0) {
      // No behavioral runs and no eval run IDs — not required
      gates.push({
        name: "Behavioral evaluation",
        status: "not_required",
        score: null,
        runId: null,
        reason: "No behavioral datasets linked to this prompt",
      });
    }

    // Human review gate
    const openReviews = (reviewsRes.data ?? []) as Array<{ id: string; severity: string; status: string }>;
    const criticalOpen = openReviews.filter((r) => r.severity === "critical");
    gates.push({
      name: "Human review",
      status: criticalOpen.length > 0 ? "failed" : openReviews.length > 0 ? "needs_review" : "passed",
      score: null,
      runId: null,
      reason: criticalOpen.length > 0
        ? `${criticalOpen.length} critical review(s) unresolved`
        : openReviews.length > 0
        ? `${openReviews.length} open review(s)`
        : null,
    });

    return NextResponse.json({
      id: latest.id,
      status: latest.status,
      decision: latest.decision,
      reasons: latest.reasons ?? [],
      riskScore: latest.risk_score,
      checkedAt: latest.checked_at,
      gates,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}
