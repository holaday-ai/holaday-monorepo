import { describe, expect, it } from 'vitest';
import { makeCreateContext } from './context.js';

describe('makeCreateContext task origin', () => {
  it('carries the authenticated request origin into tRPC context', async () => {
    const createContext = makeCreateContext({ planner: {} as never });
    const context = await createContext({
      req: {
        userId: 'usr_eval_runner',
        taskOrigin: 'eval',
      } as never,
      res: {} as never,
    });

    expect(context.taskOrigin).toBe('eval');
  });
});
