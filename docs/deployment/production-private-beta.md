# Vectorbea — Production Private Beta Deployment Guide

> **Vectorbea is closed-source, invite-only.** This guide is for internal use only.

## Infrastructure

| Component | Platform |
|-----------|---------|
| `apps/web` | Vercel |
| `apps/api-kotlin` | Railway / Render / Fly |
| `apps/worker-kotlin` | Railway / Render / Fly |
| Database | Neon PostgreSQL |
| Cache / Queue | Upstash Redis |
| Auth | Supabase (identity only) |

---

## Required Environment Variables

### `apps/api-kotlin`

```
APP_ENV=production
PRIVATE_BETA_MODE=true
PUBLIC_SIGNUP_ENABLED=false

# Database (Neon)
DATABASE_URL=postgres://...
RUN_MIGRATIONS=true

# Redis (Upstash)
REDIS_URL=rediss://...
REDIS_TLS_ENABLED=true

# Secret encryption — generate with:
#   openssl rand -hex 32
SECRET_ENCRYPTION_KEY=<64-char hex string>
SECRET_KEY_VERSION=v1

# Supabase JWT verification
JWT_SECRET=<your Supabase JWT secret>
# or
SUPABASE_JWT_SECRET=<your Supabase JWT secret>

# CORS — set to your Vercel domain
CORS_ALLOWED_ORIGINS=https://app.vectorbea.com,https://vectorbea.com

# Admin access
ADMIN_EMAILS=admin@yourcompany.com

# Execution controls
DEFAULT_EXECUTION_MODE=simulation_only
REAL_EXECUTION_REQUIRES_ADMIN_APPROVAL=true
BYOK_REQUIRED_FOR_REAL_EXECUTION=true
ALLOW_PLATFORM_LLM_FOR_WORKFLOW_EXECUTION=false

# AI Architect (optional)
AI_ARCHITECT_ENABLED=true
# AI_ARCHITECT_API_KEY=sk-...  (or OPENAI_API_KEY)
```

### `apps/worker-kotlin`

```
APP_ENV=production
DATABASE_URL=postgres://...
REDIS_URL=rediss://...
REDIS_TLS_ENABLED=true
SECRET_ENCRYPTION_KEY=<same key as API>
SECRET_KEY_VERSION=v1

WORKER_ID=worker-1
WORKER_NAME=prod-worker-1
WORKER_CONCURRENCY=2
BYOK_REQUIRED_FOR_REAL_EXECUTION=true
ALLOW_PLATFORM_LLM_FOR_WORKFLOW_EXECUTION=false

# App URL for built-in email
APP_URL=https://app.vectorbea.com
```

### `apps/web` (Vercel env vars)

```
NEXT_PUBLIC_VECTORBEA_API_URL=https://api.vectorbea.com
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
NEXT_PUBLIC_PRIVATE_BETA_MODE=true

# Server-side only (not NEXT_PUBLIC_)
VECTORBEA_INGEST_SECRET=<random string for internal email endpoint>
RESEND_API_KEY=re_...
EMAIL_FROM=noreply@vectorbea.com
```

---

## Generating `SECRET_ENCRYPTION_KEY`

```bash
openssl rand -hex 32
```

Store the output in Railway / Render / Fly env vars. **Never commit to git.**
Use the same key for both API and worker.

---

## Supabase JWT Configuration

1. Go to Supabase Dashboard → Settings → API
2. Copy **JWT Secret**
3. Set `JWT_SECRET=<jwt_secret>` in api-kotlin env vars
4. Supabase JWKS URL (for RS256, if used): `https://xxx.supabase.co/auth/v1/.well-known/jwks.json`

---

## Deploying api-kotlin (Railway)

1. Create a new Railway service
2. Set **Root Directory** to `apps/api-kotlin`
3. Railway auto-detects the Dockerfile
4. Add all required env vars
5. Set `RUN_MIGRATIONS=true` for first deploy (migrations are idempotent)
6. Verify: `GET https://api.yourapp.com/health`

## Deploying worker-kotlin (Railway)

1. Create a second Railway service in same project
2. Set **Root Directory** to `apps/worker-kotlin`
3. Add all required env vars
4. Worker starts polling Redis automatically

## Deploying web (Vercel)

1. Connect GitHub repo to Vercel
2. Set **Root Directory** to `apps/web`
3. Add all required env vars in Vercel dashboard
4. Vercel builds Next.js automatically on push to `main`

---

## Health & Readiness Verification

```bash
# API health
curl https://api.vectorbea.com/health

# API readiness (checks DB + Redis)
curl https://api.vectorbea.com/ready

# Version
curl https://api.vectorbea.com/version
```

Expected `/health` response:
```json
{"status":"ok","timestamp":"...","version":"0.1.0"}
```

Expected `/ready` response:
```json
{"status":"ready","db":"ok","redis":"ok","latencyMs":5}
```

---

## First Admin / Beta User Onboarding

1. Sign in to the app with your email (Supabase auth)
2. Your email is in `ADMIN_EMAILS` → you have admin access
3. Go to `/admin/beta/applications` to see applications
4. Or directly set beta_status in DB:

```sql
UPDATE app_users SET beta_status='approved', is_platform_admin=true
WHERE email='admin@yourcompany.com';
```

---

## Approving a Design Partner

1. They submit application at `/beta`
2. Admin reviews at `GET /api/admin/beta/applications`
3. Approve: `POST /api/admin/beta/applications/{id}/approve`
4. This sets `beta_status=approved` on their app_user
5. Default mode is `simulation_only` — they can test without real connections

## Enabling Real Execution for a Workspace

```bash
curl -X POST https://api.vectorbea.com/api/admin/beta/workspaces/{wsId}/enable-real-execution \
  -H "Authorization: Bearer <admin_token>" \
  -H "Content-Type: application/json" \
  -d '{"enabled": true}'
```

User must also:
1. Create an LLM connection (BYOK) in Connections page
2. Test the connection
3. Assign it to their agent

## Setting Up BYOK Connection

1. Go to Connections → New Connection
2. Type: LLM Provider (OpenAI / Anthropic)
3. Enter API key (encrypted server-side, never logged)
4. Test connection → must pass
5. Assign connection to agents in workflow builder

---

## Triggering a Simulation Run

```bash
curl -X POST https://api.vectorbea.com/api/workflows/{id}/run \
  -H "Authorization: Bearer <token>" \
  -H "X-Workspace-Id: <wsId>" \
  -H "X-Environment-Id: <envId>" \
  -H "Content-Type: application/json" \
  -d '{"mode": "simulation", "input": {}}'
```

## Triggering a Real Run

Same as above with `"mode": "real"` — requires real execution enabled + BYOK.

---

## Disabling a Workspace

```bash
curl -X POST https://api.vectorbea.com/api/admin/beta/workspaces/{wsId}/disable \
  -H "Authorization: Bearer <admin_token>" \
  -d '{"reason": "Abuse detected"}'
```

---

## Rolling Back

1. Railway / Render / Fly all support one-click rollback to previous deploy
2. Flyway migrations are additive — no down-migrations needed for V001–V015
3. If V015 rollback needed, run:
```sql
ALTER TABLE app_users DROP COLUMN IF EXISTS beta_status;
ALTER TABLE app_users DROP COLUMN IF EXISTS is_platform_admin;
DROP TABLE IF EXISTS workspace_usage_policies;
DROP TABLE IF EXISTS workspace_beta_controls;
DROP TABLE IF EXISTS daily_workspace_usage;
DROP TABLE IF EXISTS usage_limit_requests;
DROP TABLE IF EXISTS beta_applications;
```

---

## Operational Checklist

- [ ] DATABASE_URL set (Neon connection string)
- [ ] REDIS_URL set (Upstash TLS URL)
- [ ] SECRET_ENCRYPTION_KEY set (64-char hex)
- [ ] JWT_SECRET set (Supabase JWT secret)
- [ ] CORS_ALLOWED_ORIGINS set (Vercel domain)
- [ ] ADMIN_EMAILS set (at least one admin email)
- [ ] PRIVATE_BETA_MODE=true
- [ ] RUN_MIGRATIONS=true on first api-kotlin deploy
- [ ] Worker deployed with same SECRET_ENCRYPTION_KEY
- [ ] /health returns ok
- [ ] /ready returns DB+Redis ok
- [ ] Admin user manually approved in DB
- [ ] Simulation run tested successfully
