import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runMaintenanceCommand } from './browser-maintenance-control.mjs';
const identity = { candidate: 'a'.repeat(40), bootId: 'b'.repeat(32) };
test('discovery only sends read-only status to the freshly read instance', async () => {
  const commands = [];
  const result = await runMaintenanceCommand(['status'], {
    readIdentity: async () => identity,
    request: async (command) => {
      commands.push(command);
      return { identity, mode: 'closed', needsReconciliation: false, counts: { idle: true } };
    },
  });
  assert.equal(result.protocol, 1);
  assert.deepEqual(commands, [{ identity, op: 'status', timeoutMs: 5000 }]);
});
test('mutating commands require explicit exact boot identity without discovery fallback', async () => {
  let calls = 0;
  const seams = {
    readIdentity: async () => {
      calls++;
      return identity;
    },
    request: async () => {
      calls++;
    },
  };
  for (const args of [
    ['open'],
    ['close'],
    ['wait'],
    ['open', identity.candidate],
    ['open', identity.candidate, identity.bootId, 'junk'],
    ['reset', identity.candidate, identity.bootId],
  ])
    await assert.rejects(runMaintenanceCommand(args, seams), /MAINTENANCE_CLI_INPUT/);
  assert.equal(calls, 0);
});
test('one failed open stays one call and errors are not retried', async () => {
  let calls = 0;
  await assert.rejects(
    runMaintenanceCommand(['open', identity.candidate, identity.bootId], {
      readIdentity: async () => {
        throw new Error('must not discover');
      },
      request: async () => {
        calls++;
        throw new Error('MAINTENANCE_CLIENT_TIMEOUT');
      },
    }),
    /MAINTENANCE_CLIENT_TIMEOUT/,
  );
  assert.equal(calls, 1);
});
