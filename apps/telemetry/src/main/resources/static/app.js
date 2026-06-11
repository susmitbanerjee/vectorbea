const BASE = '';  // same origin

const PAGES = {
  overview:     { title: 'Overview',        sub: 'Cross-section of all telemetry' },
  business:     { title: 'Business',        sub: 'Beta funnel, activation, product events' },
  engineering:  { title: 'Engineering',     sub: 'Service health, latency, incidents' },
  users:        { title: 'Users',           sub: 'Active users, onboarding funnel, retention' },
  architect:    { title: 'AI Architect',    sub: 'Architect usage and conversion funnel' },
  workflows:    { title: 'Workflows',       sub: 'Workflow and run activity' },
  environments: { title: 'Environments',   sub: 'Dev / Stage / Prod comparison' },
  revenue:      { title: 'Revenue',         sub: 'Monetization telemetry (disabled)' },
};

const App = (() => {
  let token = '';
  let currentPage = 'overview';
  let currentEnv = 'prod';
  let currentDays = 7;

  // ── Auth ──────────────────────────────────────────────────────────────────

  function init() {
    token = localStorage.getItem('vb_telemetry_token') || '';
    if (token) {
      showApp();
    } else {
      showLogin();
    }
  }

  function showLogin() {
    document.getElementById('login-screen').style.display = 'flex';
    document.getElementById('app').style.display = 'none';
  }

  function showApp() {
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('app').style.display = 'flex';
    updateEnvBadge();
    loadPage(currentPage);
  }

  function login() {
    const t = document.getElementById('token-input').value.trim();
    const err = document.getElementById('login-error');
    if (!t) { showErr(err, 'Paste your JWT token above.'); return; }
    token = t;
    // Quick verify — hit /api/dashboard/summary
    api('/api/dashboard/summary').then(() => {
      localStorage.setItem('vb_telemetry_token', token);
      err.style.display = 'none';
      showApp();
    }).catch(e => {
      token = '';
      showErr(err, e.message || 'Invalid token or not an admin.');
    });
  }

  function logout() {
    localStorage.removeItem('vb_telemetry_token');
    token = '';
    showLogin();
  }

  function showErr(el, msg) {
    el.textContent = msg;
    el.style.display = 'block';
  }

  // ── Navigation ────────────────────────────────────────────────────────────

  function nav(el) {
    document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
    el.classList.add('active');
    currentPage = el.dataset.page;
    loadPage(currentPage);
  }

  function changeEnv() {
    currentEnv = document.getElementById('env-select').value;
    updateEnvBadge();
    loadPage(currentPage);
  }

  function changeRange() {
    currentDays = parseInt(document.getElementById('range-select').value);
    loadPage(currentPage);
  }

  function refresh() { loadPage(currentPage); }

  function updateEnvBadge() {
    const badge = document.getElementById('env-badge');
    badge.className = `env-badge ${currentEnv === 'all' ? 'prod' : currentEnv}`;
    badge.innerHTML = `<span class="dot"></span> ${currentEnv}`;
  }

  function icon(id, cls = 'ic') {
    return `<svg class="${cls}"><use href="#${id}"/></svg>`;
  }

  function setHeader(page) {
    const p = PAGES[page] || {};
    document.getElementById('page-title').textContent = p.title || page;
    document.getElementById('page-sub').textContent =
      `${p.sub || ''} · Updated ${new Date().toLocaleTimeString()}`;
  }

  // ── API ───────────────────────────────────────────────────────────────────

  async function api(path) {
    const res = await fetch(BASE + path, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.status === 401) { logout(); throw new Error('Session expired'); }
    if (res.status === 403) throw new Error('Admin access required');
    if (!res.ok) throw new Error(`API error ${res.status}`);
    return res.json();
  }

  function dateRange() {
    const to = new Date();
    const from = new Date(to - currentDays * 86400000);
    return `dateFrom=${from.toISOString()}&dateTo=${to.toISOString()}`;
  }

  function envParam() {
    return `environment=${currentEnv}`;
  }

  function qs() { return `${envParam()}&${dateRange()}`; }

  // ── Page loader ───────────────────────────────────────────────────────────

  function loadPage(page) {
    setHeader(page);
    setContent(loading());
    const loaders = {
      overview:     loadOverview,
      business:     loadBusiness,
      engineering:  loadEngineering,
      users:        loadUsers,
      architect:    loadArchitect,
      workflows:    loadWorkflows,
      environments: loadEnvironments,
      revenue:      loadRevenue,
    };
    const fn = loaders[page];
    if (fn) fn().catch(e => { setContent(errorBlock(e.message)); });
  }

  // ── Overview ──────────────────────────────────────────────────────────────

  async function loadOverview() {
    const [sum, eng] = await Promise.all([
      api(`/api/dashboard/summary?${qs()}`),
      api(`/api/dashboard/engineering?${envParam()}`),
    ]);
    const b = sum.business || {};
    const u = sum.users || {};
    const services = eng.services || [];
    const incidents = eng.openIncidents || [];

    setContent(`
      <div class="section">
        <div class="section-header">
          <div><div class="section-title">Business Snapshot</div></div>
        </div>
        <div class="cards-grid">
          ${card('Beta Applications', b.betaApplicationsSubmitted, '', 'accent')}
          ${card('Approved Workspaces', b.betaApplicationsApproved, '', 'green')}
          ${card('Active Workspaces', b.activeWorkspaces, `last ${currentDays}d`, 'accent')}
          ${card('Workflows Created', b.workflowsCreated, `last ${currentDays}d`, '')}
          ${card('Architect Sessions', b.architectSessions, `last ${currentDays}d`, '')}
          ${card('Simulation Runs', b.simulationRuns, `last ${currentDays}d`, '')}
          ${card('Real Runs', b.realRuns, `last ${currentDays}d`, 'green')}
          ${card('Limit Blocks', b.usageLimitBlocks, `last ${currentDays}d`, b.usageLimitBlocks > 0 ? 'yellow' : '')}
        </div>
      </div>

      <div class="section">
        <div class="section-header">
          <div><div class="section-title">User Activity</div></div>
        </div>
        <div class="cards-grid">
          ${card('Active Users', u.activeUsers, `last ${currentDays}d`, 'accent')}
          ${card('Sign Ins', u.signIns, `last ${currentDays}d`, '')}
          ${card('New Workspaces', u.newUsers, `last ${currentDays}d`, '')}
          ${card('Onboarding Complete', u.onboardingCompletions, `last ${currentDays}d`, 'green')}
        </div>
      </div>

      <div class="section">
        <div class="section-header">
          <div>
            <div class="section-title">Service Health</div>
            <div class="section-sub">${services.length} services monitored · ${incidents.length} open incidents</div>
          </div>
        </div>
        ${services.length === 0
          ? emptyBlock('i-engineering', 'No service snapshots yet', 'Wire up service collectors to see health data.')
          : `<div class="services-grid">${services.map(serviceCard).join('')}</div>`}
      </div>

      ${incidents.length > 0 ? `
      <div class="section">
        <div class="section-header"><div class="section-title">Open Incidents</div></div>
        <div class="table-wrap">${incidentTable(incidents)}</div>
      </div>` : ''}
    `);
  }

  // ── Business ──────────────────────────────────────────────────────────────

  async function loadBusiness() {
    const data = await api(`/api/dashboard/business?${qs()}`);
    const b = data.summary || {};
    const onboarding = data.onboardingFunnel || {};
    const topEvents = data.topEvents || [];

    setContent(`
      <div class="section">
        <div class="section-header"><div class="section-title">Private Beta Funnel</div></div>
        <div class="cards-grid">
          ${card('Applications', b.betaApplicationsSubmitted, 'submitted', 'accent')}
          ${card('Approved', b.betaApplicationsApproved, '', 'green')}
          ${card('Rejected', b.betaApplicationsRejected, '', b.betaApplicationsRejected > 0 ? 'red' : '')}
          ${card('Approval Rate', pct(b.betaApplicationsApproved, b.betaApplicationsSubmitted), '', 'green')}
        </div>
      </div>

      <div class="section">
        <div class="section-header"><div class="section-title">Activation Funnel</div></div>
        <div class="funnel">${funnelSteps(onboarding)}</div>
      </div>

      <div class="section">
        <div class="section-header"><div class="section-title">Product Activity</div></div>
        <div class="cards-grid">
          ${card('Active Workspaces', b.activeWorkspaces, `last ${currentDays}d`, 'accent')}
          ${card('Workflows Created', b.workflowsCreated, `last ${currentDays}d`, '')}
          ${card('Architect Sessions', b.architectSessions, `last ${currentDays}d`, '')}
          ${card('Workflows via Architect', b.workflowsFromArchitect, `last ${currentDays}d`, 'accent')}
          ${card('Simulation Runs', b.simulationRuns, `last ${currentDays}d`, '')}
          ${card('Real Runs', b.realRuns, `last ${currentDays}d`, 'green')}
          ${card('Usage Limit Blocks', b.usageLimitBlocks, `last ${currentDays}d`, b.usageLimitBlocks > 0 ? 'yellow' : '')}
        </div>
      </div>

      ${topEvents.length > 0 ? `
      <div class="section">
        <div class="section-header"><div class="section-title">Top Events</div></div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Event</th><th>Category</th><th>Count</th></tr></thead>
            <tbody>
              ${topEvents.slice(0, 20).map(e => `
                <tr>
                  <td><code>${e.name}</code></td>
                  <td><span class="tag teal">${e.category}</span></td>
                  <td><strong>${fmt(e.count)}</strong></td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>` : `
      <div class="section">
        <div class="section-header"><div class="section-title">Top Events</div></div>
        ${emptyBlock('i-business', 'No events yet', 'Wire up the telemetry clients in api-kotlin, worker-kotlin, and web.')}
      </div>`}
    `);
  }

  // ── Engineering ───────────────────────────────────────────────────────────

  async function loadEngineering() {
    const data = await api(`/api/dashboard/engineering?${envParam()}`);
    const services = data.services || [];
    const incidents = data.openIncidents || [];

    setContent(`
      <div class="section">
        <div class="section-header">
          <div>
            <div class="section-title">Service Health</div>
            <div class="section-sub">Latest snapshot per service · Full traces in Grafana</div>
          </div>
          <a href="#" onclick="App.openGrafana()" class="btn btn-ghost btn-sm link-ext">Open Grafana ${icon('i-external', 'ic ic-sm')}</a>
        </div>
        ${services.length === 0
          ? emptyBlock('i-engineering', 'No service snapshots yet', 'Deploy api-kotlin and worker-kotlin with TELEMETRY_ENABLED=true to see health data here.')
          : `<div class="services-grid">${services.map(serviceCard).join('')}</div>`}
      </div>

      <div class="section">
        <div class="section-header">
          <div>
            <div class="section-title">Open Incidents</div>
            <div class="section-sub">${incidents.length} active</div>
          </div>
        </div>
        ${incidents.length === 0
          ? emptyBlock('i-check', 'No open incidents', 'All clear.')
          : `<div class="table-wrap">${incidentTable(incidents)}</div>`}
      </div>

      <div class="section">
        <div class="section-header"><div class="section-title">Grafana Dashboards</div></div>
        <div class="cards-grid" style="grid-template-columns:repeat(auto-fill,minmax(180px,1fr))">
          ${grafanaLink('API Latency', 'p50/p95/p99 request latency')}
          ${grafanaLink('Worker Jobs', 'Job duration, active tasks')}
          ${grafanaLink('Queue Depth', 'Redis Streams pending')}
          ${grafanaLink('LLM & Tools', 'Call counts, tokens, errors')}
          ${grafanaLink('System Overview', 'All services, DB, Redis')}
        </div>
        <p style="margin-top:12px;font-size:12px;color:var(--muted)">
          Configure OTEL_ENABLED=true and OTEL_EXPORTER_OTLP_ENDPOINT to start sending traces to Grafana.
          See <code>docs/telemetry/grafana-opentelemetry-setup.md</code> for setup instructions.
        </p>
      </div>
    `);
  }

  // ── Users ─────────────────────────────────────────────────────────────────

  async function loadUsers() {
    const data = await api(`/api/dashboard/users?${qs()}`);
    const u = data.summary || {};
    const onboarding = data.onboardingFunnel || {};

    setContent(`
      <div class="section">
        <div class="section-header"><div class="section-title">User Activity</div></div>
        <div class="cards-grid">
          ${card('Active Users', u.activeUsers, `last ${currentDays}d`, 'accent')}
          ${card('Active Workspaces', u.activeWorkspaces, `last ${currentDays}d`, 'accent')}
          ${card('Sign Ins', u.signIns, `last ${currentDays}d`, '')}
          ${card('New Workspaces', u.newUsers, `last ${currentDays}d`, '')}
          ${card('Onboarding Completions', u.onboardingCompletions, 'first real run', 'green')}
        </div>
      </div>

      <div class="section">
        <div class="section-header"><div class="section-title">Onboarding Funnel</div></div>
        <div class="funnel">${funnelSteps(onboarding)}</div>
      </div>
    `);
  }

  // ── Architect ─────────────────────────────────────────────────────────────

  async function loadArchitect() {
    const data = await api(`/api/dashboard/architect?${qs()}`);
    const f = data.architectFunnel || {};

    const steps = [
      ['architect_opened',           'Architect Opened'],
      ['architect_goal_submitted',   'Goal Submitted'],
      ['architect_plan_generated',   'Plan Generated'],
      ['architect_plan_approved',    'Plan Approved'],
      ['architect_workflow_created', 'Workflow Created'],
      ['architect_simulation_started','Simulation Started'],
    ];

    const max = Math.max(1, ...steps.map(([k]) => f[k] || 0));

    setContent(`
      <div class="section">
        <div class="section-header"><div class="section-title">AI Architect Funnel</div></div>
        <div class="funnel">
          ${steps.map(([key, label]) => {
            const count = f[key] || 0;
            const pct = Math.round((count / max) * 100);
            return `
              <div class="funnel-step">
                <div class="funnel-label">${label}</div>
                <div class="funnel-bar-wrap"><div class="funnel-bar" style="width:${pct}%"></div></div>
                <div class="funnel-count">${fmt(count)}</div>
              </div>`;
          }).join('')}
        </div>
      </div>

      <div class="section">
        <div class="section-header"><div class="section-title">Summary</div></div>
        <div class="cards-grid">
          ${card('Sessions Started', f['architect_opened'], '', 'accent')}
          ${card('Goals Submitted', f['architect_goal_submitted'], '', '')}
          ${card('Plans Generated', f['architect_plan_generated'], '', '')}
          ${card('Plans Approved', f['architect_plan_approved'], '', 'green')}
          ${card('Workflows Created', f['architect_workflow_created'], '', 'green')}
          ${card('Goal-to-Workflow Rate', pct(f['architect_workflow_created'], f['architect_goal_submitted']), '', 'accent')}
        </div>
      </div>
    `);
  }

  // ── Workflows ─────────────────────────────────────────────────────────────

  async function loadWorkflows() {
    const data = await api(`/api/dashboard/workflows?${qs()}`);
    const events = data.workflowEvents || [];

    const byName = {};
    events.forEach(e => { byName[e.name] = e.count; });

    setContent(`
      <div class="section">
        <div class="section-header"><div class="section-title">Workflow Activity</div></div>
        <div class="cards-grid">
          ${card('Workflows Created', byName['workflow_created'], `last ${currentDays}d`, '')}
          ${card('Workflows Published', byName['workflow_published'], `last ${currentDays}d`, 'green')}
          ${card('Runs Queued', byName['workflow_run_queued'], `last ${currentDays}d`, '')}
          ${card('Runs Succeeded', byName['workflow_run_succeeded'], `last ${currentDays}d`, 'green')}
          ${card('Runs Failed', byName['workflow_run_failed'], `last ${currentDays}d`, byName['workflow_run_failed'] > 0 ? 'red' : '')}
          ${card('Simulation Runs', byName['simulation_run_started'], `last ${currentDays}d`, '')}
          ${card('Real Executions', byName['real_execution_started'], `last ${currentDays}d`, 'green')}
          ${card('Approvals Requested', byName['approval_requested'], `last ${currentDays}d`, 'yellow')}
        </div>
      </div>

      ${events.length > 0 ? `
      <div class="section">
        <div class="section-header"><div class="section-title">All Workflow Events</div></div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Event</th><th>Category</th><th>Count</th></tr></thead>
            <tbody>
              ${events.map(e => `
                <tr>
                  <td><code>${e.name}</code></td>
                  <td><span class="tag teal">${e.category}</span></td>
                  <td><strong>${fmt(e.count)}</strong></td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>` : emptyBlock('i-workflows', 'No workflow events yet', 'Wire up the telemetry clients to start tracking workflow activity.')}
    `);
  }

  // ── Environments ──────────────────────────────────────────────────────────

  async function loadEnvironments() {
    const data = await api(`/api/dashboard/environments`);
    const envs = data.environments || [];

    setContent(`
      <div class="section">
        <div class="section-header">
          <div>
            <div class="section-title">Environment Comparison</div>
            <div class="section-sub">Last 7 days across dev / stage / prod</div>
          </div>
        </div>
        <div class="env-grid">
          ${envs.map(e => {
            const b = e.business || {};
            const u = e.users || {};
            const envName = e.environment;
            return `
              <div class="env-col">
                <div class="env-col-header">
                  <span class="env-badge ${envName}">${envName}</span>
                </div>
                <div class="env-col-body">
                  ${envStat('Active Workspaces', b.activeWorkspaces)}
                  ${envStat('Workflows Created', b.workflowsCreated)}
                  ${envStat('Simulation Runs', b.simulationRuns)}
                  ${envStat('Real Runs', b.realRuns)}
                  ${envStat('Active Users', u.activeUsers)}
                  ${envStat('Architect Sessions', b.architectSessions)}
                  ${envStat('Beta Applications', b.betaApplicationsSubmitted)}
                  ${envStat('Limit Blocks', b.usageLimitBlocks)}
                </div>
              </div>`;
          }).join('')}
        </div>
      </div>
    `);
  }

  // ── Revenue ───────────────────────────────────────────────────────────────

  async function loadRevenue() {
    const data = await api(`/api/dashboard/revenue`);
    const metrics = data.metrics || {};

    setContent(`
      <div class="disabled-banner">
        <div class="banner-icon">${icon('i-revenue', 'ic-lg')}</div>
        <h2>${data.message || 'Monetization is disabled.'}</h2>
        <p>Revenue telemetry schema is scaffolded and ready. Activation will happen when
        business account and compliance requirements are met. No Stripe or Razorpay
        integration is currently active.</p>
        <div class="schema-badge">${icon('i-check', 'ic ic-sm')} Schema ready — revenue_events &amp; revenue_daily_rollups</div>
      </div>

      <div class="section">
        <div class="section-header"><div class="section-title">Future Metrics (Disabled)</div></div>
        <div class="cards-grid">
          ${disabledCard('MRR')}
          ${disabledCard('ARR')}
          ${disabledCard('Paid Workspaces')}
          ${disabledCard('Conversion Rate')}
          ${disabledCard('Churn Rate')}
          ${disabledCard('Avg Revenue / Workspace')}
        </div>
      </div>

      <div class="section">
        <div class="section-header"><div class="section-title">Planned Revenue Events</div></div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Event</th><th>Status</th></tr></thead>
            <tbody>
              ${['subscription_created','subscription_upgraded','subscription_downgraded',
                 'subscription_cancelled','invoice_paid','invoice_failed',
                 'trial_started','trial_converted','overage_recorded','refund_issued']
                .map(e => `<tr>
                  <td><code style="font-size:12px;color:var(--muted)">${e}</code></td>
                  <td><span class="tag yellow">Inactive</span></td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `);
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  function setContent(html) {
    document.getElementById('page-content').innerHTML = html;
  }

  function loading() {
    return `<div class="loading"><div class="spinner"></div> Loading…</div>`;
  }

  function errorBlock(msg) {
    return `<div class="empty"><div class="empty-icon">${icon('i-alert', 'ic-lg')}</div><strong>Something went wrong</strong><p style="color:var(--red)">${msg}</p></div>`;
  }

  function emptyBlock(iconId, title, sub) {
    return `<div class="empty"><div class="empty-icon">${icon(iconId, 'ic-lg')}</div><strong>${title}</strong><p>${sub}</p></div>`;
  }

  function card(label, value, sub, colorClass) {
    const v = value === undefined || value === null ? '—' : fmt(value);
    return `<div class="card">
      <div class="card-label">${label}</div>
      <div class="card-value ${colorClass || ''}">${v}</div>
      ${sub ? `<div class="card-sub">${sub}</div>` : ''}
    </div>`;
  }

  function disabledCard(label) {
    return `<div class="card">
      <div class="card-label">${label}</div>
      <div class="card-value disabled">—</div>
      <div class="card-sub" style="color:var(--muted)">disabled</div>
    </div>`;
  }

  function serviceCard(s) {
    const ok = s.status === 'ok' || s.status === 'healthy';
    const dotClass = ok ? 'ok' : 'err';
    return `<div class="service-card">
      <div class="service-header">
        <div class="service-name">${s.serviceName || 'unknown'}</div>
        <span class="status-chip"><span class="status-dot ${dotClass}"></span>${s.status || 'unknown'}</span>
      </div>
      <div class="service-metrics">
        ${s.p95LatencyMs != null ? metricRow('p95 latency', `${s.p95LatencyMs}ms`) : ''}
        ${s.dbLatencyMs   != null ? metricRow('DB latency',  `${s.dbLatencyMs}ms`) : ''}
        ${s.redisLatencyMs!= null ? metricRow('Redis latency',`${s.redisLatencyMs}ms`) : ''}
        ${s.errorRate5m   != null ? metricRow('Error rate 5m',`${s.errorRate5m}%`) : ''}
        ${s.queueDepth    != null ? metricRow('Queue depth', s.queueDepth) : ''}
        ${s.activeRequests!= null ? metricRow('Active reqs', s.activeRequests) : ''}
        ${s.activeTasks   != null ? metricRow('Active tasks', s.activeTasks) : ''}
        ${s.version       != null ? metricRow('Version', s.version) : ''}
        ${s.capturedAt    != null ? metricRow('Snapshot', relativeTime(s.capturedAt)) : ''}
      </div>
    </div>`;
  }

  function metricRow(label, value) {
    return `<div class="metric-row"><span>${label}</span><span>${value}</span></div>`;
  }

  function incidentTable(incidents) {
    return `<table>
      <thead><tr><th>Service</th><th>Severity</th><th>Title</th><th>Status</th><th>Last Seen</th></tr></thead>
      <tbody>
        ${incidents.map(i => `<tr>
          <td>${i.serviceName || '—'}</td>
          <td><span class="tag ${i.severity === 'critical' ? 'red' : i.severity === 'high' ? 'yellow' : 'blue'}">${i.severity}</span></td>
          <td>${i.title}</td>
          <td><span class="tag ${i.status === 'open' ? 'red' : 'green'}">${i.status}</span></td>
          <td>${relativeTime(i.lastSeenAt)}</td>
        </tr>`).join('')}
      </tbody>
    </table>`;
  }

  function funnelSteps(data) {
    const LABELS = {
      workspace_created:             'Workspace Created',
      first_connection_created:      'First Connection Created',
      first_workflow_created:        'First Workflow Created',
      first_simulation_run_started:  'First Simulation Run',
      first_simulation_run_completed:'First Simulation Completed',
      first_real_run_started:        'First Real Run Started',
      first_real_run_completed:      'First Real Run Completed',
    };
    const keys = Object.keys(LABELS);
    const max = Math.max(1, ...keys.map(k => data[k] || 0));
    return keys.map(k => {
      const count = data[k] || 0;
      const p = Math.round((count / max) * 100);
      return `<div class="funnel-step">
        <div class="funnel-label">${LABELS[k]}</div>
        <div class="funnel-bar-wrap"><div class="funnel-bar" style="width:${p}%"></div></div>
        <div class="funnel-count">${fmt(count)}</div>
      </div>`;
    }).join('');
  }

  function grafanaLink(title, sub) {
    return `<div class="card" style="cursor:pointer" onclick="App.openGrafana()">
      <div class="card-label">Grafana</div>
      <div style="font-size:14px;font-weight:600;margin-bottom:4px">${title}</div>
      <div class="card-sub">${sub}</div>
      <div class="link-ext" style="margin-top:8px;font-size:11px;color:var(--accent)">Open ${icon('i-external', 'ic ic-sm')}</div>
    </div>`;
  }

  function envStat(label, value) {
    return `<div class="env-stat">
      <span>${label}</span>
      <span>${fmt(value)}</span>
    </div>`;
  }

  function fmt(v) {
    if (v === undefined || v === null) return '0';
    if (typeof v === 'string') return v;
    if (v >= 1000000) return (v / 1000000).toFixed(1) + 'M';
    if (v >= 1000) return (v / 1000).toFixed(1) + 'k';
    return String(v);
  }

  function pct(a, b) {
    if (!b) return '—';
    return Math.round((a / b) * 100) + '%';
  }

  function relativeTime(iso) {
    if (!iso) return '—';
    const diff = Date.now() - new Date(iso).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  }

  function openGrafana() {
    toast('Configure GRAFANA_URL env var to link directly.', 'error');
  }

  function toast(msg, type = 'success') {
    const el = document.getElementById('toast');
    el.innerHTML = `${icon(type === 'success' ? 'i-check' : 'i-alert', 'ic ic-sm')}<span>${msg}</span>`;
    el.className = `toast ${type} show`;
    setTimeout(() => { el.className = 'toast'; }, 3000);
  }

  // Public API
  return { init, login, logout, nav, changeEnv, changeRange, refresh, openGrafana };
})();

document.addEventListener('DOMContentLoaded', () => App.init());
