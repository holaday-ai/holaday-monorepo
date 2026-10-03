import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildMaintenanceMigrationManifest } from './browser-maintenance-manifest.mjs';
function fixture(t) {
  const root = fs.mkdtempSync('/tmp/hm-manifest-');
  const app = path.join(root, 'apps/orchestrator');
  fs.mkdirSync(path.join(app, 'drizzle'), { recursive: true });
  fs.mkdirSync(path.join(app, 'scripts'));
  fs.writeFileSync(path.join(app, 'scripts/apply-numbered-migrations.ts'), 'runner');
  t.after(() => fs.rmSync(root, { recursive: true }));
  return { root, app };
}
test('manifest includes every replayed numbered SQL, including 0042, and hashes runner/content', (t) => {
  const { root, app } = fixture(t);
  for (const name of ['0060_cost.sql', '0042_payments.sql', '0059_identity.sql'])
    fs.writeFileSync(path.join(app, 'drizzle', name), name);
  fs.writeFileSync(path.join(app, 'drizzle', 'README.md'), 'ignored');
  const before = buildMaintenanceMigrationManifest(root);
  assert.deepEqual(
    before.manifest.migrations.map((f) => f.name),
    ['0042_payments.sql', '0059_identity.sql', '0060_cost.sql'],
  );
  assert.equal(before.manifest.replaysNumberedSql, true);
  fs.appendFileSync(path.join(app, 'drizzle/0042_payments.sql'), 'changed');
  assert.notEqual(buildMaintenanceMigrationManifest(root).sha256, before.sha256);
  const sqlChanged = buildMaintenanceMigrationManifest(root);
  fs.appendFileSync(path.join(app, 'scripts/apply-numbered-migrations.ts'), 'changed');
  assert.notEqual(buildMaintenanceMigrationManifest(root).sha256, sqlChanged.sha256);
});
test('empty/duplicate migration numbers and symlink SQL cannot become an approved manifest', (t) => {
  const { root, app } = fixture(t);
  assert.throws(() => buildMaintenanceMigrationManifest(root), /MAINTENANCE_MIGRATIONS_UNPROVEN/);
  fs.writeFileSync(path.join(app, 'drizzle/0042_a.sql'), 'a');
  fs.writeFileSync(path.join(app, 'drizzle/0042_b.sql'), 'b');
  assert.throws(() => buildMaintenanceMigrationManifest(root), /MAINTENANCE_MIGRATIONS_UNPROVEN/);
  fs.unlinkSync(path.join(app, 'drizzle/0042_b.sql'));
  fs.symlinkSync('0042_a.sql', path.join(app, 'drizzle/0059_c.sql'));
  assert.throws(() => buildMaintenanceMigrationManifest(root), /MAINTENANCE_MIGRATIONS_UNPROVEN/);
});
