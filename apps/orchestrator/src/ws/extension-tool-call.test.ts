import { afterEach, beforeAll, describe, expect, it } from 'vitest';

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
});
