import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { startSeedServer } from '../lib/server.mjs';
test('local HTTP seed persists mutations, rejects unknown contracts and resets deterministically', async () => {
  const server = await startSeedServer(path.resolve('apps/web-workbench'));
  try {
    assert.match(server.origin, /^http:\/\/127\.0\.0\.1:/);
    const first = await (
      await fetch(
        `${server.origin}/api/trpc/tasks.list?input=${encodeURIComponent(JSON.stringify({ limit: 2 }))}`,
      )
    ).json();
    assert.equal(first.result.data.tasks.length, 2);
    const taskId = first.result.data.tasks[0].taskId;
    const renamed = await fetch(`${server.origin}/api/trpc/tasks.rename`, {
      method: 'POST',
      body: JSON.stringify({ taskId, title: 'changed local only' }),
    });
    assert.equal(renamed.status, 200);
    const detail = await (
      await fetch(
        `${server.origin}/api/trpc/tasks.detail?input=${encodeURIComponent(JSON.stringify({ taskId }))}`,
      )
    ).json();
    assert.equal(detail.result.data.title, 'changed local only');
    assert.equal((await fetch(`${server.origin}/api/trpc/unknown.feature`)).status, 501);
    assert.ok(server.seed.unhandled.some((x) => x.name === 'unknown.feature'));
    await fetch(`${server.origin}/__ui_seed/reset`);
    assert.equal(server.seed.unhandled.length, 0);
    assert.notEqual(server.seed.tasks[0].title, 'changed local only');
    const denied = await fetch(`${server.origin}/api/trpc/videoEditing.getProject`);
    assert.equal(denied.status, 403);
    assert.equal((await denied.json()).error.data.code, 'FORBIDDEN');
    assert.equal(server.seed.unhandled.length, 0);
  } finally {
    await server.close();
  }
});

test('uploads preserve PNG bytes; missing asset and unknown file API are rejected', async () => {
  const server = await startSeedServer(path.resolve('apps/web-workbench'));
  try {
    assert.equal((await fetch(`${server.origin}/missing-ui-asset.js`)).status, 404);
    assert.equal((await fetch(`${server.origin}/api/files/unknown/path`)).status, 501);
    const bytes = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0u8AAAAASUVORK5CYII=',
      'base64',
    );
    const data = new FormData();
    data.set('file', new Blob([bytes], { type: 'image/png' }), 'ui.png');
    const upload = await (
      await fetch(`${server.origin}/api/files/upload`, { method: 'POST', body: data })
    ).json();
    const result = await fetch(server.origin + upload.url);
    assert.equal(result.headers.get('content-type'), 'image/png');
    assert.deepEqual(Buffer.from(await result.arrayBuffer()), bytes);
  } finally {
    await server.close();
  }
});

test('local screencast sends a valid deterministic frame and consumes only local input', async () => {
  const require = createRequire(path.resolve('apps/orchestrator/package.json'));
  const { WebSocket } = require('ws');
  const server = await startSeedServer(path.resolve('apps/web-workbench'));
  let socket;
  try {
    const messages = [];
    const frame = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('local frame timeout')), 2000);
      socket = new WebSocket(
        `${server.origin.replace('http:', 'ws:')}/screencast-ws/tsk_ui_browser_executing`,
        'holaday.v1',
      );
      socket.on('error', reject);
      socket.on('message', (bytes) => {
        const m = JSON.parse(bytes.toString());
        messages.push(m);
        if (m.type === 'frame') {
          clearTimeout(timeout);
          resolve(m);
        }
      });
    });
    const png = Buffer.from(frame.data, 'base64');
    assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.equal(png.readUInt32BE(16), 960);
    assert.equal(png.readUInt32BE(20), 600);
    assert.ok(
      messages.some(
        (m) => m.type === 'url-changed' && m.url === 'https://example.test/local-browser',
      ),
    );
    socket.send(
      JSON.stringify({
        type: 'input',
        payload: { type: 'key', key: 'Tab' },
        controlLease: 'local-only-control-lease',
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.ok(
      server.seed.requests.some((r) => r.name === 'local.browser.input' && r.input.type === 'key'),
    );
  } finally {
    socket?.terminate();
    await server.close();
  }
});
