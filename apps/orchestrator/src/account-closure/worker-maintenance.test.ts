import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { readOrdinaryMaintenanceRecord } from '../execution/ordinary-maintenance-store.js';
import { runAccountClosureWorkerRuntime } from './worker.js';

const paths: string[] = [];
const identity = { candidate: 'a'.repeat(40), bootId: 'b'.repeat(32) };
function fixture() {
  const directory = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'hm-worker-')));
  paths.push(directory);
  fs.chmodSync(directory, 0o700);
  const write = (mode: string) =>
    fs.writeFileSync(
      join(directory, 'state.json'),
      `${JSON.stringify({
        schemaVersion: 1,
        ...identity,
        mode,
        needsReconciliation: mode !== 'closed',
      })}\n`,
      { mode: 0o600 },
    );
  write('closed');
  return {
    directory,
    write,
    stopRequested: () => readOrdinaryMaintenanceRecord(directory).mode !== 'serving',
  };
}
afterEach(() => {
  vi.useRealTimers();
  for (const path of paths.splice(0)) fs.rmSync(path, { recursive: true });
});
it('does not claim a page when the durable marker is closed', async () => {
  const f = fixture();
  const tick = vi.fn(async () => 'idle' as const);
  const signals = new EventEmitter();
  const running = runAccountClosureWorkerRuntime({
    tick,
    pollMs: 1,
    signals,
    maintenanceRequested: f.stopRequested,
  });
  await new Promise<void>((resolve) => setTimeout(resolve, 10));
  signals.emit('SIGTERM');
  await running;
  expect(tick).not.toHaveBeenCalled();
});
it('waits for the original page then exits without claiming another when marker closes', async () => {
  const f = fixture();
  f.write('serving');
  let finish!: () => void;
  const held = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const tick = vi.fn(async () => {
    await held;
    return 'progress' as const;
  });
  const signals = new EventEmitter();
  let exited = false;
  const running = runAccountClosureWorkerRuntime({
    tick,
    pollMs: 1,
    signals,
    maintenanceRequested: f.stopRequested,
  }).then(() => {
    exited = true;
  });
  await vi.waitFor(() => expect(tick).toHaveBeenCalledOnce());
  f.write('draining');
  await Promise.resolve();
  expect(exited).toBe(false);
  finish();
  await new Promise<void>((resolve) => setTimeout(resolve, 10));
  const exitedOnMarker = exited;
  signals.emit('SIGTERM');
  await running;
  expect(exitedOnMarker).toBe(true);
  expect(tick).toHaveBeenCalledOnce();
});
it.each(['missing', 'corrupt', 'symlink', 'permissions'])(
  'rejects %s marker instead of admitting work',
  (kind) => {
    const f = fixture();
    const state = join(f.directory, 'state.json');
    if (kind === 'missing') fs.unlinkSync(state);
    if (kind === 'corrupt') fs.writeFileSync(state, '{}');
    if (kind === 'permissions') fs.chmodSync(state, 0o644);
    if (kind === 'symlink') {
      fs.renameSync(state, join(f.directory, 'target'));
      fs.symlinkSync('target', state);
    }
    expect(() => readOrdinaryMaintenanceRecord(f.directory)).toThrow(
      'MAINTENANCE_STATE_UNAVAILABLE',
    );
  },
);
