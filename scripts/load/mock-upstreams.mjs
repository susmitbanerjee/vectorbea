#!/usr/bin/env node
/**
 * Mock LLM and tool upstreams for the load harness.
 *
 * Every route's latency is configurable, so a full agent-shaped load test costs
 * nothing and runs offline. Real providers are never contacted.
 *
 * Routes
 * ------
 *   POST /v1/chat/completions   OpenAI-compatible. Latency: ?ms= or LLM_LATENCY_MS.
 *   POST /v1/messages           Anthropic-compatible. Same latency controls.
 *   ANY  /tool/echo             Returns the request body. Latency: ?ms= or TOOL_LATENCY_MS.
 *   ANY  /tool/slow             Latency defaults to 30_000ms — the tool-slow-30s shape.
 *   ANY  /tool/stall            Sends 200 headers immediately, then NEVER sends the
 *                               body and never closes. This is the shape that
 *                               HttpRequest.timeout() cannot catch: the JDK stops
 *                               counting once headers arrive. A worker without a
 *                               total-call ceiling parks a pool thread here forever.
 *   ANY  /tool/blackhole        Accepts the connection, sends nothing at all.
 *   GET  /stats                 Request counts and concurrency high-water mark.
 *   GET  /healthz
 *
 * Usage:
 *   node scripts/load/mock-upstreams.mjs --port 18080
 */

import http from 'node:http';

const args = Object.fromEntries(
  process.argv.slice(2).flatMap((a, i, all) =>
    a.startsWith('--') ? [[a.slice(2), all[i + 1]]] : []),
);

const PORT = Number(args.port ?? process.env.MOCK_PORT ?? 18080);
const LLM_LATENCY_MS = Number(args['llm-latency'] ?? process.env.LLM_LATENCY_MS ?? 800);
const TOOL_LATENCY_MS = Number(args['tool-latency'] ?? process.env.TOOL_LATENCY_MS ?? 100);
const SLOW_LATENCY_MS = Number(args['slow-latency'] ?? process.env.SLOW_LATENCY_MS ?? 30_000);

const stats = {
  startedAt: new Date().toISOString(),
  byRoute: {},
  inFlight: 0,
  peakInFlight: 0,
  /** Connections deliberately left hanging — these are never released. */
  heldOpen: 0,
};

/** Sockets parked by /tool/stall and /tool/blackhole; destroyed on shutdown. */
const parked = new Set();

const count = (route) => {
  stats.byRoute[route] = (stats.byRoute[route] ?? 0) + 1;
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const readBody = (req) =>
  new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', () => resolve(''));
  });

const json = (res, status, obj) => {
  const body = Buffer.from(JSON.stringify(obj), 'utf8');
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': body.length,
  });
  res.end(body);
};

/**
 * Latency for this request: ?ms= wins, then the header, then the route default.
 *
 * The null checks are load-bearing: `Number(null)` is 0, not NaN, so a missing
 * query parameter would otherwise read as "zero latency" and silently turn every
 * shape into a no-op.
 */
const latencyFor = (url, req, fallback) => {
  const qRaw = url.searchParams.get('ms');
  if (qRaw != null && qRaw !== '') {
    const q = Number(qRaw);
    if (Number.isFinite(q) && q >= 0) return q;
  }
  const hRaw = req.headers['x-mock-latency-ms'];
  if (hRaw != null && hRaw !== '') {
    const h = Number(hRaw);
    if (Number.isFinite(h) && h >= 0) return h;
  }
  return fallback;
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const route = url.pathname;

  stats.inFlight += 1;
  stats.peakInFlight = Math.max(stats.peakInFlight, stats.inFlight);
  const done = () => { stats.inFlight -= 1; };
  res.on('close', done);

  try {
    if (route === '/healthz') return json(res, 200, { ok: true });

    if (route === '/stats') {
      return json(res, 200, {
        ...stats,
        config: { LLM_LATENCY_MS, TOOL_LATENCY_MS, SLOW_LATENCY_MS },
      });
    }

    if (route === '/reset') {
      stats.byRoute = {};
      stats.peakInFlight = stats.inFlight;
      return json(res, 200, { ok: true });
    }

    // ── The two shapes a headers-only timeout cannot catch ──────────────────
    if (route === '/tool/stall') {
      count(route);
      // Headers now, body never. A client whose only bound is
      // HttpRequest.timeout() has already "succeeded" at this point.
      res.writeHead(200, { 'content-type': 'application/json' });
      res.write('{"partial":');
      stats.heldOpen += 1;
      parked.add(res);
      return; // deliberately never res.end()
    }

    if (route === '/tool/blackhole') {
      count(route);
      // Connection accepted, nothing ever written — not even headers.
      stats.heldOpen += 1;
      parked.add(res);
      return;
    }

    // ── LLM: OpenAI-compatible ──────────────────────────────────────────────
    if (route === '/v1/chat/completions') {
      count(route);
      const body = await readBody(req);
      await sleep(latencyFor(url, req, LLM_LATENCY_MS));
      let model = 'mock-gpt';
      try { model = JSON.parse(body || '{}').model ?? model; } catch { /* ignore */ }
      return json(res, 200, {
        id: `chatcmpl-mock-${Date.now()}`,
        object: 'chat.completion',
        model,
        choices: [{
          index: 0,
          message: { role: 'assistant', content: mockAgentReply(body) },
          finish_reason: 'stop',
        }],
        usage: { prompt_tokens: 120, completion_tokens: 40, total_tokens: 160 },
      });
    }

    // ── LLM: Anthropic-compatible ───────────────────────────────────────────
    if (route === '/v1/messages') {
      count(route);
      const body = await readBody(req);
      await sleep(latencyFor(url, req, LLM_LATENCY_MS));
      return json(res, 200, {
        id: `msg-mock-${Date.now()}`,
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: mockAgentReply(body) }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 120, output_tokens: 40 },
      });
    }

    // ── Tools ───────────────────────────────────────────────────────────────
    if (route === '/tool/slow') {
      count(route);
      await readBody(req);
      await sleep(latencyFor(url, req, SLOW_LATENCY_MS));
      return json(res, 200, { ok: true, slow: true });
    }

    if (route.startsWith('/tool/')) {
      count(route);
      const body = await readBody(req);
      await sleep(latencyFor(url, req, TOOL_LATENCY_MS));
      let echo = null;
      try { echo = body ? JSON.parse(body) : null; } catch { echo = { raw: body.slice(0, 500) }; }
      return json(res, 200, { ok: true, echo, at: new Date().toISOString() });
    }

    return json(res, 404, { error: 'no such mock route', route });
  } catch (err) {
    try { json(res, 500, { error: String(err && err.message) }); } catch { /* ignore */ }
  }
});

/**
 * A canned assistant reply. Returned verbatim to every LLM call, including the
 * agent loop's — the agent brain parses JSON actions out of the content, and a
 * FINAL action keeps each mock agent turn deterministic and terminating.
 */
function mockAgentReply(requestBody) {
  return JSON.stringify({
    type: 'FINAL',
    reasoning_summary: 'Mock upstream: deterministic reply for load testing.',
    final_output: { result: 'ok', bytes: (requestBody || '').length },
  });
}

server.keepAliveTimeout = 65_000;
server.headersTimeout = 70_000;
// No request timeout — the point of /tool/stall is that the SERVER never gives up.
server.requestTimeout = 0;
server.setTimeout(0);

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[mock-upstreams] listening on http://127.0.0.1:${PORT}`);
  console.log(`[mock-upstreams] llm=${LLM_LATENCY_MS}ms tool=${TOOL_LATENCY_MS}ms slow=${SLOW_LATENCY_MS}ms`);
});

const shutdown = () => {
  for (const res of parked) { try { res.destroy(); } catch { /* ignore */ } }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1_000).unref();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
