import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as evidence from './browser-cutover-evidence.mjs';
const original = Buffer.from(
  'aW1wb3J0IHsgdHlwZSBMb2dnZXJPcHRpb25zLCBwaW5vIH0gZnJvbSAncGlubyc7CmltcG9ydCB7IGVudiB9IGZyb20gJy4vZW52LmpzJzsKCmV4cG9ydCBjb25zdCBsb2dnZXJPcHRpb25zID0gewogIGxldmVsOiBlbnYuTE9HX0xFVkVMLAogIGJhc2U6IHsgc2VydmljZTogJ29yY2hlc3RyYXRvcicgfSwKICB0aW1lc3RhbXA6IHBpbm8uc3RkVGltZUZ1bmN0aW9ucy5pc29UaW1lLAogIHJlZGFjdDogewogICAgcGF0aHM6IFsKICAgICAgJ3JlcS5oZWFkZXJzLmF1dGhvcml6YXRpb24nLAogICAgICAncmVxLmhlYWRlcnMuY29va2llJywKICAgICAgJ3JlcS5oZWFkZXJzWyJwcm94eS1hdXRob3JpemF0aW9uIl0nLAogICAgICAncmVxLmhlYWRlcnNbIngtYXBpLWtleSJdJywKICAgICAgJ3JlcS5oZWFkZXJzWyJhcGkta2V5Il0nLAogICAgICAncmVzLmhlYWRlcnNbInNldC1jb29raWUiXScsCiAgICAgICdyZXMuaGVhZGVycy5sb2NhdGlvbicsCiAgICBdLAogICAgY2Vuc29yOiAnW1JlZGFjdGVkXScsCiAgfSwKfSBzYXRpc2ZpZXMgTG9nZ2VyT3B0aW9uczsKCmV4cG9ydCBjb25zdCBsb2dnZXIgPSBwaW5vKGxvZ2dlck9wdGlvbnMpOwoKZXhwb3J0IHR5cGUgTG9nZ2VyID0gdHlwZW9mIGxvZ2dlcjsK',
  'base64',
).toString('utf8');
const patched = Buffer.from(
  'aW1wb3J0IHsgdHlwZSBMb2dnZXJPcHRpb25zLCBwaW5vIH0gZnJvbSAncGlubyc7CmltcG9ydCB7IGVudiB9IGZyb20gJy4vZW52LmpzJzsKCmV4cG9ydCBjb25zdCBsb2dnZXJPcHRpb25zID0gewogIGxldmVsOiBlbnYuTE9HX0xFVkVMLAogIGJhc2U6IHsgc2VydmljZTogJ29yY2hlc3RyYXRvcicgfSwKICB0aW1lc3RhbXA6IHBpbm8uc3RkVGltZUZ1bmN0aW9ucy5pc29UaW1lLAogIHJlZGFjdDogewogICAgcGF0aHM6IFsKICAgICAgJ3JlcS5oZWFkZXJzLmF1dGhvcml6YXRpb24nLAogICAgICAncmVxLmhlYWRlcnMuY29va2llJywKICAgICAgJ3JlcS5oZWFkZXJzWyJwcm94eS1hdXRob3JpemF0aW9uIl0nLAogICAgICAncmVxLmhlYWRlcnNbIngtYXBpLWtleSJdJywKICAgICAgJ3JlcS5oZWFkZXJzWyJ4LWludGVybmFsLXNlY3JldCJdJywKICAgICAgJ3JlcS5oZWFkZXJzWyJhcGkta2V5Il0nLAogICAgICAncmVzLmhlYWRlcnNbInNldC1jb29raWUiXScsCiAgICAgICdyZXMuaGVhZGVycy5sb2NhdGlvbicsCiAgICBdLAogICAgY2Vuc29yOiAnW1JlZGFjdGVkXScsCiAgfSwKfSBzYXRpc2ZpZXMgTG9nZ2VyT3B0aW9uczsKCmV4cG9ydCBjb25zdCBsb2dnZXIgPSBwaW5vKGxvZ2dlck9wdGlvbnMpOwoKZXhwb3J0IHR5cGUgTG9nZ2VyID0gdHlwZW9mIGxvZ2dlcjsK',
  'base64',
);
function fixture(change = {}) {
  const stat = {
    dev: 1,
    ino: 2,
    uid: 0,
    gid: 0,
    mode: 0o100644,
    nlink: 1,
    size: patched.length,
    mtimeMs: 1,
    ctimeMs: 1,
    isFile: () => true,
    isSymbolicLink: () => false,
  };
  let reads = 0;
  return {
    exec: async (_, args) =>
      args.includes('rev-parse')
        ? (change.head ?? '107857fe70503e30691073f267d87275596edb20') + '\n'
        : args.includes('status')
          ? (change.status ?? ' M apps/orchestrator/src/config/logger.ts\n')
          : args.includes('show')
            ? original
            : '',
    lstat: async () => ({ ...stat, ...(change.stat ?? {}), ino: change.drift && reads++ ? 3 : 2 }),
    open: async () => ({
      stat: async () => stat,
      readFile: async () => change.bytes ?? patched,
      close: async () => {},
    }),
  };
}
test('only the accepted legacy logger bytes produce the explicit source patch identity', async () => {
  assert.equal(typeof evidence.readReviewedLegacyCheckout, 'function');
  assert.equal(
    createHash('sha256').update(original).digest('hex'),
    evidence.reviewedLegacyLoggerPatch.oldSha256,
  );
  assert.equal(
    createHash('sha256').update(patched).digest('hex'),
    evidence.reviewedLegacyLoggerPatch.newSha256,
  );
  const value = await evidence.readReviewedLegacyCheckout(fixture());
  assert.deepEqual(value.reviewedPatch, evidence.reviewedLegacyLoggerPatch);
  evidence.validateReviewedLegacyLoggerPatch(value.reviewedPatch, value.sourceCandidate);
});
for (const [name, change] of Object.entries({
  otherDirty: { status: ' M other.ts\n' },
  untracked: { status: ' M apps/orchestrator/src/config/logger.ts\n?? extra\n' },
  wrongHead: { head: 'a'.repeat(40) },
  bytes: { bytes: Buffer.from('changed') },
  metadata: { stat: { uid: 998 } },
  changed: { drift: true },
}))
  test(`legacy patch rejects ${name}`, async () => {
    await assert.rejects(evidence.readReviewedLegacyCheckout(fixture(change)), /UNPROVEN/);
  });
test('ordinary clean checkout remains supported without a patch claim', async () => {
  assert.deepEqual(
    await evidence.readReviewedLegacyCheckout(fixture({ head: 'a'.repeat(40), status: '' })),
    { sourceCandidate: 'a'.repeat(40) },
  );
});

test('default pair stdin executes the actual exact patch reader on the legacy host', async () => {
  const { readFirstCutoverHostPair } = await import('./browser-first-cutover-host.mjs');
  const source = Buffer.from(`
 import {readReviewedLegacyCheckout as actualCheckout} from ${JSON.stringify(new URL('./browser-cutover-evidence.mjs', import.meta.url).href)};
 import {isDeepStrictEqual} from 'node:util';
 const original=${JSON.stringify(original)};
 const patched=Buffer.from(${JSON.stringify(patched.toString('base64'))},'base64');
 ${fixture.toString()}
 const hostSystem=fixture();
 const readReviewedLegacyCheckout=()=>actualCheckout(hostSystem);
 const legacyCapability={sourceCandidate:'107857fe70503e30691073f267d87275596edb20'};
 const readCutoverLegacyCapability=async({sourceCandidate})=>({sourceCandidate});
 const readCutoverHostSnapshot=async()=>({observedAtMs:Date.now(),bootId:'11111111-1111-4111-8111-111111111111',processes:[{pid:process.pid,start:'1'}]});
 `);
  const result = await readFirstCutoverHostPair({
    transport: 'administrator',
    readObserverSource: async () => source,
    exec: async (_cmd, _args, { input }) =>
      execFileSync(process.execPath, ['--input-type=module'], {
        input,
        encoding: 'utf8',
        timeout: 5000,
      }),
  });
  assert.deepEqual(result.reviewedPatch, evidence.reviewedLegacyLoggerPatch);
  assert.equal(result.hosts.find((h) => h.host === 'aliyun').reviewedPatch, undefined);
});

test('real isolated Git ignores non-running historical artifacts while keeping tracked-source changes strict', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'holaday-legacy-tracked-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const git = (args) =>
    execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
    });
  git(['init', '--quiet']);
  await mkdir(join(root, 'apps/orchestrator/src/config'), { recursive: true });
  await writeFile(join(root, 'apps/orchestrator/src/config/logger.ts'), original);
  await writeFile(join(root, 'tracked.ts'), 'export const unchanged=true;\n');
  git(['add', '.']);
  git([
    '-c',
    'user.name=QA',
    '-c',
    'user.email=qa@example.invalid',
    'commit',
    '--quiet',
    '-m',
    'isolated baseline',
  ]);
  await writeFile(join(root, 'apps/orchestrator/src/config/logger.ts'), patched);
  await mkdir(join(root, 'eval-results'));
  await writeFile(join(root, 'eval-results/historical.json'), '{}');
  const io = fixture();
  const previous = io.exec;
  io.exec = async (command, args) =>
    args.includes('rev-parse') ? previous(command, args) : git(args.slice(2));
  assert.ok(
    git(['status', '--porcelain=v1', '--untracked-files=all']).includes('?? eval-results/'),
  );
  assert.deepEqual(
    (await evidence.readReviewedLegacyCheckout(io)).reviewedPatch,
    evidence.reviewedLegacyLoggerPatch,
  );
  await writeFile(join(root, 'tracked.ts'), 'export const changed=true;\n');
  await assert.rejects(evidence.readReviewedLegacyCheckout(io), /UNPROVEN/);
});
