#!/usr/bin/env node
/**
 * THE deliverable test: a schema-violating response cannot be committed.
 *
 *   node scripts/load/contract-containment.mjs
 *
 * §4 of the prompt calls the ordering "architecturally critical", and it is the one
 * thing in this whole change that cannot be verified by reading code — moving the
 * validation call below the writes would compile, pass every unit test, and
 * silently destroy the guarantee.
 *
 * So this asserts the guarantee from the outside, against durable state:
 *
 *   1. A node whose output violates its contract FAILS.
 *   2. The failure message names the assertion and the actual value — "risk_score
 *      was 340", not "validation error".
 *   3. **Nothing was written to `step_outputs`.** This is the assertion that
 *      matters. If a row exists, the bad value became durable and every downstream
 *      node would inherit it (failure mode #6, context poisoning).
 *   4. Nothing was checkpointed.
 *   5. The same node with a conforming output DOES commit — so the test
 *      distinguishes "the guard works" from "nothing ever commits".
 *
 * Requires a worker and the mock upstreams. The mock returns a violating payload
 * for model `mock-gpt-violate` and a conforming one for `mock-gpt-valid`.
 */

import { CONFIG, newPool, newRedis, sleep, mockBaseUrl } from './lib/env.mjs';
import { LOAD_TAG, createTenant, enqueueRun, resetLoadData, resetStream } from './seed.mjs';
import crypto from 'node:crypto';

const pool = newPool();
const redis = newRedis();
process.env.LOAD_QUEUE_MODE = 'postgres';

const uuid = () => crypto.randomUUID();

/** The contract from §4 of the reliability doc, near enough verbatim. */
const SCHEMA = {
  type: 'object',
  properties: {
    risk_score: { type: 'integer', minimum: 0, maximum: 100 },
    account_id: { type: 'string', pattern: '^acc_[a-z0-9]{12}$' },
    recommendation: { type: 'string', enum: ['renew', 'escalate', 'churn_risk', 'no_action'] },
    reasoning: { type: 'string', minLength: 40 },
  },
  required: ['risk_score', 'account_id', 'recommendation', 'reasoning'],
  additionalProperties: false,
};

const ASSERTIONS = [
  {
    name: 'score_in_range',
    expr: 'output.risk_score >= 0 and output.risk_score <= 100',
    severity: 'fail',
    message: 'risk_score was {output.risk_score}, expected 0-100',
  },
  {
    name: 'score_matches_recommendation',
    expr: 'output.risk_score > 70 implies output.recommendation != "no_action"',
    severity: 'fail',
    message: 'risk_score of {output.risk_score} is high but the recommendation was ' +
             '{output.recommendation} — a high score must not recommend no action',
  },
];

/**
 * A one-node LLM workflow pointed at the mock, with the contract mode in the URL.
 *
 * The mode rides on the MODEL NAME (`mock-gpt-violate`) rather than a query
 * parameter: the executor appends `/v1/chat/completions` to the configured baseUrl,
 * so a query string on the base lands in the middle of the path and 404s.
 */
async function provision(tenant, mode) {
  const connectionId = uuid();
  const { encryptSecret } = await import('./lib/env.mjs');
  await pool.query(
    `INSERT INTO connections (id, workspace_id, environment_id, name, slug, type, provider,
                              status, auth_type, secret_ref, config_json)
     VALUES ($1,$2,$3,'Mock LLM',$4,'llm','openai','active','api_key',$5,$6)`,
    [connectionId, tenant.workspaceId, tenant.environmentId, `mock-llm-${mode}`,
     encryptSecret('sk-loadtest-not-a-real-key'),
     JSON.stringify({ baseUrl: mockBaseUrl(), model: `mock-gpt-${mode}` })]);

  const workflowId = uuid(), versionId = uuid();
  const graph = {
    nodes: [
      { id: 'start', type: 'trigger', config: {} },
      { id: 'assess', type: 'llm', config: {
          connectionId, model: `mock-gpt-${mode}`, temperature: 0,
          systemPrompt: 'Assess the account risk.',
          messages: [{ role: 'user', content: 'Assess it.' }],
      } },
      { id: 'done', type: 'end', config: {} },
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'assess' },
      { id: 'e2', source: 'assess', target: 'done' },
    ],
  };
  await pool.query(
    `INSERT INTO workflows (id, workspace_id, environment_id, name, slug, status)
     VALUES ($1,$2,$3,$4,$5,'active')`,
    [workflowId, tenant.workspaceId, tenant.environmentId, `contract-${mode}`, `contract-${mode}-${workflowId.slice(0,8)}`]);
  await pool.query(
    `INSERT INTO workflow_versions (id, workflow_id, version, graph_json) VALUES ($1,$2,1,$3)`,
    [versionId, workflowId, JSON.stringify(graph)]);
  await pool.query(`UPDATE workflows SET current_version_id=$1 WHERE id=$2`, [versionId, workflowId]);

  // The contract, active on the LLM node.
  const body = JSON.stringify({ schema: SCHEMA, assertions: ASSERTIONS });
  const hash = crypto.createHash('sha256').update(body).digest('hex');
  await pool.query(
    `INSERT INTO node_contracts (workspace_id, workflow_id, node_id, version, content_hash,
                                 schema_json, assertions_json, status, decoding_enforced, source)
     VALUES ($1,$2,'assess',1,$3,$4::jsonb,$5::jsonb,'active',true,'user')`,
    [tenant.workspaceId, workflowId, hash, JSON.stringify(SCHEMA), JSON.stringify(ASSERTIONS)]);

  return { workflowId, versionId, shape: `contract-${mode}`, expectedClass: 'AGENT' };
}

async function waitTerminal(runId) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const { rows: [r] } = await pool.query(
      `SELECT status, error_json FROM agent_runs WHERE id=$1`, [runId]);
    if (r && !['queued','claimed','running','yielded'].includes(r.status)) return r;
    await sleep(300);
  }
  return { status: 'timeout', error_json: null };
}

const durableState = async (runId) => {
  const { rows: [r] } = await pool.query(
    `SELECT
       (SELECT count(*)::int FROM step_outputs WHERE run_id=$1 AND node_id='assess') AS outputs,
       (SELECT count(*)::int FROM run_checkpoints WHERE run_id=$1)                   AS checkpoints,
       (SELECT count(*)::int FROM contract_validations WHERE run_id=$1)              AS validations`,
    [runId]);
  return r;
};

// ── Setup ───────────────────────────────────────────────────────────────────
console.log('▶ resetting …');
await resetLoadData(pool);
await resetStream(redis);
await fetch(`${mockBaseUrl().replace(/\/$/, '')}/reset`, { method: 'POST' }).catch(() => {});

const tenant = await createTenant(pool, 1);
await pool.query(
  `INSERT INTO workspace_usage_policies (workspace_id, max_runs_per_day, max_concurrent_runs)
   VALUES ($1, 100000, 8) ON CONFLICT (workspace_id) DO UPDATE
     SET max_runs_per_day = 100000, max_concurrent_runs = 8`, [tenant.workspaceId]);

// ── 1. The violating output ─────────────────────────────────────────────────
const badWf = await provision(tenant, 'violate');
const { runId: badRun } = await enqueueRun(pool, redis, tenant, badWf, {});
console.log(`▶ violating run ${badRun} …`);
const bad = await waitTerminal(badRun);
const badState = await durableState(badRun);
const badError = JSON.stringify(bad.error_json ?? {});

console.log(`  status=${bad.status}`);
console.log(`  step_outputs rows=${badState.outputs}  checkpoints=${badState.checkpoints}  validations=${badState.validations}`);
console.log(`  error=${badError.slice(0, 220)}`);

const { rows: [v] } = await pool.query(
  `SELECT outcome, schema_valid, schema_errors_json::text AS se, assertion_results_json::text AS ar
     FROM contract_validations WHERE run_id=$1 AND node_id='assess' LIMIT 1`, [badRun]);
if (v) {
  console.log(`  validation outcome=${v.outcome} schemaValid=${v.schema_valid}`);
  console.log(`  schemaErrors=${(v.se ?? '').slice(0, 200)}`);
}

// ── 2. The conforming output ────────────────────────────────────────────────
const goodWf = await provision(tenant, 'valid');
const { runId: goodRun } = await enqueueRun(pool, redis, tenant, goodWf, {});
console.log(`\n▶ conforming run ${goodRun} …`);
const good = await waitTerminal(goodRun);
const goodState = await durableState(goodRun);
const { rows: [gv] } = await pool.query(
  `SELECT outcome FROM contract_validations WHERE run_id=$1 AND node_id='assess' LIMIT 1`, [goodRun]);
console.log(`  status=${good.status}  step_outputs rows=${goodState.outputs}  outcome=${gv?.outcome}`);

// ── Assertions ──────────────────────────────────────────────────────────────
const checks = [
  ['violating run FAILED', bad.status === 'failed', bad.status],
  // The assertion this whole test exists for.
  ['violating output NOT written to step_outputs', badState.outputs === 0,
    `${badState.outputs} rows`],
  ['violating output NOT checkpointed', badState.checkpoints === 0,
    `${badState.checkpoints} checkpoints`],
  ['the violation WAS recorded for audit', badState.validations > 0,
    `${badState.validations} validations`],
  ['error names the actual value, not "validation error"',
    badError.includes('340'), badError.includes('340') ? 'names 340' : 'value missing'],
  ['error is specific, not generic',
    !/validation error/i.test(badError), 'no generic phrasing'],
  ['conforming run SUCCEEDED', good.status === 'succeeded', good.status],
  ['conforming output WAS committed', goodState.outputs === 1, `${goodState.outputs} rows`],
  ['conforming validation passed', gv?.outcome === 'pass', String(gv?.outcome)],
];

console.log('\n=== CONTRACT CONTAINMENT ===\n');
let pass = true;
for (const [n, ok, d] of checks) { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n} — ${d}`); if (!ok) pass = false; }

await pool.end();
redis.disconnect();
process.exit(pass ? 0 : 1);
