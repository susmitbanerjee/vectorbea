#!/bin/sh
#
# Startup for the all-in-one monitoring container.
#
# Does the four things that cannot be baked into an image, then hands off to
# supervisord: creates the volume's subdirectories, substitutes the values that
# Prometheus/Alertmanager/nginx refuse to read from the environment, builds the Grafana
# access allow-list, and fails loudly rather than starting half-configured.

set -e

# ── Fail closed, before anything binds a port ───────────────────────────────
# Each of these produces a stack that LOOKS healthy and is quietly wrong, which is the
# category of failure this whole exercise exists to remove.
if [ -z "$TELEMETRY_INGEST_TOKEN" ]; then
  echo "FATAL: TELEMETRY_INGEST_TOKEN is not set." >&2
  echo "       The OTLP ingest path would be open to anyone who found the domain." >&2
  exit 1
fi
if [ -z "$ALERT_EMAIL" ]; then
  echo "FATAL: ALERT_EMAIL is not set." >&2
  echo "       Alertmanager would start healthy and deliver every alert nowhere." >&2
  exit 1
fi

# ── Storage ─────────────────────────────────────────────────────────────────
# One Railway volume at /data, one subdirectory per component. Created here because a
# component that starts before its directory exists fails on its first write, several
# seconds after reporting a successful start.
mkdir -p /data/prometheus /data/alertmanager /data/tempo /data/loki /data/grafana
chown -R grafana:root /data/grafana 2>/dev/null || true

# Tempo and Loki have their storage paths written into config files that are SHARED
# with docker-compose, where they are named volumes at /var/tempo and /loki. Rewriting
# those paths for this topology would fork two more config files; symlinking costs one
# line each and keeps a single source of truth.
#
# `-n` matters on a restart: without it, ln would create /var/tempo/data inside the
# existing directory rather than replacing the link, and Tempo would quietly start
# writing somewhere that is not the volume.
[ -e /var/tempo ] && [ ! -L /var/tempo ] && rm -rf /var/tempo
[ -e /loki ] && [ ! -L /loki ] && rm -rf /loki
ln -sfn /data/tempo /var/tempo
ln -sfn /data/loki  /loki

# ── nginx: the public port ──────────────────────────────────────────────────
# nginx does not expand environment variables in its config, and Railway assigns the
# port at runtime. Substituted rather than templated with envsubst so the container
# needs no gettext.
sed "s|__PORT__|${PORT:-8080}|g" /etc/nginx/nginx.conf.template > /tmp/nginx.conf
echo "[stack] nginx will listen on ${PORT:-8080}"

# ── Alertmanager: SMTP credentials ──────────────────────────────────────────
# Alertmanager does not expand environment variables either. Left unsubstituted,
# '${SMTP_PASSWORD}' is a literal 17-character password: Alertmanager starts cleanly,
# reports healthy, routes correctly, and every delivery fails at the SMTP layer. You
# find out the next time something breaks and nobody tells you.
sed -e "s|\${ALERT_EMAIL}|${ALERT_EMAIL}|g" \
    -e "s|\${ALERT_WEBHOOK_URL}|${ALERT_WEBHOOK_URL:-http://127.0.0.1:1/disabled}|g" \
    -e "s|\${SMTP_HOST}|${SMTP_HOST:-smtp.resend.com}|g" \
    -e "s|\${SMTP_USER}|${SMTP_USER:-resend}|g" \
    -e "s|\${SMTP_PASSWORD}|${SMTP_PASSWORD}|g" \
    /etc/alertmanager/alertmanager.tpl.yml > /tmp/alertmanager.yml

# ── The collector's own endpoints ───────────────────────────────────────────
# Everything is loopback in this topology. Exported rather than written into the config
# so ops/monitoring/otel/config.yml stays the single file both topologies use.
export PROMETHEUS_REMOTE_WRITE_ENDPOINT="${PROMETHEUS_REMOTE_WRITE_ENDPOINT:-http://127.0.0.1:9090/api/v1/write}"
export TEMPO_ENDPOINT="${TEMPO_ENDPOINT:-127.0.0.1:4317}"
# The collector's OTLP/HTTP receiver sits BEHIND nginx, so it uses a fixed internal
# port. Deliberately NOT $PORT — that one is nginx's, and both binding it means one of
# them fails to start.
export OTLP_HTTP_PORT=4318

# ── Grafana access control ──────────────────────────────────────────────────
# Shared with the standalone Grafana image so the two cannot drift. Sets GF_AUTH_*.
. /usr/local/lib/grafana-auth.sh
grafana_auth_configure || exit 1

# supervisord passes its own environment to every child, so the exports above and the
# GF_* variables set by grafana_auth_configure reach the programs that need them.
echo "[stack] starting prometheus, alertmanager, tempo, loki, collector, grafana, nginx"
exec /usr/bin/supervisord -c /etc/supervisord.conf
