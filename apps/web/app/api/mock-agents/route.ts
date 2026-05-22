import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/mock-agents
 *
 * Returns a list of available mock agent endpoints with descriptions.
 * Use these URLs as the `endpointUrl` in your AgentJob configuration
 * when developing locally.
 */
export async function GET() {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  return NextResponse.json({
    description: "Vectorbea local mock agent endpoints for development and testing.",
    agents: [
      {
        name: "success",
        url: `${base}/api/mock-agents/success`,
        method: "POST",
        description:
          "Simulates a successful agent run. Waits 1-2 s, runs 2 steps (LLM + tool call), reports 2500 tokens / $0.01.",
        useCases: ["Happy path testing", "Budget tracking", "Run timeline display"],
      },
      {
        name: "fail",
        url: `${base}/api/mock-agents/fail`,
        method: "POST",
        description:
          "Simulates a failing agent (CRM rate-limit). Fails after 300 ms. Use ?errorMessage= to override the error.",
        useCases: ["Retry flow testing", "Error display", "Alert triggering"],
      },
      {
        name: "approval",
        url: `${base}/api/mock-agents/approval`,
        method: "POST",
        description:
          "Simulates an approval-gated agent. First call pauses for human review (creates ApprovalRequest). " +
          "Second call (resumeFromApproval=true) completes the run.",
        useCases: ["Approval inbox testing", "Approval-gate flow", "WAITING_FOR_APPROVAL state"],
      },
      {
        name: "slow",
        url: `${base}/api/mock-agents/slow`,
        method: "POST",
        description:
          "Sleeps for 35 s by default (?seconds=N to override, max 60). " +
          "Set the job's maxDurationSeconds=10 to observe timeout behavior.",
        useCases: ["Timeout testing", "TIMEOUT state display", "Retry after timeout"],
      },
    ],
    seedJobIds: {
      note: "Run prisma/seed.sql in your DB to create these jobs.",
      jobs: [
        { name: "Daily Support Ticket Triage", endpoint: "success" },
        { name: "CRM Enrichment with Approval", endpoint: "approval" },
        { name: "Failed Payment Recovery", endpoint: "fail" },
        { name: "Slow Batch Processor (Timeout Test)", endpoint: "slow" },
      ],
    },
  });
}
