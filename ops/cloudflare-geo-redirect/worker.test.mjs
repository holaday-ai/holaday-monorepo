import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workerSource = await readFile(new URL('./worker.js', import.meta.url), 'utf8');
const workerModule = await import(
  `data:text/javascript;base64,${Buffer.from(workerSource).toString('base64')}`
);

function requestFromChina(pathname) {
  const request = new Request(`https://holaday.ai${pathname}`, {
    headers: {
      Accept: '*/*',
      Connection: 'Upgrade',
      Upgrade: 'websocket',
    },
  });
  Object.defineProperty(request, 'cf', {
    configurable: true,
    value: { country: 'CN' },
  });
  return request;
}

test('passes screencast WebSocket requests through for mainland users', async () => {
  const originalFetch = globalThis.fetch;
  let forwardedUrl = '';
  globalThis.fetch = async (request) => {
    forwardedUrl = request.url;
    return new Response('origin', { status: 200 });
  };

  try {
    const request = requestFromChina('/screencast-ws/tsk_123?token=stream');
    const response = await workerModule.default.fetch(request, {}, {});

    assert.equal(response.status, 200);
    assert.equal(forwardedUrl, request.url);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('does not treat similarly named pages as screencast routes', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('origin', { status: 200 });

  try {
    const response = await workerModule.default.fetch(
      requestFromChina('/screencast-ws-old'),
      {},
      {},
    );

    assert.equal(response.status, 302);
    assert.equal(
      response.headers.get('location'),
      'https://hd-app.orangebench.tech/screencast-ws-old',
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
