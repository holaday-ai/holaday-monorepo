import assert from 'node:assert/strict';
import test from 'node:test';
import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { PassThrough } from 'node:stream';
import { serveFirstCutoverRecoverySession } from './browser-first-cutover-recovery-session.mjs';
import { observeCutoverChild } from './browser-first-cutover-bridge-output.mjs';
const module = new URL('./browser-first-cutover-recovery-session.mjs', import.meta.url).pathname;
const siteBytes = await fs.readFile(
  new URL('./browser-first-cutover-site.mjs', import.meta.url),
  'utf8',
);
const connection = siteBytes.slice(
  siteBytes.indexOf('recovery = await io.connectRecovery(approved,'),
);
const writer = connection.match(/output: ([\s\S]*?),\n      assertScope:/)?.[1];
assert.ok(writer, 'actual site recovery output expression');
for (const fault of ['normal', 'early-attach', 'nonzero-exit', 'early-eof'])
  test('real recovery pipe transport ' + fault, async (t) => {
    const directory = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'holaday-bridge-pipe-')));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    const binding = {
      attempt: '12345678-1234-4234-8234-123456789abc',
      candidate: 'a'.repeat(40),
      configDigest: 'b'.repeat(64),
      migrationDigest: 'c'.repeat(64),
      inventoryDigest: 'd'.repeat(64),
    };
    const facility = {
      executable: '/approved/age',
      executableDigest: '1'.repeat(64),
      recipientFile: '/approved/public-recipient',
      recipientDigest: '2'.repeat(64),
    };
    const scope = {
      schemaVersion: 1,
      binding,
      maintenanceEndsAtMs: Date.now() + 10000,
      sourceOptions: { facility, directory: '/approved/source', attempt: binding.attempt },
      sourceIdentity: { serverUuid: '11111111-1111-4111-8111-111111111111', database: 'source' },
      destination: { facility, directory, attempt: binding.attempt },
      identityFile: directory + '/identity',
      target: {
        containerId: '3'.repeat(64),
        imageId: 'sha256:' + '4'.repeat(64),
        volume: 'holaday-cutover-restore-' + binding.attempt,
        attempt: binding.attempt,
        identity: { serverUuid: '22222222-2222-4222-8222-222222222222', database: 'restore' },
      },
    };
    const bytes = JSON.stringify(scope);
    await fs.writeFile(join(directory, 'first-cutover-' + binding.attempt + '.json'), bytes, {
      mode: 0o600,
    });
    const request = {
      directory,
      attempt: binding.attempt,
      scopeDigest: createHash('sha256').update(bytes).digest('hex'),
    };
    const publicScope = {
      binding,
      maintenanceEndsAtMs: scope.maintenanceEndsAtMs,
      scopeDigest: request.scopeDigest,
      sourceIdentity: scope.sourceIdentity,
      isolatedTarget: scope.target.identity,
    };
    const code =
      fault === 'early-eof'
        ? 'process.exit(0);'
        : `import {Writable} from 'node:stream';import {connectFirstCutoverRecoverySession} from ${JSON.stringify(module)};const approved=${JSON.stringify(publicScope)};let checked=0;const connection=await connectFirstCutoverRecoverySession(approved,{input:process.stdin,output:${writer},assertScope:async()=>{checked++;if(approved.binding.attempt!==${JSON.stringify(binding.attempt)})throw Error('scope')}});await connection.close();process.stdout.write(JSON.stringify({kind:'first-cutover-execution-result',candidate:approved.binding.candidate,attempt:approved.binding.attempt,ok:true,phase:'reconciled'})+'\\n');${fault === 'nonzero-exit' ? 'process.exitCode=7;' : ''}`;
    const child = spawn(
      process.execPath,
      ['--max-old-space-size=192', '--input-type=module', '-e', code],
      { stdio: ['pipe', 'pipe', 'pipe'] },
    );
    t.after(() => {
      if (child.exitCode === null) child.kill();
    });
    const input = new PassThrough({ highWaterMark: 256 * 1024 });
    child.stdout.pipe(input);
    const output = observeCutoverChild(child);
    if (fault === 'early-attach') await new Promise((r) => setTimeout(r, 150));
    let servingError;
    try {
      await serveFirstCutoverRecoverySession(request, { input, output: child.stdin });
    } catch (e) {
      servingError = true;
    } finally {
      child.stdin.end();
    }
    const exit = await output.exited;
    const summary = output.summary();
    const transportProven =
      !servingError &&
      exit.code === 0 &&
      summary.final?.phase === 'reconciled' &&
      !summary.outputUnproven;
    assert.equal(transportProven, ['normal', 'early-attach'].includes(fault));
    if (fault !== 'early-eof') {
      assert.equal(summary.final?.phase, 'reconciled');
      assert.ok(summary.protocolFrames >= 3);
    }
    if (fault === 'nonzero-exit') assert.equal(exit.code, 7);
  });
