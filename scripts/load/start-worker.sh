#!/usr/bin/env bash
# Start a worker joined to the load harness.
#
# Pool sizes are left at the production-derived defaults (WORKER_CONCURRENCY=4 →
# short 8 / long 2 / agent 2 / system 2). A baseline measured against inflated
# pools would describe a system nobody runs.
#
#   scripts/load/start-worker.sh                 # foreground
#   scripts/load/start-worker.sh > worker.log &  # background
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
JAR="$ROOT/apps/worker-kotlin/build/libs/worker-kotlin-0.1.0-all.jar"

if [ ! -f "$JAR" ]; then
  echo "fat jar missing — run: (cd apps/worker-kotlin && gradle fatJar)" >&2
  exit 1
fi

: "${JAVA_BIN:=java}"

export APP_ENV=development
export DATABASE_URL="jdbc:postgresql://127.0.0.1:${LOAD_PG_PORT:-15432}/vectorbea?user=vectorbea&password=vectorbea"
export REDIS_URL="redis://127.0.0.1:${LOAD_REDIS_PORT:-16379}"
export REDIS_TLS_ENABLED=false
# Must exceed WORKER_POLL_BLOCK_MS or every idle XREADGROUP aborts as a timeout.
export REDIS_COMMAND_TIMEOUT_MS="${REDIS_COMMAND_TIMEOUT_MS:-10000}"
# Must match scripts/load/lib/env.mjs CONFIG.secretKeyBase64 (32 bytes of 0x07).
export SECRET_ENCRYPTION_KEY="${LOAD_SECRET_KEY:-BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=}"

# Replica identity. Each replica needs a distinct WORKER_ID: it is the Redis
# consumer name on every typed stream AND the owner recorded in run_leases, so
# two replicas sharing an id would share a PEL and each other's leases.
export WORKER_ID="${WORKER_ID:-load-worker-1}"
# Metrics port must differ per replica on one host.
export METRICS_PORT="${METRICS_PORT:-19090}"
export WORKER_QUEUE_STREAM="${WORKER_QUEUE_STREAM:-workflow-runs}"
export WORKER_QUEUE_GROUP="${WORKER_QUEUE_GROUP:-workflow-workers}"
export WORKER_CONCURRENCY="${WORKER_CONCURRENCY:-4}"   # fallback formula only
# Stage 1 per-pool sizing. Agent 2 -> 6 (09-EXECUTION-ARCHITECTURE-REVISED §5).
export WORKER_POOL_SHORT="${WORKER_POOL_SHORT:-8}"
export WORKER_POOL_LONG="${WORKER_POOL_LONG:-2}"
export WORKER_POOL_AGENT="${WORKER_POOL_AGENT:-6}"
export WORKER_POOL_SYSTEM="${WORKER_POOL_SYSTEM:-2}"
# Tenant-database node execution, isolated from every pool above.
export WORKER_POOL_TENANT_DB="${WORKER_POOL_TENANT_DB:-16}"
# Per-tenant limits now come from shared state (run_leases) and per-workspace
# policy, so they are independent of how many replicas run. No REPLICA_COUNT.
export TENANT_LOAD_STALENESS_MS="${TENANT_LOAD_STALENESS_MS:-1500}"

# Mock upstreams are on loopback; see README "The SSRF exemption".
export SSRF_ALLOWED_TEST_HOSTS=127.0.0.1

# The outbound timeout policy under test — stated explicitly so a recorded
# baseline carries the values it was measured with.
export DB_CONNECT_TIMEOUT_SECONDS="${DB_CONNECT_TIMEOUT_SECONDS:-5}"
export DB_SOCKET_TIMEOUT_SECONDS="${DB_SOCKET_TIMEOUT_SECONDS:-30}"
export DB_LOGIN_TIMEOUT_SECONDS="${DB_LOGIN_TIMEOUT_SECONDS:-5}"
export HTTP_CONNECT_TIMEOUT_MS="${HTTP_CONNECT_TIMEOUT_MS:-5000}"
export HTTP_TOTAL_CALL_CEILING_MS="${HTTP_TOTAL_CALL_CEILING_MS:-120000}"

# Postgres claim scheduler. redis | dual | postgres — see POSTGRES-CLAIM.md.
export WORKER_CLAIM_MODE="${WORKER_CLAIM_MODE:-redis}"
# LISTEN must not go through a transaction pooler. Locally this is the same
# endpoint; ClaimWakeup logs at ERROR if it ever looks pooled.
export DATABASE_DIRECT_URL="$DATABASE_URL"
export CLAIM_RESERVED_PRIORITY_SLOTS="${CLAIM_RESERVED_PRIORITY_SLOTS:-1}"
export WORKER_LEGACY_STREAM_ENABLED="${WORKER_LEGACY_STREAM_ENABLED:-true}"

export TELEMETRY_ENABLED=false
export LOG_LEVEL="${LOG_LEVEL:-INFO}"

exec "$JAVA_BIN" -Xms128m -Xmx768m -jar "$JAR"
