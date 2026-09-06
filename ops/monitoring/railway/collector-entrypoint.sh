#!/bin/sh
#
# Standalone collector — the six-service layout only.
#
# Bridges Railway's assigned $PORT to the variable the shared config reads. The config
# deliberately carries no default: `${env:PORT:-4318}` is not shell, and collector
# 0.109 reads the whole string as a variable name and refuses to start. So the mapping
# happens here, once, in a place where `:-` means what it looks like.
set -e
export OTLP_HTTP_PORT="${PORT:-4318}"
echo "[collector] OTLP/HTTP receiver on ${OTLP_HTTP_PORT}"
exec /otelcol-contrib --config=/etc/otel/config.yml
