# The per-environment agent. One of these runs in EACH application environment.
#
# It is the same collector binary as the central one with a different config: it scrapes
# the API and the worker over that environment's private network, stamps VECTORBEA_ENV
# on everything, and pushes out over one authenticated connection.
#
# See ops/monitoring/agent/config.yml for why this exists rather than Prometheus
# scraping the services directly.
FROM otel/opentelemetry-collector-contrib:0.109.0

COPY ops/monitoring/agent/config.yml /etc/otel/config.yml

CMD ["--config=/etc/otel/config.yml"]
