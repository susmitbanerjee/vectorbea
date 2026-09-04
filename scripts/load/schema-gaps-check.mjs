#!/usr/bin/env node
/**
 * The six §4 schema gaps, checked end to end.
 *
 *   node scripts/load/schema-gaps-check.mjs
 *
 * Each assertion is the UI promise the gap was blocking, not the schema object:
 * a column existing proves nothing, a Ribbon rendering from one row does.
 */
import { newPool, newRedis, sleep } from './lib/env.mjs';
import { LOAD_TAG, createTenant, enqueueRun, provisionShape, resetLoadData, resetStream } from './seed.mjs';

const API = process.env.API_BASE ?? 'http://127.0.0.1:18090';
const pool = newPool();
const redis = newRedis();
process.env.LOAD_QUEUE_MODE = 'postgres';

await resetLoadData(pool);
await resetStream(redis);
const t = await createTenant(pool, 1);
await pool.query(
  `INSERT INTO workspace_usage_policies (workspace_id, max_runs_per_day, max_concurrent_runs)
   VALUES ($1, 100000, 8) ON CONFLICT (workspace_id) DO UPDATE
     SET max_runs_per_day = 100000, max_concurrent_runs = 8`, [t.workspaceId]);
const wf = await provisionShape(pool, t, 'agent-iterative-8-turn');

const { runId } = await enqueueRun(pool, redis, t, wf, {});
const deadline = Date.now() + 180_000;
let run;
while (Date.now() < deadline) {
  ({ rows: [run] } = await pool.query(
    `SELECT status, node_total, node_committed, ribbon_json FROM agent_runs WHERE id=$1`, [runId]));
  if (run && !['queued','claimed','running','yielded'].includes(run.status)) break;
  await sleep(300);
}

// ── 1. Ribbon, from ONE row ─────────────────────────────────────────────────
const ribbon = run.ribbon_json ?? [];
console.log(`\n1. RIBBON`);
console.log(`   status=${run.status} node_committed=${run.node_committed} node_total=${run.node_total}`);
console.log(`   ribbon entries=${ribbon.length}  first=${JSON.stringify(ribbon[0] ?? null)}`);

// The N+1 this replaces: one query per row, versus one column already on the row.
const { rows: [nplus1] } = await pool.query(
  `SELECT count(*)::int AS n FROM run_checkpoints WHERE run_id=$1`, [runId]);
console.log(`   (would have needed run_checkpoints lookups: ${nplus1.n} rows)`);

// ── 2. Ribbon has no duplicate node entries ─────────────────────────────────
const ids = ribbon.map(e => e.n);
const dupes = ids.filter((v,i) => ids.indexOf(v) !== i);

// ── 3. Approvals reconciled ─────────────────────────────────────────────────
const { rows: [appr] } = await pool.query(
  `SELECT
     (SELECT count(*)::int FROM information_schema.columns
       WHERE table_name='run_approvals'
         AND column_name IN ('sla_deadline_at','escalation_policy_json',
                             'decision_context_json','confidence_score','evidence_refs_json')) AS p13_cols,
     (SELECT count(*)::int FROM information_schema.tables WHERE table_name='approvals') AS old_table,
     (SELECT count(*)::int FROM information_schema.tables
       WHERE table_name='approvals_deprecated_v027') AS renamed`);
console.log(`\n3. APPROVALS: p13 columns=${appr.p13_cols}/5 old table gone=${appr.old_table===0} renamed=${appr.renamed===1}`);

// ── 4. Audit log append-only ────────────────────────────────────────────────
await pool.query(
  `INSERT INTO audit_log (workspace_id, actor_type, action, target_type, result)
   VALUES ($1,'user','settings.update','workspace','success')`, [t.workspaceId]);
let updateRefused = false, deleteRefused = false;
try { await pool.query(`UPDATE audit_log SET result='error' WHERE workspace_id=$1`, [t.workspaceId]); }
catch { updateRefused = true; }
try { await pool.query(`DELETE FROM audit_log WHERE workspace_id=$1`, [t.workspaceId]); }
catch { deleteRefused = true; }
console.log(`\n4. AUDIT LOG: update refused=${updateRefused} delete refused=${deleteRefused}`);

// ── 5. Partitioning ─────────────────────────────────────────────────────────
const { rows: parts } = await pool.query(
  `SELECT c.relname FROM pg_class c JOIN pg_inherits i ON i.inhrelid=c.oid
     JOIN pg_class p ON p.oid=i.inhparent WHERE p.relname='run_events' ORDER BY 1`);
const { rows: [cov] } = await pool.query(
  `SELECT count(*)::int AS n FROM pg_indexes
    WHERE indexname='run_events_timeline_covering_idx'`);
const { rows: [ev] } = await pool.query(`SELECT count(*)::int AS n FROM run_events WHERE run_id=$1`, [runId]);
console.log(`\n5. PARTITIONING: partitions=${parts.length} [${parts.map(p=>p.relname).join(', ')}]`);
console.log(`   covering index=${cov.n===1}  events readable for this run=${ev.n}`);

// ── 6. Continuation chain ───────────────────────────────────────────────────
const chain = await fetch(`${API}/api/runs/${runId}/chain`, {
  headers: { 'x-workspace-id': t.workspaceId, 'x-environment-id': t.environmentId },
}).then(r => r.json()).catch(() => null);
console.log(`\n6. CHAIN: segments=${chain?.segmentCount} isContinued=${chain?.isContinued} ` +
  `tokens=${chain?.totals?.tokens} cost=${chain?.totals?.costCents}c ribbon=${(chain?.ribbon??'').length}b`);

const checks = [
  ['ribbon rendered from one row, no join', ribbon.length > 0, `${ribbon.length} entries`],
  ['one entry per node, not one per transition', dupes.length === 0, `${dupes.length} duplicates`],
  ['node_committed / node_total both populated',
    run.node_committed > 0 && run.node_total > 0, `${run.node_committed}/${run.node_total}`],
  ['run_approvals carries all five P13 fields', appr.p13_cols === 5, `${appr.p13_cols}/5`],
  ['old approvals table retired', appr.old_table === 0 && appr.renamed === 1, 'renamed'],
  ['audit_log refuses UPDATE and DELETE', updateRefused && deleteRefused,
    `update=${updateRefused} delete=${deleteRefused}`],
  ['run_events partitioned', parts.length >= 2, `${parts.length} partitions`],
  ['events still readable through the parent', ev.n > 0, `${ev.n} events`],
  ['chain endpoint aggregates the run', chain?.segmentCount >= 1, `${chain?.segmentCount} segments`],
];
console.log('\n=== VERDICT ===\n');
let pass = true;
for (const [n, ok, d] of checks) { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n} — ${d}`); if (!ok) pass = false; }
await pool.end(); redis.disconnect();
process.exit(pass ? 0 : 1);
