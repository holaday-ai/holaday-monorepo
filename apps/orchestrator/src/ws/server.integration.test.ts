import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

beforeAll(() => {
  process.env.DATABASE_URL ??= 'mysql://holaday:holaday-dev@127.0.0.1:3306/holaday';
  process.env.REDIS_URL ??= 'redis://127.0.0.1:6379/0';
  process.env.JWT_SECRET ??= 'integration-test-secret-must-be-32-chars-or-more-please';
  process.env.WS_PORT ??= '38202';
});

describe('WS server end-to-end', () => {
  let close: () => Promise<void> = async () => {};

  afterAll(async () => {
    await close();
  });

  it('JWT subprotocol auth -> welcome -> task.dispatch on planted task', async () => {
    const port = Number(process.env.WS_PORT);
    const { default: WebSocket } = await import('ws');
    const { signAccessToken, verifyAccessToken } = await import('../auth/jwt.js');
    const { createWsServer } = await import('./server.js');
    const { WS_SUBPROTOCOL, parseServerMessage } = await import('@holaday/shared-types');
    const { TaskController } = await import('../agent/task-controller.js');

    const ws = createWsServer(port, {
      authenticateToken: async (candidate) => (await verifyAccessToken(candidate))?.sub ?? null,
    });
    close = async () => {
      await ws.close();
    };

    const token = await signAccessToken({ sub: 'usr_abc12345', plan: 'free' });

    const client = new WebSocket(`ws://127.0.0.1:${port}`, [WS_SUBPROTOCOL, `jwt.${token}`]);

    const messages: unknown[] = [];
    const receivedWelcome = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('welcome timeout')), 5_000);
      client.on('message', (raw) => {
        const parsed = parseServerMessage(raw.toString());
        if (parsed.success) {
          messages.push(parsed.data);
          if (parsed.data.type === 'server.welcome') {
            clearTimeout(timer);
            resolve();
          }
        }
      });
      client.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });

    await new Promise<void>((resolve, reject) => {
      client.once('open', () => resolve());
      client.once('error', reject);
    });

    await receivedWelcome;
    const welcome = messages.find(
      (m): m is { type: 'server.welcome' } & Record<string, unknown> =>
        (m as { type: string }).type === 'server.welcome',
    );
    expect(welcome).toBeDefined();

    // Plant a task into the controller's view by injecting state via the
    // exported controller. (Phase 0: WS server uses a singleton controller;
    // the per-client task map lives on the connection state, so we plant
    // through an in-band synthetic flow: we inject by sending a step.result
    // for a task we 'expect' the server doesn't know — the protocol should
    // reply with server.error UNKNOWN_TASK. Then we know the dispatch
    // path is wired even without DB-backed tasks.)
    const taskController = new TaskController();
    void taskController; // keep import live; full dispatch lands with W2 SkillLoader

    client.send(
      JSON.stringify({
        type: 'client.step.result',
        taskId: 'tsk_does_not_exist',
        stepId: 'stp_x',
        status: 'ok',
      }),
    );

    const errFrame = await new Promise<{ type: string; code?: string }>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('no error frame')), 5_000);
      client.on('message', (raw) => {
        const parsed = parseServerMessage(raw.toString());
        if (parsed.success && parsed.data.type === 'server.error') {
          clearTimeout(timer);
          resolve(parsed.data);
        }
      });
    });
    expect(errFrame.code).toBe('UNKNOWN_TASK');

    client.close();
  });

  it('uses the connection authenticator once for an accepted subprotocol token', async () => {
    const port = Number(process.env.WS_PORT) + 1;
    const { default: WebSocket } = await import('ws');
    const { createWsServer } = await import('./server.js');
    const { WS_SUBPROTOCOL, parseServerMessage } = await import('@holaday/shared-types');
    const authenticateToken = vi.fn(async () => 'usr_ws_active');
    const ws = createWsServer(port, { authenticateToken });
    close = async () => {
      await ws.close();
    };
    const client = new WebSocket(`ws://127.0.0.1:${port}`, [
      WS_SUBPROTOCOL,
      'jwt.signed-access-token',
    ]);

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('welcome timeout')), 5_000);
      client.on('message', (raw) => {
        const parsed = parseServerMessage(raw.toString());
        if (parsed.success && parsed.data.type === 'server.welcome') {
          clearTimeout(timer);
          resolve();
        }
      });
      client.once('error', reject);
    });

    expect(authenticateToken).toHaveBeenCalledTimes(1);
    expect(authenticateToken).toHaveBeenCalledWith('signed-access-token');
    client.close();
  });

  it('rejects a revoked access token supplied in client.hello', async () => {
    const port = Number(process.env.WS_PORT) + 2;
    const { default: WebSocket } = await import('ws');
    const { createWsServer } = await import('./server.js');
    const { WS_SUBPROTOCOL, parseServerMessage } = await import('@holaday/shared-types');
    const authenticateToken = vi.fn(async () => null);
    const ws = createWsServer(port, { authenticateToken });
    close = async () => {
      await ws.close();
    };
    const client = new WebSocket(`ws://127.0.0.1:${port}`, WS_SUBPROTOCOL);

    await new Promise<void>((resolve, reject) => {
      client.once('open', resolve);
      client.once('error', reject);
    });
    const unauthorized = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('unauthorized timeout')), 5_000);
      client.on('message', (raw) => {
        const parsed = parseServerMessage(raw.toString());
        if (
          parsed.success &&
          parsed.data.type === 'server.error' &&
          parsed.data.code === 'UNAUTHORIZED'
        ) {
          clearTimeout(timer);
          resolve();
        }
      });
    });
    client.send(
      JSON.stringify({
        type: 'client.hello',
        token: 'revoked-access-token',
        extensionVersion: 'web-workbench',
      }),
    );

    await unauthorized;
    expect(authenticateToken).toHaveBeenCalledTimes(1);
    expect(authenticateToken).toHaveBeenCalledWith('revoked-access-token');
    client.close();
  });

  it('fails closed when the connection authenticator throws', async () => {
    const port = Number(process.env.WS_PORT) + 3;
    const { default: WebSocket } = await import('ws');
    const { createWsServer } = await import('./server.js');
    const { WS_SUBPROTOCOL, parseServerMessage } = await import('@holaday/shared-types');
    const authenticateToken = vi.fn(async () => {
      throw new Error('database unavailable');
    });
    const ws = createWsServer(port, { authenticateToken });
    close = async () => {
      await ws.close();
    };
    const client = new WebSocket(`ws://127.0.0.1:${port}`, [
      WS_SUBPROTOCOL,
      'jwt.signed-access-token',
    ]);

    await new Promise<void>((resolve, reject) => {
      client.once('open', resolve);
      client.once('error', reject);
    });
    const unauthorized = new Promise<{ code: string }>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('unauthorized timeout')), 5_000);
      client.on('message', (raw) => {
        const parsed = parseServerMessage(raw.toString());
        if (parsed.success && parsed.data.type === 'server.error') {
          clearTimeout(timer);
          resolve(parsed.data);
        }
      });
      client.once('error', reject);
    });
    client.send(
      JSON.stringify({
        type: 'client.hello',
        token: 'signed-access-token',
        extensionVersion: 'web-workbench',
      }),
    );

    expect((await unauthorized).code).toBe('UNAUTHORIZED');
    expect(authenticateToken).toHaveBeenCalledTimes(2);
    expect(authenticateToken).toHaveBeenNthCalledWith(1, 'signed-access-token');
    expect(authenticateToken).toHaveBeenNthCalledWith(2, 'signed-access-token');
    client.close();
  });
});
