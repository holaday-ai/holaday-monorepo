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
