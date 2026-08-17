#!/usr/bin/env node
/**
 * Produces the environment a worker needs to join the load harness, and
 * optionally execs a command with it applied.
 *
 *   node scripts/load/worker-env.mjs --print
 *   node scripts/load/worker-env.mjs --exec gradle run
 *
 * Pool sizes are left at their production-derived defaults (WORKER_CONCURRENCY=4
 * → short 8 / long 2 / agent 2 / system 2). The baseline is only meaningful if
 * it reflects the configuration that actually ships.
 */

import { spawn } from 'node:child_process';
import { CONFIG } from './lib/env.mjs';

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);

export function workerEnv() {
  return {
    APP_ENV: 'development',
    DATABASE_URL:
      `jdbc:postgresql://${CONFIG.pgHost}:${CONFIG.pgPort}/${CONFIG.pgDatabase}` +
      `?user=${CONFIG.pgUser}&password=${CONFIG.pgPassword}`,
    REDIS_URL: `redis://${CONFIG.redisHost}:${CONFIG.redisPort}`,
    REDIS_TLS_ENABLED: 'false',
    // Must exceed WORKER_POLL_BLOCK_MS or every idle XREADGROUP aborts as a timeout.
    REDIS_COMMAND_TIMEOUT_MS: process.env.REDIS_COMMAND_TIMEOUT_MS ?? '10000',
    SECRET_ENCRYPTION_KEY: CONFIG.secretKeyBase64,

    WORKER_ID: 'load-worker-1',
    WORKER_QUEUE_STREAM: CONFIG.stream,
    WORKER_QUEUE_GROUP: CONFIG.group,
    WORKER_CONCURRENCY: process.env.WORKER_CONCURRENCY ?? '4', // fallback formula only
    // Stage 1 per-pool sizing. Agent 2 -> 6.
    WORKER_POOL_SHORT: process.env.WORKER_POOL_SHORT ?? '8',
    WORKER_POOL_LONG: process.env.WORKER_POOL_LONG ?? '2',
    WORKER_POOL_AGENT: process.env.WORKER_POOL_AGENT ?? '6',
    WORKER_POOL_SYSTEM: process.env.WORKER_POOL_SYSTEM ?? '2',
    WORKER_POOL_TENANT_DB: process.env.WORKER_POOL_TENANT_DB ?? '16',
    // Replicas are NOT scaled — see docs/architecture/TECH-DEBT.md#D1.
    REPLICA_COUNT: process.env.REPLICA_COUNT ?? '1',

    METRICS_PORT: String(CONFIG.metricsPort),

    // Mock upstreams live on loopback; see README "The SSRF exemption".
    SSRF_ALLOWED_TEST_HOSTS: '127.0.0.1',

    // Outbound timeout policy under test — the audit's defaults, stated
    // explicitly so a baseline run records the values it was measured with.
    DB_CONNECT_TIMEOUT_SECONDS: process.env.DB_CONNECT_TIMEOUT_SECONDS ?? '5',
    DB_SOCKET_TIMEOUT_SECONDS: process.env.DB_SOCKET_TIMEOUT_SECONDS ?? '30',
    DB_LOGIN_TIMEOUT_SECONDS: process.env.DB_LOGIN_TIMEOUT_SECONDS ?? '5',
    HTTP_CONNECT_TIMEOUT_MS: process.env.HTTP_CONNECT_TIMEOUT_MS ?? '5000',
    HTTP_TOTAL_CALL_CEILING_MS: process.env.HTTP_TOTAL_CALL_CEILING_MS ?? '120000',

    // Telemetry off — it is not part of what is being measured.
    TELEMETRY_ENABLED: 'false',
    LOG_LEVEL: process.env.LOG_LEVEL ?? 'INFO',
  };
}

const env = workerEnv();

if (flag('print') || argv.length === 0) {
  for (const [k, v] of Object.entries(env)) console.log(`${k}=${v}`);
  process.exit(0);
}

if (flag('exec')) {
  const idx = argv.indexOf('--exec');
  const [cmd, ...rest] = argv.slice(idx + 1);
  if (!cmd) {
    console.error('--exec needs a command');
    process.exit(1);
  }
  const child = spawn(cmd, rest, {
    stdio: 'inherit',
    env: { ...process.env, ...env },
    shell: process.platform === 'win32',
  });
  child.on('exit', (code) => process.exit(code ?? 1));
}
