import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const sourceDirectory = fileURLToPath(new URL('.', import.meta.url));

async function copyModuleClosure(directory, name, copied = new Set()) {
  if (copied.has(name)) return;
  assert.match(name, /^[a-zA-Z0-9.-]+\.mjs$/);
  copied.add(name);
  const source = await fs.readFile(join(sourceDirectory, name), 'utf8');
  await fs.writeFile(join(directory, name), source);
  for (const match of source.matchAll(
    /(?:from\s*|import\s*\()\s*['"]\.\/([a-zA-Z0-9.-]+\.mjs)['"]/g,
  )) {
    await copyModuleClosure(directory, match[1], copied);
  }
}

async function cliFixture(t) {
  const directory = await fs.mkdtemp(join(await fs.realpath(tmpdir()), 'cutover-cli-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await copyModuleClosure(directory, 'browser-first-cutover-host.mjs');
  const path = join(directory, 'browser-first-cutover-host.mjs');
  let source = await fs.readFile(path, 'utf8');
  // Substitute only read-only prerequisites. Keep the real CLI and the real
  // site's back-import, and exit before constructing any lifecycle adapter.
  const identity = 'const handle = await createFirstCutoverCoordinatorIdentity(';
  assert.equal(source.split(identity).length, 2);
  source = source.replace(identity, 'const handle = await fixtureIdentity(');
  const approval = 'const approval = await readFirstCutoverApproval({ attempt });';
  assert.equal(source.split(approval).length, 2);
  source = source.replace(approval, 'const approval = {};');
  const site = '        const site = createFirstCutoverExecutionSite(';
  assert.equal(source.split(site).length, 2);
  source = source.replace(
    site,
    "        process.stdout.write('CLI_IMPORT_READY\\n');\n        process.exit(0);\n" + site,
  );
  source =
    "async function fixtureIdentity() { return { readExecutionIdentity: async () => ({ binding: { candidate: 'a'.repeat(40) }, toolDigest: 'b'.repeat(64) }), close() {} }; }\n" +
    source;
  await fs.writeFile(path, source);
  return (mode) =>
    spawnSync(process.execPath, [path, mode, '81f4c9e3-ec69-4c43-82cb-b19ff3e59d8a'], {
      encoding: 'utf8',
      timeout: 10000,
      env: {
        PATH: process.env.PATH,
        NODE_OPTIONS: '--max-old-space-size=192 --v8-pool-size=1',
        UV_THREADPOOL_SIZE: '1',
      },
    });
}

test('execute CLI resolves the real site back-import before lifecycle effects', async (t) => {
  const child = (await cliFixture(t))('--execute');
  assert.equal(child.error, undefined);
  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.stdout, 'CLI_IMPORT_READY\n');
});

test('check CLI remains source-only and does not enter the site lifecycle', async (t) => {
  const child = (await cliFixture(t))('--check');
  assert.equal(child.error, undefined);
  assert.equal(child.status, 0, child.stderr);
  const result = JSON.parse(child.stdout);
  assert.equal(result.kind, 'coordinator-source-inspection');
  assert.equal(result.releaseReady, false);
});

test('invalid CLI mode still rejects before coordinator or lifecycle work', async (t) => {
  const child = (await cliFixture(t))('--invalid');
  assert.equal(child.error, undefined);
  assert.equal(child.status, 1);
  assert.equal(child.stdout, '');
  assert.equal(child.stderr, 'CUTOVER_COORDINATOR_USAGE\n');
});

test('diagnose preparation CLI resolves the actual site before any diagnostic lifecycle work', async (t) => {
  const child = (await cliFixture(t))('--diagnose-prepare');
  assert.equal(child.error, undefined);
  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.stdout, 'CLI_IMPORT_READY\n');
});
