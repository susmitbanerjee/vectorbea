#!/bin/sh
#
# Analytics database connections, one per environment. Sourced by both Grafana
# entrypoints (all-in-one and standalone) so they cannot drift.
#
# Grafana's provisioning expands ${VAR} but has no default syntax, so the defaults
# datasources.yml relies on are exported here.
#
# The single-database ANALYTICS_DB_* variables predate per-environment connections.
# They are read as PRODUCTION's so an existing deployment keeps its Product
# dashboard. If they actually pointed at staging, the `environment = 'prod'` filter
# in every query shows empty panels, never staging's numbers labelled production.

grafana_analytics_configure() {
  for env in PROD DEV; do
    eval "host=\${ANALYTICS_${env}_DB_HOST:-}"
    if [ "$env" = PROD ] && [ -z "$host" ] && [ -n "${ANALYTICS_DB_HOST:-}" ]; then
      echo "[grafana] ANALYTICS_DB_* is deprecated; reading it as ANALYTICS_PROD_DB_*. Rename it." >&2
      export ANALYTICS_PROD_DB_HOST="$ANALYTICS_DB_HOST"
      export ANALYTICS_PROD_DB_PORT="${ANALYTICS_PROD_DB_PORT:-${ANALYTICS_DB_PORT:-}}"
      export ANALYTICS_PROD_DB_NAME="${ANALYTICS_PROD_DB_NAME:-${ANALYTICS_DB_NAME:-}}"
      export ANALYTICS_PROD_DB_USER="${ANALYTICS_PROD_DB_USER:-${ANALYTICS_DB_USER:-}}"
      export ANALYTICS_PROD_DB_PASSWORD="${ANALYTICS_PROD_DB_PASSWORD:-${ANALYTICS_DB_PASSWORD:-}}"
      host="$ANALYTICS_DB_HOST"
    fi
    eval "export ANALYTICS_${env}_DB_PORT=\"\${ANALYTICS_${env}_DB_PORT:-5432}\""
    eval "export ANALYTICS_${env}_DB_NAME=\"\${ANALYTICS_${env}_DB_NAME:-vectorbea}\""
    eval "export ANALYTICS_${env}_DB_USER=\"\${ANALYTICS_${env}_DB_USER:-grafana_ro}\""
    eval "export ANALYTICS_${env}_DB_PASSWORD=\"\${ANALYTICS_${env}_DB_PASSWORD:-}\""
    eval "export ANALYTICS_${env}_DB_SSLMODE=\"\${ANALYTICS_${env}_DB_SSLMODE:-require}\""
    if [ -z "$host" ]; then
      echo "[grafana] ANALYTICS_${env}_DB_HOST is not set: database panels are empty for that environment." >&2
    fi
  done
}
