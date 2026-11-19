import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

let relay;
try {
  relay = await import('./browser-acceptance-model-fetch.mjs');
} catch {}

async function fixture(t, mode) {
  assert.ok(relay, 'bounded child-process relay has not been implemented');
  const root = await mkdtemp(join(tmpdir(), 'holaday-relay-child-'));
  const path = join(root, 'child.mjs');
  const trace = join(root, 'trace.json');
  await writeFile(
    path,
    `import {writeFileSync} from 'node:fs';
const mode=${JSON.stringify(mode)}; const trace=${JSON.stringify(trace)};
if(mode==='hang')process.on('SIGTERM',()=>{});
writeFileSync(trace,JSON.stringify({pid:process.pid,started:1,requests:0}));
let input='';process.stdin.on('data',chunk=>input+=chunk);process.stdin.on('end',()=>{
writeFileSync(trace,JSON.stringify({pid:process.pid,started:1,requests:1}));
if(mode==='hang'){setInterval(()=>{},1000);return;}
if(mode==='large'){process.stdout.write('x'.repeat(2048));return;}
if(mode==='malformed'){process.stdout.write('not-json');return;}
if(mode==='error'){process.stderr.write('synthetic-secret-not-for-errors');process.exitCode=2;return;}
process.stdout.write(JSON.stringify({status:200,contentType:'application/json',bodyBase64:Buffer.from('ok').toString('base64')}));});`,
  );
  const cleanup = () => {
    if (existsSync(trace)) {
      const { pid } = JSON.parse(readFileSync(trace, 'utf8'));
      try {
        process.kill(-pid, 'SIGKILL');
      } catch (error) {
        if (error.code !== 'ESRCH') throw error;
      }
    }
  };
  t.signal.addEventListener('abort', cleanup, { once: true });
  t.after(async () => {
    cleanup();
    await rm(root, { recursive: true, force: true });
  });
  return { path, trace };
}

async function started(trace) {
  for (let count = 0; count < 100; count++) {
    if (existsSync(trace)) return JSON.parse(readFileSync(trace, 'utf8'));
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw Error('owned fixture child did not start');
}

test('actual child receipt is received once', { timeout: 3000 }, async (t) => {
  const f = await fixture(t, 'ok');
  const run = relay.createRelayRunner({
    executable: process.execPath,
    relayPath: f.path,
    timeoutMs: 1000,
  });
  assert.equal((await run({ mode: 'describe' })).status, 200);
  assert.equal(JSON.parse(readFileSync(f.trace)).requests, 1);
});

test('already-aborted input does not spawn a child', async (t) => {
  const f = await fixture(t, 'ok');
  const controller = new AbortController();
  controller.abort();
  const run = relay.createRelayRunner({ executable: process.execPath, relayPath: f.path });
  await assert.rejects(run({ mode: 'describe' }, controller.signal), /already_aborted/);
  assert.equal(existsSync(f.trace), false);
});

test(
  'timeout kills a child that ignores SIGTERM without retrying',
  { timeout: 3500 },
  async (t) => {
    const f = await fixture(t, 'hang');
    const run = relay.createRelayRunner({
      executable: process.execPath,
      relayPath: f.path,
      timeoutMs: 1000,
      killGraceMs: 25,
    });
    await assert.rejects(run({ mode: 'describe' }), /timeout/);
    const record = JSON.parse(readFileSync(f.trace));
    assert.equal(record.requests, 1);
    assert.throws(() => process.kill(record.pid, 0), { code: 'ESRCH' });
  },
);

test(
  'cancellation confirms the owned child closed even when SIGTERM is ignored',
  { timeout: 3500 },
  async (t) => {
    const f = await fixture(t, 'hang');
    const controller = new AbortController();
    const run = relay.createRelayRunner({
      executable: process.execPath,
      relayPath: f.path,
      timeoutMs: 5000,
      killGraceMs: 25,
    });
    const result = run({ mode: 'describe' }, controller.signal);
    const record = await started(f.trace);
    controller.abort();
    await assert.rejects(result, /relay_aborted/);
    assert.throws(() => process.kill(record.pid, 0), { code: 'ESRCH' });
  },
);

test('oversized output is rejected instead of parsed or retried', { timeout: 3000 }, async (t) => {
  const f = await fixture(t, 'large');
  const run = relay.createRelayRunner({
    executable: process.execPath,
    relayPath: f.path,
    timeoutMs: 1000,
    maxOutputBytes: 1024,
  });
  await assert.rejects(run({ mode: 'describe' }), /output_limit/);
  assert.equal(JSON.parse(readFileSync(f.trace)).requests, 1);
});

test(
  'malformed receipts and failed children do not become successful responses',
  { timeout: 3000 },
  async (t) => {
    for (const mode of ['malformed', 'error']) {
      const f = await fixture(t, mode);
      const run = relay.createRelayRunner({
        executable: process.execPath,
        relayPath: f.path,
        timeoutMs: 1000,
      });
      await assert.rejects(run({ mode: 'describe' }), (error) => {
        assert.match(
          error.message,
          /invalid_existing_model_relay_receipt|bounded_existing_model_relay_failed/,
        );
        assert.ok(!error.message.includes('synthetic-secret-not-for-errors'));
        return true;
      });
    }
  },
);

test('URL and method guards reject before dispatch', async () => {
  assert.ok(relay, 'bounded child-process relay has not been implemented');
  let calls = 0;
  const fetch = relay.createExistingModelFetch(
    { baseURL: 'https://provider.invalid/apps/anthropic' },
    () => 'github-pr360',
    async () => {
      calls++;
    },
  );
  await assert.rejects(fetch('https://other.invalid/v1/messages', { method: 'POST', body: '{}' }));
  await assert.rejects(
    fetch('https://provider.invalid/apps/anthropic/v1/messages', { method: 'GET', body: '{}' }),
  );
  assert.equal(calls, 0);
});

test('fetch preserves actual response bytes and requires a valid transport envelope', async () => {
  assert.ok(relay, 'bounded child-process relay has not been implemented');
  const descriptor = { baseURL: 'https://provider.invalid/apps/anthropic' };
  const body = JSON.stringify({ model: 'fixture', max_tokens: 4, messages: [] });
  const received = JSON.stringify({ id: 'msg_fixture', content: [{ type: 'text', text: 'OK' }] });
  let captured;
  const fetch = relay.createExistingModelFetch(
    descriptor,
    () => 'github-pr360',
    async (request) => {
      captured = request;
      return {
        status: 200,
        contentType: 'application/json',
        credentialValuesReturned: false,
        bodyBase64: Buffer.from(received).toString('base64'),
      };
    },
  );
  assert.equal(
    await (await fetch(`${descriptor.baseURL}/v1/messages`, { method: 'POST', body })).text(),
    received,
  );
  assert.deepEqual(captured.body, JSON.parse(body));
  const malformed = relay.createExistingModelFetch(
    descriptor,
    () => 'github-pr360',
    async () => ({
      status: 200,
      contentType: 'application/json',
      credentialValuesReturned: false,
      bodyBase64: '%%%%',
    }),
  );
  await assert.rejects(malformed(`${descriptor.baseURL}/v1/messages`, { method: 'POST', body }));
});

test('invalid watchdog configuration cannot extend the maximum budget', () => {
  assert.ok(relay, 'bounded child-process relay has not been implemented');
  assert.throws(() => relay.createRelayRunner({ timeoutMs: 105001 }));
  assert.throws(() => relay.createRelayRunner({ killGraceMs: 2001 }));
});
