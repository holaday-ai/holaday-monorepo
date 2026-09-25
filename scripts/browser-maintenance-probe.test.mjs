import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

test('read-only probe discovers the flat durable store record and queries the live socket CLI', () => {
  const shell = readFileSync(new URL('browser-maintenance-probe.sh', import.meta.url), 'utf8');
  const body = shell
    .split("--input-type=module -e '\n")[1]
    .replace(/'\s*$/, '')
    .replace(/^import .*;\n/gm, '');
  const calls = [],
    outputs = [];
  vm.runInNewContext(body, {
    readFileSync: (path) => {
      assert.equal(path, '/var/lib/holaday/ordinary-maintenance/state.json');
      return JSON.stringify({
        schemaVersion: 1,
        candidate: 'a'.repeat(40),
        bootId: 'b'.repeat(32),
        mode: 'closed',
        needsReconciliation: false,
      });
    },
    spawnSync: (...args) => {
      calls.push(args);
      return { status: 0, stdout: 'live-proof' };
    },
    process: {
      exit: () => {
        throw new Error('PROBE_REFUSED');
      },
      stdout: { write: (text) => outputs.push(text) },
    },
  });
  assert.equal(calls.length, 1);
  assert.equal(
    calls[0][1][2],
    '/opt/holaday-releases/' + 'a'.repeat(40) + '/scripts/browser-maintenance-control.mjs',
  );
  assert.deepEqual(outputs, ['live-proof']);
});
