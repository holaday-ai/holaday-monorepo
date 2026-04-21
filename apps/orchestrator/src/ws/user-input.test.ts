import { beforeAll, describe, expect, it } from 'vitest';
import { clientVisionUserInputSchema } from '@holaday/shared-types';
import type { PlaywrightExecutor } from '../agent/vision-loop/playwright-executor.js';
import { dispatchUserInput } from './server.js';

beforeAll(() => {
  process.env.JWT_SECRET ??= 'test-secret-must-be-at-least-32-characters-long-yes';
  process.env.DATABASE_URL ??= 'mysql://test:test@127.0.0.1:3306/test';
  process.env.REDIS_URL ??= 'redis://127.0.0.1:6379/0';
});

/**
 * Schema + dispatcher tests for the panel interactive-mode channel.
 * We exercise the executor seam via a recorder fake; no real browser
 * or WebSocket. The handler's contract:
 *   - kind='click' → executor.click(page, x, y, button)
 *   - kind='type'  → executor.type(page, text)
 *   - kind='key'   → executor.pressKey(page, key)
 *   - kind='scroll'→ executor.scroll(page, dy, x?, y?)
 *   - no executor  → log + no-op, never throw
 */

type Call = { method: string; args: unknown[] };

function fakeExecutor(): { executor: PlaywrightExecutor; calls: Call[] } {
  const calls: Call[] = [];
  const page = { tag: 'fake-page' };
  const exec = {
    getPage: async () => page,
    click: async (p: unknown, x: number, y: number, btn?: string) => {
      calls.push({ method: 'click', args: [p, x, y, btn] });
      return { ok: true };
    },
    type: async (p: unknown, text: string) => {
      calls.push({ method: 'type', args: [p, text] });
      return { ok: true };
    },
    pressKey: async (p: unknown, key: string) => {
      calls.push({ method: 'pressKey', args: [p, key] });
      return { ok: true };
    },
    scroll: async (p: unknown, dy: number, ax?: number, ay?: number) => {
      calls.push({ method: 'scroll', args: [p, dy, ax, ay] });
      return { ok: true };
    },
  } as unknown as PlaywrightExecutor;
  return { executor: exec, calls };
}

describe('clientVisionUserInputSchema — zod validation', () => {
  it('accepts a well-formed click', () => {
    const r = clientVisionUserInputSchema.safeParse({
      type: 'client.vision.user_input',
      taskId: 'tsk_x',
      kind: 'click',
      x: 100,
      y: 200,
      button: 'left',
    });
    expect(r.success).toBe(true);
  });

  it('accepts type + key + scroll', () => {
    const forms = [
      { type: 'client.vision.user_input', kind: 'type', text: 'hello' },
      { type: 'client.vision.user_input', kind: 'key', key: 'Enter' },
      { type: 'client.vision.user_input', kind: 'scroll', scrollDeltaY: 400 },
    ] as const;
    for (const f of forms) {
      expect(clientVisionUserInputSchema.safeParse(f).success).toBe(true);
    }
  });

  it('rejects an unknown kind', () => {
    const r = clientVisionUserInputSchema.safeParse({
      type: 'client.vision.user_input',
      kind: 'teleport',
    });
    expect(r.success).toBe(false);
  });

  it('rejects text longer than cap (DoS guard)', () => {
    const r = clientVisionUserInputSchema.safeParse({
      type: 'client.vision.user_input',
      kind: 'type',
      text: 'x'.repeat(5_000),
    });
    expect(r.success).toBe(false);
  });
});

describe('dispatchUserInput — executor dispatch', () => {
  it('routes click to executor.click with coords + default button', async () => {
    const { executor, calls } = fakeExecutor();
    await dispatchUserInput(
      {
        type: 'client.vision.user_input',
        kind: 'click',
        x: 42,
        y: 84,
      },
      executor,
      'usr_test',
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe('click');
    expect(calls[0]?.args.slice(1)).toEqual([42, 84, 'left']);
  });

  it('routes type with the literal text', async () => {
    const { executor, calls } = fakeExecutor();
    await dispatchUserInput(
      { type: 'client.vision.user_input', kind: 'type', text: 'hola' },
      executor,
      null,
    );
    expect(calls[0]?.method).toBe('type');
    expect(calls[0]?.args[1]).toBe('hola');
  });

  it('routes key with the named key (handed to pressKey)', async () => {
    const { executor, calls } = fakeExecutor();
    await dispatchUserInput(
      { type: 'client.vision.user_input', kind: 'key', key: 'Enter' },
      executor,
      null,
    );
    expect(calls[0]?.method).toBe('pressKey');
    expect(calls[0]?.args[1]).toBe('Enter');
  });

  it('routes scroll with deltaY (+ optional anchor coords)', async () => {
    const { executor, calls } = fakeExecutor();
    await dispatchUserInput(
      {
        type: 'client.vision.user_input',
        kind: 'scroll',
        scrollDeltaY: 300,
        x: 100,
        y: 200,
      },
      executor,
      null,
    );
    expect(calls[0]?.method).toBe('scroll');
    expect(calls[0]?.args.slice(1)).toEqual([300, 100, 200]);
  });

  it('no-ops (no throw) when executor is null — legacy WS/SW path', async () => {
    // Doesn't throw, doesn't call anything. The frontend's UX for
    // this session is "interactive mode unavailable", not a WS error.
    await expect(
      dispatchUserInput(
        { type: 'client.vision.user_input', kind: 'click', x: 1, y: 2 },
        null,
        'usr_test',
      ),
    ).resolves.toBeUndefined();
  });

  it('skips click when coords are missing (schema allows optional, dispatcher is defensive)', async () => {
    const { executor, calls } = fakeExecutor();
    await dispatchUserInput(
      { type: 'client.vision.user_input', kind: 'click' },
      executor,
      null,
    );
    expect(calls).toHaveLength(0);
  });

  it('swallows executor errors so the WS connection stays alive', async () => {
    const executor = {
      getPage: async () => {
        throw new Error('executor exploded');
      },
      click: async () => ({ ok: true }),
      type: async () => ({ ok: true }),
      pressKey: async () => ({ ok: true }),
      scroll: async () => ({ ok: true }),
    } as unknown as PlaywrightExecutor;
    await expect(
      dispatchUserInput(
        { type: 'client.vision.user_input', kind: 'click', x: 1, y: 2 },
        executor,
        null,
      ),
    ).resolves.toBeUndefined();
  });
});
