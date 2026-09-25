// Explicit synthetic child fixture. Never imported by production entrypoints.
import fs from 'node:fs';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import express from 'express';
import { createOrdinaryApplication } from '../src/execution/ordinary-application.js';
import { createHttpDrain } from '../src/execution/http-drain.js';
import { currentOperationLifetime, startOwnedOperation } from '../src/execution/owned-operation.js';
import { createWsServer, sendExtensionToolCall } from '../src/ws/server.js';
import { runAccountClosureWorkerRuntime } from '../src/account-closure/worker.js';
import { readOrdinaryMaintenanceRecord } from '../src/execution/ordinary-maintenance-store.js';

if (process.env.HOLADAY_MAINTENANCE_SYNTHETIC_CHILD !== '1' || !process.send)
  throw new Error('SYNTHETIC_CHILD_ONLY');
const [directory, scenario = 'normal'] = process.argv.slice(2);
const identity = { candidate: 'a'.repeat(40), bootId: 'b'.repeat(32) };
const send = (value: object) => process.send?.(value);
const events: string[] = [];
const event = (name: string) => {
  events.push(name);
  send({ event: name });
};
let writes = 0;
let release!: () => void;
const held = new Promise<void>((resolve) => {
  release = resolve;
});
const records = [
  { status: 'paused', result: { text: 'keep paused' } },
  { status: 'awaiting_user', result: { text: 'keep awaiting' } },
];
const application = createOrdinaryApplication({ directory, identity, verifyReady: async () => {} });
const m = application.coordinator;
application.bind({
  prepareServing: async () => {},
  startProducers() {},
  stopProducers: async () => {},
  verifyRetainedQueue: async () => {
    if (scenario === 'queue') throw new Error('MAINTENANCE_QUEUE_UNPROVEN');
  },
});
await application.startControl();
await m.resumeServing();
const websocket = createWsServer(0, {
  executionDrain: m,
  ordinaryMaintenance: m,
  authenticateToken: async (token) => token,
});
await websocket.ready;
const wsAddress = websocket.wss.address();
if (!wsAddress || typeof wsAddress === 'string') throw new Error('SYNTHETIC_ADDRESS');
const app = express();
const scope = createHttpDrain(m);
app.get('/healthz', (_req, res) => res.json({ status: 'ok' }));
app.use(scope.admit, scope.middleware(express.json()));
app.post(
  '/task',
  scope.handler(async (req, res) => {
    writes++;
    event('accepted');
    const parent = currentOperationLifetime();
    if (!parent) throw new Error('MISSING_HTTP_OWNER');
    const child = startOwnedOperation(
      m.drain,
      'execution',
      async () => {
        const result = await sendExtensionToolCall('synthetic-owner', {
          taskId: 'synthetic-task',
          kind: 'tabs',
          extensionClientId: req.body.clientId,
        });
        if (!result.ok) throw new Error('SYNTHETIC_RECEIPT_FAILED');
        event('original-receipt');
        await held;
      },
      { parent: parent.owner, errorOutcome: 'unknown', dispatch: 'immediate' },
    );
    void child.result.then(
      () => event('child-finished'),
      () => event('child-failed'),
    );
    res.status(202).json({ accepted: true });
  }),
);
app.post(
  '/payment/callback',
  scope.handler(async (_req, res) => {
    writes++;
    res.json({ ok: true });
  }),
);
const http = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
  const server = app.listen(0, '127.0.0.1', () => resolve(server));
});
const address = http.address();
if (!address || typeof address === 'string') throw new Error('SYNTHETIC_ADDRESS');
let workerExited = scenario !== 'worker';
if (scenario === 'worker') {
  void runAccountClosureWorkerRuntime({
    signals: new EventEmitter(),
    pollMs: 1,
    maintenanceRequested: () => readOrdinaryMaintenanceRecord(directory).mode !== 'serving',
    tick: async () => {
      event('worker-page');
      await held;
      return 'progress';
    },
  }).then(() => {
    workerExited = true;
    event('worker-exited');
  });
}
process.on('message', async (message: { id: number; op: string }) => {
  try {
    if (message.op === 'release') release();
    if (message.op === 'snapshot') {
      send({ id: message.id, snapshot: m.snapshot(), writes, records, events, workerExited });
      return;
    }
    if (message.op === 'replace-boot') {
      const path = join(directory, 'state.json');
      fs.writeFileSync(
        path,
        fs.readFileSync(path, 'utf8').replace(identity.bootId, 'c'.repeat(32)),
      );
    }
    if (message.op === 'rename-fail')
      fs.renameSync = () => {
        throw new Error('synthetic EIO');
      };
    if (message.op === 'shutdown') {
      await application.closeControl();
      await m.retire(async () => {
        await websocket.close();
        await new Promise<void>((resolve, reject) =>
          http.close((error) => (error ? reject(error) : resolve())),
        );
      });
      application.closeState();
      event('listeners-closed');
      send({ id: message.id, ok: true });
      process.disconnect();
      return;
    }
    send({ id: message.id, ok: true });
  } catch {
    send({ id: message.id, error: 'SYNTHETIC_COMMAND_REFUSED' });
  }
});
send({ event: 'ready', httpPort: address.port, wsPort: wsAddress.port, identity });
