# Loki.
#
# Deployed, but NOT yet receiving anything on Railway: log shipping is still Promtail,
# which reads the Docker socket, and Railway does not expose one. The service is here so
# the datasource resolves and the correlation config stays valid — a Grafana datasource
# pointing at nothing makes every trace-to-logs link fail loudly.
#
# Wiring a Railway log drain into this is the remaining piece. See
# docs/telemetry/deployment.md.
FROM grafana/loki:3.1.1

COPY ops/monitoring/loki/loki.yml /etc/loki/loki.yml

ENTRYPOINT ["/usr/bin/loki"]
CMD ["-config.file=/etc/loki/loki.yml"]
