import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import {
  connectFirstCutoverGatewaySession,
  serveFirstCutoverGatewaySession,
} from './browser-first-cutover-gateway-session.mjs';
import * as diagnostics from './browser-first-cutover-ingress-diagnostics.mjs';
import {
  connectFirstCutoverIngressSession,
  serveFirstCutoverIngressSession,
} from './browser-first-cutover-ingress-session.mjs';

const secret = 'SECRET_FAKE_AUTHORIZATION_DO_NOT_PRINT';
const attempt = 'd279a33e-08be-42ab-854e-1b507d8b5646';
function childFixture() {
  const child = new EventEmitter();
  child.stderr = new PassThrough();
  child.stdout = new PassThrough();
  child.stdin = new PassThrough();
  return child;
}
function line(role = 'ingress', stage = 'RECEIVER_IDENTITY') {
  return `${JSON.stringify({ kind: 'first-cutover-receiver-failure', role, stage })}\n`;
}
for (const [role, serve] of [
  ['ingress', serveFirstCutoverIngressSession],
  ['gateway', serveFirstCutoverGatewaySession],
]) {
  test(`${role} original receiver retains scope failure without exception text`, async () => {
    const output = new PassThrough();
    let failed;
    try {
      await serve(
        { attempt },
        {
          output,
          readSite: async () => {
            throw Error(secret);
          },
        },
      );
    } catch (error) {
      failed = error;
    }
    assert.ok(failed);
    assert.equal(diagnostics.ingressDiagnosticStage(failed), 'RECEIVER_SCOPE');
    assert.equal(JSON.stringify(failed).includes(secret), false);
  });
}
for (const order of [
  ['stderr', 'stdout', 'exit', 'close'],
  ['stdout', 'stderr', 'exit', 'close'],
  ['exit', 'stdout', 'stderr', 'close'],
]) {
  test(`same child completion retains bounded diagnostics for ${order.join('/')}`, async () => {
    assert.equal(typeof diagnostics.firstCutoverSshCompletion, 'function');
    const child = childFixture();
    const completion = diagnostics.firstCutoverSshCompletion(child, 'ingress');
    for (const event of order) {
      if (event === 'stderr') child.stderr.end(line());
      else if (event === 'stdout') child.stdout.end();
      else {
        if (event === 'close') await new Promise((resolve) => setImmediate(resolve));
        child.emit(event, 1, null);
      }
    }
    assert.deepEqual(await completion, { code: 1, receiverStage: 'RECEIVER_IDENTITY' });
  });
}
for (const bytes of [
  secret,
  `${line()}${secret}`,
  `${line()}${line()}`,
  line('gateway'),
  line('ingress', secret),
  `${'x'.repeat(4097)}\n`,
]) {
  test(`unknown/mixed/duplicate/mismatched/oversize stderr is never exposed (${bytes.length} bytes)`, async () => {
    assert.equal(typeof diagnostics.firstCutoverSshCompletion, 'function');
    const child = childFixture();
    const completion = diagnostics.firstCutoverSshCompletion(child, 'ingress');
    child.stderr.end(bytes);
    await new Promise((resolve) => setImmediate(resolve));
    child.emit('close', 1, null);
    assert.deepEqual(await completion, { code: 1 });
  });
}
test('successful exit never adopts a failure diagnostic', async () => {
  assert.equal(typeof diagnostics.firstCutoverSshCompletion, 'function');
  const child = childFixture();
  const completion = diagnostics.firstCutoverSshCompletion(child, 'ingress');
  child.stderr.end(line());
  await new Promise((resolve) => setImmediate(resolve));
  child.emit('close', 0, null);
  assert.deepEqual(await completion, { code: 0 });
});
test('failure diagnostics never authorize success or replace an owned guard failure', async () => {
  assert.equal(typeof diagnostics.firstCutoverReceiverFailure, 'function');
  const original = diagnostics.ingressDiagnosticError(
    'CUTOVER_INGRESS_SESSION_UNPROVEN',
    'WIRE_READ',
  );
  const result = await diagnostics.firstCutoverReceiverFailure(
    original,
    { completion: Promise.resolve({ code: 1, receiverStage: 'RECEIVER_IDENTITY' }) },
    Date.now() + 1000,
    Date.now,
  );
  assert.equal(result.message, original.message);
  assert.equal(diagnostics.ingressDiagnosticStage(result), 'RECEIVER_IDENTITY');
  const owner = diagnostics.ingressDiagnosticError(
    'CUTOVER_INGRESS_SESSION_UNPROVEN',
    'REMOTE_OWNER',
  );
  assert.equal(
    await diagnostics.firstCutoverReceiverFailure(
      owner,
      { completion: Promise.resolve({ code: 1, receiverStage: 'RECEIVER_IDENTITY' }) },
      Date.now() + 1000,
      Date.now,
    ),
    owner,
  );
});
test('no close remains bounded by absolute deadline, not a new business window', async () => {
  assert.equal(typeof diagnostics.firstCutoverReceiverFailure, 'function');
  const error = diagnostics.ingressDiagnosticError('CUTOVER_INGRESS_SESSION_UNPROVEN', 'WIRE_READ');
  const start = Date.now();
  assert.equal(
    await diagnostics.firstCutoverReceiverFailure(
      error,
      { completion: new Promise(() => {}) },
      start + 30,
      Date.now,
    ),
    error,
  );
  assert.ok(Date.now() - start < 500);
  for (const deadline of [start - 1, Number.POSITIVE_INFINITY, Number.NaN])
    assert.equal(
      await diagnostics.firstCutoverReceiverFailure(
        error,
        { completion: new Promise(() => {}) },
        deadline,
        Date.now,
      ),
      error,
    );
});
test('actual receiver CLI emits only the fixed scope stage, not secret exception text', async () => {
  assert.equal(typeof diagnostics.firstCutoverReceiverFailureLine, 'function');
  for (const role of ['ingress', 'gateway']) {
    const entry = new URL(`./browser-first-cutover-${role}-session.mjs`, import.meta.url).pathname;
    const program = `Object.defineProperty(process,'platform',{value:'linux'});process.getuid=()=>0;process.argv=[process.execPath,${JSON.stringify(entry)},${JSON.stringify(attempt)}];await import(${JSON.stringify(`file://${entry}`)});`;
    const child = spawn(
      process.execPath,
      ['--max-old-space-size=192', '--v8-pool-size=1', '--input-type=module', '--eval', program],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (x) => {
      stdout += x;
    });
    child.stderr.on('data', (x) => {
      stderr += x;
    });
    const code = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', resolve);
    });
    assert.equal(code, 1);
    assert.equal(stdout, '');
    const value = JSON.parse(stderr.trim());
    assert.equal(value.kind, 'first-cutover-receiver-failure');
    assert.equal(value.role, role);
    assert.ok(['APPROVAL_FOLDER', 'SITE_FOLDER'].includes(value.stage));
    assert.equal(stderr.includes(secret), false);
  }
});

test('complete-looking stderr without EOF and child close is never adopted', async () => {
  const child = childFixture();
  const completion = diagnostics.firstCutoverSshCompletion(child, 'ingress');
  child.stderr.write(line());
  const error = diagnostics.ingressDiagnosticError('CUTOVER_INGRESS_SESSION_UNPROVEN', 'WIRE_READ');
  assert.equal(
    await diagnostics.firstCutoverReceiverFailure(error, { completion }, Date.now() + 20, Date.now),
    error,
  );
  child.stderr.end(secret);
  await new Promise((resolve) => setImmediate(resolve));
  child.emit('close', 1, null);
  assert.deepEqual(await completion, { code: 1 });
});
test('close before stderr EOF cannot authenticate a complete-looking diagnostic', async () => {
  const child = childFixture();
  const completion = diagnostics.firstCutoverSshCompletion(child, 'ingress');
  child.stderr.write(line());
  child.emit('close', 1, null);
  assert.deepEqual(await completion, { code: 1 });
  child.stderr.end(secret);
});
test('transport child error retains generic failure and destroys owned streams', async () => {
  const child = childFixture();
  const completion = diagnostics.firstCutoverSshCompletion(child, 'ingress');
  child.emit('error', Error(secret));
  assert.deepEqual(await completion, { code: 1 });
  assert.equal(child.stdin.destroyed, true);
  assert.equal(child.stdout.destroyed, true);
  child.stderr.end();
});

for (const [role, connect] of [
  ['ingress', connectFirstCutoverIngressSession],
  ['gateway', connectFirstCutoverGatewaySession],
]) {
  test(`${role} actual client propagates receiver hint after stdout EOF without succeeding`, async () => {
    const binding = {
      attempt,
      candidate: 'a'.repeat(40),
      configDigest: 'b'.repeat(64),
      migrationDigest: 'c'.repeat(64),
      inventoryDigest: 'd'.repeat(64),
    };
    const input = { binding, maintenanceEndsAtMs: Date.now() + 5000, siteDigest: 'e'.repeat(64) };
    let ownedChild;
    let completion;
    const io = {
      platform: 'linux',
      uid: 0,
      now: Date.now,
      journal: {
        assertOwnership: async () => binding,
        readFirstCutoverEffects: async () => ({ ...binding }),
        recordStartupEvent: async () => {
          throw Error('NO_EFFECT');
        },
        recordRegistrationEvent: async () => {
          throw Error('NO_EFFECT');
        },
      },
      observeWriters: async () => ({}),
      verifyOpenedIdentity: async () => ({}),
      verifyFence: async () => ({}),
      observer: {
        read: async () => ({}),
        readRegistrationProgress: async () => ({}),
        readUnmanagedProgress: async () => ({}),
        retireUnmanaged: async () => {
          throw Error('NO_EFFECT');
        },
      },
      open: async () => {
        ownedChild = childFixture();
        completion = diagnostics.firstCutoverSshCompletion(ownedChild, role);
        setImmediate(() => {
          ownedChild.stdout.end();
          setTimeout(() => {
            ownedChild.stderr.end(line(role, 'RECEIVER_IDENTITY'));
            setImmediate(() => {
              ownedChild.emit('close', 1, null);
            });
          }, 5);
        });
        return { input: ownedChild.stdout, output: ownedChild.stdin, completion };
      },
    };
    let failure;
    try {
      await connect(input, io);
    } catch (error) {
      failure = error;
    }
    assert.ok(failure);
    assert.equal(diagnostics.ingressDiagnosticStage(failure), 'RECEIVER_IDENTITY');
    assert.equal(
      failure.message,
      role === 'ingress' ? 'CUTOVER_INGRESS_SESSION_UNPROVEN' : 'CUTOVER_GATEWAY_SESSION_UNPROVEN',
    );
    assert.equal(ownedChild.stdin.writableEnded, true);
    assert.deepEqual(await completion, { code: 1, receiverStage: 'RECEIVER_IDENTITY' });
  });
}

test('real child stdout EOF before fixed stderr completion retains only the safe hint', async () => {
  const expected = line('gateway', 'RECEIVER_SCOPE');
  const program = `process.stdout.end();setTimeout(()=>{process.stderr.end(${JSON.stringify(expected)},()=>{process.exitCode=1;});},5);`;
  const child = spawn(
    process.execPath,
    ['--max-old-space-size=192', '--v8-pool-size=1', '--eval', program],
    { stdio: ['pipe', 'pipe', 'pipe'] },
  );
  const completion = diagnostics.firstCutoverSshCompletion(child, 'gateway');
  child.stdin.end();
  child.stdout.resume();
  assert.deepEqual(await completion, { code: 1, receiverStage: 'RECEIVER_SCOPE' });
});
test('receiver diagnostic encoder drops arbitrary messages, stack and accessor cause', () => {
  for (const value of [
    Error(secret),
    Object.defineProperty({}, 'cause', {
      get() {
        throw Error(secret);
      },
    }),
  ]) {
    const text = diagnostics.firstCutoverReceiverFailureLine(value, 'ingress');
    assert.equal(text.includes(secret), false);
    assert.equal(JSON.parse(text).stage, 'RECEIVER_ENTRY');
  }
  assert.equal(diagnostics.firstCutoverReceiverFailureLine(Error(secret), 'arbitrary'), '');
});

for (const [role, connect] of [
  ['gateway', connectFirstCutoverGatewaySession],
  ['ingress', connectFirstCutoverIngressSession],
]) {
  test(`actual ${role} connect observes a pending completion only once across nested catches`, async () => {
    const binding = {
      attempt,
      candidate: 'a'.repeat(40),
      configDigest: 'b'.repeat(64),
      migrationDigest: 'c'.repeat(64),
      inventoryDigest: 'd'.repeat(64),
    };
    const input = { binding, maintenanceEndsAtMs: Date.now() + 10000, siteDigest: 'e'.repeat(64) };
    const ownedChild = childFixture();
    const started = performance.now();
    let failure;
    try {
      await connect(input, {
        platform: 'linux',
        uid: 0,
        now: Date.now,
        journal: {
          assertOwnership: async () => binding,
          readFirstCutoverEffects: async () => binding,
          recordStartupEvent: async () => {
            throw Error('NO_EFFECT');
          },
          recordRegistrationEvent: async () => {
            throw Error('NO_EFFECT');
          },
        },
        verifyFence: async () => ({}),
        observeWriters: async () => ({}),
        verifyOpenedIdentity: async () => ({}),
        observer: {
          read: async () => ({}),
          readRegistrationProgress: async () => ({}),
          readUnmanagedProgress: async () => ({}),
          retireUnmanaged: async () => {
            throw Error('NO_EFFECT');
          },
        },
        open: async () => {
          setImmediate(() => ownedChild.stdout.end());
          return {
            input: ownedChild.stdout,
            output: ownedChild.stdin,
            completion: new Promise(() => {}),
          };
        },
      });
    } catch (error) {
      failure = error;
    }
    const elapsed = performance.now() - started;
    assert.ok(failure);
    assert.equal(
      failure.message,
      role === 'gateway' ? 'CUTOVER_GATEWAY_SESSION_UNPROVEN' : 'CUTOVER_INGRESS_SESSION_UNPROVEN',
    );
    assert.equal(diagnostics.ingressDiagnosticStage(failure), 'WIRE_READ');
    assert.ok(elapsed >= 900 && elapsed < 1700, `one observation budget, elapsed=${elapsed}`);
    assert.equal(ownedChild.stdin.writableEnded, true);
    ownedChild.stderr.destroy();
    ownedChild.stdin.destroy();
  });
}

test('actual connected ingress command failure retains the completed receiver stage', async () => {
  const binding = {
    attempt,
    candidate: 'a'.repeat(40),
    configDigest: 'b'.repeat(64),
    migrationDigest: 'c'.repeat(64),
    inventoryDigest: 'd'.repeat(64),
  };
  const input = { binding, maintenanceEndsAtMs: Date.now() + 5000, siteDigest: 'e'.repeat(64) };
  const execution = {
    role: 'ingress',
    bootId: '11111111-1111-4111-8111-111111111111',
    process: {
      pid: 910,
      ppid: 900,
      start: '100',
      uids: [0, 0, 0, 0],
      cwd: '/',
      exe: '/usr/bin/node',
      argvDigest: '8'.repeat(64),
      cgroup: '0::/qa\n',
    },
  };
  const child = childFixture();
  const completion = diagnostics.firstCutoverSshCompletion(child, 'ingress');
  let buffered = '';
  child.stdin.on('data', (bytes) => {
    buffered += bytes.toString();
    let end = buffered.indexOf('\n');
    while (end >= 0) {
      const request = JSON.parse(buffered.slice(0, end));
      buffered = buffered.slice(end + 1);
      end = buffered.indexOf('\n');
      if (request.name === 'attach') {
        child.stdout.write(
          `${JSON.stringify({ protocol: 1, type: 'result', seq: request.seq, value: { host: 'aliyun', ...input, execution } })}\n`,
        );
      } else {
        child.stdout.end();
        child.stderr.end(line('ingress', 'RECEIVER_LOCAL'));
        setImmediate(() => child.emit('close', 1, null));
      }
    }
  });
  const client = await connectFirstCutoverIngressSession(input, {
    platform: 'linux',
    uid: 0,
    now: Date.now,
    journal: { assertOwnership: async () => binding, readFirstCutoverEffects: async () => binding },
    observeWriters: async () => ({}),
    verifyOpenedIdentity: async () => ({}),
    open: async () => ({ input: child.stdout, output: child.stdin, completion }),
  });
  let failure;
  try {
    await client.verifyFence();
  } catch (error) {
    failure = error;
  }
  assert.ok(failure);
  assert.equal(failure.message, 'CUTOVER_INGRESS_SESSION_UNPROVEN');
  assert.equal(diagnostics.ingressDiagnosticStage(failure), 'RECEIVER_LOCAL');
  assert.deepEqual(await completion, { code: 1, receiverStage: 'RECEIVER_LOCAL' });
  child.stdin.destroy();
});

test('stderr stream error is handled and never adopted as a receiver hint', async () => {
  const child = childFixture();
  const completion = diagnostics.firstCutoverSshCompletion(child, 'ingress');
  child.stderr.emit('error', Error(secret));
  child.stderr.end(line());
  await new Promise((resolve) => setImmediate(resolve));
  child.emit('close', 1, null);
  assert.deepEqual(await completion, { code: 1 });
});
