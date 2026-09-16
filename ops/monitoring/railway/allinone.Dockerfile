# The whole monitoring stack in one container.
#
# ── WHY ONE CONTAINER ────────────────────────────────────────────────────────
# Six Railway services means six lots of root directory, Dockerfile path, variables
# and volumes — and the setup being long is not a cosmetic problem: every one of those
# is a place to get it wrong once and debug it for twenty minutes. At this size the
# whole stack is smaller than the application it watches.
#
# This is also, precisely, what the original design was: `ops/monitoring/docker-compose.yml`
# describes one box running all of it. The six-service split was an artefact of moving
# to Railway, not a decision anyone made on the merits.
#
# ── WHAT IS GIVEN UP, HONESTLY ───────────────────────────────────────────────
#  - One component being OOM-killed takes the others with it. supervisord restarts
#    each program independently, but the container's memory limit is shared, so a
#    Prometheus cardinality explosion is now everyone's problem.
#  - No per-component memory limits. The compose file sets six; here there is one.
#  - The public port fronts a container that also runs an unauthenticated Prometheus,
#    so the internal services are protected by nginx REFUSING TO ROUTE to them rather
#    than by simply having no domain. That is a deliberate configuration rather than an absence,
#    and deliberate things can be edited wrongly. See allinone/nginx.conf.template.
#
# Splitting back out is the individual *.Dockerfile files next to this one; the configs
# and dashboards are shared and need no change.
#
# ── WHY BINARIES ARE COPIED FROM OFFICIAL IMAGES ─────────────────────────────
# Every one of these is a static Go binary, so `COPY --from` gives the exact upstream
# build at a pinned version with no package manager, no curl-into-shell, and no
# checksum to maintain. Grafana is the base rather than another COPY because it is the
# one component that needs its whole home directory of web assets.

FROM prom/prometheus:v2.54.1                       AS prometheus
FROM prom/alertmanager:v0.27.0                     AS alertmanager
FROM grafana/tempo:2.6.0                           AS tempo
FROM grafana/loki:3.1.1                            AS loki
FROM otel/opentelemetry-collector-contrib:0.109.0  AS collector

FROM grafana/grafana:11.2.0

USER root

# nginx fronts the single public port; supervisor keeps six programs alive.
RUN apk add --no-cache nginx supervisor tzdata

COPY --from=prometheus   /bin/prometheus            /usr/local/bin/prometheus
COPY --from=prometheus   /bin/promtool              /usr/local/bin/promtool
COPY --from=alertmanager /bin/alertmanager          /usr/local/bin/alertmanager
COPY --from=alertmanager /bin/amtool                /usr/local/bin/amtool
COPY --from=tempo        /tempo                     /usr/local/bin/tempo
COPY --from=loki         /usr/bin/loki              /usr/local/bin/loki
COPY --from=collector    /otelcol-contrib           /usr/local/bin/otelcol-contrib

# ── Configuration ───────────────────────────────────────────────────────────
# Prometheus gets its own file rather than the six-service one: it cannot expand
# environment variables, so its alertmanager and scrape targets have to be written as
# literals, and in this topology those are all 127.0.0.1. See the file's header.
COPY ops/monitoring/prometheus/prometheus.allinone.yml /etc/prometheus/prometheus.yml
COPY ops/monitoring/prometheus/alerts.yml              /etc/prometheus/alerts.yml
COPY ops/monitoring/alertmanager/alertmanager.yml      /etc/alertmanager/alertmanager.tpl.yml
COPY ops/monitoring/alertmanager/templates/            /etc/alertmanager/templates/
COPY ops/monitoring/tempo/tempo.yml                    /etc/tempo/tempo.yml
COPY ops/monitoring/loki/loki.yml                      /etc/loki/loki.yml
COPY ops/monitoring/otel/config.yml                    /etc/otel/config.yml

COPY ops/monitoring/grafana/provisioning /etc/grafana/provisioning
COPY ops/monitoring/grafana/dashboards   /var/lib/grafana/dashboards

COPY ops/monitoring/railway/allinone/supervisord.conf   /etc/supervisord.conf
COPY ops/monitoring/railway/allinone/nginx.conf.template /etc/nginx/nginx.conf.template
COPY ops/monitoring/railway/lib/grafana-auth.sh          /usr/local/lib/grafana-auth.sh
COPY ops/monitoring/railway/lib/grafana-analytics.sh     /usr/local/lib/grafana-analytics.sh
COPY ops/monitoring/railway/allinone-entrypoint.sh       /usr/local/bin/start-stack.sh
RUN chmod +x /usr/local/bin/start-stack.sh

# No anonymous access, no self-signup through the local form. The dashboards show
# per-workspace cost and volume, which is customer data even in aggregate.
ENV GF_AUTH_ANONYMOUS_ENABLED=false \
    GF_USERS_ALLOW_SIGN_UP=false \
    GF_USERS_AUTO_ASSIGN_ORG=false \
    GF_INSTALL_PLUGINS="" \
    GF_PATHS_PROVISIONING=/etc/grafana/provisioning \
    GF_PATHS_DATA=/data/grafana \
    GF_SERVER_HTTP_PORT=3000

# Grafana is reached through nginx inside this container, so it binds loopback only.
# Even if a route to it were added by mistake, there is no second way in from outside.
ENV GF_SERVER_HTTP_ADDR=127.0.0.1

# Where the datasources point. Set here rather than in datasources.yml so the SAME
# provisioning file serves this topology and docker-compose, where they are service
# names on a bridge network.
ENV PROMETHEUS_URL=http://127.0.0.1:9090 \
    LOKI_URL=http://127.0.0.1:3100 \
    TEMPO_URL=http://127.0.0.1:3200

ENTRYPOINT ["/usr/local/bin/start-stack.sh"]
