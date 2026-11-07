import { pino } from 'pino';
import { afterEach, expect, it, vi } from 'vitest';
import { browserReplayStore } from '../../agent/browser-tools/browser-replay-service.js';
import { env } from '../../config/env.js';
import type { Context } from '../context.js';
import { browserReplayRouter } from './browser-replay.js';
const original = env.BROWSER_REPLAY_V1;
afterEach(() => {
  env.BROWSER_REPLAY_V1 = original;
  vi.restoreAllMocks();
});
it('rejects task replay access before storage when database ownership is absent', async () => {
  env.BROWSER_REPLAY_V1 = true;
  const chain = {
    from: () => chain,
    innerJoin: () => chain,
    where: () => chain,
    limit: async () => [],
  };
  const caller = browserReplayRouter.createCaller({
    db: { select: () => chain },
    userId: 'attacker',
    logger: pino({ level: 'silent' }),
  } as unknown as Context);
  const read = vi.spyOn(browserReplayStore, 'read');
  await expect(caller.read({ taskId: 'victim-task' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  await expect(caller.remove({ taskId: 'victim-task' })).rejects.toMatchObject({
    code: 'NOT_FOUND',
  });
  expect(read).not.toHaveBeenCalled();
});
it('does not access archives when replay is disabled', async () => {
  env.BROWSER_REPLAY_V1 = false;
  const caller = browserReplayRouter.createCaller({
    userId: 'owner',
    logger: pino({ level: 'silent' }),
  } as Context);
  await expect(caller.read({ taskId: 'task' })).resolves.toBeNull();
});

it('negotiates the active task snapshot after environment rollout changes', async () => {
  const capabilities = Object.freeze({
    viewportV2: true,
    observationV2: true,
    replayV1: true,
    routingV2: true,
  });
  const chain = {
    from: () => chain,
    innerJoin: () => chain,
    where: () => chain,
    limit: async () => [{ id: 1 }],
  };
  const caller = browserReplayRouter.createCaller({
    userId: 'owner',
    db: { select: () => chain },
    browserPool: { peek: () => ({ userId: 'owner', capabilities }) },
    logger: pino({ level: 'silent' }),
  } as unknown as Context);
  const read = vi.spyOn(browserReplayStore, 'read').mockResolvedValue(null);
  env.BROWSER_REPLAY_V1 = false;
  expect(await caller.capabilities({ taskId: 'task' })).toEqual(capabilities);
  await caller.read({ taskId: 'task' });
  expect(read).toHaveBeenCalledWith('owner', 'task', 0);
});
