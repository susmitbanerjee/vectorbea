/**
 * Shared connection settings and the AES-256-GCM secret encoding the worker's
 * SecretService expects.
 */

import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(here, '..', '..', '..');

/**
 * `pg` and `ioredis` are already dependencies of the monorepo root. Resolving
 * from there keeps scripts/load dependency-free — no separate install step, and
 * no risk of the harness drifting onto a different driver than the app uses.
 */
const require = createRequire(path.join(REPO_ROOT, 'package.json'));
export const pg = require('pg');
export const Redis = require('ioredis');

export const CONFIG = {
  pgHost: process.env.LOAD_PG_HOST ?? '127.0.0.1',
  pgPort: Number(process.env.LOAD_PG_PORT ?? 15432),
  pgUser: process.env.LOAD_PG_USER ?? 'vectorbea',
  pgPassword: process.env.LOAD_PG_PASSWORD ?? 'vectorbea',
  pgDatabase: process.env.LOAD_PG_DB ?? 'vectorbea',

  redisHost: process.env.LOAD_REDIS_HOST ?? '127.0.0.1',
  redisPort: Number(process.env.LOAD_REDIS_PORT ?? 16379),

  /** Legacy untyped stream — still consumed during migration. */
  stream: process.env.WORKER_QUEUE_STREAM ?? 'workflow-runs',
  group: process.env.WORKER_QUEUE_GROUP ?? 'workflow-workers',

  /**
   * Typed streams. One per execution class, one consumer group each, each read
   * by exactly one worker pool. Must match ExecutionClass.streamKey in the API
   * and TypedStreamConsumer.streamKeyFor in the worker.
   */
  classes: ['short', 'long', 'agent', 'system'],
  streamFor: (executionClass) => `runs.${executionClass}`,
  groupFor: (executionClass) => `runs.${executionClass}.workers`,

  mockPort: Number(process.env.MOCK_PORT ?? 18080),
  hangDbPort: Number(process.env.HANG_DB_PORT ?? 15433),
  metricsPort: Number(process.env.METRICS_PORT ?? 19090),
  /**
   * One metrics port per replica (19090, 19091, …). Fleet-wide numbers are the
   * sum across all of them; a single port would report one replica's view and
   * silently understate throughput as replicas are added.
   */
  metricsPorts: (process.env.LOAD_METRICS_PORTS
    ? process.env.LOAD_METRICS_PORTS.split(',').map(Number)
    : [Number(process.env.METRICS_PORT ?? 19090)]),

  /**
   * Must match SECRET_ENCRYPTION_KEY given to the worker. Fixed by default so a
   * harness run is reproducible; this key protects nothing real.
   */
  secretKeyBase64:
    process.env.LOAD_SECRET_KEY ?? Buffer.alloc(32, 7).toString('base64'),
};

export const mockBaseUrl = () => `http://127.0.0.1:${CONFIG.mockPort}`;

export function newPool() {
  return new pg.Pool({
    host: CONFIG.pgHost,
    port: CONFIG.pgPort,
    user: CONFIG.pgUser,
    password: CONFIG.pgPassword,
    database: CONFIG.pgDatabase,
    max: 8,
  });
}

export function newRedis() {
  return new Redis({
    host: CONFIG.redisHost,
    port: CONFIG.redisPort,
    maxRetriesPerRequest: 3,
  });
}

/**
 * Produce a self-contained secret ref in the format SecretService decrypts:
 *
 *   "aes256gcm:" + base64url( IV(12) || ciphertext || GCM tag(16) )
 *
 * The layout matters: Java's `Cipher.doFinal` returns ciphertext with the tag
 * appended, so Node's separate `getAuthTag()` must be concatenated to match.
 */
export function encryptSecret(plaintext) {
  const key = Buffer.from(CONFIG.secretKeyBase64, 'base64');
  if (key.length !== 32) throw new Error('secret key must decode to 32 bytes');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const combined = Buffer.concat([iv, ct, tag]);
  return `aes256gcm:${combined.toString('base64url')}`;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
