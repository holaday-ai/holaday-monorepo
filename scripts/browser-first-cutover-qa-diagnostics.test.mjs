import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { tmpdir } from 'node:os';
test('QA diagnostics persist only bounded private whitelisted metadata across chunks', () => {
  const source = fs.readFileSync(
    new URL('./fixtures/browser-recovery-target-qa.mjs', import.meta.url),
    'utf8',
  );
  const start = source.indexOf('const safeDiagnosticPath =');
  const end = source.indexOf('const child =', start);
  assert.ok(start > 0 && end > start);
  const directory = fs.mkdtempSync(join(tmpdir(), 'holaday-safe-diagnostic-contract-'));
  const api = new Function(
    'directory',
    'join',
    'openSync',
    'writeSync',
    'fsyncSync',
    source.slice(start, end) +
      '\nreturn {safeLine,persistSafeDiagnostics,fd:safeDiagnosticFd,path:safeDiagnosticPath,state:()=>({bytes:safeDiagnosticBytes,failed:safeDiagnosticFailed})};',
  )(directory, join, fs.openSync, fs.writeSync, fs.fsyncSync);
  assert.equal(fs.statSync(api.path).mode & 0o777, 0o600);
  const good = 'QA_BACKUP_STAGE source-snapshot start';
  assert.ok(api.safeLine(good));
  assert.ok(api.safeLine('QA_INGRESS_REJECTION {"component":"pair","stage":"PAIR_REVISION"}'));
  assert.equal(api.safeLine('QA_INGRESS_REJECTION {"component":"pair","stage":"/SECRET"}'), false);
  assert.equal(
    api.safeLine(
      'QA_INGRESS_REJECTION {"component":"pair","stage":"PAIR_ENTRY","message":"SECRET"}',
    ),
    false,
  );
  assert.ok(
    api.safeLine(
      'QA_RECOVERY_REJECTION {"component":"server","stage":"RECOVERY_SERVER_SCOPE_READ"}',
    ),
  );
  assert.ok(api.safeLine('QA_RECOVERY_REJECTION {"component":"client","stage":"PAIR_REVISION"}'));
  assert.equal(
    api.safeLine('QA_RECOVERY_REJECTION {"component":"server","stage":"SECRET"}'),
    false,
  );
  assert.equal(
    api.safeLine(
      'QA_RECOVERY_REJECTION {"component":"server","stage":"RECOVERY_SERVER_SCOPE_READ","message":"SECRET"}',
    ),
    false,
  );
  assert.equal(
    api.safeLine(
      'QA_RECOVERY_REJECTION {"component":"server","stage":["RECOVERY_SERVER_SCOPE_READ"]}',
    ),
    false,
  );
  for (const bad of [
    'raw SECRET business-row',
    'QA_BACKUP_STAGE source-snapshot start SECRET',
    'QA_CGROUP_MEMORY_STATE source-snapshot-start {"env":"SECRET"}',
    'QA_CGROUP_MEMORY_STATE source-snapshot-start {"events":{"SECRET":1}}',
    'QA_INGRESS_CHILD_EXIT {"code":0,"signal":null,"env":"SECRET"}',
    'QA_INGRESS_CHILD_EXIT {"code":256,"signal":null}',
  ])
    assert.equal(api.safeLine(bad), false);
  api.persistSafeDiagnostics(Buffer.from('raw SECRET\n' + good.slice(0, 10)));
  api.persistSafeDiagnostics(Buffer.from(good.slice(10) + '\n'));
  assert.equal(fs.readFileSync(api.path, 'utf8'), good + '\n');
  api.persistSafeDiagnostics(Buffer.from((good + '\n').repeat(3000)));
  assert.equal(api.state().failed, true);
  assert.ok(api.state().bytes <= 65536);
  const saved = fs.readFileSync(api.path, 'utf8');
  assert.ok(!saved.includes('SECRET'));
  assert.ok(
    saved
      .split('\n')
      .filter(Boolean)
      .every((v) => v === good),
  );
  fs.closeSync(api.fd);
  fs.rmSync(directory, { recursive: true, force: true });
});
