import { createServer } from 'node:http';
import mysql, { type RowDataPacket } from 'mysql2/promise';
import type { RecoveryCommand } from './ws-recovery-process.js';

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

const { pool, db } = await import('../db/client.js');
const { createHttpApp } = await import('../http.js');
const {
  createWsServer,
  loadRehydratedTasks,
  getConnectedExtensionClientIds,
  sendExtensionToolCall,
  broadcastToUser,
} = await import('../ws/server.js');
// This covers the legacy recovery boot used without controlled maintenance.
// Controlled boot reconciliation is separate; do not fabricate its opening authority here.
// Use the same legacy startup SQL sweep as application-main before hydration.
// This still deliberately does not start production producers or Linux-native boot.
const { failStaleTasksWithEvents } = await import('../agent/task-maintenance.js');
await failStaleTasksWithEvents(db, {
  source: 'boot_sweep',
  sourceStatuses: ['pending', 'planning', 'queued', 'executing'],
  staleBy: 'createdAt',
  cutoff: new Date(Date.now() - 2 * 60_000),
  errorCode: 'ORCHESTRATOR_RESTART',
  errorMessage: '服务重启导致任务中断，重新发送一次即可。',
});
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

// Test-only coordinator over the parent's private IPC. Product auth/tool handlers are unchanged.
process.on('message', (raw) => {
  if (
    !raw ||
    typeof raw !== 'object' ||
    !('type' in raw) ||
    raw.type !== 'command' ||
    !('id' in raw) ||
    typeof raw.id !== 'string'
  )
    return;
  const command = raw as unknown as { id: string } & RecoveryCommand;
  const execute = async () => {
    if (command.op === 'extensions') return getConnectedExtensionClientIds(command.userId);
    if (command.op === 'tool') return sendExtensionToolCall(command.userId, command.options);
    if (command.op === 'cancel') {
      const { db } = await import('../db/client.js');
      const { tasks } = await import('../db/schema/tasks.js');
      const { users } = await import('../db/schema/users.js');
      const { and, eq } = await import('drizzle-orm');
      const [owned] = await db
        .select({ id: tasks.id })
        .from(tasks)
        .innerJoin(users, eq(tasks.userId, users.id))
        .where(and(eq(tasks.externalId, command.taskId), eq(users.externalId, command.userId)))
        .limit(1);
      if (!owned) throw new Error('RECOVERY_TASK_NOT_OWNED');
      const { TaskRepository } = await import('../agent/task-repository.js');
      const receipt = await new TaskRepository(db).persistVisionOutcome(command.taskId, {
        status: 'cancelled',
        tickCount: 0,
      });
      if (receipt.persisted)
        broadcastToUser(command.userId, {
          type: 'server.task.control',
          taskId: command.taskId,
          command: 'cancel',
        });
      return receipt;
    }
    throw new Error('RECOVERY_COMMAND_INVALID');
  };
  void execute().then(
    (result) => {
      if (process.connected) process.send?.({ type: 'reply', id: command.id, ok: true, result });
    },
    () => {
      if (process.connected)
        process.send?.({
          type: 'reply',
          id: command.id,
          ok: false,
          error: 'RECOVERY_COMMAND_FAILED',
        });
    },
  );
});
