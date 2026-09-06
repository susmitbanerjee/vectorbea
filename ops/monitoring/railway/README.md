# Deploying the monitoring stack on Railway

**One Railway service** running the whole stack, plus **one small agent per application
environment**. One public domain, routed by path.

```
  staging env            ┌──────────── telemetry.vectorbea.com (one service) ────────────┐
  ┌──────────┐           │                                                               │
  │ agent    │──┐        │        nginx  ── /v1/*  ──▶ collector ──metrics──▶ prometheus │
  │ api      │  │  OTLP  │          │                      │                      │      │
  │ worker   │  ├───────▶│          │                      └──traces──▶ tempo     ▼      │
  └──────────┘  │  HTTPS │          └── /*  ──▶ grafana ◀────queries───┘    alertmanager │
                │        │                                        └── loki (idle)   │    │
  production env│        │                                                          ▼    │
  ┌──────────┐  │        │                                                       email   │
  │ agent    │──┘        │   prometheus / alertmanager / tempo / loki: NO route in       │
  │ api      │           │                                                               │
  │ worker   │           └───────────────────────────────────────────────────────────────┘
  └──────────┘
```

## Why it is shaped like this

**One service, one container.** Prometheus, Alertmanager, Tempo, Loki, the OTel
collector and Grafana all run side by side under supervisord, behind one nginx that
routes the single public port. Six Railway services would mean six lots of root
directory, Dockerfile path, variables and volumes — and each of those is a place to get
it wrong once and lose twenty minutes. At this size the whole monitoring stack is
smaller than the application it watches.

This is also what the original design was: `ops/monitoring/docker-compose.yml` has
always described one box running all of it. The six-service split was an artefact of
moving to Railway, not a decision made on the merits. Those Dockerfiles still exist —
see the appendix — for the day the trade stops being worth it.

**What is given up, honestly.** One component being OOM-killed takes the others with
it, and there are no per-component memory limits: the compose file sets six, here
there is one. supervisord restarts each program independently, so a crash is contained;
a memory exhaustion is not.

**An agent per application environment.** Railway's private network is scoped per
project AND per environment, so this container genuinely cannot reach
`worker.railway.internal` in staging. Each environment runs one small collector inside
its own network that scrapes locally, stamps `environment`, and pushes out over one
authenticated connection. The alternative — public `/metrics` endpoints — would serve
`llm_cost_usd_micros{workspace}`, a per-customer cost report, to anyone who asked.

**One Grafana for both environments**, separated by the `environment` label and an
`$env` selector on every dashboard. Two Grafanas would mean two sets of dashboards to
keep in step, and the question asked during an incident is "does staging look like this
too?"

---

## 1. Create the service

One Railway project (suggested name `vectorbea-monitoring`), one environment, **one
service**. Connect it to this repo and set:

| Setting | Value |
|---|---|
| Root Directory | `/` |
| `RAILWAY_DOCKERFILE_PATH` (service variable) | `ops/monitoring/railway/allinone.Dockerfile` |
| Volume mount path | `/data` |

### `RAILWAY_DOCKERFILE_PATH` is not optional

**Set it before the first deploy.** Without it Railway finds no Dockerfile at the root
directory, falls back to **Railpack** auto-detection, sees `gradlew` and
`build.gradle.kts` at the repo root, decides this is a Java project, and tries to build
the entire Kotlin monorepo:

```
using build driver railpack-v0.39.0
  ↳ Detected Java
  ↳ Using Gradle
  $ ./gradlew clean build -x check -x test -Pproduction
Error: Unable to access jarfile /app/gradle/wrapper/gradle-wrapper.jar
```

The giveaway is the first line: `build driver railpack` means the Dockerfile was never
read. Whatever error follows is a symptom of the wrong builder, not the cause.

**It must name a FILE, not a folder.** Pointing it at `ops/monitoring/railway/` makes
Railway read the directory itself as a Dockerfile:

```
dockerfile invalid: failed to parse dockerfile: file with no instructions
```

### Root Directory must be `/`

The repo root. This is the other setting most likely to be got wrong, because
`ops/monitoring/railway` looks like the obvious answer. It is not: Railway makes the
root directory the Docker **build context**, and the Dockerfile copies from
`ops/monitoring/…`. Narrow the root and the build fails at the first `COPY`, on a path
that plainly exists in the repo.

### The volume

Mount one volume at **`/data`**. The entrypoint creates a subdirectory per component
(`/data/prometheus`, `/data/tempo`, `/data/loki`, `/data/grafana`,
`/data/alertmanager`). Without it a redeploy loses all history — and for Grafana, every
user account.

### Optional: config-as-code

`ops/monitoring/railway/allinone.railway.json` carries the restart policy, the
`/api/health` health check and `watchPatterns` so an unrelated commit does not rebuild
the stack. Point the service's **Config-as-code** field at it. Set
`RAILWAY_DOCKERFILE_PATH` as well, not instead — the variable is what guarantees the
builder is right even if the config path is wrong.

### Sizing

Seven processes share one memory limit. Prometheus is the largest and is capped at
15d/4GB of series. **2 GB is a sensible starting point**; below about 1 GB, Prometheus
and Grafana will contend and you will see restarts under load rather than a clean
failure.

## 2. Domain

Give the service the custom domain **`telemetry.vectorbea.com`**. That single domain
serves both things, routed by path inside the container:

| Path | Goes to | Auth |
|---|---|---|
| `/v1/metrics`, `/v1/traces` | the OTel collector | bearer token |
| everything else | Grafana | Google OAuth, §4 |

`/prometheus`, `/alertmanager`, `/tempo`, `/loki` and `/api/v1/write` return **404** —
nginx has no route to them. Prometheus' query API has no authentication and can read
every series including per-workspace cost, so it must never be reachable; the same
applies to Alertmanager's silence API and Tempo's span store.

> **Note:** `telemetry.vectorbea.com` previously pointed at the standalone
> `apps/telemetry` service, which no longer exists — it was folded into `api-kotlin`,
> and its admin console now lives at `api.vectorbea.com/admin/telemetry`. Repointing
> the domain here is deliberate and is the last step of that move.

## 3. Environment variables

All on the one service. **The container refuses to start if any of the first three is
missing** — each produces a stack that looks healthy and is quietly wrong, which is the
failure this whole exercise exists to remove.

| Variable | Value | If unset |
|---|---|---|
| `TELEMETRY_INGEST_TOKEN` | `openssl rand -hex 32` | refuses to start — ingest would be open to anyone who found the domain |
| `ALERT_EMAIL` | where pages and tickets go | refuses to start — Alertmanager would deliver every alert nowhere |
| `GRAFANA_ALLOWED_EMAILS` | `susmit.b1@gmail.com` | refuses to start — see §4 |
| `GF_SECURITY_ADMIN_PASSWORD` | `openssl rand -base64 32` | Grafana will not start |
| `GF_SERVER_ROOT_URL` | `https://telemetry.vectorbea.com` | alert-email links point at localhost |
| `GRAFANA_OAUTH_CLIENT_ID` / `_SECRET` | from Google, §4 | falls back to password login and warns loudly |
| `SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD` | any SMTP provider; Resend and Postmark have adequate free tiers | delivery fails |
| `ALERT_WEBHOOK_URL` | optional — ntfy or a Telegram bot, so a page reaches a lock screen | webhook simply not used |
| `ANALYTICS_DB_HOST` … `ANALYTICS_DB_PASSWORD` | the **read-only** Neon role, §6 | Product and Workspace dashboards show a datasource error |

Everything else — the collector's endpoints, the OTLP port, the datasource URLs — is
set by the entrypoint to loopback addresses. Do not override them unless you are
splitting the stack back out.

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
project), add one more service. Same three settings as above:

| Service | Root Directory | `RAILWAY_DOCKERFILE_PATH` |
|---|---|---|
| `telemetry-agent` | `/` | `ops/monitoring/railway/agent.Dockerfile` |

Same rule as §1: set the variable, or Railpack builds the Kotlin monorepo instead.

Variables:

| Variable | staging | production |
|---|---|---|
| `VECTORBEA_ENV` | `dev` | `prod` |
| `TELEMETRY_INGEST_ENDPOINT` | `https://telemetry.vectorbea.com` | same |
| `TELEMETRY_INGEST_TOKEN` | the secret from §3 | same |
| `API_METRICS_TARGET` | `api.railway.internal:8080` | same |
| `WORKER_DNS_NAME` | `worker.railway.internal` | same |

`TELEMETRY_INGEST_ENDPOINT` is the **domain only — no port, no path**. The agent
exports OTLP over HTTP and appends `/v1/metrics` and `/v1/traces` itself, which is
exactly what nginx routes to the collector. Appending `:4318` sends it to a port
Railway's proxy does not serve, and the symptom is an environment that looks dark with
no error visible on the receiving end.

Yes, this is the same domain humans use for Grafana. The two are separated by path and
by authentication — the collector requires the bearer token, Grafana requires OAuth —
and nothing on `/v1/` reaches Grafana or vice versa.

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

1. **The build log's first lines name a Dockerfile, not Railpack.** If you see
   `using build driver railpack`, `RAILWAY_DOCKERFILE_PATH` is unset or wrong and
   nothing below will work. Check this first — every other symptom of a wrong builder
   is misleading.
2. **All seven programs are running.** In the service's shell:
   ```
   supervisorctl -c /etc/supervisord.conf status
   ```
   Expect `RUNNING` for prometheus, alertmanager, tempo, loki, collector, grafana and
   nginx. A `FATAL` here is the specific component to debug — the container as a whole
   will still look healthy, which is exactly why this check exists.
3. **The routing boundary holds.** From anywhere:
   ```
   curl -s -o /dev/null -w '%{http_code}
' https://telemetry.vectorbea.com/prometheus
   ```
   **Must be 404.** So must `/alertmanager`, `/tempo`, `/loki` and `/api/v1/write`.
   A 200 from any of them means nginx is routing somewhere it must not, and
   Prometheus' query API — which has no authentication and can read per-workspace
   cost — is on the public internet.
4. **Ingest rejects an unauthenticated push.**
   ```
   curl -s -o /dev/null -w '%{http_code}
' -X POST -H 'Content-Type: application/json'         -d '{}' https://telemetry.vectorbea.com/v1/traces
   ```
   **Must be 401.** A 200 means `TELEMETRY_INGEST_TOKEN` is not being enforced and
   anyone can write series into your Prometheus.
5. **`telemetry-agent` logs** in each environment show no 401s. A 401 means
   `TELEMETRY_INGEST_TOKEN` does not match.
6. **Prometheus** — through Grafana, run `up{job="telemetry-agent"}`. One series per
   environment.
7. **`count(count by (environment) (job_last_success_timestamp_seconds))`** should equal
   the number of environments reporting. This is also the check the `ScrapeAgentDown`
   alert automates.
8. **Access control — test the refusal, not just the admission.** Confirming your own
   login works proves nothing about whether anyone else's does.
   - Sign in as `susmit.b1@gmail.com`. You should land on the dashboards as Admin.
   - In a private window, try any other Google account. Expect a refusal from Google's
     consent screen (app in Testing) or *"user does not have a valid role"* from
     Grafana. **If it admits you, stop and check `role_attribute_strict` — without it
     a non-matching user silently gets the default role.**
   - Confirm the password form is gone from `/login`. If it is there, OAuth did not
     configure — check the startup logs for the `GRAFANA_OAUTH_CLIENT_ID unset` warning.
9. **Open every dashboard** and switch `$env` between `prod` and `dev`. A panel that is
   empty in both is a genuine gap; a panel empty in one is usually correct (staging is
   quiet).
10. **Fire a synthetic alert** — see `docs/telemetry/RUNBOOKS.md`.

## 8. What this costs

One container at roughly 2 GB, plus one small agent per environment. On Railway's
usage-based pricing that is roughly **$10–15/month** — less than the six-service layout,
which paid a baseline per service.

Storage is bounded by config, not by hope: Prometheus at 15d/4GB, Tempo at 72h. A
cardinality mistake fills a capped volume instead of the disk.

**The external ping is not optional.** This stack cannot alert on its own death —
Alertmanager is inside it — and that is more true now than with six services, because
one container failing takes every component with it. A free external check on
`https://telemetry.vectorbea.com/api/health` and on the API's `/health` closes it. See
`docs/telemetry/RUNBOOKS.md`.

---

## Appendix: splitting back out

The per-component Dockerfiles (`prometheus.Dockerfile`, `grafana.Dockerfile`, …) and
their `.railway.json` files are still here. They deploy the same configs and the same
dashboards as six separate Railway services, with per-component memory limits and
independent restarts.

**When that trade becomes worth it:** when one component's memory pressure starts
restarting the others, when Prometheus needs materially more memory than Grafana, or
when the stack's availability requirement stops matching "restart the container".

**What changes:** each service gets its own Root Directory `/` and its own
`RAILWAY_DOCKERFILE_PATH`; Grafana and the collector each take a domain, and the
collector's `TELEMETRY_INGEST_ENDPOINT` becomes its own domain rather than the shared
one. The datasource URLs move from loopback to `*.railway.internal` names via
`PROMETHEUS_URL` / `LOKI_URL` / `TEMPO_URL`, and Prometheus uses `prometheus.yml`
rather than `prometheus.allinone.yml`. Nothing about the dashboards, alerts, runbooks
or agents changes.
