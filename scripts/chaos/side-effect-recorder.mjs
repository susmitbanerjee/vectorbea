#!/usr/bin/env node
/**
 * The oracle for the chaos suite.
 *
 * Every assertion about duplicate side effects has to be grounded in something
 * outside the system under test. Counting rows in `side_effects` would only
 * prove the worker's own bookkeeping is self-consistent — it would happily
 * report zero duplicates while sending two emails, because the duplicate is
 * precisely the call the bookkeeping missed.
 *
 * So this server counts **actual HTTP requests it received**, keyed by the
 * idempotency key the worker passed. Two requests bearing the same key is a
 * duplicate side effect, full stop, and no amount of internal state can argue
 * with it.
 *
 * Routes
 * ------
 *   POST /effect         records the call, returns 200. The endpoint the chaos
 *                        workflows point at.
 *   POST /effect/slow    same, but holds the response — used to force a crash in
 *                        the window between "call received" and "state written".
 *   GET  /calls          every call, in order, with keys and timestamps.
 *   GET  /duplicates     keys seen more than once. THE assertion.
 *   POST /reset          clear between scenarios.
 *
 * Usage:
 *   node scripts/chaos/side-effect-recorder.mjs --port 18090
 */

import http from 'node:http';

const args = Object.fromEntries(
  process.argv.slice(2).flatMap((a, i, all) =>
    a.startsWith('--') ? [[a.slice(2), all[i + 1]]] : []),
);

const PORT = Number(args.port ?? process.env.RECORDER_PORT ?? 18090);
const SLOW_MS = Number(args['slow-ms'] ?? 5_000);

/** Every call received, in arrival order. Never mutated, only appended. */
let calls = [];
/** Sockets held open by /effect/slow, so shutdown does not hang. */
const parked = new Set();

const readBody = (req) =>
  new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', () => resolve(''));
  });

const json = (res, status, obj) => {
  const body = Buffer.from(JSON.stringify(obj), 'utf8');
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': body.length });
  res.end(body);
};

/**
 * The key the worker sent.
 *
 * Read from the header first — that is the value passed through to real
 * providers for native dedupe, so checking it also verifies the pass-through
 * actually happens. Falls back to the body for calls that carry it there.
 */
function extractKey(req, body) {
  const header = req.headers['idempotency-key'] || req.headers['x-idempotency-key'];
  if (header) return String(header);
  try {
    const parsed = JSON.parse(body || '{}');
    return parsed.idempotencyKey ?? parsed.key ?? null;
  } catch {
    return null;
  }
}

function duplicates() {
  const byKey = new Map();
  for (const c of calls) {
    if (!c.key) continue;              // unkeyed calls cannot be judged
    byKey.set(c.key, (byKey.get(c.key) ?? 0) + 1);
  }
  return [...byKey.entries()]
    .filter(([, n]) => n > 1)
    .map(([key, count]) => ({ key, count, calls: calls.filter((c) => c.key === key) }));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === '/calls') {
    return json(res, 200, { calls, total: calls.length });
  }

  if (url.pathname === '/duplicates') {
    const dups = duplicates();
    const unkeyed = calls.filter((c) => !c.key).length;
    return json(res, 200, {
      duplicateKeys: dups.length,
      duplicateCalls: dups.reduce((a, d) => a + (d.count - 1), 0),
      totalCalls: calls.length,
      unkeyedCalls: unkeyed,
      details: dups,
    });
  }

  if (url.pathname === '/reset') {
    calls = [];
    return json(res, 200, { ok: true });
  }

  if (url.pathname.startsWith('/effect')) {
    const body = await readBody(req);
    const key = extractKey(req, body);

    // Recorded BEFORE any delay or response, so a call that the worker never
    // sees the answer to is still counted. That is the whole point: the
    // dangerous duplicate is the one whose first attempt succeeded silently.
    const call = {
      seq: calls.length + 1,
      key,
      at: new Date().toISOString(),
      path: url.pathname,
      bytes: body.length,
    };
    calls.push(call);
    console.log(`[recorder] call #${call.seq} key=${key ?? 'NONE'} path=${url.pathname}`);

    if (url.pathname === '/effect/slow') {
      // Hold the response open. The chaos driver kills the worker during this
      // window — the side effect has happened, the worker will never learn it.
      parked.add(res);
      setTimeout(() => {
        parked.delete(res);
        try { json(res, 200, { ok: true, seq: call.seq, key }); } catch { /* client gone */ }
      }, SLOW_MS).unref();
      return;
    }

    return json(res, 200, { ok: true, seq: call.seq, key });
  }

  if (url.pathname === '/healthz') return json(res, 200, { ok: true });
  return json(res, 404, { error: 'unknown route' });
});

server.requestTimeout = 0;
server.setTimeout(0);

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[recorder] side-effect oracle on http://127.0.0.1:${PORT} (slow=${SLOW_MS}ms)`);
});

const shutdown = () => {
  for (const res of parked) { try { res.destroy(); } catch { /* ignore */ } }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 500).unref();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
