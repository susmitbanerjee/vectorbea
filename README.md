# Vectorbea Agent Scheduler

A production control plane for scheduled AI agent jobs — with cron scheduling,
run history, retries, approval gates, per-job budgets, and full audit logs.

---

## What it is

Vectorbea lets you define, schedule, and monitor AI agent jobs the same way
you would manage background workers in any serious production system.

- Define jobs with cron expressions or trigger them via API
- Set retry policies, budget caps, and timeout limits per job
- Require human approval before high-stakes runs execute
- Track every run's status, cost, and output in one place
- Get alerted on failures via Slack or email

---

## Architecture

```
vectorbea/
├── apps/
│   ├── web/          Next.js 15 control plane (dashboard + API routes)
│   └── worker/       BullMQ scheduler worker process
├── packages/
│   ├── shared/       Shared TypeScript types (JobDefinition, JobRun, etc.)
│   └── sdk-js/       Node.js SDK for triggering and querying jobs
├── prisma/
│   ├── schema.prisma Canonical database schema
│   └── migrations/   SQL migration history
└── docker-compose.yml  Local dev stack (Postgres + Redis + web + worker)
```

### Tech stack

| Layer | Technology |
|---|---|
| Control plane UI | Next.js 15, React 19, Tailwind CSS, Supabase Auth |
| Database | PostgreSQL (via Supabase) |
| ORM / migrations | Prisma |
| Job queue | BullMQ + Redis |
| Scheduler worker | Node.js (TypeScript) |
| Billing | LemonSqueezy |
| Notifications | Resend (email) + Slack webhooks |
| Auth | Supabase (GitHub, Google, Microsoft OAuth) |

---

## MVP feature list

- [ ] Job definitions (cron + manual trigger)
- [ ] Run execution via worker process
- [ ] Retry policy per job (max attempts, backoff)
- [ ] Run history with status, cost, duration
- [ ] Budget caps (USD + token limits)
- [ ] Approval gates (block run until approved)
- [ ] Audit log for all job and approval actions
- [ ] Failure alerts (Slack + email)
- [ ] API key management
- [ ] Multi-tenant workspaces
- [ ] Billing and usage quotas

See [docs/mvp-scope.md](docs/mvp-scope.md) for full scope and out-of-scope decisions.

---

## Local development

See [docs/local-development.md](docs/local-development.md) for the full setup guide.

**Quick start:**

```bash
# 1. Start infrastructure
docker compose up postgres redis -d

# 2. Install dependencies
cd apps/web && npm install

# 3. Configure environment
cp apps/web/.env.example apps/web/.env.local
# fill in Supabase credentials

# 4. Run migrations
cd apps/web && npx prisma migrate dev

# 5. Start the web app
npm run dev
```

---

## Out of scope (intentionally)

- LLM evaluation / LLM-as-judge
- Observability dashboards for AI traces
- Governance policy packs and compliance reports
- Prompt management and versioning
- RAG / classification integrations
- GraalVM / JVM sidecar proxy

See [docs/product-direction.md](docs/product-direction.md) for the full pivot rationale.

---

## Contributing

Branch off `dev`. Open PRs against `master` only when ready for production.
