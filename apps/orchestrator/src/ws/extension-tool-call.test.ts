import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { RawData } from 'ws';

beforeAll(() => {
  process.env.DATABASE_URL ??= 'mysql://holaday:holaday-dev@127.0.0.1:3306/holaday';
  process.env.REDIS_URL ??= 'redis://127.0.0.1:6379/0';
  process.env.JWT_SECRET ??= 'integration-test-secret-must-be-32-chars-or-more-please';
});

describe('extension tool-call websocket lifecycle', () => {
  let close: () => Promise<void> = async () => {};

  afterEach(async () => {
    await close();
    close = async () => {};
  });

  it('settles in-flight tool calls when the extension socket disconnects', async () => {
    const { WS_SUBPROTOCOL, parseServerMessage } = await import('@holaday/shared-types');
    const { signAccessToken } = await import('../auth/jwt.js');
    const { createWsServer, sendExtensionToolCall } = await import('./server.js');
    const { default: WebSocket } = await import('ws');

    const port = 38224;
    const server = createWsServer(port);
    close = async () => {
      await server.close();
    };

    const userId = 'usr_extension_disconnect_test';
    const token = await signAccessToken({ sub: userId, plan: 'free' });
    const client = new WebSocket(`ws://127.0.0.1:${port}`, WS_SUBPROTOCOL);

    await new Promise<void>((resolve, reject) => {
      client.once('open', resolve);
      client.once('error', reject);
    });

    const toolCallSeen = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('no extension tool call')), 5_000);
      client.on('message', (raw) => {
        const parsed = parseServerMessage(raw.toString());
        if (parsed.success && parsed.data.type === 'server.extension.tool_call') {
          clearTimeout(timer);
          client.close();
          resolve();
        }
      });
    });

    const welcome = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('no welcome')), 5_000);
      client.on('message', (raw) => {
        const parsed = parseServerMessage(raw.toString());
        if (parsed.success && parsed.data.type === 'server.welcome') {
          clearTimeout(timer);
          resolve();
        }
      });
    });

    client.send(
      JSON.stringify({
        type: 'client.hello',
        token,
        extensionVersion: 'test-extension',
      }),
    );
    await welcome;

    const outcomePromise = sendExtensionToolCall(userId, {
      taskId: 'tsk_extension_disconnect_test',
      kind: 'navigate',
      args: { url: 'https://example.com/' },
      timeoutMs: 30_000,
    });
    await toolCallSeen;

    const outcome = await Promise.race([
      outcomePromise,
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('tool call did not settle after socket close')), 1_000);
      }),
    ]);

    expect(outcome).toEqual({
      ok: false,
      error: {
        message: '浏览器扩展连接已断开，请重新打开 HOLA DAY 扩展后重试',
        code: 'socket_closed',
      },
    });
  });

  it('ignores tool results from the wrong extension socket or task', async () => {
    const { WS_SUBPROTOCOL, parseServerMessage } = await import('@holaday/shared-types');
    const { signAccessToken } = await import('../auth/jwt.js');
    const { createWsServer, sendExtensionToolCall } = await import('./server.js');
    const { default: WebSocket } = await import('ws');

    const port = 38225;
    const server = createWsServer(port);
    close = async () => {
      await server.close();
    };

    const userId = 'usr_extension_owner_guard_test';
    const token = await signAccessToken({ sub: userId, plan: 'free' });
    const primary = new WebSocket(`ws://127.0.0.1:${port}`, WS_SUBPROTOCOL);
    const secondary = new WebSocket(`ws://127.0.0.1:${port}`, WS_SUBPROTOCOL);

    await Promise.all([
      new Promise<void>((resolve, reject) => {
        primary.once('open', resolve);
        primary.once('error', reject);
      }),
      new Promise<void>((resolve, reject) => {
        secondary.once('open', resolve);
        secondary.once('error', reject);
      }),
    ]);

    const waitForWelcome = (client: typeof primary): Promise<void> =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('no welcome')), 5_000);
        client.on('message', (raw: RawData) => {
          const parsed = parseServerMessage(raw.toString());
          if (parsed.success && parsed.data.type === 'server.welcome') {
            clearTimeout(timer);
            resolve();
          }
        });
      });

    primary.send(
      JSON.stringify({
        type: 'client.hello',
        token,
        extensionVersion: 'primary-test-extension',
      }),
    );
    secondary.send(
      JSON.stringify({
        type: 'client.hello',
        token,
        extensionVersion: 'secondary-test-extension',
      }),
    );
    await Promise.all([waitForWelcome(primary), waitForWelcome(secondary)]);

    secondary.send(JSON.stringify({ type: 'client.pong', at: Date.now() }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    primary.send(JSON.stringify({ type: 'client.pong', at: Date.now() }));
    await new Promise((resolve) => setTimeout(resolve, 20));

    const toolCall = new Promise<{
      taskId: string;
      requestId: string;
    }>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('no extension tool call')), 5_000);
      primary.on('message', (raw) => {
        const parsed = parseServerMessage(raw.toString());
        if (parsed.success && parsed.data.type === 'server.extension.tool_call') {
          clearTimeout(timer);
          resolve({
            taskId: parsed.data.taskId,
            requestId: parsed.data.requestId,
          });
        }
      });
    });

    const outcomePromise = sendExtensionToolCall(userId, {
      taskId: 'tsk_extension_owner_guard_test',
      kind: 'navigate',
      args: { url: 'https://example.com/' },
      timeoutMs: 30_000,
    });
    const call = await toolCall;

    secondary.send(
      JSON.stringify({
        type: 'client.extension.tool_result',
        taskId: call.taskId,
        requestId: call.requestId,
        ok: true,
        result: { finalUrl: 'https://wrong-socket.test/' },
        at: Date.now(),
      }),
    );
    primary.send(
      JSON.stringify({
        type: 'client.extension.tool_result',
        taskId: 'tsk_wrong_task',
        requestId: call.requestId,
        ok: true,
        result: { finalUrl: 'https://wrong-task.test/' },
        at: Date.now(),
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    primary.send(
      JSON.stringify({
        type: 'client.extension.tool_result',
        taskId: call.taskId,
        requestId: call.requestId,
        ok: true,
        result: { finalUrl: 'https://example.com/final' },
        at: Date.now(),
      }),
    );

    await expect(outcomePromise).resolves.toEqual({
      ok: true,
      result: { finalUrl: 'https://example.com/final' },
    });

    primary.close();
    secondary.close();
  });

  it('routes tool calls to the most recently responsive extension socket', async () => {
    const { WS_SUBPROTOCOL, parseServerMessage } = await import('@holaday/shared-types');
    const { signAccessToken } = await import('../auth/jwt.js');
    const { createWsServer, sendExtensionToolCall } = await import('./server.js');
    const { default: WebSocket } = await import('ws');

    const port = 38226;
    const server = createWsServer(port);
    close = async () => {
      await server.close();
    };

    const userId = 'usr_extension_fresh_socket_test';
    const token = await signAccessToken({ sub: userId, plan: 'free' });
    const primary = new WebSocket(`ws://127.0.0.1:${port}`, WS_SUBPROTOCOL);
    const secondary = new WebSocket(`ws://127.0.0.1:${port}`, WS_SUBPROTOCOL);

    await Promise.all([
      new Promise<void>((resolve, reject) => {
        primary.once('open', resolve);
        primary.once('error', reject);
      }),
      new Promise<void>((resolve, reject) => {
        secondary.once('open', resolve);
        secondary.once('error', reject);
      }),
    ]);

    const waitForWelcome = (client: typeof primary): Promise<void> =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('no welcome')), 5_000);
        client.on('message', (raw: RawData) => {
          const parsed = parseServerMessage(raw.toString());
          if (parsed.success && parsed.data.type === 'server.welcome') {
            clearTimeout(timer);
            resolve();
          }
        });
      });

    primary.send(
      JSON.stringify({
        type: 'client.hello',
        token,
        extensionVersion: 'primary-test-extension',
      }),
    );
    await waitForWelcome(primary);
    secondary.send(
      JSON.stringify({
        type: 'client.hello',
        token,
        extensionVersion: 'secondary-test-extension',
      }),
    );
    await waitForWelcome(secondary);

    primary.send(JSON.stringify({ type: 'client.pong', at: Date.now() }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    secondary.send(JSON.stringify({ type: 'client.pong', at: Date.now() }));
    await new Promise((resolve) => setTimeout(resolve, 20));

    const primaryUnexpectedCall = new Promise<never>((_, reject) => {
      primary.on('message', (raw) => {
        const parsed = parseServerMessage(raw.toString());
        if (parsed.success && parsed.data.type === 'server.extension.tool_call') {
          reject(new Error('tool call was routed to stale primary extension socket'));
        }
      });
    });

    const secondaryToolCall = new Promise<{
      taskId: string;
      requestId: string;
    }>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('no extension tool call')), 5_000);
      secondary.on('message', (raw) => {
        const parsed = parseServerMessage(raw.toString());
        if (parsed.success && parsed.data.type === 'server.extension.tool_call') {
          clearTimeout(timer);
          resolve({
            taskId: parsed.data.taskId,
            requestId: parsed.data.requestId,
          });
        }
      });
    });

    const outcomePromise = sendExtensionToolCall(userId, {
      taskId: 'tsk_extension_fresh_socket_test',
      kind: 'navigate',
      args: { url: 'https://example.com/' },
      timeoutMs: 30_000,
    });

    const call = await Promise.race([secondaryToolCall, primaryUnexpectedCall]);
    secondary.send(
      JSON.stringify({
        type: 'client.extension.tool_result',
        taskId: call.taskId,
        requestId: call.requestId,
        ok: true,
        result: { finalUrl: 'https://example.com/fresh' },
        at: Date.now(),
      }),
    );

    await expect(outcomePromise).resolves.toEqual({
      ok: true,
      result: { finalUrl: 'https://example.com/fresh' },
    });

    primary.close();
    secondary.close();
  });
});
