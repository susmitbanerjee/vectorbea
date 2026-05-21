# Product Direction

## The Pivot

Vectorbea is pivoting from an AI evaluation and observability platform to a
**production control plane for scheduled AI agent jobs**.

### Old direction (removed)

The previous product was focused on:

- **LLM-as-judge** evaluation runs and rubrics
- **Behavioral evaluations** with regression schedules
- **Governance policy packs** and compliance controls
- **Observability dashboards** for AI traces and token costs
- **Prompt management** with versioned rollouts and release gates
- **Evidence collection** for AI system audits
- **Kotlin sidecar proxy** (GraalVM native) for telemetry ingestion

All of the above has been removed from the codebase.

### New direction

The new product — **Vectorbea Agent Scheduler** — treats AI agents as first-class
scheduled jobs, the same way backend engineers treat cron jobs or Celery tasks.

**Core insight:** teams running AI agents in production need the same primitives
they already use for background jobs: scheduling, retry logic, budget limits,
approval workflows, and a run history they can query and alert on.

**Target users:** engineering teams running AI agents (LLM pipelines, web scrapers,
data enrichment agents, code review bots, etc.) who need reliable, auditable
job execution with cost controls.

### What stays from the old codebase

The following infrastructure was preserved because it is product-agnostic:

- Supabase authentication (GitHub, Google, Microsoft OAuth)
- Multi-tenant workspace model with RBAC
- UI design system (Tailwind, shadcn/ui components)
- Layout and navigation shell
- Billing integration (LemonSqueezy)
- Email and Slack notification infrastructure
- API key management
- Audit log infrastructure
- Agent heartbeat and command queue schema (repurposed for worker fleet)
- Feature gate system

### Architecture philosophy

- **Monorepo** with clear app/package separation
- **Next.js API routes** as the control plane backend (no separate Kotlin API)
- **BullMQ + Redis** for the job queue (replaces the Kotlin proxy)
- **Prisma** for database access (replaces raw Supabase queries over time)
- **Node.js worker** process for job execution (replaces JVM sidecar)
