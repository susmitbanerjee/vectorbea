# Prometheus, with this repo's config baked in.
#
# The config is COPIED rather than mounted because Railway has no bind mounts — the
# image is the only way config reaches the container. That is a feature here: the
# running config is whatever the deployed commit says, and there is no drift between
# what the repo claims and what the box does.
FROM prom/prometheus:v2.54.1

COPY ops/monitoring/prometheus/prometheus.yml /etc/prometheus/prometheus.yml
COPY ops/monitoring/prometheus/alerts.yml     /etc/prometheus/alerts.yml

# --web.enable-remote-write-receiver is what makes the agent topology work at all.
# Without it /api/v1/write returns 404 and every agent retries into a wall, which
# presents as "no data" rather than as an error.
#
# Retention is bounded twice, by time AND size: the time limit is the policy, the size
# limit is the safety net for a cardinality mistake. Without the second, a bad label
# fills the volume and takes Prometheus down with it.
ENTRYPOINT ["/bin/prometheus"]
CMD ["--config.file=/etc/prometheus/prometheus.yml", \
     "--storage.tsdb.path=/prometheus", \
     "--storage.tsdb.retention.time=15d", \
     "--storage.tsdb.retention.size=4GB", \
     "--web.enable-remote-write-receiver", \
     "--web.enable-lifecycle"]
