import { createServer } from 'node:http';
import mysql, { type RowDataPacket } from 'mysql2/promise';

// Validate the parent's ownership before importing application modules or creating their pool.
if (
  !process.send ||
  process.env.HOLADAY_PROCESS_RECOVERY_PROBE !== '1' ||
  process.env.HOLADAY_SQL_PERSISTENCE_PROBE !== '1'
)
  throw new Error('Recovery child requires an explicit parent-owned SQL probe');
const value = process.env.HOLADAY_SQL_TEST_URL;
if (!value || process.env.DATABASE_URL !== value)
  throw new Error('Recovery child database mismatch');
const url = new URL(value);
if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.pathname !== '/holaday_it')
  throw new Error('Recovery child requires exact loopback test schema');
const guard = await mysql.createConnection(value);
try {
  const [marker] = await guard.query<RowDataPacket[]>('SELECT token FROM codex_probe_owner');
  if (
    !process.env.HOLADAY_SQL_PROBE_OWNER ||
    marker.length !== 1 ||
    marker[0]?.token !== process.env.HOLADAY_SQL_PROBE_OWNER
  )
    throw new Error('Recovery child namespace ownership mismatch');
} finally {
  await guard.end();
}

const { pool } = await import('../db/client.js');
const { createHttpApp } = await import('../http.js');
const { createWsServer, loadRehydratedTasks } = await import('../ws/server.js');
// This covers the legacy recovery boot used without controlled maintenance.
// Controlled boot reconciliation is separate; do not fabricate its opening authority here.
const rehydrated = await loadRehydratedTasks();
const app = createHttpApp({
  planner: {
    async plan() {
      throw new Error('Recovery readback must not invoke a planner');
    },
    async healSelector() {
      throw new Error('Recovery readback must not invoke a model');
    },
  } as never,
});
const http = createServer((req, res) => {
  if (req.url?.startsWith('/api/')) req.url = req.url.slice(4);
  app(req, res);
});
await new Promise<void>((resolve, reject) => {
  http.once('error', reject);
  http.listen(Number(process.env.HOLADAY_QA_HTTP_PORT || 0), '127.0.0.1', resolve);
});
const ws = createWsServer(Number(process.env.HOLADAY_QA_WS_PORT || 0));
await ws.ready;
const httpAddress = http.address();
const wsAddress = ws.wss.address();
if (!httpAddress || !wsAddress || typeof httpAddress === 'string' || typeof wsAddress === 'string')
  throw new Error('No recovery listener address');
process.send({
  type: 'ready',
  pid: process.pid,
  node: process.version,
  httpPort: httpAddress.port,
  wsPort: wsAddress.port,
  rehydrated,
});
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  const deadline = setTimeout(() => process.exit(1), 5000);
  deadline.unref();
  try {
    for (const socket of ws.wss.clients) socket.terminate();
    await ws.close();
    http.closeAllConnections();
    await new Promise<void>((resolve) => http.close(() => resolve()));
    await pool.end();
    process.exit(0);
  } catch {
    process.exit(1);
  }
}
process.once('SIGTERM', () => {
  void close();
});
process.once('SIGINT', () => {
  void close();
});
process.once('disconnect', () => {
  void close();
});
