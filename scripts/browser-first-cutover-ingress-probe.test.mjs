import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import test from 'node:test';
import * as fence from './browser-first-cutover-fence.mjs';

// Real loopback HTTP at the socket boundary; the Linux nginx fixture exercises
// actual TLS and IPv6. Catch lost method/WS headers, false no-store, SSRF/scope
// expansion, redirect success and invented writer-zero evidence.
async function fixture(
  t,
  response = (req, res) => {
    res.writeHead(
      req.url.includes('/api/internal/') || req.url.includes('/api/payment/') ? 401 : 503,
      { 'cache-control': 'private, no-store' },
    );
    res.end('not evidence');
  },
) {
  const seen = [];
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const bytes of req) chunks.push(bytes);
    seen.push({
      path: req.url,
      method: req.method,
      headers: req.headers,
      body: Buffer.concat(chunks).toString(),
    });
    response(req, res);
  });
  const connections = new Set();
  server.on('connection', (socket) => {
    connections.add(socket);
    socket.on('close', () => connections.delete(socket));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    for (const socket of connections) socket.destroy();
    server.closeAllConnections();
    return new Promise((resolve) => server.close(resolve));
  });
  const bytes = await readFile(
    new URL('./fixtures/cutover-nginx/holaday.conf', import.meta.url),
    'utf8',
  );
  const file = {
    ...fence.describeCutoverSite(bytes, 'vultr-20260926'),
    path: '/etc/nginx/sites-available/holaday',
  };
  const approval = { inventoryDigest: 'a'.repeat(64), unknownIngress: [], files: [file] };
  let count = 0;
  const io = {
    now: () => 1000,
    observeWriters: async () => ({
      inventoryDigest: approval.inventoryDigest,
      observedAtMs: 1000,
      existingSockets: 0,
      internalWriters: 0,
      producersRunning: 0,
    }),
    request: (options, callback) => {
      count++;
      assert.equal(options.port, 443);
      assert.equal(options.servername, 'holaday.ai');
      assert.equal(options.rejectUnauthorized, true);
      assert.ok(['127.0.0.1', '::1'].includes(options.hostname));
      assert.equal(options.agent, false);
      return http.request(
        { ...options, hostname: '127.0.0.1', port: server.address().port },
        callback,
      );
    },
  };
  return { approval, io, seen, server, count: () => count };
}

test('production probe covers each approved route and uses invalid callbacks and real WS handshakes', async (t) => {
  const f = await fixture(t);
  assert.equal(typeof fence.probeCutoverIngress, 'function');
  const result = await fence.probeCutoverIngress(f.approval, 'orders', f.io);
  assert.equal(result.probes.length, 20);
  assert.equal(f.seen.length, 20);
  assert.equal(result.existingSockets, 0);
  assert.ok(result.probes.every((p) => p.noStore === true));
  const callbacks = f.seen.filter((p) => /\/api\/(?:internal|payment)\//.test(p.path));
  assert.equal(callbacks.length, 6);
  assert.ok(
    callbacks.every((p) => p.method === 'POST' && p.body === '{}' && !p.headers.authorization),
  );
  const sockets = f.seen.filter((p) => p.headers.upgrade === 'websocket');
  assert.equal(sockets.length, 6);
  assert.ok(
    sockets.every((p) => p.method === 'GET' && p.headers['sec-websocket-version'] === '13'),
  );
  assert.ok(result.probes.every((p) => p.path === '/etc/nginx/sites-available/holaday'));
  // The exact health exception must not stand in for its fenced business prefix.
  assert.equal(f.seen.filter((p) => p.path === '/healthz__holaday_cutover_probe__').length, 2);
  assert.ok(!f.seen.some((p) => p.path === '/healthz'));
});

test('unapproved routes, destinations and missing writer observations refuse before network', async (t) => {
  const f = await fixture(t);
  assert.equal(typeof fence.probeCutoverIngress, 'function');
  for (const mutate of [
    (a) => {
      a.unknownIngress = ['unknown'];
    },
    (a) => {
      a.files[0].locations[0].serverName = 'attacker.test';
    },
    (a) => {
      a.files[0].path = '/etc/nginx/sites-available/other';
    },
    (a) => {
      a.files.push(a.files[0]);
    },
  ]) {
    const a = structuredClone(f.approval);
    mutate(a);
    await assert.rejects(
      fence.probeCutoverIngress(a, 'orders', f.io),
      /CUTOVER_INGRESS_PROBE_UNPROVEN/,
    );
  }
  await assert.rejects(
    fence.probeCutoverIngress(f.approval, 'orders', { ...f.io, observeWriters: undefined }),
    /UNPROVEN/,
  );
  assert.equal(f.count(), 0);
});

test('writer counts remain actual nonzero evidence and cannot silently default to zero', async (t) => {
  const f = await fixture(t);
  assert.equal(typeof fence.probeCutoverIngress, 'function');
  f.io.observeWriters = async () => ({
    inventoryDigest: f.approval.inventoryDigest,
    observedAtMs: 1000,
    existingSockets: 2,
    internalWriters: 3,
    producersRunning: 1,
  });
  const r = await fence.probeCutoverIngress(f.approval, 'all-writers', f.io);
  assert.deepEqual([r.existingSockets, r.internalWriters, r.producersRunning], [2, 3, 1]);
  for (const change of [
    { existingSockets: undefined },
    { internalWriters: -1 },
    { observedAtMs: 1001 },
    { inventoryDigest: 'b'.repeat(64) },
  ]) {
    f.io.observeWriters = async () => ({
      inventoryDigest: f.approval.inventoryDigest,
      observedAtMs: 1000,
      existingSockets: 0,
      internalWriters: 0,
      producersRunning: 0,
      ...change,
    });
    await assert.rejects(fence.probeCutoverIngress(f.approval, 'orders', f.io), /UNPROVEN/);
  }
});

test('redirects and cacheable denial are returned as failures, never followed or made no-store', async (t) => {
  const f = await fixture(t, (_req, res) => {
    res.writeHead(302, { location: 'http://attacker.test', 'cache-control': 'no-cache' });
    res.end();
  });
  assert.equal(typeof fence.probeCutoverIngress, 'function');
  const r = await fence.probeCutoverIngress(f.approval, 'orders', f.io);
  assert.equal(f.count(), 20);
  assert.ok(r.probes.every((p) => p.status === 302 && p.noStore === false));
});

test('oversized or truncated response fails the whole observation without retry', async (t) => {
  for (const response of [
    (_req, res) => res.end('x'.repeat(65537)),
    (_req, res) => {
      res.writeHead(503, { 'content-length': '1000' });
      res.write('short');
      res.destroy();
    },
  ]) {
    const f = await fixture(t, response);
    assert.equal(typeof fence.probeCutoverIngress, 'function');
    await assert.rejects(fence.probeCutoverIngress(f.approval, 'orders', f.io), /UNPROVEN/);
    assert.ok(f.count() <= 20);
  }
});

test('an accepted WebSocket upgrade is refused and its socket is closed', async (t) => {
  const f = await fixture(t);
  const sockets = new Set();
  t.after(() => {
    for (const socket of sockets) socket.destroy();
  });
  f.server.on('upgrade', (_req, socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n',
    );
  });
  await assert.rejects(fence.probeCutoverIngress(f.approval, 'orders', f.io), /UNPROVEN/);
  assert.equal(f.count(), 20);
});

test(
  'stalled response bodies time out without retry or partial success',
  { timeout: 10000 },
  async (t) => {
    const f = await fixture(t, (_req, res) => {
      res.writeHead(503, { 'cache-control': 'no-store' });
      res.write('unfinished');
    });
    await assert.rejects(fence.probeCutoverIngress(f.approval, 'orders', f.io), /UNPROVEN/);
    assert.equal(f.count(), 20);
  },
);

test('verification uses the production probe when no substitute is supplied', async (t) => {
  const f = await fixture(t);
  const generated = 'server configuration';
  const { createHash } = await import('node:crypto');
  const receipt = {
    attempt: '11111111-1111-4111-8111-111111111111',
    inventoryDigest: f.approval.inventoryDigest,
    phase: 'active',
    stage: 'orders',
    files: [
      {
        path: f.approval.files[0].path,
        originalDigest: f.approval.files[0].digest,
        backupDigest: f.approval.files[0].digest,
        generatedDigest: createHash('sha256').update(generated).digest('hex'),
      },
    ],
  };
  const io = {
    now: f.io.now,
    readApprovedIngress: async () => f.approval,
    assertJournalOwnership: async () => ({
      attempt: receipt.attempt,
      inventoryDigest: receipt.inventoryDigest,
    }),
    readFenceReceipt: async () => receipt,
    readConfig: async () => generated,
    ingressProbe: f.io,
  };
  const result = await fence.verifyCutoverFence(
    { inventoryDigest: receipt.inventoryDigest, stage: 'orders' },
    io,
  );
  assert.equal(result.stage, 'orders');
  assert.equal(f.count(), 20);
});

test('writer changes during probes and clock reversal cannot publish an observation', async (t) => {
  for (const kind of ['writers', 'clock']) {
    const f = await fixture(t);
    let reads = 0;
    let reversed = false;
    f.io.now = () => (reversed ? 999 : 1000);
    const original = f.io.observeWriters;
    f.io.observeWriters = async () => {
      const value = await original();
      reads++;
      if (reads === 2) {
        if (kind === 'writers') value.internalWriters = 1;
        else reversed = true;
      }
      return value;
    };
    await assert.rejects(fence.probeCutoverIngress(f.approval, 'all-writers', f.io), /UNPROVEN/);
  }
});

test('clock reversal above the start time still refuses the observation', async (t) => {
  const f = await fixture(t);
  let reads = 0;
  f.io.now = () => (++reads === 1 ? 1000 : reads === 2 ? 1010 : 1005);
  await assert.rejects(fence.probeCutoverIngress(f.approval, 'orders', f.io), /UNPROVEN/);
  assert.equal(f.count(), 0);
});

async function diagnosticRefusal(action, stage) {
  const { ingressDiagnosticStage } = await import(
    './browser-first-cutover-ingress-diagnostics.mjs'
  );
  await assert.rejects(action, (error) => {
    assert.equal(error.message, 'CUTOVER_INGRESS_PROBE_UNPROVEN');
    assert.equal(ingressDiagnosticStage(error), stage);
    assert.deepEqual(error.cause, { ingressStage: stage });
    return true;
  });
}
test('probe diagnostics preserve request-stage clock rejection without raw request errors', async (t) => {
  const f = await fixture(t);
  let clocks = 0;
  f.io.now = () => (++clocks <= 2 ? 1000 : 999);
  await diagnosticRefusal(fence.probeCutoverIngress(f.approval, 'orders', f.io), 'PROBE_CLOCK');
  assert.equal(f.count(), 0);
});
test('probe diagnostics distinguish writer observation, drift and request failure without retry', async (t) => {
  for (const mode of ['read', 'shape', 'drift', 'request']) {
    const f = await fixture(t);
    const original = f.io.observeWriters;
    let reads = 0;
    f.io.observeWriters = async () => {
      if (mode === 'read') throw new Error('private writer payload');
      const value = await original();
      reads++;
      if (mode === 'shape') value.internalWriters = -1;
      if (mode === 'drift' && reads === 2) value.internalWriters = 1;
      return value;
    };
    if (mode === 'request')
      f.io.request = () => {
        throw new Error('private URL/header');
      };
    await diagnosticRefusal(
      fence.probeCutoverIngress(f.approval, 'orders', f.io),
      {
        read: 'PROBE_WRITER_READ',
        shape: 'PROBE_WRITER_SHAPE',
        drift: 'PROBE_WRITER_DRIFT',
        request: 'PROBE_REQUEST',
      }[mode],
    );
  }
});
test(
  'probe diagnostics retain body limit and bounded timeout categories after all requests settle',
  { timeout: 12000 },
  async (t) => {
    for (const mode of ['body', 'timeout']) {
      const f = await fixture(t, (_req, res) => {
        res.writeHead(503, { 'cache-control': 'no-store' });
        if (mode === 'body') res.end('x'.repeat(65537));
        else res.write('unfinished');
      });
      await diagnosticRefusal(
        fence.probeCutoverIngress(f.approval, 'orders', f.io),
        mode === 'body' ? 'PROBE_BODY' : 'PROBE_TIMEOUT',
      );
      assert.equal(f.count(), 20);
    }
  },
);
