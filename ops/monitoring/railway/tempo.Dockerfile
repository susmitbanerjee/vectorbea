FROM grafana/tempo:2.6.0

COPY ops/monitoring/tempo/tempo.yml /etc/tempo/tempo.yml

# Traces are kept 72h, not 15d like metrics. "Why was this run slow yesterday" is a real
# question; "why was this run slow two weeks ago" is not, and the metric and log records
# survive either way. Traces are also by far the largest signal.
ENTRYPOINT ["/tempo"]
CMD ["-config.file=/etc/tempo/tempo.yml"]
