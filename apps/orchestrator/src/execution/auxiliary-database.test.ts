import { describe, expect, it } from 'vitest';
import { runAuxiliaryDatabase } from './auxiliary-database.js';
import { ExecutionDrain } from './execution-drain.js';
import { startOwnedOperation, withOperationDispatchScope } from './owned-operation.js';

describe('auxiliary database dispatch ownership', () => {
  it('allows an admitted child after close and keeps its raw promise pinned', async () => {
    const drain = new ExecutionDrain();
    drain.open();
    let finish!: () => void;
    const held = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const root = startOwnedOperation(
      drain,
      'suggestions',
      async () => {
        drain.close();
        return runAuxiliaryDatabase(() => held);
      },
      { dispatch: 'immediate', errorOutcome: 'known' },
    );
    const pending = drain.snapshot();
    finish();
    await root.result;
    expect(pending.byKind.database).toBe(1);
    expect(pending.idle).toBe(false);
    expect(drain.snapshot()).toMatchObject({ active: 0, unknown: 0, idle: true });
  });

  it.each(['blocked', 'sealed'] as const)(
    'refuses %s dispatch before touching the database',
    async (reason) => {
      const drain = new ExecutionDrain();
      drain.open();
      let calls = 0;
      const root = startOwnedOperation(
        drain,
        'execution',
        () =>
          withOperationDispatchScope(async (seal) => {
            if (reason === 'blocked') drain.block();
            else seal();
            await expect(
              runAuxiliaryDatabase(async () => {
                calls++;
              }),
            ).rejects.toThrow();
          }),
        { dispatch: 'immediate', errorOutcome: 'known' },
      );
      await root.result;
      expect(calls).toBe(0);
      expect(drain.snapshot()).toMatchObject({ active: 0, unknown: 0 });
    },
  );

  it('retains a synchronous driver failure even when its caller catches it', async () => {
    const drain = new ExecutionDrain();
    drain.open();
    const root = startOwnedOperation(
      drain,
      'suggestions',
      async () => {
        await runAuxiliaryDatabase(() => {
          throw new Error('synthetic error');
        }).catch(() => undefined);
      },
      { dispatch: 'immediate', errorOutcome: 'known' },
    );
    await root.result;
    drain.close();
    expect(drain.snapshot()).toMatchObject({ active: 0, unknown: 1, idle: false });
  });

  it('keeps unscoped compatibility without silently creating a drain', async () => {
    expect(await runAuxiliaryDatabase(async () => false)).toBe(false);
    await expect(
      runAuxiliaryDatabase(async () => {
        throw new Error('synthetic error');
      }),
    ).rejects.toThrow('synthetic error');
  });
});
