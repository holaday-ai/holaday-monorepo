import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  mode: 'closed',
  tick: vi.fn(async () => 'idle' as const),
  end: vi.fn(async () => {}),
}));
vi.mock('../execution/ordinary-maintenance-mode.js', () => ({
  ORDINARY_MAINTENANCE_DIRECTORY: '/synthetic-maintenance',
  resolveOrdinaryMaintenanceMode: () => true,
}));
vi.mock('../execution/ordinary-maintenance-store.js', () => ({
  readOrdinaryMaintenanceRecord: () => ({
    identity: { candidate: 'a'.repeat(40), bootId: 'b'.repeat(32) },
    mode: state.mode,
    needsReconciliation: state.mode !== 'closed',
  }),
}));
vi.mock('../auth/email-code.js', () => ({ privateResendSender: {} }));
vi.mock('../config/env.js', () => ({ env: { ACCOUNT_CLOSURE_WORKER_ENABLED: true } }));
vi.mock('../config/logger.js', () => ({ logger: { info() {} } }));
vi.mock('../db/client.js', () => ({ db: {}, pool: { end: state.end } }));
vi.mock('../files/storage-provider.js', async (original) => ({
  ...(await original<typeof import('../files/storage-provider.js')>()),
  getSharedStorageProvider: () => ({}),
}));
vi.mock('./handler-registry.js', () => ({ ACCOUNT_CLOSURE_HANDLERS: [] }));
vi.mock('./sms-gateway-client.js', () => ({ SmsGatewayClient: class {} }));
vi.mock('./worker.js', async (original) => ({
  ...(await original<typeof import('./worker.js')>()),
  runAccountClosureWorkerTick: state.tick,
}));
beforeEach(() => {
  vi.resetModules();
  state.tick.mockClear();
  state.end.mockClear();
  state.mode = 'closed';
  vi.stubEnv('HOLADAY_ORDINARY_CANDIDATE', 'a'.repeat(40));
});
afterEach(() => vi.unstubAllEnvs());
it('the actual entry closes DB without claiming work when maintenance is closed', async () => {
  await import('./worker-entry.js');
  expect(state.tick).not.toHaveBeenCalled();
  expect(state.end).toHaveBeenCalledOnce();
});
it('the actual entry waits for its current page before closing DB on a maintenance marker', async () => {
  state.mode = 'serving';
  let done!: () => void;
  const held = new Promise<void>((resolve) => {
    done = resolve;
  });
  state.tick.mockImplementationOnce(async () => {
    await held;
    return 'idle';
  });
  const running = import('./worker-entry.js');
  await vi.waitFor(() => expect(state.tick).toHaveBeenCalledOnce());
  state.mode = 'draining';
  expect(state.end).not.toHaveBeenCalled();
  done();
  await running;
  expect(state.tick).toHaveBeenCalledOnce();
  expect(state.end).toHaveBeenCalledOnce();
});
