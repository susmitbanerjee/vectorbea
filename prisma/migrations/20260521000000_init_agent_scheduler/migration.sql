-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('OWNER', 'ADMIN', 'MEMBER', 'VIEWER');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('ACTIVE', 'PAUSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "TriggerType" AS ENUM ('MANUAL', 'CRON');

-- CreateEnum
CREATE TYPE "HttpMethod" AS ENUM ('GET', 'POST', 'PUT', 'PATCH', 'DELETE');

-- CreateEnum
CREATE TYPE "RunStatus" AS ENUM ('QUEUED', 'RUNNING', 'WAITING_FOR_APPROVAL', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'TIMEOUT');

-- CreateEnum
CREATE TYPE "TriggerSource" AS ENUM ('MANUAL', 'SCHEDULE', 'RETRY');

-- CreateEnum
CREATE TYPE "StepType" AS ENUM ('LLM_CALL', 'TOOL_CALL', 'HTTP_CALL', 'APPROVAL_GATE', 'SYSTEM', 'ERROR');

-- CreateEnum
CREATE TYPE "StepStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED');

-- CreateTable
CREATE TABLE "organizations" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'MEMBER',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_jobs" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "JobStatus" NOT NULL DEFAULT 'ACTIVE',
    "trigger_type" "TriggerType" NOT NULL,
    "cron_expression" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "endpoint_url" TEXT NOT NULL,
    "http_method" "HttpMethod" NOT NULL DEFAULT 'POST',
    "headers_json" JSONB,
    "max_duration_seconds" INTEGER NOT NULL DEFAULT 300,
    "max_retries" INTEGER NOT NULL DEFAULT 3,
    "retry_backoff_seconds" INTEGER NOT NULL DEFAULT 60,
    "require_approval_before_run" BOOLEAN NOT NULL DEFAULT false,
    "require_approval_before_external_action" BOOLEAN NOT NULL DEFAULT false,
    "created_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_runs" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "agent_job_id" TEXT NOT NULL,
    "status" "RunStatus" NOT NULL DEFAULT 'QUEUED',
    "trigger_source" "TriggerSource" NOT NULL,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "duration_ms" INTEGER,
    "attempt_number" INTEGER NOT NULL DEFAULT 1,
    "idempotency_key" TEXT NOT NULL,
    "input_json" JSONB,
    "output_json" JSONB,
    "error_message" TEXT,
    "total_tokens" INTEGER,
    "estimated_cost_usd" DECIMAL(12,6),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_run_steps" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "agent_run_id" TEXT NOT NULL,
    "step_index" INTEGER NOT NULL,
    "step_type" "StepType" NOT NULL,
    "name" TEXT NOT NULL,
    "status" "StepStatus" NOT NULL DEFAULT 'PENDING',
    "input_json" JSONB,
    "output_json" JSONB,
    "error_message" TEXT,
    "tokens_used" INTEGER,
    "estimated_cost_usd" DECIMAL(12,6),
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_run_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_requests" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "agent_run_id" TEXT NOT NULL,
    "agent_run_step_id" TEXT,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "requested_by_system" BOOLEAN NOT NULL DEFAULT true,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_at" TIMESTAMP(3),
    "decided_by_user_id" TEXT,
    "decision_reason" TEXT,

    CONSTRAINT "approval_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budget_policies" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "agent_job_id" TEXT NOT NULL,
    "max_tokens_per_run" INTEGER,
    "max_cost_usd_per_run" DECIMAL(12,6),
    "max_runs_per_day" INTEGER,
    "max_runs_per_month" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "budget_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "actor_user_id" TEXT,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "metadata_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations"("slug");

-- CreateIndex
CREATE INDEX "users_organization_id_idx" ON "users"("organization_id");

-- CreateIndex
CREATE INDEX "users_email_idx" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_organization_id_email_key" ON "users"("organization_id", "email");

-- CreateIndex
CREATE INDEX "agent_jobs_organization_id_idx" ON "agent_jobs"("organization_id");

-- CreateIndex
CREATE INDEX "agent_jobs_organization_id_status_idx" ON "agent_jobs"("organization_id", "status");

-- CreateIndex
CREATE INDEX "idx_agent_jobs_cron_expression" ON "agent_jobs"("cron_expression");

-- CreateIndex
CREATE INDEX "agent_runs_organization_id_idx" ON "agent_runs"("organization_id");

-- CreateIndex
CREATE INDEX "agent_runs_agent_job_id_idx" ON "agent_runs"("agent_job_id");

-- CreateIndex
CREATE INDEX "agent_runs_organization_id_status_idx" ON "agent_runs"("organization_id", "status");

-- CreateIndex
CREATE INDEX "agent_runs_created_at_idx" ON "agent_runs"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "agent_runs_agent_job_id_idempotency_key_key" ON "agent_runs"("agent_job_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "agent_run_steps_agent_run_id_idx" ON "agent_run_steps"("agent_run_id");

-- CreateIndex
CREATE INDEX "agent_run_steps_organization_id_idx" ON "agent_run_steps"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "agent_run_steps_agent_run_id_step_index_key" ON "agent_run_steps"("agent_run_id", "step_index");

-- CreateIndex
CREATE INDEX "approval_requests_organization_id_idx" ON "approval_requests"("organization_id");

-- CreateIndex
CREATE INDEX "approval_requests_agent_run_id_idx" ON "approval_requests"("agent_run_id");

-- CreateIndex
CREATE INDEX "approval_requests_organization_id_status_idx" ON "approval_requests"("organization_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "budget_policies_agent_job_id_key" ON "budget_policies"("agent_job_id");

-- CreateIndex
CREATE INDEX "budget_policies_organization_id_idx" ON "budget_policies"("organization_id");

-- CreateIndex
CREATE INDEX "audit_logs_organization_id_idx" ON "audit_logs"("organization_id");

-- CreateIndex
CREATE INDEX "audit_logs_organization_id_entity_type_entity_id_idx" ON "audit_logs"("organization_id", "entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_logs_organization_id_created_at_idx" ON "audit_logs"("organization_id", "created_at");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_jobs" ADD CONSTRAINT "agent_jobs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_jobs" ADD CONSTRAINT "agent_jobs_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_agent_job_id_fkey" FOREIGN KEY ("agent_job_id") REFERENCES "agent_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_run_steps" ADD CONSTRAINT "agent_run_steps_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_run_steps" ADD CONSTRAINT "agent_run_steps_agent_run_id_fkey" FOREIGN KEY ("agent_run_id") REFERENCES "agent_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_agent_run_id_fkey" FOREIGN KEY ("agent_run_id") REFERENCES "agent_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_agent_run_step_id_fkey" FOREIGN KEY ("agent_run_step_id") REFERENCES "agent_run_steps"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_decided_by_user_id_fkey" FOREIGN KEY ("decided_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_policies" ADD CONSTRAINT "budget_policies_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_policies" ADD CONSTRAINT "budget_policies_agent_job_id_fkey" FOREIGN KEY ("agent_job_id") REFERENCES "agent_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

