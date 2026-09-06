# Grafana — telemetry.vectorbea.com.
#
# The only human-facing part of the stack, and the only one that needs a real domain.
#
# ── ACCESS IS AN ALLOW-LIST OF EMAIL ADDRESSES ───────────────────────────────
# These dashboards show per-workspace cost, run volume and the product event stream —
# customer data, even in aggregate. Access is restricted to the addresses in
# GRAFANA_ALLOWED_EMAILS, enforced through OAuth role mapping. The container refuses
# to start if that variable is unset. See grafana-entrypoint.sh for how, and why
# Grafana's `allowed_domains` cannot do this job.
#
# ── DASHBOARDS ARE BAKED IN, NOT CLICKED TOGETHER ────────────────────────────
# Provisioning copies this repo's dashboards into the image. A dashboard that exists
# only in Grafana's database is one volume failure away from being gone, is not
# reviewable, and cannot be checked by CI — and CI checking dashboards is the entire
# point of scripts/monitoring/validate.mjs.
#
# The practical consequence: editing a dashboard in the UI and saving it does NOT
# persist across a redeploy. That is deliberate. Export the JSON and commit it.
FROM grafana/grafana:11.2.0

COPY ops/monitoring/grafana/provisioning /etc/grafana/provisioning
COPY ops/monitoring/grafana/dashboards   /var/lib/grafana/dashboards

# No anonymous access, and no self-signup through the local form. The dashboards show
# per-workspace cost and volume, which is customer data even in aggregate.
ENV GF_AUTH_ANONYMOUS_ENABLED=false \
    GF_USERS_ALLOW_SIGN_UP=false \
    GF_USERS_AUTO_ASSIGN_ORG=false \
    GF_INSTALL_PLUGINS="" \
    GF_PATHS_PROVISIONING=/etc/grafana/provisioning

USER root
COPY ops/monitoring/railway/grafana-entrypoint.sh /usr/local/bin/start-grafana.sh
RUN chmod +x /usr/local/bin/start-grafana.sh
USER grafana

ENTRYPOINT ["/usr/local/bin/start-grafana.sh"]
