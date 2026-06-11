# MVP Scope

## Goal

Ship a working **Vectorbea Agent Scheduler** that a real engineering team can
use to schedule, monitor, and control AI agent jobs in production.

---

## In scope for MVP

### Job management
- Create, edit, and delete job definitions
- Cron expression scheduling with timezone support
- Manual trigger via dashboard and API
- Enable / disable jobs without deleting them

### Run execution
- Worker process picks up scheduled jobs from BullMQ queue
- Executes agent via HTTP POST to a configured endpoint
- Stores run status, duration, cost (USD), tokens used
- Per-job configurable timeout

### Retry policy
- Max attempt count per job
- Configurable backoff: fixed or exponential
- Retry on network errors and non-2xx agent responses
- Retry exhaustion marks run as `failed`

### Budget controls
- Per-job max cost (USD) limit
- Per-job max token limit (optional)
- Alert threshold (e.g., alert at 80% of budget)
- Budget exceeded terminates the run

### Approval gates
- Jobs can be marked `requiresApproval`
- Run enters `awaiting_approval` state before execution
- Approvers receive email + Slack notification
- Approved → run executes; rejected → run cancelled with reason

### Run history and audit log
- Full run history per job with filter and search
- Audit log for all state transitions (created, approved, failed, cancelled)
- Audit log for all job definition changes

### Alerts
- Alert rules: on failure, on budget threshold, on long run duration
- Delivery via Slack webhook and email

### Infrastructure
- Multi-tenant workspace model (team members, invites, roles)
- API key management (create, rotate, revoke)
- Billing and plan limits (via LemonSqueezy)

---

## Out of scope for MVP

These are explicitly excluded to keep the MVP shippable:

| Feature | Reason excluded |
|---|---|
| LLM-as-judge / evaluations | Old product direction, removed |
| Governance policy packs | Old product direction, removed |
| AI trace observability | Old product direction, removed |
| Prompt versioning and rollout | Old product direction, removed |
| Agent streaming / SSE | Post-MVP |
| Dependency chains between jobs | Post-MVP |
| Job DAG / workflow orchestration | Post-MVP (scope creep risk) |
| Visual cron builder | Post-MVP |
| Per-run cost breakdown by provider | Post-MVP |
| Multi-region worker deployment | Post-MVP |
| Custom approval workflows (multi-step) | Post-MVP |
| Agent SDK (packages/sdk-js) | Stub created; full API post-MVP |

---

## Data model (target Prisma schema additions)

The following tables need to be added to the existing schema:

```
jobs            — job definitions
job_runs        — individual run records
approval_requests — approval gate records
job_budget_events — budget alert and limit events
alert_rules     — per-job alert configuration
alert_deliveries — delivery log for alerts
```

The existing tables to keep and extend:

```
workspaces      — already exists
profiles        — already exists
api_keys        — already exists
audit_logs      — already exists (extend to cover job actions)
deployment_agents — repurpose for worker fleet tracking
agent_commands  — repurpose for job dispatch commands
agent_metrics   — repurpose for worker health metrics
```

---

## Recommended implementation order

1. Prisma schema — add `jobs`, `job_runs`, `approval_requests` tables
2. `apps/web` API routes — `/api/jobs`, `/api/jobs/[id]/runs`, `/api/jobs/[id]/trigger`
3. `apps/web` dashboard pages — job list, job detail, run history
4. `apps/worker` — BullMQ worker, job runner, heartbeat
5. Approval gate — awaiting state, email/Slack notification, approve/reject API
6. Budget enforcement — cost tracking in worker, limit check before run
7. Alert rules — failure detection, Slack/email delivery
8. `packages/sdk-js` — typed client for job trigger + run query API
