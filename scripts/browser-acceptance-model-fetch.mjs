import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** Local acceptance transport only. Its private Python sibling owns the ledger and endpoint. */
export const RELAY_DEADLINES = Object.freeze({ providerMs: 75000, sshMs: 95000, nodeMs: 105000 });

export function createRelayRunner({
  executable = 'python3',
  relayPath = fileURLToPath(new URL('./real-model-relay.py', import.meta.url)),
  timeoutMs = RELAY_DEADLINES.nodeMs,
  killGraceMs = 2000,
  maxOutputBytes = 4 * 1024 * 1024,
} = {}) {
  assert.ok(Number.isInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= RELAY_DEADLINES.nodeMs);
  assert.ok(Number.isInteger(killGraceMs) && killGraceMs >= 0 && killGraceMs <= 2000);
  assert.ok(
    Number.isInteger(maxOutputBytes) && maxOutputBytes > 0 && maxOutputBytes <= 4 * 1024 * 1024,
  );
  assert.equal(typeof executable, 'string');
  assert.equal(typeof relayPath, 'string');
  return (request, signal) =>
    new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(Error('existing_model_request_already_aborted'));
        return;
      }
      const child = spawn(
        executable,
        [relayPath, ...(request.mode === 'send' ? ['--allow-real-model'] : [])],
        { stdio: ['pipe', 'pipe', 'pipe'], detached: true },
      );
      let chunks = [];
      let length = 0;
      let reason = null;
      let settled = false;
      let spawnFailed = false;
      let escalation;
      const kill = (kind) => {
        if (!child.pid) return;
        try {
          process.kill(-child.pid, kind);
        } catch (error) {
          if (error.code !== 'ESRCH') spawnFailed = true;
        }
      };
      const stop = (why) => {
        if (settled || reason) return;
        reason = why;
        chunks = [];
        kill('SIGTERM');
        escalation = setTimeout(() => kill('SIGKILL'), killGraceMs);
        escalation.unref();
      };
      const watchdog = setTimeout(() => stop('timeout'), timeoutMs);
      const abort = () => stop('aborted');
      signal?.addEventListener('abort', abort, { once: true });
      child.stdout.on('data', (chunk) => {
        if (settled || reason) return;
        length += chunk.length;
        if (length > maxOutputBytes) {
          stop('output_limit');
          return;
        }
        chunks.push(chunk);
      });
      // Never include remote stderr or provider content in an exception/log.
      child.stderr.resume();
      child.stdin.on('error', () => stop('stdin_error'));
      child.once('error', () => {
        spawnFailed = true;
      });
      child.once('close', (code) => {
        settled = true;
        clearTimeout(watchdog);
        clearTimeout(escalation);
        signal?.removeEventListener('abort', abort);
        if (reason) {
          reject(Error(`existing_model_relay_${reason}`));
          return;
        }
        if (spawnFailed || code !== 0) {
          reject(Error('bounded_existing_model_relay_failed'));
          return;
        }
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch {
          reject(Error('invalid_existing_model_relay_receipt'));
        }
      });
      if (signal?.aborted) {
        abort();
        child.stdin.end();
        return;
      }
      child.stdin.end(JSON.stringify(request));
    });
}

export const runExistingModelRelay = createRelayRunner();

export function createExistingModelFetch(
  descriptor,
  scopeForRequest,
  runner = runExistingModelRelay,
) {
  return async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    assert.equal(url.href, `${descriptor.baseURL}/v1/messages`);
    assert.equal(init.method, 'POST');
    assert.equal(typeof init.body, 'string');
    const result = await runner(
      { mode: 'send', scope: scopeForRequest(), body: JSON.parse(init.body) },
      init.signal,
    );
    assert.equal(result.credentialValuesReturned, false);
    assert.ok(Number.isInteger(result.status) && result.status >= 100 && result.status <= 599);
    assert.equal(typeof result.bodyBase64, 'string');
    assert.ok(result.bodyBase64.length <= 3 * 1024 * 1024);
    const body = Buffer.from(result.bodyBase64, 'base64');
    assert.ok(body.length <= 2 * 1024 * 1024);
    assert.equal(body.toString('base64'), result.bodyBase64);
    return new Response(body, {
      status: result.status,
      headers: { 'content-type': result.contentType },
    });
  };
}
