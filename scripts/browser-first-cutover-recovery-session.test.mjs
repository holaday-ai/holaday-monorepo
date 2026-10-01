import { ingressDiagnosticStage } from './browser-first-cutover-ingress-diagnostics.mjs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';

const session = await import('./browser-first-cutover-recovery-session.mjs').catch(() => ({}));
const hash = (value) => createHash('sha256').update(value).digest('hex');
const binding = {
  attempt: '12345678-1234-4234-8234-123456789abc',
  candidate: 'a'.repeat(40),
  configDigest: 'b'.repeat(64),
  migrationDigest: 'c'.repeat(64),
  inventoryDigest: 'd'.repeat(64),
};

async function fixture(t) {
  const directory = await fs.realpath(
    await fs.mkdtemp(join(tmpdir(), 'cutover-recovery-session-')),
  );
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const facility = {
    executable: '/approved/age',
    executableDigest: '1'.repeat(64),
    recipientFile: '/approved/recipient',
    recipientDigest: '2'.repeat(64),
  };
  const scope = {
    schemaVersion: 1,
    binding,
    maintenanceEndsAtMs: Date.now() + 30000,
    sourceOptions: { facility, directory: '/approved/source', attempt: binding.attempt },
    sourceIdentity: { serverUuid: '11111111-1111-4111-8111-111111111111', database: 'source' },
    destination: {
      facility: { ...facility, recipientFile: join(directory, 'recipient') },
      directory,
      attempt: binding.attempt,
    },
    identityFile: join(directory, 'identity.txt'),
    target: {
      containerId: '3'.repeat(64),
      imageId: `sha256:${'4'.repeat(64)}`,
      volume: `holaday-cutover-restore-${binding.attempt}`,
      attempt: binding.attempt,
      identity: { serverUuid: '22222222-2222-4222-8222-222222222222', database: 'restore' },
    },
  };
  const file = join(directory, `first-cutover-${binding.attempt}.json`);
  const bytes = JSON.stringify(scope);
  await fs.writeFile(file, bytes, { mode: 0o600, flag: 'wx' });
  const request = { directory, attempt: binding.attempt, scopeDigest: hash(bytes) };
  return { directory, file, scope, request };
}

test('recovery metadata reads only exact private approved bytes and refuses permission or digest drift', async (t) => {
  assert.equal(typeof session.readFirstCutoverRecoveryScope, 'function');
  const f = await fixture(t);
  assert.deepEqual(await session.readFirstCutoverRecoveryScope(f.request), f.scope);
  await assert.rejects(
    session.readFirstCutoverRecoveryScope({ ...f.request, scopeDigest: '0'.repeat(64) }),
    /UNPROVEN/,
  );
  await fs.chmod(f.file, 0o644);
  await assert.rejects(session.readFirstCutoverRecoveryScope(f.request), /UNPROVEN/);
  await fs.chmod(f.file, 0o600);
  await fs.rename(f.file, `${f.file}.saved`);
  await fs.symlink(`${f.file}.saved`, f.file);
  await assert.rejects(session.readFirstCutoverRecoveryScope(f.request), /UNPROVEN/);
});

for (const fault of [
  'none',
  'runtime-absent',
  'early-migration',
  'repeat-migration',
  'migration-failed',
  'business-drift',
  'full-90-table-projection',
  'oversized-snapshot',
  'snapshot-identity-drift',
])
  test(`recovery runtime session ${fault}: ordered snapshot, single migration and original projection`, async (t) => {
    const f = await fixture(t);
    if (fault !== 'runtime-absent')
      f.scope.runtime = {
        manifestDigest: '5'.repeat(64),
        nodeDigest: '6'.repeat(64),
        toolDigest: '7'.repeat(64),
      };
    const bytes = JSON.stringify(f.scope);
    await fs.writeFile(f.file, bytes);
    f.request.scopeDigest = hash(bytes);
    assert.deepEqual(await session.readFirstCutoverRecoveryScope(f.request), f.scope);
    const toMac = new PassThrough();
    const toCoordinator = new PassThrough();
    t.after(() => {
      toMac.destroy();
      toCoordinator.destroy();
    });
    const observed = [];
    const snapshot = {
      identity: f.scope.target.identity,
      objects: [
        {
          name: 'sample',
          kind: 'BASE TABLE',
          engine: 'InnoDB',
          rowCount: 1,
          definitionDigest: '8'.repeat(64),
          columnsDigest: '9'.repeat(64),
          dataDigest: 'a'.repeat(64),
        },
      ],
      projection: [{ table: 'sample', columns: ['id'] }],
      schemaDigest: '8'.repeat(64),
      sourceDigest: '9'.repeat(64),
      businessDigest: 'a'.repeat(64),
    };
    if (fault === 'full-90-table-projection') {
      snapshot.objects = Array.from({ length: 90 }, (_, i) => ({
        ...snapshot.objects[0],
        name: `table_${i}`,
      }));
      snapshot.projection = snapshot.objects.map((object) => ({
        table: object.name,
        columns: Array.from({ length: 20 }, (_, i) => `column_${i}`),
      }));
      assert.ok(Buffer.byteLength(JSON.stringify(snapshot)) < 256 * 1024);
    }
    if (fault === 'oversized-snapshot') snapshot.objects[0].name = 'x'.repeat(256 * 1024);
    if (fault === 'snapshot-identity-drift') snapshot.identity = f.scope.sourceIdentity;
    const serving = session
      .serveFirstCutoverRecoverySession(f.request, {
        input: toMac,
        output: toCoordinator,
        inspectTarget: async () => f.scope.target.identity,
        restore: async () => f.scope.target.identity,
        executeTool: async (input, { assertScope }) => {
          await assertScope();
          assert.deepEqual(input.target, f.scope.target);
          assert.deepEqual(input.runtime, f.scope.runtime);
          assert.equal(input.migrationDigest, binding.migrationDigest);
          observed.push(input.action);
          if (input.action === 'snapshot') return snapshot;
          if (input.action === 'migrate') {
            if (fault === 'migration-failed') throw new Error('private runner diagnostics');
            return { migrationDigest: binding.migrationDigest };
          }
          assert.deepEqual(input.projection, snapshot.projection);
          return {
            schemaDigest: 'b'.repeat(64),
            businessDigest: fault === 'business-drift' ? 'c'.repeat(64) : snapshot.businessDigest,
          };
        },
      })
      .then(
        () => {
          toCoordinator.end();
          return 0;
        },
        () => {
          toCoordinator.end();
          return 1;
        },
      );
    const client = await session.connectFirstCutoverRecoverySession(
      {
        binding,
        maintenanceEndsAtMs: f.scope.maintenanceEndsAtMs,
        scopeDigest: f.request.scopeDigest,
        sourceIdentity: f.scope.sourceIdentity,
        isolatedTarget: f.scope.target.identity,
      },
      { input: toCoordinator, output: toMac, assertScope: async () => {} },
    );
    await client.restore({
      artifact: {
        reference: `/approved/source/${binding.attempt}.sql.age`,
        encryptionProfileDigest: 'b'.repeat(64),
      },
      expectedBackupDigest: 'c'.repeat(64),
      expectedBytes: 12,
    });
    const rejects = async (operation, count) => {
      await assert.rejects(operation(), /CUTOVER_RECOVERY_SESSION_UNPROVEN/);
      assert.equal(await serving, 1);
      const previous = observed.length;
      await assert.rejects(client.migrate(), /CUTOVER_RECOVERY_SESSION_UNPROVEN/);
      assert.equal(observed.length, previous);
      assert.equal(observed.filter((v) => v === 'migrate').length, count);
    };
    if (fault === 'runtime-absent') return rejects(client.snapshot, 0);
    if (fault === 'early-migration') return rejects(client.migrate, 0);
    if (['oversized-snapshot', 'snapshot-identity-drift'].includes(fault))
      return rejects(client.snapshot, 0);
    assert.deepEqual(await client.snapshot(), snapshot);
    if (fault === 'migration-failed') return rejects(client.migrate, 1);
    assert.deepEqual(await client.migrate(), { migrationDigest: binding.migrationDigest });
    if (fault === 'repeat-migration') return rejects(client.migrate, 1);
    if (fault === 'business-drift') return rejects(client.verify, 1);
    assert.deepEqual(await client.verify(), {
      schemaDigest: 'b'.repeat(64),
      businessDigest: snapshot.businessDigest,
    });
    await client.close();
    assert.equal(await serving, 0);
    assert.deepEqual(observed, ['snapshot', 'migrate', 'verify']);
  });

for (const fault of ['none', 'scope', 'metadata', 'source', 'ack', 'identity']) {
  test(`recovery session ${fault}: live coordinator checks and no import replay`, async (t) => {
    assert.equal(typeof session.serveFirstCutoverRecoverySession, 'function');
    assert.equal(typeof session.connectFirstCutoverRecoverySession, 'function');
    const f = await fixture(t);
    const toMac = new PassThrough();
    const toCoordinator = new PassThrough();
    const sent = [];
    // Observe writes without switching unread pipes into flowing mode before
    // the real endpoint has installed its reader after checking local metadata.
    for (const stream of [toMac, toCoordinator]) {
      const write = stream.write.bind(stream);
      stream.write = (bytes, ...args) => {
        sent.push(bytes.toString());
        return write(bytes, ...args);
      };
    }
    t.after(() => {
      toMac.destroy();
      toCoordinator.destroy();
    });
    let scopeChecks = 0;
    let imports = 0;
    let block = false;
    const serving = session
      .serveFirstCutoverRecoverySession(f.request, {
        input: toMac,
        output: toCoordinator,
        inspectTarget: async () => f.scope.target.identity,
        restore: async (input, io) => {
          assert.equal(input.identityFile, f.scope.identityFile);
          assert.deepEqual(input.transfer.source.options, f.scope.sourceOptions);
          await io.assertScope();
          imports++;
          if (fault === 'ack') {
            toCoordinator.destroy();
            throw new Error('private raw details');
          }
          return fault === 'identity' ? f.scope.sourceIdentity : f.scope.target.identity;
        },
      })
      .then(
        () => {
          toCoordinator.end();
          return 0;
        },
        () => {
          toCoordinator.end();
          return 1;
        },
      );
    const client = await session.connectFirstCutoverRecoverySession(
      {
        binding,
        maintenanceEndsAtMs: f.scope.maintenanceEndsAtMs,
        scopeDigest: f.request.scopeDigest,
        sourceIdentity: f.scope.sourceIdentity,
        isolatedTarget: f.scope.target.identity,
      },
      {
        input: toCoordinator,
        output: toMac,
        assertScope: async () => {
          scopeChecks++;
          await fs.stat(f.directory); // real journal/fence checks yield to pipe EOF
          if (block) throw new Error('private journal details');
        },
      },
    );
    assert.deepEqual(await client.inspect(), f.scope.target.identity);
    if (fault === 'scope') block = true;
    if (fault === 'metadata') await fs.appendFile(f.file, ' ');
    const artifact = {
      reference: join(f.scope.sourceOptions.directory, `${binding.attempt}.sql.age`),
      encryptionProfileDigest: 'e'.repeat(64),
    };
    if (fault === 'source') artifact.reference = '/unapproved/source.age';
    const action = client.restore({
      artifact,
      expectedBackupDigest: 'f'.repeat(64),
      expectedBytes: 128,
    });
    if (fault === 'none') {
      assert.deepEqual(await action, f.scope.target.identity);
      assert(scopeChecks >= 4);
      assert.deepEqual(await client.inspect(), f.scope.target.identity);
      await client.close();
      assert.equal(await serving, 0);
    } else {
      await assert.rejects(action, /UNPROVEN/);
      assert.equal(await serving, 1);
    }
    await assert.rejects(
      client.restore({ artifact, expectedBackupDigest: 'f'.repeat(64), expectedBytes: 128 }),
      /UNPROVEN/,
    );
    assert.equal(imports, ['none', 'ack', 'identity'].includes(fault) ? 1 : 0);
    assert(!sent.join('').includes(f.scope.identityFile));
    assert(!sent.join('').includes('private raw details'));
    assert(!sent.join('').includes('private journal details'));
  });
}

for (const fault of ['initial', 'challenge', 'final']) {
  test(`recovery attach diagnostic client ${fault} preserves guard order and public refusal`, async (t) => {
    const f = await fixture(t);
    const input = new PassThrough();
    const output = new PassThrough();
    t.after(() => {
      input.destroy();
      output.destroy();
    });
    const approved = {
      binding,
      maintenanceEndsAtMs: f.scope.maintenanceEndsAtMs,
      scopeDigest: f.request.scopeDigest,
      sourceIdentity: f.scope.sourceIdentity,
      isolatedTarget: f.scope.target.identity,
    };
    let calls = 0;
    let operations = 0;
    output.on('data', (chunk) => {
      const frame = JSON.parse(chunk.toString());
      if (frame.type === 'operation') {
        operations++;
        input.write(
          JSON.stringify({ protocol: 1, type: 'scope', seq: 1, scopeSeq: 1, binding }) + '\n',
        );
      } else
        input.write(
          JSON.stringify({ protocol: 1, type: 'result', seq: 1, value: approved }) + '\n',
        );
    });
    const at = { initial: 1, challenge: 2, final: 3 }[fault];
    const expected = {
      initial: 'RECOVERY_CLIENT_SCOPE_INITIAL',
      challenge: 'RECOVERY_CLIENT_SCOPE_CHECK',
      final: 'RECOVERY_CLIENT_SCOPE_FINAL',
    }[fault];
    await assert.rejects(
      session.connectFirstCutoverRecoverySession(approved, {
        input,
        output,
        assertScope: async () => {
          if (++calls === at) throw new Error('private row/path/key');
        },
      }),
      (error) => {
        assert.equal(error.message, 'CUTOVER_RECOVERY_SESSION_UNPROVEN');
        assert.equal(ingressDiagnosticStage(error), expected);
        assert(!JSON.stringify(error.cause).includes('private'));
        return true;
      },
    );
    assert.equal(calls, at);
    assert.equal(operations, fault === 'initial' ? 0 : 1);
  });
}
for (const fault of ['scope-read', 'scope-recheck', 'attach-value']) {
  test(`recovery attach diagnostic server ${fault} reports fixed cause without payload`, async (t) => {
    const f = await fixture(t);
    const input = new PassThrough();
    const output = new PassThrough();
    t.after(() => {
      input.destroy();
      output.destroy();
    });
    const approved = {
      binding,
      maintenanceEndsAtMs: f.scope.maintenanceEndsAtMs,
      scopeDigest: f.request.scopeDigest,
      sourceIdentity: f.scope.sourceIdentity,
      isolatedTarget: f.scope.target.identity,
    };
    input.write(
      JSON.stringify({
        protocol: 1,
        type: 'operation',
        seq: 1,
        name: 'attach',
        value: fault === 'attach-value' ? {} : approved,
      }) + '\n',
    );
    let reads = 0;
    const stages = {
      'scope-read': 'RECOVERY_SERVER_SCOPE_READ',
      'scope-recheck': 'RECOVERY_SERVER_SCOPE_RECHECK',
      'attach-value': 'RECOVERY_SERVER_ATTACH_VALUE',
    };
    await assert.rejects(
      session.serveFirstCutoverRecoverySession(f.request, {
        input,
        output,
        readScope: async () => {
          reads++;
          if ((fault === 'scope-read' && reads === 1) || (fault === 'scope-recheck' && reads === 2))
            throw new Error('private row/path/key');
          return f.scope;
        },
      }),
      (error) => {
        assert.equal(error.message, 'CUTOVER_RECOVERY_SESSION_UNPROVEN');
        assert.equal(ingressDiagnosticStage(error), stages[fault]);
        assert(!JSON.stringify(error.cause).includes('private'));
        return true;
      },
    );
    assert.equal(reads, fault === 'scope-read' ? 1 : 2);
  });
}
