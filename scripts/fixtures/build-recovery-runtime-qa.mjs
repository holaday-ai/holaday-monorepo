// QA staging of the ORIGINAL migration runner and readers, not an installer or
// release approval. A production tool closure still needs independent review.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from '../../node_modules/.pnpm/esbuild@0.25.12/node_modules/esbuild/lib/main.js';
import { readFirstCutoverRecoveryRuntime } from '../browser-first-cutover-recovery-runtime.mjs';
import { buildMaintenanceMigrationManifest } from '../browser-maintenance-manifest.mjs';

const source = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const [nodeBinary] = process.argv.slice(2);
assert.ok(nodeBinary?.startsWith('/'));
const root = await realpath(await mkdtemp(join(tmpdir(), 'holaday-recovery-pack-')));
for (const dir of [
  'apps',
  'apps/orchestrator',
  'apps/orchestrator/scripts',
  'apps/orchestrator/drizzle',
])
  await mkdir(join(root, dir), { mode: 0o700 });
const files = [
  'node',
  'recovery-tool.mjs',
  'apps/orchestrator/scripts/apply-numbered-migrations.mjs',
  'apps/orchestrator/scripts/apply-numbered-migrations.ts',
  'apps/orchestrator/scripts/release-db-contract.mjs',
];
const sql = (await readdir(join(source, 'apps/orchestrator/drizzle')))
  .filter((v) => /^\d{4}_.+\.sql$/.test(v))
  .sort();
assert.equal(sql.length, 61);
files.push(...sql.map((v) => `apps/orchestrator/drizzle/${v}`));
await copyFile(nodeBinary, join(root, 'node'));
for (const file of files.slice(3)) await copyFile(join(source, file), join(root, file));
const common = {
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  logLevel: 'silent',
  banner: {
    js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);',
  },
};
await build({
  ...common,
  entryPoints: [join(source, 'scripts/browser-first-cutover-recovery-tool.mjs')],
  outfile: join(root, 'recovery-tool.mjs'),
});
await build({
  ...common,
  entryPoints: [join(source, 'apps/orchestrator/scripts/apply-numbered-migrations.ts')],
  outfile: join(root, 'apps/orchestrator/scripts/apply-numbered-migrations.mjs'),
});
const hashes = {};
for (const name of files) {
  await chmod(join(root, name), name === 'node' ? 0o700 : 0o600);
  hashes[name] = createHash('sha256')
    .update(await readFile(join(root, name)))
    .digest('hex');
}
const migrationDigest = buildMaintenanceMigrationManifest(root).sha256;
assert.equal(migrationDigest, buildMaintenanceMigrationManifest(source).sha256);
const bytes = JSON.stringify({ schemaVersion: 1, migrationDigest, files: hashes });
await writeFile(join(root, 'runtime.json'), bytes, { mode: 0o600, flag: 'wx' });
const runtimeDigest = createHash('sha256').update(bytes).digest('hex');
await readFirstCutoverRecoveryRuntime({ root, runtimeDigest, migrationDigest });
console.log(JSON.stringify({ root, runtimeDigest, migrationDigest, migrations: sql.length }));
