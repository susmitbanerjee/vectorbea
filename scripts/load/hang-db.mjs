#!/usr/bin/env node
/**
 * A tenant database that accepts and then never answers.
 *
 * This is the failure the timeout audit exists for, and it is specifically NOT
 * "the host is down". A refused connection is easy: the driver fails in
 * milliseconds and the run fails cleanly. The dangerous shape is the one below —
 * the TCP handshake completes, the driver sends its startup packet, and then
 * nothing ever comes back. Without a driver-level `socketTimeout` the JDBC read
 * blocks forever, and the pool thread holding it is an execution slot the
 * platform never gets back.
 *
 * Modes:
 *   --mode accept   (default) complete the handshake, read the startup packet,
 *                   never write a byte. The realistic "firewalled egress" and
 *                   "database wedged" case.
 *   --mode drop     accept and immediately stop reading, never write. Same
 *                   client-visible behaviour, different kernel-buffer dynamics.
 *   --mode slowloris answer with one byte every --drip ms, forever. Defeats a
 *                   naive "first byte received" timeout while still never
 *                   completing a protocol message.
 *
 * Usage:
 *   node scripts/load/hang-db.mjs --port 15433
 */

import net from 'node:net';

const args = Object.fromEntries(
  process.argv.slice(2).flatMap((a, i, all) =>
    a.startsWith('--') ? [[a.slice(2), all[i + 1]]] : []),
);

const PORT = Number(args.port ?? process.env.HANG_DB_PORT ?? 15433);
const MODE = args.mode ?? 'accept';
const DRIP_MS = Number(args.drip ?? 5_000);

let accepted = 0;
let open = 0;
const sockets = new Set();

const server = net.createServer((socket) => {
  accepted += 1;
  open += 1;
  sockets.add(socket);
  const id = accepted;
  console.log(`[hang-db] connection #${id} accepted (open=${open}, mode=${MODE})`);

  socket.on('error', () => { /* the client giving up is the expected outcome */ });
  socket.on('close', () => {
    open -= 1;
    sockets.delete(socket);
    console.log(`[hang-db] connection #${id} closed by peer (open=${open})`);
  });

  if (MODE === 'drop') {
    socket.pause();
    return;
  }

  if (MODE === 'slowloris') {
    const timer = setInterval(() => {
      if (socket.destroyed) return clearInterval(timer);
      try { socket.write('\0'); } catch { clearInterval(timer); }
    }, DRIP_MS);
    socket.on('close', () => clearInterval(timer));
    return;
  }

  // MODE === 'accept': drain whatever the driver sends (the startup packet),
  // acknowledge nothing.
  socket.on('data', (buf) => {
    console.log(`[hang-db] connection #${id} sent ${buf.length} bytes — ignoring`);
  });
});

server.on('error', (err) => {
  console.error(`[hang-db] server error: ${err.message}`);
  process.exit(1);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[hang-db] black-hole database listening on 127.0.0.1:${PORT} (mode=${MODE})`);
});

// Report so the harness can assert how many connections the hang consumed.
process.on('SIGUSR2', () => console.log(`[hang-db] stats accepted=${accepted} open=${open}`));

const shutdown = () => {
  console.log(`[hang-db] shutting down — accepted=${accepted} stillOpen=${open}`);
  for (const s of sockets) { try { s.destroy(); } catch { /* ignore */ } }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 500).unref();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
