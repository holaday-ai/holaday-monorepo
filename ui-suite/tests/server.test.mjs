import assert from 'node:assert/strict';
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
