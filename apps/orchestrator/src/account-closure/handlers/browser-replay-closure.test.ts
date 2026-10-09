import { expect, it, vi } from 'vitest';
import type { ClosureHandlerContext } from '../handler-contract.js';
const { removeOwner } = vi.hoisted(() => ({ removeOwner: vi.fn(async () => {}) }));
vi.mock('../../agent/browser-tools/browser-replay-service.js', () => ({
  browserReplayStore: { removeOwner },
}));
vi.mock('../../files/file-service.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../files/file-service.js')>()),
  deleteUserFilesPage: vi.fn(async () => ({ deleted: 1, nextAfterId: null })),
}));
vi.mock('./team-work-items.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./team-work-items.js')>()),
  minimizeRetainedTeamWorkSources: vi.fn(async () => 0),
}));
import { taskExecutionClosureHandler } from './task-execution.js';
it('account closure purges replay owner before task relational cleanup', async () => {
  const context = {
    request: { userId: 1, userExternalId: 'synthetic-owner' },
    signal: new AbortController().signal,
    pageSize: 100,
    checkpoint: null,
    db: {},
    storage: {},
    logger: {},
  } as unknown as ClosureHandlerContext;
  const result = await taskExecutionClosureHandler.run(context);
  expect(result.kind).toBe('continue');
  expect(removeOwner).toHaveBeenCalledWith('synthetic-owner');
});
