# Telemetry Service Deployment — telemetry.vectorbea.com

## Overview

`apps/telemetry` is an independent Kotlin service deployable to Railway, Render, or Fly.io.
It runs at `telemetry.vectorbea.com` and is accessed only by internal services and admins.

## Deploy to Railway

1. Create a new Railway project or service in the Vectorbea project.
2. Set root directory to `apps/telemetry`.
3. Set build command: `gradle fatJar --no-daemon`
4. Set start command: `java -Xms64m -Xmx256m -jar build/libs/vectorbea-telemetry-0.1.0-all.jar`
5. Or use the Dockerfile: Railway auto-detects and uses `apps/telemetry/Dockerfile`.
6. Add the environment variables below.
7. Set custom domain: `telemetry.vectorbea.com`

## Deploy to Render

1. Create a new Web Service.
2. Connect GitHub repo, set root directory to `apps/telemetry`.
3. Build command: `gradle fatJar --no-daemon`
4. Start command: `java -jar build/libs/vectorbea-telemetry-0.1.0-all.jar`
5. Set environment variables below.
6. Add custom domain: `telemetry.vectorbea.com`

## Deploy to Fly.io

```bash
cd apps/telemetry
fly launch --name vectorbea-telemetry
fly deploy
fly domains add telemetry.vectorbea.com
```

## Required Environment Variables

```env
APP_ENV=production
VECTORBEA_ENV=prod
PORT=8080

# Database — same Neon DB or separate telemetry DB
DATABASE_URL=postgresql://...
RUN_MIGRATIONS=true

# Auth — same JWT secret as api-kotlin
JWT_SECRET=<shared-jwt-secret>

# Admin access
ADMIN_EMAILS=admin@vectorbea.com,ops@vectorbea.com

# Internal service token — shared with api-kotlin and worker-kotlin
TELEMETRY_INTERNAL_TOKEN=<strong-random-secret>

# CORS — only these origins allowed
TELEMETRY_CORS_ALLOWED_ORIGINS=https://vectorbea.com,https://app.vectorbea.com,https://telemetry.vectorbea.com

# Public URL
TELEMETRY_PUBLIC_URL=https://telemetry.vectorbea.com

# OpenTelemetry (optional — disable if no Grafana yet)
OTEL_ENABLED=false
OTEL_SERVICE_NAME=vectorbea-telemetry
OTEL_EXPORTER_OTLP_ENDPOINT=
OTEL_EXPORTER_OTLP_HEADERS=

# Analytics settings
ANALYTICS_MAX_BATCH_SIZE=50
ANALYTICS_MAX_EVENT_SIZE_BYTES=16384
ANALYTICS_RETENTION_DAYS=180
```

## Required Environment Variables in Other Services

### api-kotlin
```env
TELEMETRY_ENABLED=true
TELEMETRY_ENDPOINT=https://telemetry.vectorbea.com
TELEMETRY_INTERNAL_TOKEN=<same-token-as-telemetry-service>
VECTORBEA_ENV=prod
```

### worker-kotlin
```env
TELEMETRY_ENABLED=true
TELEMETRY_ENDPOINT=https://telemetry.vectorbea.com
TELEMETRY_INTERNAL_TOKEN=<same-token-as-telemetry-service>
VECTORBEA_ENV=prod
```

### apps/web
```env
NEXT_PUBLIC_TELEMETRY_ENABLED=true
NEXT_PUBLIC_TELEMETRY_ENDPOINT=https://telemetry.vectorbea.com
NEXT_PUBLIC_VECTORBEA_ENV=prod
```

## Health Checks

| Endpoint       | Purpose                     |
|----------------|-----------------------------|
| `GET /health`  | Liveness — always 200 if up |
| `GET /ready`   | Readiness — checks DB + auth config |

Configure Railway/Render health check path: `/health`

## Database Migrations

Migrations run automatically on startup when `RUN_MIGRATIONS=true`.
Tables created: `analytics_events`, `analytics_daily_rollups`, `engineering_service_snapshots`,
`engineering_incidents`, `revenue_events`, `revenue_daily_rollups`.

For production, run migrations manually first:
```bash
RUN_MIGRATIONS=true java -jar app.jar
# Service will run migrations then start
```

## Domain Configuration

1. In your DNS provider, add a CNAME:
   `telemetry.vectorbea.com → <railway-or-render-domain>`
2. Add the domain in Railway/Render dashboard.
3. SSL is handled automatically.

## CORS

Only these origins are allowed by default:
- `https://vectorbea.com`
- `https://app.vectorbea.com`
- `https://telemetry.vectorbea.com`

For local dev, add `http://localhost:3000` to `TELEMETRY_CORS_ALLOWED_ORIGINS`.

## Internal Token Security

`TELEMETRY_INTERNAL_TOKEN` must be a strong random secret shared between:
- apps/telemetry (validates incoming requests)
- apps/api-kotlin (sends events via `X-Telemetry-Token` header)
- apps/worker-kotlin (sends events via `X-Telemetry-Token` header)

Generate a secure token:
```bash
openssl rand -hex 32
```

Store this in your secrets manager (Railway Variables, Render Environment, etc.).
Never commit this value to git.

## Grafana Integration

Once deployed, configure Grafana to read from the telemetry service:
- See `docs/telemetry/grafana-opentelemetry-setup.md`
- Engineering dashboard links to Grafana for full traces/metrics
- Snapshot summaries are stored in `engineering_service_snapshots`

## Revenue Telemetry

The `revenue_events` and `revenue_daily_rollups` tables are created but inactive.
The revenue dashboard shows: "Monetization is disabled. Revenue telemetry schema is available for future use."
Do not add Stripe, Razorpay, or any payment provider until business/compliance is ready.
