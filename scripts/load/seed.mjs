/**
 * Seeds tenants, workflows and connections, and enqueues runs.
 *
 * Runs are created exactly the way the API creates them:
 *   1. INSERT agent_runs (status='queued')     ← committed first
 *   2. XADD workflow-runs                      ← then enqueued
 *
 * That ordering is the platform's existing durability guarantee, and reproducing
 * it matters here: the stream message ID assigned by XADD is what
 * `job_wait_before_start_seconds` measures from, so the harness must not invent
 * its own enqueue path.
 */

import crypto from 'node:crypto';
import { CONFIG, encryptSecret, mockBaseUrl } from './lib/env.mjs';
import {
  agentIterative8Turn,
  linear5Step,
  parallelFanout8,
  tenantDbHang,
  toolSlow30s,
} from './shapes.mjs';

const uuid = () => crypto.randomUUID();

/** Everything the harness creates is tagged so cleanup is exact. */
export const LOAD_TAG = 'loadtest';

/**
 * Clear the Redis stream and rebuild the consumer group.
 *
 * Without this, messages from a previous scenario survive into the next one:
 * their `agent_runs` rows are gone, so they are read, found missing, and acked —
 * but only after occupying read capacity and PEL slots first. That silently
 * inflates the next scenario's wait percentiles and PEL high-water mark. The
 * consumer group is deleted and recreated so no stale PEL entries remain either.
 */
export async function resetStream(redis) {
  // Every typed stream plus the legacy one. Missing any of them would let a
  // previous scenario's messages leak into the next and quietly inflate its
  // wait percentiles and PEL high-water mark.
  const streams = [
    ...CONFIG.classes.map((c) => [CONFIG.streamFor(c), CONFIG.groupFor(c)]),
    [CONFIG.stream, CONFIG.group],
  ];
  for (const [stream, group] of streams) {
    await redis.del(stream);
    try { await redis.xgroup('DESTROY', stream, group); } catch { /* may not exist */ }
    try { await redis.xgroup('CREATE', stream, group, '0', 'MKSTREAM'); } catch { /* BUSYGROUP */ }
  }
}

export async function resetLoadData(pool) {
  // Order matters: children before parents.
  await pool.query(`DELETE FROM run_leases WHERE run_id IN (
      SELECT ar.id FROM agent_runs ar JOIN workspaces w ON w.id = ar.workspace_id
      WHERE w.slug LIKE $1)`, [`${LOAD_TAG}-%`]);
  await pool.query(`DELETE FROM run_events WHERE run_id IN (
      SELECT ar.id FROM agent_runs ar JOIN workspaces w ON w.id = ar.workspace_id
      WHERE w.slug LIKE $1)`, [`${LOAD_TAG}-%`]);
  await pool.query(`DELETE FROM agent_runs WHERE workspace_id IN (
      SELECT id FROM workspaces WHERE slug LIKE $1)`, [`${LOAD_TAG}-%`]);
  await pool.query(`DELETE FROM workflow_versions WHERE workflow_id IN (
      SELECT id FROM workflows WHERE workspace_id IN (
        SELECT id FROM workspaces WHERE slug LIKE $1))`, [`${LOAD_TAG}-%`]);
  await pool.query(`DELETE FROM workflows WHERE workspace_id IN (
      SELECT id FROM workspaces WHERE slug LIKE $1)`, [`${LOAD_TAG}-%`]);
  await pool.query(`DELETE FROM connections WHERE workspace_id IN (
      SELECT id FROM workspaces WHERE slug LIKE $1)`, [`${LOAD_TAG}-%`]);
  await pool.query(`DELETE FROM workspaces WHERE slug LIKE $1`, [`${LOAD_TAG}-%`]);
}

/** Create one workspace + environment. Returns { workspaceId, environmentId, slug }. */
export async function createTenant(pool, index) {
  const workspaceId = uuid();
  const environmentId = uuid();
  const slug = `${LOAD_TAG}-t${String(index).padStart(2, '0')}`;

  await pool.query(
    `INSERT INTO workspaces (id, name, slug) VALUES ($1, $2, $3)`,
    [workspaceId, `Load tenant ${index}`, slug],
  );
  await pool.query(
    `INSERT INTO environments (id, workspace_id, name, slug, type)
     VALUES ($1, $2, 'Load', 'load', 'development')`,
    [environmentId, workspaceId],
  );
  return { workspaceId, environmentId, slug, index };
}

/** LLM connection pointing at the mock upstream. */
export async function createLlmConnection(pool, tenant) {
  const id = uuid();
  await pool.query(
    `INSERT INTO connections
       (id, workspace_id, environment_id, name, slug, type, provider, status,
        auth_type, secret_ref, config_json)
     VALUES ($1,$2,$3,'Mock LLM','mock-llm','llm','openai','active','api_key',$4,$5)`,
    [
      id, tenant.workspaceId, tenant.environmentId,
      encryptSecret('sk-loadtest-not-a-real-key'),
      // LlmNodeExecutor appends /v1/chat/completions to baseUrl.
      JSON.stringify({ baseUrl: mockBaseUrl(), model: 'mock-gpt' }),
    ],
  );
  return id;
}

/**
 * A database connection pointing at the black-hole listener.
 *
 * `sslRequired: false` matters — the host is a raw TCP sink that will never
 * negotiate TLS, and we want the hang to happen on the startup read, which is
 * the realistic shape, rather than on an SSL handshake.
 */
export async function createHangingDbConnection(pool, tenant, port = CONFIG.hangDbPort) {
  const id = uuid();
  await pool.query(
    `INSERT INTO connections
       (id, workspace_id, environment_id, name, slug, type, provider, status,
        auth_type, secret_ref, config_json)
     VALUES ($1,$2,$3,'Hanging tenant DB','hang-db','database','postgresql','active','basic',$4,$5)`,
    [
      id, tenant.workspaceId, tenant.environmentId,
      encryptSecret('not-a-real-password'),
      JSON.stringify({
        connectionMode: 'host_port',
        host: '127.0.0.1',
        port,
        database: 'blackhole',
        username: 'loadtest',
        sslRequired: false,
        readOnly: true,
      }),
    ],
  );
  return id;
}

/** Create a workflow + version from a shape descriptor. Returns ids. */
export async function createWorkflow(pool, tenant, shapeDescriptor) {
  const workflowId = uuid();
  const versionId = uuid();
  const { shape, graph } = shapeDescriptor;

  await pool.query(
    `INSERT INTO workflows (id, workspace_id, environment_id, name, slug, status)
     VALUES ($1,$2,$3,$4,$5,'active')`,
    [workflowId, tenant.workspaceId, tenant.environmentId, shape, `${shape}-${workflowId.slice(0, 8)}`],
  );
  await pool.query(
    `INSERT INTO workflow_versions (id, workflow_id, version, graph_json)
     VALUES ($1,$2,1,$3)`,
    [versionId, workflowId, JSON.stringify(graph)],
  );
  await pool.query(`UPDATE workflows SET current_version_id = $1 WHERE id = $2`,
    [versionId, workflowId]);

  return { workflowId, versionId, shape, expectedClass: shapeDescriptor.expectedClass };
}

/**
 * Build the shape a tenant will run, creating any connections it needs.
 * Returns the workflow descriptor.
 */
export async function provisionShape(pool, tenant, shapeName, opts = {}) {
  let descriptor;
  switch (shapeName) {
    case 'linear-5-step':
      descriptor = linear5Step();
      break;
    case 'agent-iterative-8-turn': {
      const connectionId = await createLlmConnection(pool, tenant);
      descriptor = agentIterative8Turn({ connectionId, ...opts });
      break;
    }
    case 'parallel-fanout-8':
      descriptor = parallelFanout8({ baseUrl: mockBaseUrl(), ...opts });
      break;
    case 'tool-slow-30s':
      descriptor = toolSlow30s({ baseUrl: mockBaseUrl(), ...opts });
      break;
    case 'tool-stall':
      descriptor = toolSlow30s({ baseUrl: mockBaseUrl(), stall: true, ...opts });
      break;
    case 'tenant-db-hang': {
      const connectionId = await createHangingDbConnection(pool, tenant, opts.hangDbPort);
      descriptor = tenantDbHang({ connectionId, ...opts });
      break;
    }
    default:
      throw new Error(`unknown shape: ${shapeName}`);
  }
  return createWorkflow(pool, tenant, descriptor);
}

/**
 * Enqueue one run: commit `agent_runs` first, then XADD — the same order the API
 * uses, and the reason a crash between the two leaves a recoverable row rather
 * than an orphaned message.
 *
 * Returns { runId, streamId, enqueuedAtMs }.
 */
export async function enqueueRun(pool, redis, tenant, workflow, input = {}) {
  const runId = uuid();

  // The class is decided HERE, before the message exists — mirroring what the
  // API now does at trigger. The shape declares its own class, so the harness
  // tests the worker's typed consumption rather than re-deriving a guess.
  const executionClass = (workflow.expectedClass ?? 'SHORT').toLowerCase();

  await pool.query(
    `INSERT INTO agent_runs
       (id, workspace_id, environment_id, workflow_id, workflow_version_id,
        status, trigger_type, input_json, execution_class)
     VALUES ($1,$2,$3,$4,$5,'queued','manual',$6,$7)`,
    [runId, tenant.workspaceId, tenant.environmentId,
      workflow.workflowId, workflow.versionId, JSON.stringify(input), executionClass],
  );

  // Postgres first, XADD second — the durability contract is unchanged by
  // typing the queue.
  //
  // LOAD_USE_LEGACY_STREAM=true routes every run onto the old untyped stream
  // instead, so the same worker binary and the same scenario can be measured
  // both ways. That is how the before/after in TYPED-QUEUE-MIGRATION.md is
  // produced: one variable, everything else identical.
  const targetStream = process.env.LOAD_USE_LEGACY_STREAM === 'true'
    ? CONFIG.stream
    : CONFIG.streamFor(executionClass);

  const streamId = await redis.xadd(
    targetStream, '*',
    'jobType', 'START_RUN',
    'runId', runId,
    'workflowId', workflow.workflowId,
    'workspaceId', tenant.workspaceId,
    'triggeredBy', `load:${tenant.slug}`,
    'inputJson', JSON.stringify(input),
    'retryCount', '0',
    'executionClass', executionClass,
  );

  return {
    runId,
    streamId,
    executionClass,
    enqueuedAtMs: Number(String(streamId).split('-')[0]),
    tenantSlug: tenant.slug,
    shape: workflow.shape,
  };
}

/** Terminal-state snapshot for a batch of runs. */
export async function fetchRunOutcomes(pool, runIds) {
  if (runIds.length === 0) return [];
  const { rows } = await pool.query(
    `SELECT id, workspace_id, status, started_at, completed_at, duration_ms,
            created_at, error_json
       FROM agent_runs WHERE id = ANY($1::uuid[])`,
    [runIds],
  );
  return rows;
}
