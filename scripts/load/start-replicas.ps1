# Start N worker replicas with the harness environment, one metrics port each.
#
#   powershell -File scripts/load/start-replicas.ps1 -Count 3
#   powershell -File scripts/load/start-replicas.ps1 -Stop
#
# ASCII ONLY. Windows PowerShell 5.1 reads a .ps1 as the system ANSI codepage unless it
# has a BOM, so a UTF-8 em-dash in a comment becomes three bytes of garbage and takes
# the parser with it. Learned the hard way.
#
# WHY THIS EXISTS AND replicas.sh DOES NOT SUFFICE
# ------------------------------------------------
# D14: `replicas.sh stop` iterates pids it recorded at start, so a worker launched any
# other way is invisible to it. That produced three consecutive wrong measurements in
# Stage 6b - per-tenant concurrency read 8, then 9, then 14 against a cap of 2, and each
# looked like a scheduler defect. Five workers were running.
#
# This matches on the COMMAND LINE instead, so it stops every worker regardless of how
# it started, and asserts the live count before returning. A harness run whose worker
# count is not asserted is a measurement you cannot trust.

param(
    [int]$Count = 1,
    [switch]$Stop,
    [string]$ClaimMode = "postgres"
)

$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
$repo = Split-Path -Parent $repo
$jar = Join-Path $repo "apps\worker-kotlin\build\libs\worker-kotlin-0.1.0-all.jar"
$java = "C:\Program Files\Eclipse Adoptium\jdk-17.0.18.8-hotspot\bin\java.exe"

function Get-Workers {
    Get-CimInstance Win32_Process -Filter "Name='java.exe'" |
        Where-Object { $_.CommandLine -like '*worker-kotlin*' }
}

function Stop-Workers {
    $live = @(Get-Workers)
    foreach ($p in $live) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }
    if ($live.Count -gt 0) { Start-Sleep -Seconds 3 }
    Write-Host ("stopped " + $live.Count + " worker(s)")
}

if ($Stop) { Stop-Workers; exit 0 }

Stop-Workers

for ($i = 1; $i -le $Count; $i++) {
    $port = 19089 + $i     # 19090, 19091, 19092 - matches CONFIG.metricsPorts
    $env:APP_ENV = "development"
    $env:DATABASE_URL = "jdbc:postgresql://127.0.0.1:15432/vectorbea?user=vectorbea&password=vectorbea"
    $env:DATABASE_DIRECT_URL = $env:DATABASE_URL
    $env:REDIS_URL = "redis://127.0.0.1:16379"
    $env:REDIS_TLS_ENABLED = "false"
    $env:REDIS_COMMAND_TIMEOUT_MS = "10000"
    # Must match CONFIG.secretKeyBase64 - Buffer.alloc(32, 7) in base64.
    $env:SECRET_ENCRYPTION_KEY = "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc="
    $env:WORKER_ID = "load-worker-$i"
    $env:METRICS_PORT = "$port"
    # Production-derived pool sizes. The baseline only means something if it reflects
    # the configuration that actually ships.
    $env:WORKER_CONCURRENCY = "4"
    $env:WORKER_POOL_SHORT = "8"
    $env:WORKER_POOL_LONG = "2"
    $env:WORKER_POOL_AGENT = "6"
    $env:WORKER_POOL_SYSTEM = "2"
    $env:WORKER_POOL_TENANT_DB = "16"
    $env:WORKER_CLAIM_MODE = $ClaimMode
    $env:QUEUE_MODE = $ClaimMode
    $env:CLAIM_RESERVED_PRIORITY_SLOTS = "1"
    $env:WORKER_LEGACY_STREAM_ENABLED = "false"
    # D6: the mock upstreams are on loopback and SSRF protection blocks loopback by
    # default. Without this every HTTP-node scenario fails with "SSRF blocked" - the
    # guard working correctly and the measurement being wrong.
    $env:SSRF_ALLOWED_TEST_HOSTS = "127.0.0.1"

    Start-Process -FilePath $java `
        -ArgumentList '-Xmx1g', '-jar', $jar `
        -RedirectStandardOutput "$env:TEMP\worker-$i-out.log" `
        -RedirectStandardError "$env:TEMP\worker-$i-err.log" `
        -NoNewWindow
    Write-Host ("started replica " + $i + " on metrics :" + $port)
}

Start-Sleep -Seconds 30

$live = @(Get-Workers).Count
Write-Host ("live workers: " + $live + " (expected " + $Count + ")")
if ($live -ne $Count) {
    Write-Error "worker count mismatch - measurements would be invalid"
    exit 1
}

for ($i = 1; $i -le $Count; $i++) {
    $port = 19089 + $i
    try {
        $r = Invoke-WebRequest ("http://127.0.0.1:" + $port + "/metrics") -TimeoutSec 5 -UseBasicParsing
        Write-Host ("  :" + $port + " ok, " + $r.Content.Length + " bytes")
    } catch {
        Write-Error ("  :" + $port + " NOT RESPONDING")
        exit 1
    }
}
