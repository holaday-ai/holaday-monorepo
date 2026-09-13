import { AsyncLocalStorage } from 'node:async_hooks';
import type { DrainController } from './drain-controller.js';

/** One original run at a time. Clearing a producer's timer is not its stop receipt. */
export function createPeriodicWork(controller?: DrainController) {
  const inside = new AsyncLocalStorage<boolean>();
  let pending: Promise<void> | undefined;
  let stopping = false;
  let failed = false;
  let settled = false;
  let stopped: Promise<void> | undefined;
  return {
    get stopping() {
      return stopping;
    },
    get settled() {
      return settled;
    },
    run(action: () => Promise<void>): Promise<void> | null {
      if (stopping || pending || failed) return null;
      let release!: () => void;
      const barrier = new Promise<void>((resolve) => {
        release = resolve;
      });
      // Publish before synchronous admission, including callbacks during admission.
      pending = barrier;
      const finish = () => {
        pending = undefined;
        release();
      };
      const invoke = async () => {
        await Promise.resolve();
        if (stopping) return;
        await inside.run(true, action);
        if (controller && controller.drain.snapshot().unknown > 0)
          throw new Error('CLEANUP_OUTCOME_UNKNOWN');
      };
      let original: Promise<void>;
      try {
        original = controller
          ? controller.runRoot(async (lifetime) => {
              await Promise.resolve();
              if (stopping) return;
              controller.drain.assertDispatch(lifetime.owner);
              if (stopping) return;
              await inside.run(true, action);
              if (controller.drain.snapshot().unknown > 0)
                throw new Error('CLEANUP_OUTCOME_UNKNOWN');
            }).result
          : invoke();
      } catch {
        finish();
        return null;
      }
      void original.then(finish, () => {
        failed = true;
        finish();
      });
      return original;
    },
    stop(): Promise<void> {
      if (inside.getStore()) throw new Error('CLEANUP_STOP_REENTRY');
      if (stopped) return stopped;
      stopping = true;
      stopped = Promise.allSettled(pending ? [pending] : []).then(() => {
        settled = true;
        if (failed) throw new Error('CLEANUP_OUTCOME_UNKNOWN');
      });
      return stopped;
    },
  };
}
