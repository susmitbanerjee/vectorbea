# Alertmanager.
#
# ── WHY THERE IS AN ENTRYPOINT SCRIPT HERE ───────────────────────────────────
# **Alertmanager does not expand environment variables in its config file.** Neither
# does Prometheus. This is a real trap: `${SMTP_PASSWORD}` in alertmanager.yml is not
# a placeholder that gets filled in at startup — it is a literal five-character
# password that Alertmanager will happily try to authenticate with.
#
# The failure mode is the worst available. Alertmanager starts cleanly, reports itself
# healthy, routes alerts correctly, and every delivery fails at the SMTP layer. You
# find out the next time something breaks and nobody is told about it — which is
# precisely the situation the alerts exist to prevent.
#
# (The OTel collector DOES expand `${env:VAR}` natively, and Grafana DOES interpolate
# `${VAR}` in provisioning files. Only this component needs the substitution done for
# it, which is exactly why it is easy to miss.)
#
# Substitution is by explicit `sed` rather than `envsubst`: the base image is busybox
# and has no gettext, and listing the five variables by name doubles as documentation
# of what this config actually takes.
FROM prom/alertmanager:v0.27.0

COPY ops/monitoring/alertmanager/alertmanager.yml /etc/alertmanager/alertmanager.tpl.yml
COPY ops/monitoring/alertmanager/templates/       /etc/alertmanager/templates/

USER root
RUN printf '%s\n' \
    '#!/bin/sh' \
    'set -e' \
    '' \
    '# Fail loudly rather than sending alerts nowhere. An Alertmanager with no' \
    '# destination is worse than one that refuses to start: it looks healthy.' \
    'if [ -z "$ALERT_EMAIL" ]; then' \
    '  echo "FATAL: ALERT_EMAIL is not set. Alerts would have nowhere to go." >&2' \
    '  exit 1' \
    'fi' \
    '' \
    'sed -e "s|\${ALERT_EMAIL}|${ALERT_EMAIL}|g" \' \
    '    -e "s|\${ALERT_WEBHOOK_URL}|${ALERT_WEBHOOK_URL:-http://127.0.0.1:1/disabled}|g" \' \
    '    -e "s|\${SMTP_HOST}|${SMTP_HOST:-smtp.resend.com}|g" \' \
    '    -e "s|\${SMTP_USER}|${SMTP_USER:-resend}|g" \' \
    '    -e "s|\${SMTP_PASSWORD}|${SMTP_PASSWORD}|g" \' \
    '    /etc/alertmanager/alertmanager.tpl.yml > /tmp/alertmanager.yml' \
    '' \
    'exec /bin/alertmanager --config.file=/tmp/alertmanager.yml --storage.path=/alertmanager "$@"' \
    > /usr/local/bin/start-alertmanager.sh \
 && chmod +x /usr/local/bin/start-alertmanager.sh
USER nobody

ENTRYPOINT ["/usr/local/bin/start-alertmanager.sh"]
