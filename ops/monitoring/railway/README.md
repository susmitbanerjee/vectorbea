# Deploying the monitoring stack on Railway

The stack is **six services in one Railway project** plus **one agent per application
environment**. Only two things are reachable from the internet; everything else talks
over Railway's private network.

```
                     ┌──────────────────────── monitoring project ─────────────────────────┐
                     │                                                                     │
  staging env        │   collector ──metrics──▶ prometheus ──▶ alertmanager ──▶ email      │
  ┌──────────┐       │   (public)   ──traces───▶ tempo            │                        │
  │ agent    │───────┼──▶  :4318                                  │                        │
  │ api      │       │                                            ▼                        │
  │ worker   │       │                        grafana ◀── queries ─┘                       │
  └──────────┘       │                        (public) telemetry.vectorbea.com             │
                     │                                                                     │
  production env     │                                                                     │
  ┌──────────┐       │                                                                     │
  │ agent    │───────┘                                                                     │
  │ api      │                                                                             │
  │ worker   │                                                                             │
  └──────────┘                                                                             │
                     └─────────────────────────────────────────────────────────────────────┘
```

## Why it is shaped like this

**One stack, not one per environment.** A separate Grafana per environment means two
sets of dashboards to keep in step, and the question you actually ask during an incident
— "does staging look like this too?" — needs both on one screen. The `environment` label
does the separating, and every dashboard has an `$env` selector.

**An agent per environment, because Railway's private network is per-environment.**
Prometheus in the monitoring project genuinely cannot reach `worker.railway.internal` in
the staging environment. The alternative would be public `/metrics` endpoints, and those
would serve `llm_cost_usd_micros{workspace}` — a per-customer cost report — to anyone
who asked. See `ops/monitoring/agent/config.yml`.

**Only Grafana and the collector are public.** Prometheus' query API has no
authentication and can read every series including per-workspace cost; Tempo's OTLP port
has none either. Neither may face the internet. The collector is the one component whose
ingest can require a bearer token, so it is the only door in.

---

## 1. Create the project and services

Create a Railway project (suggested name `vectorbea-monitoring`) with a **single
`production` environment** — this stack is not itself per-environment.

Add six services, each **Dockerfile-deployed from this repo**:

| Service | Dockerfile | Public? |
|---|---|---|
| `prometheus` | `ops/monitoring/railway/prometheus.Dockerfile` | no |
| `alertmanager` | `ops/monitoring/railway/alertmanager.Dockerfile` | no |
| `tempo` | `ops/monitoring/railway/tempo.Dockerfile` | no |
| `loki` | `ops/monitoring/railway/loki.Dockerfile` | no |
| `collector` | `ops/monitoring/railway/collector.Dockerfile` | **yes** |
| `grafana` | `ops/monitoring/railway/grafana.Dockerfile` | **yes** |

Set each service's **root directory to the repo root** (the Dockerfiles copy from
`ops/monitoring/…`, so a narrower root breaks the build context).

Attach a **volume** to `prometheus` (`/prometheus`), `tempo` (`/var/tempo`), `loki`
(`/loki`) and `grafana` (`/var/lib/grafana`). Without one, a redeploy loses history —
and for Grafana, loses every user account.

## 2. Domains

- `grafana` → custom domain **`telemetry.vectorbea.com`**.
- `collector` → a Railway-generated domain is fine (e.g.
  `collector-production.up.railway.app`). Nothing human visits it.

> **Note:** `telemetry.vectorbea.com` previously pointed at the standalone
> `apps/telemetry` service, which no longer exists — it was folded into `api-kotlin`,
> and its admin console now lives at `api.vectorbea.com/admin/telemetry`. Repointing the
> domain here is deliberate and is the last step of that move.

## 3. Environment variables

**On every monitoring service:**

| Variable | Value |
|---|---|
| `TELEMETRY_INGEST_TOKEN` | a long random secret — generate with `openssl rand -hex 32` |

**`collector` also needs:**

| Variable | Value |
|---|---|
| `PROMETHEUS_REMOTE_WRITE_ENDPOINT` | `http://prometheus.railway.internal:9090/api/v1/write` |
| `TEMPO_ENDPOINT` | `tempo.railway.internal:4317` |

**`alertmanager` also needs:**

| Variable | Notes |
|---|---|
| `ALERT_EMAIL` | where pages and tickets go |
| `SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD` | any SMTP provider; Resend and Postmark both have adequate free tiers |
| `ALERT_WEBHOOK_URL` | optional — an ntfy topic or Telegram bot, so a page reaches a lock screen |

**`grafana` also needs:**

| Variable | Notes |
|---|---|
| `GF_SECURITY_ADMIN_PASSWORD` | required; generate a long random one — see §4 for why it still matters |
| `GF_SERVER_ROOT_URL` | `https://telemetry.vectorbea.com` |
| `GRAFANA_ALLOWED_EMAILS` | **`susmit.b1@gmail.com`** — see §4. The container refuses to start without it. |
| `GRAFANA_OAUTH_CLIENT_ID` / `GRAFANA_OAUTH_CLIENT_SECRET` | from the Google OAuth client, §4 |
| `ANALYTICS_DB_HOST` … `ANALYTICS_DB_PASSWORD` | the **read-only** Neon role, see §6 |

## 4. Who can open telemetry.vectorbea.com

**One address: `susmit.b1@gmail.com`. Everyone else is refused at login.**

These dashboards carry per-workspace cost, run volume and the product event stream.
That is customer data even in aggregate, on a public domain, so access is an explicit
allow-list rather than a shared password.

### Why it is built this way

Grafana has **no "allowed emails" setting.** It has `allowed_domains`, and for this
case that setting is a trap: the address to admit is a `gmail.com` address, so
`allowed_domains = gmail.com` **would admit every Google account on earth** while
looking, in a config file, exactly like access control.

What Grafana does have is `role_attribute_path` — a JMESPath expression evaluated
against the OAuth userinfo response, whose result becomes the user's role. Paired with
`role_attribute_strict = true`, an expression yielding nothing **denies the login**
rather than falling back to a default role. So the allow-list is expressed as a role
mapping, because that is the only mechanism in Grafana that actually refuses people:

```
email_verified && contains(['susmit.b1@gmail.com'], email) && 'Admin'
```

`email_verified` is checked first and deliberately — Google returns an unverified
address on some account types, and an unverified address is a claim, not an identity.

The list is assembled from `GRAFANA_ALLOWED_EMAILS` at startup, so adding someone is a
Railway variable change and a restart — not a commit, a rebuild and a redeploy.

### Create the Google OAuth client

This is the one step that cannot be done from the repo.

1. <https://console.cloud.google.com/apis/credentials> → **Create credentials** →
   **OAuth client ID** → **Web application**.
2. Authorised redirect URI — exactly this, including the path:
   ```
   https://telemetry.vectorbea.com/login/generic_oauth
   ```
3. Copy the client ID and secret into `GRAFANA_OAUTH_CLIENT_ID` and
   `GRAFANA_OAUTH_CLIENT_SECRET` on the `grafana` service.
4. On the OAuth **consent screen**, leave the publishing status as **Testing** and add
   `susmit.b1@gmail.com` as a test user. This is a second, independent layer: Google
   itself then refuses everyone else before Grafana is ever reached.

### What each failure looks like

| Who | What happens |
|---|---|
| `susmit.b1@gmail.com` | Signs in, lands on the dashboards as Admin |
| Any other Google account | Google's own consent screen refuses it (app in Testing), or — if publishing is ever changed — Grafana refuses with *"user does not have a valid role"* |
| Anyone with no account | The login form is not rendered; there is nothing to submit |
| A crawler or a shared link | `GF_AUTH_ANONYMOUS_ENABLED=false`; redirected to login |

### The local password form, and the one honest caveat

The local admin login form is **disabled** whenever OAuth is configured. It is a second
door that OAuth does not guard, and "only this address" is not true while anyone holding
the admin password can walk through it.

**The caveat:** `GF_SECURITY_ADMIN_PASSWORD` still exists, and Grafana's HTTP API accepts
it over basic auth regardless of the login form. That is not a UI you can browse, but it
is API access, so **treat that password as a credential of the same weight as the OAuth
secret** — generate it with `openssl rand -base64 32`, put it nowhere else, and do not
reuse it.

**Break-glass.** If OAuth is misconfigured you would otherwise be locked out of the
monitoring at exactly the moment you want it. Set `GRAFANA_BREAK_GLASS=true` and
redeploy: the password form comes back, the startup logs say so loudly, and you can get
in. Turn it off once OAuth works.

**One known behaviour:** the match is case-sensitive. Google normalises the `email`
claim to lowercase for Gmail accounts, so this does not arise in practice — but if you
ever add a non-Google address through another provider, enter it exactly as that
provider returns it.

### Note on the admin analytics console

`api.vectorbea.com/admin/telemetry` is a **separate** surface with **separate** access
control — `ADMIN_EMAILS` on the API service. Restricting Grafana does not restrict it.
If the intent is that only one person sees platform-wide data, set `ADMIN_EMAILS` to
that same single address.

## 5. The agents

In **each application environment** (Railway `staging` and `production` of the main
project), add one more service:

| Service | Dockerfile |
|---|---|
| `telemetry-agent` | `ops/monitoring/railway/agent.Dockerfile` |

Variables:

| Variable | staging | production |
|---|---|---|
| `VECTORBEA_ENV` | `dev` | `prod` |
| `TELEMETRY_INGEST_ENDPOINT` | `https://<collector domain>:443` | same |
| `TELEMETRY_INGEST_TOKEN` | the secret from §3 | same |
| `API_METRICS_TARGET` | `api.railway.internal:8080` | same |
| `WORKER_DNS_NAME` | `worker.railway.internal` | same |

`VECTORBEA_ENV` is the label every dashboard's `$env` selector reads. **Getting it wrong
mislabels an entire environment's data**, which is worse than having none — staging
rendered as production reads as a customer-facing incident.

Then point the application services at their local agent:

```
OTEL_ENABLED=true
OTEL_EXPORTER_OTLP_ENDPOINT=http://telemetry-agent.railway.internal:4317
```

on **both** `api-kotlin` and `worker-kotlin`, in **both** environments.

## 6. The read-only analytics role

The Product and Workspace-support dashboards query `analytics_events` directly. Grafana
accepts arbitrary SQL from anyone who can edit a panel, so this connection must not be
able to write.

```sql
CREATE ROLE grafana_ro LOGIN PASSWORD '…';
GRANT CONNECT ON DATABASE vectorbea TO grafana_ro;
GRANT USAGE ON SCHEMA public TO grafana_ro;
GRANT SELECT ON analytics_events, analytics_daily_rollups TO grafana_ro;
-- Deliberately NOT `GRANT SELECT ON ALL TABLES`: the dashboards need two tables, and
-- a role that can read `connections` or `workspace_otel_exports` puts customer
-- credentials one panel away from anyone with Grafana edit rights.
```

## 7. Verify

In order, because each step depends on the one before:

1. **`collector` logs** show no startup errors and the OTLP receivers are listening.
2. **`telemetry-agent` logs** in each environment show no 401s. A 401 means
   `TELEMETRY_INGEST_TOKEN` does not match.
3. **Prometheus** — through Grafana, run `up{job="telemetry-agent"}`. One series per
   environment.
4. **`count(count by (environment) (job_last_success_timestamp_seconds))`** should equal
   the number of environments reporting. This is also the check the `ScrapeAgentDown`
   alert automates.
5. **Access control — test the refusal, not just the admission.** Confirming your own
   login works proves nothing about whether anyone else's does.
   - Sign in as `susmit.b1@gmail.com`. You should land on the dashboards as Admin.
   - In a private window, try any other Google account. Expect a refusal from Google's
     consent screen (app in Testing) or *"user does not have a valid role"* from
     Grafana. **If it admits you, stop and check `role_attribute_strict` — without it
     a non-matching user silently gets the default role.**
   - Confirm the password form is gone from `/login`. If it is there, OAuth did not
     configure — check the startup logs for the `GRAFANA_OAUTH_CLIENT_ID unset` warning.
6. **Open every dashboard** and switch `$env` between `prod` and `dev`. A panel that is
   empty in both is a genuine gap; a panel empty in one is usually correct (staging is
   quiet).
7. **Fire a synthetic alert** — see `docs/telemetry/RUNBOOKS.md`.

## 8. What this costs

Six small containers plus one agent per environment. On Railway's usage-based pricing
that is roughly **$15–25/month** at the memory limits in `docker-compose.yml`
(Prometheus 768M is the largest). Prometheus retention is capped at 15d/4GB and Tempo at
72h, so storage does not grow without bound.

Cheaper alternative if that matters: the same compose file on a €6/month Hetzner box,
with the agents pointing at it instead. The trade is that you then own the box —
including patching it, and including the fact that it has no monitoring of its own.

**Either way, the external ping in `docs/telemetry/RUNBOOKS.md` is not optional.** This
stack cannot alert on its own death.
