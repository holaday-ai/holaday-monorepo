import { createServer } from 'node:http';
import { expect, it } from 'vitest';

it('an immediate close waits for the original pending bind and leaves no listener', async () => {
  const { createHttpListener } = await import('./http-listener.js');
  const listener = createHttpListener((_req, res) => res.end(), 0);
  const stopped = listener.close();
  expect(listener.close()).toBe(stopped);
  await stopped;
  expect(listener.server.listening).toBe(false);
});

it('reports actual HTTP bind readiness and closes the original listener', async () => {
  const { createHttpListener } = await import('./http-listener.js');
  const listener = createHttpListener((_req, res) => res.end('synthetic'), 0);
  try {
    await listener.ready;
    expect(listener.server.listening).toBe(true);
  } finally {
    await listener.close();
  }
  expect(listener.server.listening).toBe(false);
});

it('observes an occupied HTTP port without an uncaught error or fake readiness', async () => {
  const occupied = createServer();
  await new Promise<void>((resolve) => occupied.listen(0, resolve));
  try {
    const address = occupied.address();
    if (!address || typeof address === 'string') throw new Error('missing test port');
    const { createHttpListener } = await import('./http-listener.js');
    const listener = createHttpListener((_req, res) => res.end(), address.port);
    try {
      await expect(listener.ready).rejects.toThrow('HTTP_LISTEN_UNPROVEN');
    } finally {
      await listener.close();
    }
    expect(listener.server.listening).toBe(false);
    expect(occupied.listening).toBe(true);
  } finally {
    await new Promise<void>((resolve) => occupied.close(() => resolve()));
  }
});
