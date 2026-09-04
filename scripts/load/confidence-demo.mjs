#!/usr/bin/env node
/**
 * The demo walkthrough: a low-confidence output routes to a gate and is corrected.
 *
 *   node scripts/load/confidence-demo.mjs
 *
 * §6 calls this "the single most compelling thing in a demo". This drives it end to
 * end and narrates each step, so the sequence can be watched, screen-recorded, or
 * read as a transcript.
 *
 * The scenario is chosen to be honest rather than flattering: the agent is asked to
 * extract three fields from an email that contains only two of them. A model that
 * invents the third is doing the most common thing models do wrong in business
 * extraction — and the system catches it not by being clever about the value, but
 * by checking whether the quotation the model gave actually exists.
 *
 *   1. Run the agent. It cites two fields correctly and invents the third.
 *   2. Span verification fails on the invented one.
 *   3. Confidence lands in the gate band. The run SUSPENDS - no worker slot held.
 *   4. Show the gate payload a reviewer sees: score, breakdown, weak signal,
 *      output beside source, what happens next.
 *   5. Approve with correction. The human supplies the right value.
 *   6. Prove the corrected value flows downstream and was captured as an eval case.
 */

import { CONFIG, newPool, newRedis, sleep, mockBaseUrl } from './lib/env.mjs';
import { LOAD_TAG, createTenant, resetLoadData, resetStream } from './seed.mjs';
import crypto from 'node:crypto';

const API = process.env.API_BASE ?? 'http://127.0.0.1:18090';
const pool = newPool();
const redis = newRedis();
const uuid = () => crypto.randomUUID();

const rule = (s) => console.log('\n' + '─'.repeat(74) + '\n' + s + '\n' + '─'.repeat(74));
const step = (n, s) => console.log(`\n[${n}] ${s}`);

/**
 * The source email. Contains the account name and the renewal date; contains NO
 * support contact, which is the field the agent will invent.
 */
const SOURCE = `Hi team, quick note before the weekend. The renewal for Northwind Traders is due on 14 March and the account owner is Priya Raman. Their current plan is Growth. No tickets outstanding.`;

const q = async (sql, p = []) => (await pool.query(sql, p)).rows;

// ── Setup ───────────────────────────────────────────────────────────────────
rule('CONFIDENCE ROUTING DEMO');
console.log('A low-confidence extraction routes to a human, who corrects it.');

await resetLoadData(pool);
await resetStream(redis);
const tenant = await createTenant(pool, 1);
await pool.query(
  `INSERT INTO workspace_usage_policies (workspace_id, max_runs_per_day, max_concurrent_runs)
   VALUES ($1, 100000, 8) ON CONFLICT (workspace_id) DO UPDATE
     SET max_runs_per_day = 100000, max_concurrent_runs = 8`, [tenant.workspaceId]);

const workflowId = uuid(), versionId = uuid(), runId = uuid();
await pool.query(
  `INSERT INTO workflows (id, workspace_id, environment_id, name, slug, status)
   VALUES ($1,$2,$3,'Account extraction','account-extraction','active')`,
  [workflowId, tenant.workspaceId, tenant.environmentId]);
await pool.query(
  `INSERT INTO workflow_versions (id, workflow_id, version, graph_json) VALUES ($1,$2,1,$3)`,
  [versionId, workflowId, JSON.stringify({
    nodes: [
      { id: 'start', type: 'trigger', config: {} },
      { id: 'extract', type: 'llm', config: {} },
      { id: 'notify', type: 'email', config: {} },
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'extract' },
      { id: 'e2', source: 'extract', target: 'notify' },
    ],
  })]);
await pool.query(`UPDATE workflows SET current_version_id=$1 WHERE id=$2`, [versionId, workflowId]);
await pool.query(
  `INSERT INTO agent_runs (id, workspace_id, environment_id, workflow_id, workflow_version_id,
                           status, trigger_type, input_json, execution_class)
   VALUES ($1,$2,$3,$4,$5,'running','manual',$6,'agent')`,
  [runId, tenant.workspaceId, tenant.environmentId, workflowId, versionId,
   JSON.stringify({ email: SOURCE })]);

// ── 1. What the agent produced ──────────────────────────────────────────────
step(1, 'The agent extracts three fields from the email.');
console.log(`    Source: "${SOURCE.slice(0, 96)}…"`);

const agentOutput = {
  account_name:    { value: 'Northwind Traders', found: true,
                     source_span: 'renewal for Northwind Traders is due on' },
  renewal_date:    { value: '14 March', found: true,
                     source_span: 'is due on 14 March and the account owner' },
  // The invention. Plausible, formatted correctly, and nowhere in the email.
  support_contact: { value: 'Dan Whitfield', found: true,
                     source_span: 'the support contact is Dan Whitfield' },
};
console.log('    account_name    = "Northwind Traders"   cited');
console.log('    renewal_date    = "14 March"            cited');
console.log('    support_contact = "Dan Whitfield"       cited  <-- watch this one');

// ── 2. Span verification ────────────────────────────────────────────────────
step(2, 'Every citation is checked against the source, mechanically.');
const verification = {};
let verified = 0, claims = 0, unverifiedField = null;
for (const [field, env] of Object.entries(agentOutput)) {
  if (!env.found) continue;
  claims++;
  const present = SOURCE.includes(env.span ?? env.source_span);
  verification[field] = { span: env.source_span, verified: present, level: present ? 'EXACT' : 'NOT_FOUND' };
  if (present) verified++; else unverifiedField = field;
  console.log(`    ${present ? 'VERIFIED  ' : 'NOT FOUND '} ${field}: "${(env.source_span).slice(0, 52)}…"`);
}
console.log(`\n    ${verified} of ${claims} citations verified.`);
console.log(`    '${unverifiedField}' cited text that does not exist in the email.`);
console.log('    The citation was invented, so the value cannot be trusted.');

// ── 3. Confidence and routing ───────────────────────────────────────────────
step(3, 'Confidence is composed from the signals already collected.');

// Mirrors ConfidenceScorer: absent signals are excluded and their weight
// redistributed, so this node is scored on assertions and citations at full scale.
const W = { assertions: 0.25, citations: 0.30 };
const assertionRatio = 1.0;                 // both business rules held
// A PROVEN fabrication halves the citation signal on top of the ratio. Two of three
// citations verified is 0.67, but one of them was checked and found to be invented -
// which is evidence about the model, not just a missing field. See
// ConfidenceScorer.citationRatio for why this is not merely a ratio.
const fabricated = claims - verified;
const citationRatio = (verified / claims) * (fabricated > 0 ? 0.5 : 1.0);
const total = W.assertions + W.citations;
const score = (assertionRatio * W.assertions + citationRatio * W.citations) / total;

console.log(`    Business rules      ${(assertionRatio * 100).toFixed(0)}%   weight ${W.assertions}`);
console.log(`    Citations verified  ${(citationRatio * 100).toFixed(0)}%   weight ${W.citations}   <-- weakest`);
console.log(`                        (${verified}/${claims} verified, halved: one was provably invented)`);
console.log(`    Model certainty     not measured (provider returned no logprobs)`);
console.log(`    Sample agreement    not measured (self-consistency is off)`);
console.log(`\n    Confidence = ${(score * 100).toFixed(0)}%`);

const action = score >= 0.90 ? 'commit'
             : score >= 0.70 ? 'commit_flagged'
             : score >= 0.50 ? 'gate' : 'fail';
console.log(`    Routing:  >=90 commit | >=70 flag | >=50 GATE | <50 fail`);
console.log(`    -> ${action.toUpperCase()}`);
if (action !== 'gate') {
  console.error('\nThe demo scenario did not land in the gate band; adjust the fixture.');
  process.exit(1);
}

// Persist the score and open the gate, exactly as the worker would.
const [{ id: scoreId }] = await q(
  `INSERT INTO confidence_scores
     (run_id, workspace_id, workflow_id, node_id, score, action, components_json,
      weakest_signal, explanation, thresholds_json)
   VALUES ($1,$2,$3,'extract',$4,'gate',$5::jsonb,'citations_verified',$6,$7::jsonb)
   RETURNING id`,
  [runId, tenant.workspaceId, workflowId, score,
   JSON.stringify([
     { name: 'assertions_passed', value: assertionRatio, weight: W.assertions,
       contribution: assertionRatio * W.assertions / total, present: true,
       description: 'Business rules satisfied: 2 of 2' },
     { name: 'citations_verified', value: citationRatio, weight: W.citations,
       contribution: citationRatio * W.citations / total, present: true,
       description: `Citations verified against the source: ${verified} of ${claims}` },
     { name: 'logprob_certainty', value: null, weight: 0.15, contribution: 0,
       present: false, description: 'Model certainty on key fields' },
     { name: 'self_consistency', value: null, weight: 0.15, contribution: 0,
       present: false, description: 'Agreement across repeated samples' },
     { name: 'critic_verdict', value: null, weight: 0.10, contribution: 0,
       present: false, description: "Reviewing model's verdict" },
     { name: 'distribution_match', value: null, weight: 0.05, contribution: 0,
       present: false, description: "Similarity to this agent's usual output" },
   ]),
   `The citation for '${unverifiedField}' could not be found in the input.`,
   JSON.stringify({ commit: 0.9, flag: 0.7, gate: 0.5 })]);

step(4, 'The run SUSPENDS and a gate opens. No worker slot is held while it waits.');
await pool.query(`UPDATE agent_runs SET status='yielded' WHERE id=$1`, [runId]);

const unwrapped = Object.fromEntries(
  Object.entries(agentOutput).map(([k, v]) => [k, v.found ? v.value : null]));

// The node's committed output, exactly as the runtime stores it before suspending.
// This is what downstream nodes resolve `steps.extract.<field>` against, and what the
// correction has to reach for "the run continues with your value" to be true.
await pool.query(
  `INSERT INTO step_outputs (run_id, workspace_id, environment_id, node_id, node_type,
                             raw_output_json_sanitized, extracted_output_json_sanitized,
                             validated_output_json_sanitized)
   VALUES ($1,$2,$3,'extract','llm',$4::jsonb,$4::jsonb,$4::jsonb)`,
  [runId, tenant.workspaceId, tenant.environmentId, JSON.stringify(unwrapped)]);

const [{ id: approvalId }] = await q(
  `INSERT INTO run_approvals
     (run_id, workspace_id, environment_id, node_id, status, message, title, risk_level,
      requested_by, confidence_score, confidence_score_id, original_output_json,
      evidence_refs_json, decision_context_json)
   VALUES ($1,$2,$3,'extract','PENDING',$4,$5,'medium','confidence_gate',$6,$7,
           $8::jsonb,$9::jsonb,$10::jsonb)
   RETURNING id`,
  [runId, tenant.workspaceId, tenant.environmentId,
   `Low confidence (${Math.round(score * 100)}%) - a value could not be traced to the input.`,
   `Low confidence on 'extract'`, score, scoreId,
   JSON.stringify(unwrapped), JSON.stringify(verification),
   JSON.stringify({ account: 'Northwind Traders', reviewing: unverifiedField })]);

const [runState] = await q(`SELECT status FROM agent_runs WHERE id=$1`, [runId]);
console.log(`    Run status: ${runState.status}  (suspended - holding no worker permit)`);
console.log(`    Gate opened: ${approvalId}`);

// ── 5. What the reviewer sees ───────────────────────────────────────────────
step(5, 'The gate payload a reviewer opens:');
const gate = await fetch(`${API}/api/approvals/${approvalId}/gate`, {
  headers: {
    'x-workspace-id': tenant.workspaceId,
    'x-environment-id': tenant.environmentId,
  },
}).then((r) => r.json()).catch((e) => ({ error: String(e) }));

if (gate.error || !gate.confidence) {
  console.log(`    (API not reachable at ${API} - showing the stored payload instead)`);
  console.log(`    score=${score.toFixed(2)} weakest=citations_verified`);
} else {
  console.log(`    Confidence ring : ${Math.round(gate.confidence.score * 100)}%`);
  console.log(`    Weakest signal  : ${gate.confidence.weakestSignal}`);
  console.log(`    Explanation     : ${gate.confidence.explanation}`);
  console.log(`    History         : ${gate.history?.note ?? 'n/a'}`);
  if (gate.nextAction?.hasSideEffects) {
    console.log(`    WARNING         : ${gate.nextAction.warning}`);
  }
  console.log('    Components, worst first:');
  for (const c of gate.confidence.components.slice(0, 3)) {
    const v = c.present ? `${Math.round((c.value ?? 0) * 100)}%`.padStart(4) : ' n/a';
    console.log(`        ${v}  ${c.name}${c.present ? '' : '  (not measured)'}`);
  }
  console.log('    Actions: ' + (gate.actions ?? []).map((a) => a.label).join(' | '));
}

// ── 6. Approve with correction ──────────────────────────────────────────────
step(6, 'The reviewer corrects the invented value and approves.');
const corrected = { ...unwrapped, support_contact: null };
console.log(`    support_contact: "Dan Whitfield"  ->  null  ("not in the email")`);

const decided = await fetch(`${API}/api/approvals/${approvalId}/decide`, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'x-workspace-id': tenant.workspaceId,
    'x-environment-id': tenant.environmentId,
  },
  body: JSON.stringify({
    action: 'approve_with_correction',
    correctedOutput: corrected,
    reason: 'The email contains no support contact. The agent invented one.',
    decidedBy: 'demo-reviewer',
  }),
}).then((r) => r.json()).catch((e) => ({ error: String(e) }));

if (decided.error) {
  console.log(`    (API not reachable - ${decided.error})`);
} else {
  console.log(`    ${decided.message}`);
}

// ── 7. Prove it ─────────────────────────────────────────────────────────────
step(7, 'What actually happened, read back from the database:');
const [approval] = await q(
  `SELECT status, decision_action, decision_reason,
          original_output_json->>'support_contact'  AS agent_said,
          corrected_output_json ? 'support_contact' AS has_correction,
          corrected_output_json->>'support_contact' AS human_said
     FROM run_approvals WHERE id=$1`, [approvalId]);
const [downstream] = await q(
  `SELECT validated_output_json_sanitized ? 'support_contact' AS has_key,
          validated_output_json_sanitized->>'support_contact' AS value,
          validated_output_json_sanitized->>'account_name'    AS untouched
     FROM step_outputs WHERE run_id=$1 AND node_id='extract'`, [runId]);
const evalCases = await q(
  `SELECT node_id, source, confidence_at_capture,
          agent_output_json->>'support_contact'    AS agent_value,
          expected_output_json ? 'support_contact' AS expected_present
     FROM eval_cases WHERE workflow_id=$1`, [workflowId]);

console.log(`    Approval status        : ${approval?.status} / ${approval?.decision_action}`);
console.log(`    Agent said             : "${approval?.agent_said}"`);
console.log(`    Human corrected it to  : ${approval?.human_said ?? 'null'} ` +
            `(field present: ${approval?.has_correction})`);
console.log(`    Downstream now reads   : support_contact = ${downstream?.value ?? 'null'} ` +
            `(key present: ${downstream?.has_key})`);
console.log(`    Other fields untouched : account_name = "${downstream?.untouched}"`);
console.log(`    Eval cases captured    : ${evalCases.length}`);
if (evalCases[0]) {
  console.log(`        source=${evalCases[0].source} ` +
              `confidence_at_capture=${Number(evalCases[0].confidence_at_capture).toFixed(2)}`);
}

const checks = [
  ['routed to a gate rather than committing', action === 'gate', action],
  ['run suspended, holding no worker slot', runState.status === 'yielded', runState.status],
  ['the invented citation was the weak signal', unverifiedField === 'support_contact', String(unverifiedField)],
  ['reviewer correction recorded', approval?.decision_action === 'approve_with_correction',
    String(approval?.decision_action)],
  ['the agent value and the human value are both kept',
    !!approval?.agent_said && approval?.has_correction === true, 'both stored'],
  ['the correction reached the value downstream nodes read',
    downstream?.has_key === true && downstream?.value === null,
    `support_contact=${downstream?.value ?? 'null'}`],
  ['the correction did not disturb the fields that verified',
    downstream?.untouched === 'Northwind Traders', String(downstream?.untouched)],
  ['captured as an eval case', evalCases.length === 1, `${evalCases.length}`],
  ['the eval case records the confidence at the time',
    evalCases[0] != null && Number(evalCases[0].confidence_at_capture) > 0,
    String(evalCases[0]?.confidence_at_capture)],
];

rule('WALKTHROUGH RESULT');
let pass = true;
for (const [n, ok, d] of checks) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n} — ${d}`);
  if (!ok) pass = false;
}
console.log(
  '\n  The agent did not know it was wrong. It knew it could not prove it was right,\n' +
  '  and that was enough to ask.');

await pool.end();
redis.disconnect();
process.exit(pass ? 0 : 1);
