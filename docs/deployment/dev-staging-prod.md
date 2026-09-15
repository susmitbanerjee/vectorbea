# Dev / Staging / Prod — deployment runbook

How Vectorbea is deployed across two environments using Git branches as the
source of truth.

| Branch   | Environment | Web (Vercel)            | API / Worker / Telemetry (Railway) | Database (Neon)     |
| -------- | ----------- | ----------------------- | ---------------------------------- | ------------------- |
| `dev`    | **staging** | `dev.vectorbea.com`     | Railway env: **staging**           | Neon **staging** DB |
| `master` | **prod**    | `vectorbea.com`         | Railway env: **production**        | Neon **prod** DB    |

**The rule:**
- Push to `dev` → staging redeploys (Vercel `dev.vectorbea.com` + Railway `staging`).
- Open a PR `dev → master`, merge it → prod redeploys (Vercel `vectorbea.com` + Railway `production`).

> The repo's prod branch is **`master`** (not `main`). CI (`.github/workflows/ci.yml`)
> and all deploy integrations are wired to `master` + `dev`.

---

## 0. One-time: domain plan

| Service   | Prod                      | Staging                       |
| --------- | ------------------------- | ----------------------------- |
| Web       | `vectorbea.com`           | `dev.vectorbea.com`           |
| API       | `api.vectorbea.com`       | `devapi.vectorbea.com`        |
| Telemetry | `telemetry.vectorbea.com` | `telemetry-dev.vectorbea.com` |

Worker has no public domain (it consumes the Redis queue).

**The public API hosts serve the run API and nothing else.** `api.vectorbea.com`
(prod) and `devapi.vectorbea.com` (staging) are what the product prints: the
workflow "Run it from anywhere" snippet, the API keys page and webhook URLs. Both
the API (`PublicUrls.apiBase`) and the web app (`getPublicApiBaseUrl`) derive
them from the environment tag — `VECTORBEA_ENV=prod` → `api`, anything else →
`devapi`. The Railway `*.up.railway.app` hostname is never printed.

A request arriving on either host reaches only (`PublicHostGate`):

| | |
|---|---|
| `POST /api/workflows/:id/run` | start a run |
| `GET /api/runs/:id` | read its status and output |
| `POST /api/hooks/:token` | webhook trigger |
| `POST /api/tool-callbacks/:token`, `GET /api/delivery-payloads/:token` | mid-run callbacks and large results |
| `GET /healthz`, `/health`, `/version` | health |

Everything else answers 404 on those hosts. Two consequences:

- **The web app must NOT use them.** `NEXT_PUBLIC_VECTORBEA_API_URL` stays the
  Railway service domain (or a separate, unpublished custom domain) — the app
  needs the whole API.
- **MCP sign-in does not use them either.** Its OAuth redirect is the web app's
  own `/mcp/oauth/callback`, so it works even before these DNS records exist.

Override the printed host only if a deployment fronts the API somewhere else:
`PUBLIC_API_BASE_URL` on the API and `NEXT_PUBLIC_PUBLIC_API_BASE_URL` on the web,
to the same value. Extra hostnames that should get the run-API-only treatment go
in `PUBLIC_API_HOSTS` (comma-separated).

---

## 1. Neon (Postgres)

You've already created the staging DB. Confirm you have **two** connection strings:

- **Prod**: the original Neon DB.
- **Staging**: the new Neon DB.

For each, grab the **pooled** connection string (Neon → project → Connection
Details → "Pooled connection"). Use the pooled URL for the API and worker;
migrations can use either.

```
# prod
DATABASE_URL=postgresql://USER:PASS@ep-xxxx-pooler.REGION.aws.neon.tech/vectorbea?sslmode=require
# staging
DATABASE_URL=postgresql://USER:PASS@ep-yyyy-pooler.REGION.aws.neon.tech/vectorbea_staging?sslmode=require
```

> The worker/API JDBC layer auto-rewrites `postgresql://` → `jdbc:postgresql://`,
> so the raw Neon URL works as-is. `sslmode=require` is honored.

**Run migrations on the staging DB before first deploy.** Flyway migrations live
in `apps/api-kotlin/src/main/resources/db/migration`. Point Flyway (or the API
with `RUN_MIGRATIONS=true` on first boot) at the staging `DATABASE_URL`.

---

## 2. Railway — clone prod env → staging

You've already cloned the Railway app and created the **staging** environment.
Finish wiring it:

### 2.1 Services per environment

Each Railway environment (production + staging) should contain the same services,
each built from this monorepo:

| Service     | Root / Dockerfile               | Notes                          |
| ----------- | ------------------------------- | ------------------------------ |
| `api`       | `apps/api-kotlin/Dockerfile`    | public domain; also serves telemetry ingestion and the admin console at `/admin/telemetry` |
| `worker`    | `apps/worker-kotlin/Dockerfile` | no domain; needs Redis         |
| `redis`     | Railway Redis plugin            | one per environment            |

> `telemetry` was a fourth service. It is now a library compiled into `api` and
> `worker` — delete the Railway service and retire `telemetry.vectorbea.com`. Point
> `TELEMETRY_ENDPOINT` at the API host. See
> [`../architecture/OBSERVABILITY.md`](../architecture/OBSERVABILITY.md).

In each service: **Settings → Source → Branch**
- production env services → deploy from **`master`**
- staging env services → deploy from **`dev`**

Enable **"Wait for CI"** (or "Check suites must pass") so a red CI run blocks the
deploy.

### 2.2 Redis

Add a Railway Redis plugin in **each** environment (prod + staging are isolated
queues). Railway injects `REDIS_URL`. Reference it in api + worker via
`${{ Redis.REDIS_URL }}`.

### 2.3 Environment variables

Set these per service, per environment. Secrets (`*_SECRET`, `*_KEY`,
`*_TOKEN`, `DATABASE_URL`) are **never** committed — set them only in Railway.

**`api` service**
```
APP_ENV=production              # both envs run the prod code path; see note below
VECTORBEA_ENV=prod              # staging → dev
DATABASE_URL=<neon prod|staging>
REDIS_URL=${{ Redis.REDIS_URL }}
JWT_SECRET=<supabase jwt secret>
SECRET_ENCRYPTION_KEY=<base64 32-byte key>     # same value across services in an env
AI_ARCHITECT_ENABLED=true
AI_ARCHITECT_API_KEY=<openai key>
TELEMETRY_ENABLED=true
TELEMETRY_INGEST_URL=https://telemetry.vectorbea.com   # staging → telemetry-dev...
TELEMETRY_INTERNAL_TOKEN=<shared internal token>
CORS_ALLOWED_ORIGINS=https://vectorbea.com             # staging → https://dev.vectorbea.com
APP_URL=https://vectorbea.com                          # staging → https://dev.vectorbea.com
# PUBLIC_API_BASE_URL is derived from VECTORBEA_ENV (api / devapi.vectorbea.com); set only to override
MCP_DISCOVERY_ENABLED=true      # connecting MCP servers: probe, sign-in, discovery
MESSAGING_WEBHOOKS_ENABLED=true # "Send test message" for Teams / Google Chat / Discord; set on the worker too
```

**`worker` service**
```
APP_ENV=production
VECTORBEA_ENV=prod                              # staging → dev
DATABASE_URL=<neon prod|staging>
REDIS_URL=${{ Redis.REDIS_URL }}
SECRET_ENCRYPTION_KEY=<same as api in this env>
WORKER_CONCURRENCY=4
# durability/robustness knobs (sensible defaults shown — override per load)
WORKER_LEASE_TTL_SECONDS=60
WORKER_DEFAULT_NODE_TIMEOUT_MS=120000
WORKER_MAX_RUN_DURATION_MS=600000
WORKER_MAX_BRANCH_THREADS=16
AGENT_SKILLS_ENABLED=true       # skills apply to agent runs; off = granted skills are ignored at run time
MESSAGING_WEBHOOKS_ENABLED=true # Teams / Google Chat / Discord tools post; off = those calls fail naming this variable
TRACE_STEP_IO_ENABLED=true      # Debug shows step inputs/outputs and model prompts/responses (redacted); off = not recorded
AGENT_TOOL_RESULT_MAX_CHARS=12000 # how much of the newest tool result an agent reads; default 2000 cuts off diffs
TELEMETRY_ENABLED=true
TELEMETRY_INGEST_URL=https://telemetry.vectorbea.com   # staging → telemetry-dev...
TELEMETRY_INTERNAL_TOKEN=<shared internal token>
```

**`telemetry` service** — see §4.

> **Note on `APP_ENV` vs `VECTORBEA_ENV`:** `APP_ENV=production` selects the
> hardened code path (fail-closed config validation, no dev fallbacks) and should
> be `production` in **both** Railway environments. `VECTORBEA_ENV` (`prod` |
> `dev`) is the **data tag** — it's what segments telemetry, beta controls, and
> environment filtering. Staging uses `APP_ENV=production` + `VECTORBEA_ENV=dev`.

### 2.4 Domains

DNS for `vectorbea.com` is at **GoDaddy** (nameservers `ns25/ns26.domaincontrol.com`).
A subdomain resolves only once BOTH halves exist:

1. **Railway** → the `api` service → select the environment (`production` for
   `api.vectorbea.com`, `staging` for `devapi.vectorbea.com`) → **Settings →
   Networking → Custom Domain** → enter the hostname. Railway shows a **CNAME
   target** (something like `abc123.up.railway.app`) and, for most domains, a
   **TXT verification record** (`_railway-verify.<name>`).
2. **GoDaddy** → My Products → `vectorbea.com` → **DNS** → **Add New Record**:
   - Type `CNAME`, Name `api` (or `devapi`), Value = the Railway target, TTL 1 hour.
   - Type `TXT`, Name exactly as Railway shows it, Value exactly as shown.
3. Wait for Railway to show the domain as verified; it issues the TLS certificate
   itself. Check with `nslookup api.vectorbea.com 8.8.8.8`.

GoDaddy's Name field is the part BEFORE `.vectorbea.com` — enter `api`, not
`api.vectorbea.com`, or the record becomes `api.vectorbea.com.vectorbea.com`.

---

## 3. Vercel — branch → domain

The web app (`apps/web`) is a Next.js app on Vercel. Vercel deploys **every**
branch automatically; we pin two branches to two domains.

### 3.1 Production branch

**Project → Settings → Git → Production Branch → `master`.**
Every merge to `master` triggers a Production deployment → `vectorbea.com`.

### 3.2 Staging domain on the `dev` branch

Vercel gives every non-prod branch a Preview URL. To pin `dev` to a stable
subdomain:

1. **Project → Settings → Domains → Add** `dev.vectorbea.com`.
2. In the domain's config, set **Git Branch = `dev`** (this binds the domain to
   the latest `dev` deployment instead of production).
3. Add the CNAME Vercel shows you at your DNS provider.

Now every push to `dev` updates `dev.vectorbea.com`; every merge to `master`
updates `vectorbea.com`. PRs from feature branches still get throwaway preview
URLs.

### 3.3 Environment variables (per Vercel environment)

**Project → Settings → Environment Variables.** Vercel has three scopes:
*Production*, *Preview*, *Development*. Map:
- **Production** scope → prod values (used by `master`/`vectorbea.com`).
- **Preview** scope → staging values (used by `dev`/`dev.vectorbea.com` and PR previews).

```
# Production scope
NEXT_PUBLIC_VECTORBEA_API_URL=https://<prod api service>.up.railway.app   # NOT api.vectorbea.com — see §0
NEXT_PUBLIC_VECTORBEA_ENV=prod                  # picks the public API host printed in snippets
NEXT_PUBLIC_SUPABASE_URL=<prod supabase url>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<prod anon key>
NEXT_PUBLIC_PRIVATE_BETA_MODE=true

# Preview scope (staging)
NEXT_PUBLIC_VECTORBEA_API_URL=https://<staging api service>.up.railway.app   # NOT devapi.vectorbea.com
NEXT_PUBLIC_VECTORBEA_ENV=dev
NEXT_PUBLIC_SUPABASE_URL=<staging supabase url>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<staging anon key>
NEXT_PUBLIC_PRIVATE_BETA_MODE=true
DATABASE_URL=<the SAME database the staging api/worker use>
```

**`DATABASE_URL` on Vercel must be the environment's database.** The web app's
own server routes read it directly: Settings → Profile (name, time zone), the
support widget and `/support` portal (`support_tickets`), beta access. When the
API and worker moved to another database and Vercel kept the old one, the
support portal kept showing the old database's tickets and the profile showed
the old account row. The database must accept connections from Vercel (its
addresses are not fixed, so allow SSL connections broadly or use a connection
proxy). `support_tickets` is created by V077; the web app no longer needs
CREATE on the schema for it.

**Forwarding support reports to Spiceworks (optional).** The free Spiceworks
Cloud Help Desk creates tickets from email, so the web app emails each new report
to your help desk address after saving it (`lib/server/support-spiceworks.ts`).

```
SPICEWORKS_HELPDESK_EMAIL=help@<your-account>.on.spiceworks.com
# plus a working email provider, which the portal already uses:
RESEND_API_KEY=...            # or SENDGRID_API_KEY / SMTP_HOST ...
FROM_EMAIL=support@<your verified domain>
```

1. In Spiceworks, find the help desk email address (Settings → Email) and make
   sure tickets from `FROM_EMAIL` are accepted.
2. Set the variables on the Vercel scope and redeploy.
3. Open `/support` — the strip under the header says "Spiceworks connected".
   Press **Send test ticket** and confirm it appears in Spiceworks.

What to expect: the subject starts with the Vectorbea ticket number; the
requester's name, email, workspace, priority and category are the first lines;
Reply-To is the customer. A report that fails to send is marked on the ticket and
can be sent again from `/support`. While forwarding is on, the support-admin
notification email is not sent; Spiceworks notifies your technicians itself.

**Syncing Spiceworks back to the customer (optional, off by default).** Customers
never get a Spiceworks account. Vectorbea stays their view: the widget's My
reports shows the conversation and status, they comment there (or by replying to
the update email), and technicians keep working in Spiceworks. The free help desk
has no API or webhooks, so the sync runs over email
(`lib/server/support-inbound.ts`, `support-sync.ts`):

1. Reports are sent to Spiceworks FROM a support mailbox you own, so Spiceworks
   makes that mailbox the requester and emails every comment and status change
   to it.
2. An inbound-mail provider posts each message in that mailbox to
   `/api/support/inbound/<SUPPORT_INBOUND_TOKEN>`.
3. Mail from the help desk becomes a support comment and/or a status change
   (closed/resolved → Resolved, reopened → Open); the customer is emailed once
   and sees it under My reports. Mail from the customer becomes a comment, is
   passed on to Spiceworks, and reopens a resolved report.

```
SUPPORT_INBOUND_ADDRESS=support@<your verified domain>   # the requester mailbox
SUPPORT_INBOUND_TOKEN=<random, 24+ characters>           # openssl rand -hex 24
SUPPORT_HELPDESK_SENDERS=@acme.com,it@acme.com            # optional: other senders that count as the help desk
```

Set up the mailbox with one of these (each posts to the URL above):

| Provider | Setup |
|---|---|
| SendGrid Inbound Parse | MX for a subdomain to `mx.sendgrid.net`; Inbound Parse → the URL; leave "POST the raw MIME" off. |
| Mailgun | Receiving → Create route → match recipient → forward to the URL. |
| Postmark | Inbound stream → webhook URL; forward the mailbox to the inbound address. |
| Anything else | POST JSON `{from, subject, text, html, headers, messageId}` (a Cloudflare Email Worker works). |

Then: `SUPPORT_INBOUND_ADDRESS` must be a sender your email provider can send as
(same verified domain as `FROM_EMAIL`), and in Spiceworks turn on requester
notifications for comments and status changes. `/support` says "Comments and
status changes sync back" when both variables are set. File a report, comment on
the ticket in Spiceworks, and close it: both should appear under My reports
within a minute.

How messages are matched, and what is deliberately conservative:
- By the `[VB-XXXXXX]` number Spiceworks keeps in the subject, or by the
  Spiceworks ticket number learned from an earlier message.
- Only mail from `*.spiceworks.com`, the help desk address's domain,
  `SUPPORT_HELPDESK_SENDERS` or a support admin can change a status; a customer
  writing "resolved?" cannot close their own report. Status is read from what the
  help desk ADDED to the subject and from a sentence about the ticket in the first
  lines, never from the customer's own subject.
- Mail Vectorbea sent carries `X-Vectorbea-Support` and is dropped if it comes
  back; automatic replies are dropped; a provider redelivering the same
  Message-ID adds nothing.
- Spiceworks does not document its notification format. The footer, links and
  the status sentence are removed from a technician's comment; if a notification
  template adds other text, it shows in the conversation. Unmatched mail is
  logged as `support.inbound.unmatched`.
- Replies written in `/support` are emailed to the customer but not copied into
  Spiceworks; work a ticket in one place.

Without the sync variables, comments in the widget still work: they go to
Spiceworks when forwarding is on, otherwise to the support admins, and update
emails ask the customer to answer in Vectorbea. `support_ticket_messages` and
`support_tickets.helpdesk_ref` / `last_activity_at` are created by V078.

The build command is already pinned in `apps/web/vercel.json`
(`npm run prisma:generate && next build`). Set the Vercel project **Root
Directory** to `apps/web`.

---

## 4. Telemetry — app states & deployment

### 4.1 The environment-state model

Telemetry is **environment-aware**. Every event carries a `VECTORBEA_ENV` tag
(`prod` | `dev`) set by whichever service emitted it. The dashboard's top-right
**environment switcher** (`Production / Staging / Development / All`) filters on
that tag, and the **Environments** page compares them side by side.

This gives you two valid deployment shapes:

**Recommended — one telemetry instance, all envs report in.**
Deploy telemetry once (in prod). Point **both** prod and staging api/worker at
the same `TELEMETRY_INGEST_URL=https://telemetry.vectorbea.com`. Prod services
send `VECTORBEA_ENV=prod`, staging services send `VECTORBEA_ENV=dev`. The
Environments page then shows the real prod-vs-staging comparison the dashboard
was built for. Simplest, lowest cost, and the most useful view.

**Isolated — one telemetry instance per environment.**
Run `telemetry` in both Railway envs with separate `DATABASE_URL`s. Each only
ever sees its own env's data. Use this only if you need hard data isolation
(e.g. staging load tests must not touch prod analytics).

### 4.2 Telemetry env vars (Railway `telemetry` service)

```
APP_ENV=production
VECTORBEA_ENV=prod                              # the instance's own tag
PORT=8080
DATABASE_URL=<telemetry DB>                     # its own DB/schema; can be a
                                                # dedicated Neon DB
RUN_MIGRATIONS=true                             # applies V100 telemetry schema on boot
JWT_SECRET=<same supabase jwt secret as api>    # validates admin tokens
TELEMETRY_INTERNAL_TOKEN=<shared internal token># must match api/worker
ADMIN_EMAILS=you@vectorbea.com,teammate@...     # who can open the dashboard
TELEMETRY_CORS_ALLOWED_ORIGINS=https://vectorbea.com,https://dev.vectorbea.com
TELEMETRY_PUBLIC_URL=https://telemetry.vectorbea.com
OTEL_ENABLED=false                              # true + endpoint to ship traces to Grafana
```

The dashboard is served by the **API** now, from static files under
`apps/api-kotlin/src/main/resources/static/admin-telemetry/`. Open
`https://api.vectorbea.com/admin/telemetry`, sign in as an `ADMIN_EMAILS` user, and
you're in — it uses the API's own auth, so there is no JWT to paste any more.

Its data endpoints moved from `/api/dashboard/*` to `/api/admin/telemetry/*`, because
the API already serves a different resource at `/api/dashboard/summary` (the product
dashboard on Home). See
[`../architecture/OBSERVABILITY.md`](../architecture/OBSERVABILITY.md).

The **operational** dashboards are in Grafana at **`telemetry.vectorbea.com`**, not here.
Eight of them — fleet health, run health, provider capacity, trace pipeline, scheduled
jobs, cost, product, and per-workspace support — with an `$env` selector at the top-left
of each, so one Grafana serves both staging and production.

That domain used to point at the standalone `apps/telemetry` service. It was reassigned
when the service was folded into `api-kotlin`; the admin analytics console it used to
serve is now at `api.vectorbea.com/admin/telemetry`.

Deploying it: [`../../ops/monitoring/railway/README.md`](../../ops/monitoring/railway/README.md).
Each application environment also runs one `telemetry-agent` service — that is what
makes the `$env` separation work, and it is where `VECTORBEA_ENV` matters most: set it
wrong and an entire environment's data is mislabelled.

### 4.3 Auth

- **Admin dashboard**: HS256 JWT signed with `JWT_SECRET` (same secret as the
  API/Supabase). Only `ADMIN_EMAILS` addresses are admitted.
- **Internal ingestion** (api/worker → telemetry): the shared
  `TELEMETRY_INTERNAL_TOKEN`. Keep it identical across all services in an env.

---

## 5. Promotion flow (day to day)

```
feature branch ──PR──▶ dev ──────────────▶ staging redeploys
                        │                    (dev.vectorbea.com + Railway staging)
                        │  verify on staging
                        ▼
                       PR: dev ──▶ master ─▶ prod redeploys
                                              (vectorbea.com + Railway production)
```

1. Branch off `dev`, open a PR into `dev`. CI runs (`master`/`dev` triggers).
2. Merge to `dev` → staging redeploys. Smoke-test on `dev.vectorbea.com`.
3. When staging is good, open a PR `dev → master`. CI runs again.
4. Merge to `master` → prod redeploys.

**Rollback:** Railway → service → Deployments → redeploy a previous build.
Vercel → Deployments → promote a previous production deployment. DB migrations
are forward-only — never auto-rollback schema; ship a corrective migration.

---

## 6. First-deploy checklist

- [ ] Neon staging DB created; migrations applied.
- [ ] Railway `staging` env: api/worker/telemetry/redis services, each on the `dev` branch.
- [ ] Railway `production` env services on the `master` branch.
- [ ] `SECRET_ENCRYPTION_KEY` identical across api+worker **within** each env (and different between prod and staging).
- [ ] `TELEMETRY_INTERNAL_TOKEN` identical across api/worker/telemetry within each env.
- [ ] Redis plugin added in both envs; `REDIS_URL` referenced.
- [ ] Vercel: Production Branch = `master`; `dev.vectorbea.com` bound to `dev`.
- [ ] Vercel env vars set in Production **and** Preview scopes.
- [ ] DNS CNAMEs for all subdomains (api, telemetry, dev web) created.
- [ ] CORS origins include the matching web domain for that env.
- [ ] Telemetry: `ADMIN_EMAILS` set; dashboard reachable; an admin can sign in.
