# Replica scaling proof: run scenarios b, d and e at N=1, 2 and 3.
#
#   powershell -File scripts/load/replica-sweep.ps1
#   powershell -File scripts/load/replica-sweep.ps1 -Minutes 5 -Scenarios "b,d"
#
# ASCII only - see the note in start-replicas.ps1.
#
# WHAT THIS PROVES
# ----------------
# Per-tenant concurrency limits must be IDENTICAL at every replica count. That is the
# specific bug S04 fixed: the old TenantConcurrencyLimiter was in-process JVM state, so
# a cap of 2 became an effective 6 at three replicas - each replica enforcing its own
# private allowance with nothing coordinating them.
#
# The limit is now read from run_leases, which is shared. This sweep re-measures it from
# that same shared table at each N, because a number read from a worker's own memory
# would be correct at N=1 by construction and would prove nothing.
#
# Throughput should scale near-linearly over the same range. Those two together are the
# claim: adding replicas adds capacity without weakening isolation.

param(
    [int]$Minutes = 5,
    [string]$Scenarios = "b,d,e"
)

$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
if (-not (Test-Path (Join-Path $repo "scripts"))) { $repo = "C:\Users\Admin\Downloads\vectorbee" }
Set-Location $repo

foreach ($n in 1, 2, 3) {
    Write-Host ""
    Write-Host ("=" * 78)
    Write-Host ("REPLICA COUNT N=" + $n)
    Write-Host ("=" * 78)

    # LOAD_METRICS_PORTS must list every replica or fleet-wide gauges report one
    # worker's view. At N=3 that would understate throughput by two thirds and make
    # scaling look flat - the exact wrong conclusion.
    $ports = @()
    for ($i = 1; $i -le $n; $i++) { $ports += (19089 + $i) }
    $env:LOAD_METRICS_PORTS = ($ports -join ",")

    & powershell -ExecutionPolicy Bypass -File scripts/load/start-replicas.ps1 -Count $n
    if ($LASTEXITCODE -ne 0) { Write-Error "replica startup failed at N=$n"; exit 1 }

    node scripts/load/matrix.mjs --only $Scenarios --minutes $Minutes --tag ("n" + $n)
}

Write-Host ""
Write-Host ("=" * 78)
Write-Host "SWEEP COMPLETE - comparing"
Write-Host ("=" * 78)
node scripts/load/compare-replicas.mjs
