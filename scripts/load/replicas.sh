#!/usr/bin/env bash
# Start or stop N worker replicas against the load harness.
#
# Each replica gets a distinct WORKER_ID and its own METRICS_PORT. The WORKER_ID
# matters for correctness, not just tidiness: it is the Redis consumer name on
# every typed stream and the owner recorded in run_leases, so two replicas
# sharing one would share a Pending Entries List and each other's leases.
#
#   scripts/load/replicas.sh start 3
#   scripts/load/replicas.sh stop
#   scripts/load/replicas.sh ports 3      # print the metrics ports
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASE_METRICS_PORT="${BASE_METRICS_PORT:-19090}"
LOG_DIR="${LOG_DIR:-${TMPDIR:-/tmp}}"

cmd="${1:-}"
count="${2:-1}"

case "$cmd" in
  start)
    for i in $(seq 1 "$count"); do
      port=$((BASE_METRICS_PORT + i - 1))
      WORKER_ID="load-worker-$i" \
      METRICS_PORT="$port" \
        bash "$HERE/start-worker.sh" > "$LOG_DIR/worker-$i.log" 2>&1 &
      echo "started replica $i (workerId=load-worker-$i, metrics=$port, log=$LOG_DIR/worker-$i.log)"
    done
    echo "waiting for $count replica(s) to report metrics…"
    for i in $(seq 1 "$count"); do
      port=$((BASE_METRICS_PORT + i - 1))
      until curl -s -m 2 "http://127.0.0.1:$port/metrics" >/dev/null 2>&1; do sleep 1; done
      echo "replica $i ready on $port"
    done
    ;;

  stop)
    # Graceful, not forced: the shutdown hook releases run leases explicitly
    # rather than leaving them to expire, and that is part of what this harness
    # exists to verify. A forced kill would skip it and make the test vacuous.
    if command -v pkill >/dev/null 2>&1; then
      pkill -f 'worker-kotlin-0.1.0-all.jar' 2>/dev/null || true
      echo "sent SIGTERM to all replicas"
    else
      # Windows: taskkill WITHOUT /F asks the process to close, which runs JVM
      # shutdown hooks. /F would terminate immediately and skip them.
      for pid in $(powershell.exe -NoProfile -Command             "Get-CimInstance Win32_Process -Filter \"Name='java.exe'\" | Where-Object { \$_.CommandLine -like '*worker-kotlin*' } | ForEach-Object { \$_.ProcessId }"             2>/dev/null | tr -d '
'); do
        taskkill //PID "$pid" >/dev/null 2>&1 || true
        echo "requested graceful stop of pid $pid"
      done
    fi
    ;;

  start-one)
    # Start exactly one replica by index, if it is not already up. Used by the
    # chaos driver to top the fleet back up after a kill without spawning a
    # duplicate set — which would exhaust Postgres connections and invalidate
    # every assertion that follows.
    i="$count"
    port=$((BASE_METRICS_PORT + i - 1))
    if curl -s -m 1 "http://127.0.0.1:$port/metrics" >/dev/null 2>&1; then
      echo "replica $i already up on $port"
      exit 0
    fi
    WORKER_ID="load-worker-$i" METRICS_PORT="$port"       bash "$HERE/start-worker.sh" > "$LOG_DIR/worker-$i.log" 2>&1 &
    until curl -s -m 2 "http://127.0.0.1:$port/metrics" >/dev/null 2>&1; do sleep 1; done
    echo "replica $i restarted on $port"
    ;;

  ports)
    for i in $(seq 1 "$count"); do echo $((BASE_METRICS_PORT + i - 1)); done
    ;;

  *)
    echo "usage: $0 {start N|stop|ports N}" >&2
    exit 1
    ;;
esac
