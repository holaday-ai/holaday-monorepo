import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { resolveOrdinaryMaintenanceMode } from './ordinary-maintenance-mode.js';

const directories: string[] = [];
const candidate = 'a'.repeat(40);
function fixture() {
  const root = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'hm-mode-')));
  directories.push(root);
  const directory = join(root, 'ordinary');
  fs.mkdirSync(directory, { mode: 0o700 });
  fs.writeFileSync(
    join(directory, 'state.json'),
    `${JSON.stringify({ schemaVersion: 1, candidate, bootId: 'b'.repeat(32), mode: 'closed', needsReconciliation: false })}\n`,
    { mode: 0o600 },
  );
  return { root, directory };
}
afterEach(() => {
  for (const path of directories.splice(0)) fs.rmSync(path, { recursive: true });
});
it('retains unconfigured legacy behavior only when no durable directory exists', () => {
  const f = fixture();
  expect(resolveOrdinaryMaintenanceMode({}, join(f.root, 'missing'))).toBe(false);
  expect(() => resolveOrdinaryMaintenanceMode({}, f.directory)).toThrow(
    'MAINTENANCE_CONFIGURATION_REQUIRED',
  );
});
it('validates the real marker before permitting maintenance module imports', () => {
  const f = fixture();
  const env = { HOLADAY_ORDINARY_MAINTENANCE: '1', HOLADAY_ORDINARY_CANDIDATE: candidate };
  expect(resolveOrdinaryMaintenanceMode(env, f.directory)).toBe(true);
  fs.writeFileSync(join(f.directory, 'state.json'), '{}');
  expect(() => resolveOrdinaryMaintenanceMode(env, f.directory)).toThrow(
    'MAINTENANCE_STATE_UNAVAILABLE',
  );
});
it.each(['HOLADAY_POOL_BOOT', 'HOLADAY_POOL_CANDIDATE'])(
  'rejects mixed metadata %s before imports',
  (field) => {
    const f = fixture();
    expect(() =>
      resolveOrdinaryMaintenanceMode(
        { HOLADAY_ORDINARY_MAINTENANCE: '1', HOLADAY_ORDINARY_CANDIDATE: candidate, [field]: '' },
        f.directory,
      ),
    ).toThrow('MAINTENANCE_MODE_CONFLICT');
  },
);
it.each(['', '0', 'true'])('does not allow invalid flag %s to choose legacy', (value) => {
  const f = fixture();
  expect(() =>
    resolveOrdinaryMaintenanceMode(
      { HOLADAY_ORDINARY_MAINTENANCE: value },
      join(f.root, 'missing'),
    ),
  ).toThrow('MAINTENANCE_CONFIGURATION_REQUIRED');
});
it('rejects a missing required directory and malformed candidate', () => {
  const f = fixture();
  expect(() =>
    resolveOrdinaryMaintenanceMode(
      { HOLADAY_ORDINARY_MAINTENANCE: '1', HOLADAY_ORDINARY_CANDIDATE: candidate },
      join(f.root, 'missing'),
    ),
  ).toThrow();
  expect(() =>
    resolveOrdinaryMaintenanceMode(
      { HOLADAY_ORDINARY_MAINTENANCE: '1', HOLADAY_ORDINARY_CANDIDATE: 'main' },
      f.directory,
    ),
  ).toThrow();
});
