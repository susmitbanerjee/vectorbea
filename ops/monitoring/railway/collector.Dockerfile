# The central collector — the only publicly reachable ingest point.
#
# Everything else in the stack has no authentication of its own, so nothing else may
# face the internet. This does: its OTLP receivers require a bearer token, and it
# converts what it receives into the private-network writes the backends expect.
FROM otel/opentelemetry-collector-contrib:0.109.0

COPY ops/monitoring/otel/config.yml /etc/otel/config.yml

CMD ["--config=/etc/otel/config.yml"]
