/**
 * The five Part-D baseline scenarios.
 *
 * Each is a pure description; `run.mjs` executes them. Keeping them declarative
 * means a scenario can be re-run after a scheduler change and compared against
 * the recorded baseline without editing the driver.
 */

export const SCENARIOS = [
  {
    id: 1,
    name: '1 tenant, 1 agent workflow',
    description:
      'Baseline. Nothing competes; wait-before-start is pure dispatch latency and ' +
      'throughput is the ceiling every other scenario is measured against.',
    tenants: 1,
    runsPerTenant: 1,
    shape: 'agent-iterative-8-turn',
    expect:
      'Wait ≈ poll latency. One AGENT slot occupied for 8 × LLM latency.',
  },
  {
    id: 2,
    name: '3 tenants × 1 agent workflow',
    description:
      'Three agent runs against an agent pool of two. The third cannot start ' +
      'until a slot frees, so its wait is a full agent run — this is the ' +
      'saturation point the architecture doc calls out at §1.4.',
    tenants: 3,
    runsPerTenant: 1,
    shape: 'agent-iterative-8-turn',
    expect:
      'Two runs start immediately; the third waits ≈ one full agent run. ' +
      'worker_pool_slots_active{pool="agent"} pinned at 2.',
  },
  {
    id: 3,
    name: '10 tenants × 1 agent workflow',
    description:
      'Ten agent runs, two slots. Measures how far behind the last-served ' +
      'tenant falls — the number a tenth customer actually experiences.',
    tenants: 10,
    runsPerTenant: 1,
    shape: 'agent-iterative-8-turn',
    expect:
      'Wait grows roughly linearly: tenant N waits ≈ floor((N-1)/2) agent runs. ' +
      'PEL depth rises as messages are pulled but cannot be placed.',
  },
  {
    id: 4,
    name: '1 tenant floods 50 short runs + 5 tenants × 1 run',
    description:
      'Fairness under load. One workspace submits 50 short runs while five ' +
      'others submit one each. The per-tenant limiter should stop the flooder ' +
      'from starving them.',
    tenants: 6,
    shape: 'linear-5-step',
    custom: 'flood',
    floodRuns: 50,
    quietTenants: 5,
    expect:
      'Fairness ratio stays bounded and every quiet tenant completes. ' +
      'tenant_throttled_total rises for the flooding workspace only.',
  },
  {
    id: 5,
    name: '1 tenant with a hanging tenant DB + 5 normal tenants',
    description:
      'THE CRITICAL TEST. One workspace queries a database that completes the ' +
      'TCP handshake and then never responds. Measures whether that tenant can ' +
      'degrade the five unrelated ones, how many slots it consumes, and for how long.',
    tenants: 6,
    custom: 'db-hang',
    hangRuns: 4,
    normalTenants: 5,
    // Agent-shaped on purpose. "Unrelated" has to mean a genuinely different
    // execution pool, and the classifier bins `linear-5-step` as LONG (see
    // TECH-DEBT.md#D5) — the same class the db_query hang lands in. Using it
    // here would measure two workloads contending for one 2-slot pool and call
    // the result "interference", which is not what this scenario asks.
    normalShape: 'agent-iterative-8-turn',
    expect:
      'Each hung query holds one tenant-DB dispatcher thread for socketTimeout, ' +
      'then fails. The AGENT pool is untouched, so all five unrelated tenants run ' +
      'at full speed. Before the timeout fix the hold was unbounded.',
  },
  {
    id: 6,
    name: 'Saturated agent pool + short runs (decoupling)',
    description:
      'THE TYPED-QUEUE TEST. Enough agent runs to saturate the agent pool, then ' +
      'short runs from unrelated tenants. With one untyped stream the short runs ' +
      'queued behind agent messages a full worker could not start. With one ' +
      'stream per class they should not wait at all.',
    tenants: 8,
    custom: 'mixed',
    agentTenants: 4,
    agentRunsEach: 3,
    shortTenants: 4,
    shortRunsEach: 2,
    expect:
      'Short runs complete at near-baseline latency while the agent pool is ' +
      'pinned at capacity. Peak PEL depth per stream must not exceed that ' +
      "pool's free-slot count.",
  },
];

export const byId = (id) => SCENARIOS.find((s) => s.id === Number(id));
