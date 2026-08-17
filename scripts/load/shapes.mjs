/**
 * The five workload shapes.
 *
 * Graphs use the worker's **internal flat format** (WorkflowGraph.parse accepts
 * both this and the React Flow format): nodes carry `config` at the top level.
 *
 * A shape's execution class is not declared — it is *derived* by JobClassifier
 * from the graph JSON, exactly as it is in production:
 *
 *   contains "llm" | "agent" | "tool"      → AGENT
 *   contains "http" | "db_query" | "db_write"
 *     or >= WORKER_LONG_NODE_THRESHOLD nodes → LONG
 *   otherwise                                → SHORT
 *
 * The `expectedClass` field below records what that heuristic should produce,
 * so the harness can assert the classifier still agrees and a shape does not
 * silently migrate between pools.
 */

const endNode = (id) => ({ id, type: 'end', label: 'End', config: {} });
const edge = (from, to, type = 'default') => ({ id: `${from}->${to}`, source: from, target: to, type });

/** linear-5-step — five transform nodes in a row. Pure CPU, no outbound I/O. */
export function linear5Step() {
  const nodes = [
    { id: 'n0', type: 'trigger', label: 'Trigger', config: {} },
  ];
  const edges = [];
  for (let i = 1; i <= 5; i++) {
    nodes.push({
      id: `n${i}`,
      type: 'transform',
      label: `Step ${i}`,
      config: { expression: `{"step": ${i}}`, mode: 'json' },
    });
    edges.push(edge(`n${i - 1}`, `n${i}`));
  }
  nodes.push(endNode('nEnd'));
  edges.push(edge('n5', 'nEnd'));
  return { shape: 'linear-5-step', expectedClass: 'SHORT', graph: { nodes, edges } };
}

/**
 * agent-iterative-8-turn — eight sequential LLM calls.
 *
 * Modelled as eight `llm` nodes rather than one `agent` node so each turn is a
 * separate, observable outbound call with its own latency, while still landing
 * in the AGENT pool via the classifier's "llm" marker. Eight turns × the mock's
 * LLM latency is how long one AGENT slot is held.
 */
export function agentIterative8Turn({ connectionId, model = 'mock-gpt', timeoutMs = 60_000 }) {
  const nodes = [{ id: 'n0', type: 'trigger', label: 'Trigger', config: {} }];
  const edges = [];
  for (let i = 1; i <= 8; i++) {
    nodes.push({
      id: `n${i}`,
      type: 'llm',
      label: `Turn ${i}`,
      config: {
        connectionId,
        model,
        timeoutMs,
        systemPrompt: 'You are a load-test agent.',
        messages: [{ role: 'user', content: `Turn ${i}: continue the task.` }],
      },
    });
    edges.push(edge(`n${i - 1}`, `n${i}`));
  }
  nodes.push(endNode('nEnd'));
  edges.push(edge('n8', 'nEnd'));
  return { shape: 'agent-iterative-8-turn', expectedClass: 'AGENT', graph: { nodes, edges } };
}

/** parallel-fanout-8 — one parallel node fanning out to eight HTTP calls, then a join. */
export function parallelFanout8({ baseUrl, timeoutMs = 30_000 }) {
  const nodes = [
    { id: 'n0', type: 'trigger', label: 'Trigger', config: {} },
    { id: 'nFan', type: 'parallel', label: 'Fan out', config: {} },
  ];
  const edges = [edge('n0', 'nFan')];
  for (let i = 1; i <= 8; i++) {
    nodes.push({
      id: `nb${i}`,
      type: 'http',
      label: `Branch ${i}`,
      config: {
        url: `${baseUrl}/tool/echo?branch=${i}`,
        method: 'POST',
        timeoutMs,
        body: { branch: i },
      },
    });
    edges.push(edge('nFan', `nb${i}`, 'parallel'));
    edges.push(edge(`nb${i}`, 'nJoin'));
  }
  nodes.push({ id: 'nJoin', type: 'join', label: 'Join', config: { mode: 'all' } });
  nodes.push(endNode('nEnd'));
  edges.push(edge('nJoin', 'nEnd'));
  return { shape: 'parallel-fanout-8', expectedClass: 'LONG', graph: { nodes, edges } };
}

/**
 * tool-slow-30s — a single HTTP tool call against an endpoint that takes 30s.
 *
 * Pass `stall: true` to point it at /tool/stall instead: headers arrive at once
 * and the body never does. That variant is the regression test for the
 * total-call ceiling — before the fix it held the slot indefinitely, because
 * HttpRequest.timeout() had already been satisfied.
 */
export function toolSlow30s({ baseUrl, timeoutMs = 30_000, stall = false }) {
  const path = stall ? '/tool/stall' : '/tool/slow';
  return {
    shape: stall ? 'tool-stall' : 'tool-slow-30s',
    expectedClass: 'LONG',
    graph: {
      nodes: [
        { id: 'n0', type: 'trigger', label: 'Trigger', config: {} },
        {
          id: 'n1',
          type: 'http',
          label: 'Slow tool',
          config: { url: `${baseUrl}${path}`, method: 'POST', timeoutMs, body: { probe: true } },
        },
        endNode('nEnd'),
      ],
      edges: [edge('n0', 'n1'), edge('n1', 'nEnd')],
    },
  };
}

/**
 * tenant-db-hang — a db_query against a connection whose host accepts TCP and
 * then never responds.
 *
 * This is the critical shape. It is the only one whose blast radius is other
 * tenants: the thread parks inside the JDBC driver, and no application-level
 * timeout can reach it.
 */
export function tenantDbHang({ connectionId, timeoutSeconds = 30 }) {
  return {
    shape: 'tenant-db-hang',
    expectedClass: 'LONG',
    graph: {
      nodes: [
        { id: 'n0', type: 'trigger', label: 'Trigger', config: {} },
        {
          id: 'n1',
          type: 'db_query',
          label: 'Read tenant DB',
          config: { connectionId, query: 'SELECT 1', timeoutSeconds },
        },
        endNode('nEnd'),
      ],
      edges: [edge('n0', 'n1'), edge('n1', 'nEnd')],
    },
  };
}

export const SHAPES = {
  'linear-5-step': linear5Step,
  'agent-iterative-8-turn': agentIterative8Turn,
  'parallel-fanout-8': parallelFanout8,
  'tool-slow-30s': toolSlow30s,
  'tenant-db-hang': tenantDbHang,
};
