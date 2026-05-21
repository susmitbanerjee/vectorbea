/**
 * Vectorbea Agent Scheduler — Database Seed
 *
 * Creates:
 *   - 1 Organization  (Acme Corp)
 *   - 1 Owner user    (seed@vectorbea.com)
 *   - 3 AgentJobs     with realistic configs and budget policies
 *
 * Run via:  npm run prisma:seed  (from apps/web/)
 *       or: npx prisma db seed   (from apps/web/ with prisma.seed in package.json)
 */

import { PrismaClient, TriggerType, HttpMethod, JobStatus } from "../apps/web/lib/generated/prisma";

const prisma = new PrismaClient();

async function main() {
  console.log("🌱  Seeding database…");

  // ── Organization ─────────────────────────────────────────────────────────
  const org = await prisma.organization.upsert({
    where: { slug: "acme-corp" },
    update: {},
    create: {
      name: "Acme Corp",
      slug: "acme-corp",
    },
  });
  console.log(`  ✓ Organization: ${org.name} (${org.id})`);

  // ── Owner user ────────────────────────────────────────────────────────────
  const owner = await prisma.user.upsert({
    where: { organizationId_email: { organizationId: org.id, email: "seed@vectorbea.com" } },
    update: {},
    create: {
      organizationId: org.id,
      email: "seed@vectorbea.com",
      name: "Seed Admin",
      role: "OWNER",
    },
  });
  console.log(`  ✓ User: ${owner.email} (${owner.role})`);

  // ── Helper: create job + optional budget policy ───────────────────────────
  async function createJob(
    data: Parameters<typeof prisma.agentJob.create>[0]["data"],
    budget?: {
      maxTokensPerRun?: number;
      maxCostUsdPerRun?: number;
      maxRunsPerDay?: number;
      maxRunsPerMonth?: number;
    },
  ) {
    const job = await prisma.agentJob.create({ data });
    if (budget) {
      await prisma.budgetPolicy.create({
        data: {
          organizationId: org.id,
          agentJobId: job.id,
          ...budget,
        },
      });
    }
    return job;
  }

  // ── Job 1: Daily support ticket triage ───────────────────────────────────
  const job1 = await createJob(
    {
      organizationId: org.id,
      name: "Daily Support Ticket Triage",
      description:
        "Reads open support tickets from the helpdesk API, classifies priority and category using an LLM, and assigns them to the correct team queue. Runs every morning at 08:00 UTC.",
      status: JobStatus.ACTIVE,
      triggerType: TriggerType.CRON,
      cronExpression: "0 8 * * *",
      timezone: "UTC",
      endpointUrl: "https://agents.acme.internal/support-triage",
      httpMethod: HttpMethod.POST,
      headersJson: { "X-Agent-Version": "1.0", "Content-Type": "application/json" },
      maxDurationSeconds: 600,
      maxRetries: 2,
      retryBackoffSeconds: 120,
      requireApprovalBeforeRun: false,
      requireApprovalBeforeExternalAction: false,
      createdByUserId: owner.id,
    },
    {
      maxTokensPerRun: 50_000,
      maxCostUsdPerRun: 0.5,
      maxRunsPerDay: 2,
      maxRunsPerMonth: 62,
    },
  );
  console.log(`  ✓ Job: ${job1.name}`);

  // ── Job 2: Weekly account health summary ─────────────────────────────────
  const job2 = await createJob(
    {
      organizationId: org.id,
      name: "Weekly Account Health Summary",
      description:
        "Aggregates usage metrics, support volume, and payment history for each customer account. Generates a health score and flags at-risk accounts for CSM review. Sends a Slack digest every Monday at 09:00 UTC.",
      status: JobStatus.ACTIVE,
      triggerType: TriggerType.CRON,
      cronExpression: "0 9 * * 1",
      timezone: "UTC",
      endpointUrl: "https://agents.acme.internal/account-health",
      httpMethod: HttpMethod.POST,
      headersJson: { "X-Agent-Version": "1.0" },
      maxDurationSeconds: 1800,
      maxRetries: 1,
      retryBackoffSeconds: 300,
      requireApprovalBeforeRun: false,
      requireApprovalBeforeExternalAction: true,
      createdByUserId: owner.id,
    },
    {
      maxTokensPerRun: 200_000,
      maxCostUsdPerRun: 2.0,
      maxRunsPerDay: 1,
      maxRunsPerMonth: 5,
    },
  );
  console.log(`  ✓ Job: ${job2.name}`);

  // ── Job 3: Failed payment recovery assistant ──────────────────────────────
  const job3 = await createJob(
    {
      organizationId: org.id,
      name: "Failed Payment Recovery Assistant",
      description:
        "Detects failed payment events, drafts a personalised recovery email using the customer's billing history and account tier, and queues it for human review before sending. Triggered manually or via webhook from the billing system.",
      status: JobStatus.ACTIVE,
      triggerType: TriggerType.MANUAL,
      cronExpression: null,
      timezone: "UTC",
      endpointUrl: "https://agents.acme.internal/payment-recovery",
      httpMethod: HttpMethod.POST,
      headersJson: { "X-Agent-Version": "1.0" },
      maxDurationSeconds: 300,
      maxRetries: 3,
      retryBackoffSeconds: 60,
      requireApprovalBeforeRun: false,
      requireApprovalBeforeExternalAction: true,
      createdByUserId: owner.id,
    },
    {
      maxTokensPerRun: 20_000,
      maxCostUsdPerRun: 0.25,
      maxRunsPerDay: 100,
      maxRunsPerMonth: 3_000,
    },
  );
  console.log(`  ✓ Job: ${job3.name}`);

  console.log("\n✅  Seed complete.");
  console.log(`   Organization ID : ${org.id}`);
  console.log(`   Owner user ID   : ${owner.id}`);
  console.log(`   Jobs created    : 3`);
}

main()
  .catch((e) => {
    console.error("Seed failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
