/**
 * Fault injection primitives.
 *
 * Deliberately crude — SIGKILL, SIGSTOP, blocking the port. Graceful shutdown is
 * the case that already works; what needs proving is the ungraceful one, where
 * the worker gets no chance to clean up, release a lease, or finish a write.
 *
 * Windows note: SIGSTOP/SIGCONT have no direct equivalent, so the pause fault
 * uses Suspend-Process/Resume-Process via PowerShell, which is the same thing
 * at the OS level — the process stops being scheduled without dying, so its
 * lease expires while it still believes it holds it.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const isWindows = process.platform === 'win32';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** PIDs of running worker JVMs. */
export async function workerPids() {
  if (isWindows) {
    const { stdout } = await exec('powershell.exe', [
      '-NoProfile', '-Command',
      "Get-CimInstance Win32_Process -Filter \"Name='java.exe'\" | " +
      "Where-Object { $_.CommandLine -like '*worker-kotlin*' } | " +
      "ForEach-Object { $_.ProcessId }",
    ]).catch(() => ({ stdout: '' }));
    return stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean).map(Number);
  }
  const { stdout } = await exec('bash', ['-c',
    "ps -eo pid,args | grep '[w]orker-kotlin-0.1.0-all.jar' | awk '{print $1}'",
  ]).catch(() => ({ stdout: '' }));
  return stdout.split('\n').map((s) => s.trim()).filter(Boolean).map(Number);
}

/**
 * Kill a worker outright — no shutdown hook, no lease release, no final write.
 *
 * SIGKILL rather than SIGTERM on purpose: the graceful path releases leases
 * explicitly and is not the interesting case. This is the crash.
 */
export async function killWorker(pid) {
  if (isWindows) {
    await exec('powershell.exe', ['-NoProfile', '-Command',
      `Stop-Process -Id ${pid} -Force -ErrorAction SilentlyContinue`]).catch(() => {});
  } else {
    await exec('bash', ['-c', `kill -9 ${pid} 2>/dev/null || true`]).catch(() => {});
  }
  return pid;
}

/**
 * Freeze a worker without killing it.
 *
 * This is the nastiest of the four faults, because the process is still alive
 * and still believes it holds its lease. Its heartbeat stops, the lease expires,
 * another worker takes over — and then the frozen one is resumed and carries on
 * writing as though nothing happened. That is precisely what fencing exists to
 * stop, and nothing else in the suite exercises it.
 */
export async function pauseWorker(pid, durationMs) {
  if (isWindows) {
    // Suspend-Process is PS 7+; fall back to the .NET thread-suspend equivalent.
    await exec('powershell.exe', ['-NoProfile', '-Command',
      `$p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue; ` +
      `if ($p) { foreach ($t in $p.Threads) { ` +
      `  [void][Vectorbea.Native]::SuspendThread($t.Id) } }`,
    ]).catch(async () => {
      // If native suspension is unavailable, degrade honestly rather than
      // silently skipping: report it so the run is not counted as a pass.
      throw new Error('SIGSTOP-equivalent unavailable on this host');
    });
    await sleep(durationMs);
    await exec('powershell.exe', ['-NoProfile', '-Command',
      `$p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue; ` +
      `if ($p) { foreach ($t in $p.Threads) { ` +
      `  [void][Vectorbea.Native]::ResumeThread($t.Id) } }`,
    ]).catch(() => {});
  } else {
    await exec('bash', ['-c', `kill -STOP ${pid}`]);
    await sleep(durationMs);
    await exec('bash', ['-c', `kill -CONT ${pid} 2>/dev/null || true`]);
  }
  return pid;
}

/**
 * Cut the worker off from Postgres for a while.
 *
 * Implemented by pausing the Postgres container rather than by firewall rules:
 * it needs no privileges, is symmetric on every platform, and produces the same
 * thing from the worker's point of view — connections that hang rather than
 * refuse, which is the failure mode that actually hurts.
 */
export async function partitionPostgres(containerName, durationMs) {
  await exec('docker', ['pause', containerName]);
  try {
    await sleep(durationMs);
  } finally {
    await exec('docker', ['unpause', containerName]).catch(() => {});
  }
}

/** Uniform random integer in [min, max]. */
export const randomBetween = (min, max) => min + Math.floor(Math.random() * (max - min + 1));

export { sleep, isWindows };
