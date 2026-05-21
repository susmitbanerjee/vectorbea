# Local Development

## Prerequisites

| Tool | Minimum version | Notes |
|---|---|---|
| Node.js | 22.x | Use nvm or fnm |
| npm | 10.x | Included with Node 22 |
| Docker | 24.x | For Postgres and Redis |
| Docker Compose | 2.x | `docker compose` (v2 CLI) |
| Git | any | — |

Optional but recommended:
- **pnpm** 9.x — faster installs with workspace deduplication
- **Prisma CLI** — `npm i -g prisma` for migration commands

---

## First-time setup

### 1. Clone and enter the repo

```bash
git clone https://github.com/your-org/vectorbea.git
cd vectorbea
```

### 2. Start infrastructure

```bash
docker compose up postgres redis -d
```

This starts:
- PostgreSQL 16 on `localhost:5432` (user: `vectorbea`, password: `vectorbea`, db: `vectorbea`)
- Redis 7 on `localhost:6379`

### 3. Configure the web app

```bash
cp apps/web/.env.example apps/web/.env.local
```

Then edit `apps/web/.env.local`. Minimum required variables:

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
DATABASE_URL=postgresql://vectorbea:vectorbea@localhost:5432/vectorbea
REDIS_URL=redis://localhost:6379
NEXT_PUBLIC_APP_URL=http://localhost:3000
INTERNAL_API_SECRET=dev-secret-change-in-prod
```

For auth to work locally, configure OAuth providers in your Supabase project
(Dashboard → Auth → Providers) with redirect URL `http://localhost:3000/auth/callback`.

### 4. Install dependencies

```bash
# From repo root
cd apps/web && npm install
```

### 5. Run database migrations

```bash
# From apps/web/
npx prisma migrate dev
```

> Note: Prisma schema (`prisma/schema.prisma`) is in the repo root `prisma/` directory.
> Point `prisma.schema` in `apps/web/package.json` if needed, or set
> `PRISMA_SCHEMA_PATH=../../prisma/schema.prisma`.

### 6. Start the web app

```bash
# From apps/web/
npm run dev
```

The app is available at http://localhost:3000.

---

## Running all services with Docker Compose

To run the full stack (web + worker + postgres + redis) via Docker:

```bash
docker compose up --build
```

> Note: The web and worker Docker images are not yet optimized for hot reload.
> Prefer running `npm run dev` directly for active development on `apps/web`.

---

## Common commands

```bash
# Run linting
cd apps/web && npm run lint

# Run TypeScript typecheck
cd apps/web && npm run typecheck  # (or: tsc --noEmit)

# Run unit tests
cd apps/web && npm run test

# Generate Prisma client after schema changes
cd apps/web && npx prisma generate

# Create a new migration
cd apps/web && npx prisma migrate dev --name describe-your-change

# Reset local database
cd apps/web && npx prisma migrate reset
```

---

## Project structure

```
vectorbea/
├── apps/
│   ├── web/          Next.js control plane — run with npm run dev
│   └── worker/       BullMQ worker — not yet runnable (stub)
├── packages/
│   ├── shared/       Shared TypeScript types — build with npm run build
│   └── sdk-js/       Node.js SDK — build with npm run build
├── prisma/
│   ├── schema.prisma Canonical database schema
│   └── migrations/   SQL migration history (legacy pre-Prisma migrations also here)
├── docs/             Documentation
└── docker-compose.yml  Local dev infrastructure
```

---

## Troubleshooting

**`Error: connect ECONNREFUSED 127.0.0.1:5432`**
→ Postgres is not running. Run `docker compose up postgres -d`.

**`Error: Redis connection refused`**
→ Redis is not running. Run `docker compose up redis -d`.

**`Auth callback 400 error`**
→ Check that your Supabase redirect URL includes `http://localhost:3000/auth/callback`.

**`PrismaClientInitializationError`**
→ Make sure `DATABASE_URL` is set correctly in `.env.local` and Postgres is running.
