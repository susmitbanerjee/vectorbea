# Vectorbea — Minimal-Cost Deployment Guide

This guide covers the recommended platform choices and configuration for a
production-grade deployment that stays cheap until you need to scale.

---

## Architecture Overview

```
Browser / Mobile
      │
      ▼
  Vercel (Next.js web)          ← free tier / $20/mo Pro
      │  NEXT_PUBLIC_VECTORBEA_API_URL
      ▼
  Railway / Fly / Render        ← Kotlin API  (~$5–10/mo)
  (api-kotlin, 512 MB RAM)
      │                    ▲
      │  Redis Streams      │ SSE stream
      ▼                    │
  Railway / Fly / Render   │   Upstash Redis  ← $0 free tier / pay-as-you-go
  (worker-kotlin, 512 MB)  │
      │                    │
      └──── Neon Postgres ──┘    ← free tier / $19/mo pro
```

---

## Platform Recommendations

| Service | Platform | Tier | Est. monthly cost |
|---|---|---|---|
| **Web (Next.js)** | Vercel | Hobby → Pro | $0 → $20 |
| **API (Kotlin)** | Railway | Starter | $5–10 |
| **Worker (Kotlin)** | Railway | Starter | $5–10 |
| **Postgres** | Neon | Free → Launch | $0 → $19 |
| **Redis** | Upstash | Pay-per-request | $0–5 |
| **Secrets** | Encrypted in DB | — | $0 |
| **Total (early stage)** | | | **$10–55/mo** |

---

## Service-by-Service Setup

### 1. Postgres — Neon

1. Create a project at [neon.tech](https://neon.tech).
2. Copy the **Connection string** (pooled for app, direct for migrations).
3. Set env vars in each service:

```
# Kotlin API + Worker (JDBC format)
DATABASE_URL=jdbc:postgresql://<host>.neon.tech/vectorbea?sslmode=require&user=<user>&password=<password>

# Next.js Prisma (postgresql:// format)
DATABASE_URL=postgresql://<user>:<password>@<host>.neon.tech/vectorbea?sslmode=require&schema=vectorbea
DIRECT_URL=postgresql://<user>:<password>@<host>.neon.tech/vectorbea?sslmode=require&schema=vectorbea
```

**Neon gotchas:**
- Use the **pooled** endpoint for the app, **direct** endpoint for Prisma migrations.
- Enable `keepaliveTimeMs=300000` in HikariCP to prevent idle-timeout disconnects.
- Free tier pauses after 5 minutes of inactivity — the first request after a pause
  may take 2–3 s. Use the **Launch** plan ($19/mo) to disable auto-suspend in production.

---

### 2. Redis — Upstash

1. Create a database at [upstash.com](https://upstash.com).
2. Copy the **REST URL** or **Redis URL** from the dashboard.
3. Enable **TLS** (required for Upstash).

```
# Kotlin API + Worker
REDIS_URL=rediss://<token>@<host>.upstash.io:6380
REDIS_TLS_ENABLED=true
```

**Upstash caveats — read carefully:**

| Concern | Detail |
|---|---|
| **Latency** | Upstash is HTTP-over-Redis. P50 ≈ 1–3 ms for nearby regions. Good for queuing; avoid for sub-ms caching. |
| **Streams** | Redis Streams (`XREADGROUP`) are supported but have per-request pricing. Each worker poll = 1 command. At 4 workers × 1 poll/5s = ~70k commands/day ≈ $0.07/day. |
| **Max connections** | Serverless model — no persistent connection limit issues. |
| **Pub/Sub** | Upstash supports Pub/Sub. SSE run-event streaming works fine. |
| **Free tier** | 10,000 commands/day. Fine for development; hits the limit quickly in production. |
| **Pricing** | $0.20 per 100k commands after free tier. Budget $5–15/mo for light production use. |

**When to move from Upstash to dedicated Redis:**
- Worker concurrency > 8 and polling frequently (latency matters).
- > 1M commands/day (Upstash cost exceeds a $15/mo Render Redis instance).
- You need Redis persistence guarantees (AOF/RDB) for the queue.
- You want Pub/Sub subscriptions open permanently (Upstash charges per connection-second).

Upgrade path: [Railway Redis](https://railway.app) or [Render Redis](https://render.com) at ~$15/mo for a persistent instance.

---

### 3. Kotlin API — Railway

1. Connect your GitHub repo.
2. Add a new **Service** → point to `apps/api-kotlin`.
3. Set **Root Directory**: `apps/api-kotlin`.
4. Set **Build Command**: `gradle fatJar --no-daemon -q`
5. Set **Start Command**: `java $JAVA_OPTS -jar build/libs/vectorbea-api-all.jar`

   Or use the Dockerfile (recommended for reproducibility):
   - Set **Dockerfile path**: `apps/api-kotlin/Dockerfile`

6. Set environment variables (see [Required Env Vars](#required-env-vars) below).

**Health checks** (Railway → Settings → Health Check):
- Path: `/health`
- Port: `8080`
- Timeout: `10s`
- Readiness: `/ready` — waits until DB + Redis are up before routing traffic.

**Scaling:**
- Start with 1 replica, 512 MB RAM.
- Scale horizontally by adding replicas — the API is stateless.
- Memory pressure: watch GC logs. Increase to 1 GB if you see frequent GC.

---

### 4. Kotlin Worker — Railway (Background Worker)

1. Add another **Service** from the same repo.
2. Set **Root Directory**: `apps/worker-kotlin`.
3. Set **Dockerfile path**: `apps/worker-kotlin/Dockerfile` (recommended).
4. The worker has **no inbound HTTP** — it's a long-running background process.

**Health / readiness:**
- Railway won't route HTTP traffic to the worker.
- Liveness is tracked via the heartbeat key in Redis
  (`vectorbea:worker:<id>:heartbeat`).
- If the heartbeat key expires the worker is considered dead and will be
  restarted by Railway's crash detection.

**Scaling worker replicas:**

| Load | Replicas | Concurrency per replica | Total parallel runs |
|---|---|---|---|
| Light (< 10 runs/hr) | 1 | 4 | 4 |
| Medium (< 100 runs/hr) | 2 | 4 | 8 |
| Heavy (< 500 runs/hr) | 4 | 8 | 32 |

Each replica independently consumes from the Redis Stream consumer group —
Rails automatically distributes work. No coordination needed.

**Concurrency tuning:**
- `WORKER_CONCURRENCY` controls parallel runs per replica.
- Each run may make multiple LLM/HTTP calls — set concurrency based on
  downstream rate limits, not CPU.
- For OpenAI-heavy workloads: start at 4, increase if you're not hitting
  rate limits.
- Monitor `worker_runs_active` in the metrics endpoint to find the steady-state.

---

### 5. Next.js Web — Vercel

1. Import the repo at [vercel.com](https://vercel.com).
2. Set **Root Directory**: `apps/web`.
3. Set **Build Command**: `npm run build` (Next.js default).
4. Set environment variables (see [Required Env Vars](#required-env-vars) below).

**Vercel env var:**

```
NEXT_PUBLIC_VECTORBEA_API_URL=https://api.yourapp.com
```

This is the only critical Vercel-specific setting — it tells the browser
where to reach the Kotlin API.

---

## Required Env Vars

### Kotlin API (`apps/api-kotlin`)

| Variable | Required | Example | Notes |
|---|---|---|---|
| `DATABASE_URL` | ✅ | `jdbc:postgresql://host/db?sslmode=require` | HikariCP JDBC URL |
| `REDIS_URL` | ✅ | `rediss://token@host:6380` | Lettuce URI |
| `SECRET_ENCRYPTION_KEY` | ✅ | `<base64 32 bytes>` | `openssl rand -base64 32` |
| `PORT` | — | `8080` | Default: 8080 |
| `APP_ENV` | — | `production` | Enables strict mode |
| `RUN_MIGRATIONS` | — | `false` | Run Flyway in CI instead |
| `REDIS_TLS_ENABLED` | — | `true` | Required for Upstash |
| `CORS_ALLOWED_ORIGINS` | — | `https://app.vercel.app` | Comma-separated |
| `LOG_LEVEL` | — | `INFO` | TRACE/DEBUG/INFO/WARN/ERROR |
| `SECRET_KEY_VERSION` | — | `1` | Key rotation version |
| `DB_POOL_MAX_SIZE` | — | `10` | HikariCP max connections |

### Kotlin Worker (`apps/worker-kotlin`)

| Variable | Required | Example | Notes |
|---|---|---|---|
| `DATABASE_URL` | ✅ | `jdbc:postgresql://host/db?sslmode=require` | |
| `REDIS_URL` | ✅ | `rediss://token@host:6380` | |
| `SECRET_ENCRYPTION_KEY` | ✅ | `<base64 32 bytes>` | Must match API |
| `APP_ENV` | — | `production` | Fails fast if infra absent |
| `WORKER_CONCURRENCY` | — | `4` | Parallel runs (1–32) |
| `WORKER_QUEUE_STREAM` | — | `workflow-runs` | Must match API |
| `WORKER_QUEUE_GROUP` | — | `workflow-workers` | Must match API |
| `WORKER_HEARTBEAT_TTL_SECONDS` | — | `60` | Redis TTL for heartbeat |
| `METRICS_PORT` | — | `9090` | Prometheus metrics |
| `LOG_LEVEL` | — | `INFO` | |

### Next.js Web (`apps/web`)

| Variable | Required | Example | Notes |
|---|---|---|---|
| `NEXT_PUBLIC_VECTORBEA_API_URL` | ✅ | `https://api.yourapp.com` | Kotlin API base URL |
| `DATABASE_URL` | ✅ | `postgresql://...` | Prisma — auth/billing only |
| `DIRECT_URL` | ✅ | `postgresql://...` | Prisma direct (non-pooled) |
| `NEXT_PUBLIC_SUPABASE_URL` | — | `https://xxx.supabase.co` | Auth (if enabled) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | — | `eyJ...` | Auth |
| `SUPABASE_SERVICE_ROLE_KEY` | — | `eyJ...` | Auth (server-side only) |
| `REQUIRE_AUTH` | — | `true` | Enforce auth in production |

---

## Health Checks

### API — `/health` and `/ready`

```
GET /health
→ 200 {"status":"ok","service":"vectorbea-api","version":"0.1.0"}

GET /ready
→ 200 {"status":"ok","checks":{"db":"ok","redis":"ok"}}
→ 503 {"status":"error","checks":{"db":"error","redis":"ok"}}
```

Configure your platform's health check to hit `/health` for liveness and
`/ready` for readiness (waits for DB + Redis before routing traffic).

### Worker — `/metrics` (port 9090)

The worker does not expose an HTTP API. It exposes a Prometheus-compatible
metrics endpoint on `METRICS_PORT` (default 9090):

```
GET http://worker:9090/metrics
→ 200 (Prometheus text format)

# worker_runs_active 2.0
# worker_runs_total{status="succeeded"} 47.0
# worker_heartbeat_last_ms 1716900000000.0
```

---

## Migrations

**Development (local):**
```bash
# Flyway (Kotlin API) — runs automatically on startup if RUN_MIGRATIONS=true
npm run dev:api

# Prisma (Next.js auth/billing tables) — run once after starting infra
npm run db:migrate
```

**Production — run migrations before deploying new app version:**
```bash
# Option A: Railway release command
#   In Railway → Service → Settings → Deploy → Release Command:
#   java -jar app.jar --migrate-only
#   (Requires a --migrate-only CLI flag in Main.kt — or set RUN_MIGRATIONS=true
#   on the API service only during the release phase)

# Option B: One-off migration job (recommended for zero-downtime)
#   Run a temporary container with RUN_MIGRATIONS=true and APP_ENV=production.
#   Flyway is idempotent — safe to run before every deploy.

# Prisma (web)
npx prisma migrate deploy --schema prisma/schema.prisma
```

---

## Secrets Management

**Current approach — encrypted in DB:**
- Connection secrets (API keys, tokens) are encrypted with AES-256-GCM
  before storage using `SECRET_ENCRYPTION_KEY`.
- The key itself is stored as a platform environment variable (Railway secret,
  Vercel env var, etc.).
- This is secure for early-stage: the secret never touches the DB in plaintext.

**Rotation:**
- Increment `SECRET_KEY_VERSION` and re-encrypt secrets with the new key via
  a migration job. Old and new versions can coexist during rotation.

**When to upgrade to a cloud secret manager:**
- When you have compliance requirements (SOC 2, HIPAA).
- When more than one team member needs access to production secrets.
- Upgrade path: AWS Secrets Manager, GCP Secret Manager, or HashiCorp Vault.
  The `SecretService` in the worker and API is already abstracted — swap the
  implementation without changing callers.

---

## Cost Scaling Thresholds

| Monthly runs | Recommended change | Est. cost delta |
|---|---|---|
| < 1,000 | Current setup fine | — |
| 1,000–10,000 | Upgrade Neon to Launch ($19) to avoid cold starts | +$19 |
| 10,000–100,000 | Add second worker replica; move Redis to dedicated ($15) | +$20–30 |
| 100,000+ | Consider Railway Teams or Fly.io; add read replica for Postgres | +$50–100 |

---

## Quick Reference — Local Commands

```bash
# First time
cp .env.example .env
cp apps/web/.env.example apps/web/.env.local
cp apps/api-kotlin/.env.example apps/api-kotlin/.env
cp apps/worker-kotlin/.env.example apps/worker-kotlin/.env

# Start infra (Postgres + Redis)
npm run dev:infra

# Run Prisma migrations (Next.js tables)
npm run db:migrate

# Start all services natively (hot-reload)
npm run dev:web          # Terminal 1: Next.js on :3000
npm run dev:api          # Terminal 2: Kotlin API on :8080
npm run dev:worker:kotlin # Terminal 3: Kotlin worker

# Or start everything in Docker (no hot-reload)
docker compose up -d

# Build fat jars
npm run build:api
npm run build:worker

# Run tests
npm run test:api
npm run test:worker

# Stop infra
npm run dev:infra:stop
```

---

## Deployment Checklist

- [ ] `SECRET_ENCRYPTION_KEY` is a real random value (`openssl rand -base64 32`)
- [ ] `APP_ENV=production` is set on API and worker
- [ ] `RUN_MIGRATIONS=false` on the running app (run migrations as a separate step)
- [ ] `CORS_ALLOWED_ORIGINS` is set to your Vercel domain (not `*`)
- [ ] `REQUIRE_AUTH=true` is set on the web app
- [ ] `REDIS_TLS_ENABLED=true` if using Upstash or Redis Cloud
- [ ] Health check path `/health` is configured on the API service
- [ ] Worker heartbeat TTL > heartbeat interval (`WORKER_HEARTBEAT_TTL_SECONDS=60`, `WORKER_HEARTBEAT_INTERVAL_MS=15000`)
- [ ] Postgres `keepaliveTimeMs` is set (prevents Neon idle disconnect)
- [ ] Secrets are not committed to git (`.env` is in `.gitignore`)
