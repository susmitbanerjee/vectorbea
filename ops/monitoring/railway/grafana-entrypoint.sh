#!/bin/sh
#
# Grafana startup, for the STANDALONE image — the six-service layout.
#
# The all-in-one container (allinone-entrypoint.sh) is the documented deployment; this
# is the split-out alternative. Both source the same access-control logic from
# lib/grafana-auth.sh, deliberately: that file decides who may read per-workspace cost
# data, and a security check that exists twice is one that will eventually disagree
# with itself.

set -e

# Railway assigns the listening port at runtime; Grafana reads GF_SERVER_HTTP_PORT.
# The fallback keeps `docker run` and the compose file working unchanged.
export GF_SERVER_HTTP_PORT="${PORT:-3000}"

# Sets GF_AUTH_* from GRAFANA_ALLOWED_EMAILS, and fails if it is unset.
. /usr/local/lib/grafana-auth.sh
grafana_auth_configure || exit 1

# Defaults for the per-environment analytics connections in datasources.yml.
. /usr/local/lib/grafana-analytics.sh
grafana_analytics_configure

exec /run.sh "$@"
