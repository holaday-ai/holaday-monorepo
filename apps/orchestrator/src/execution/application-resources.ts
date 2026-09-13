import { AsyncLocalStorage } from 'node:async_hooks';
import type { ApplicationBoot } from './application-boot.js';

/** Startup-owned local resources only; not proof of OS group exit or global IO coverage. */
export function createApplicationResources(boot: ApplicationBoot) {
  const releases: Array<() => unknown> = [];
  const inside = new AsyncLocalStorage<boolean>();
  let stopping: Promise<void> | undefined;
  return {
    add(stop: () => unknown): void {
      if (stopping || releases.length >= 128) throw new Error('APPLICATION_RESOURCES_CLOSED');
      releases.push(stop);
    },
    stop(): Promise<void> {
      if (inside.getStore()) throw new Error('APPLICATION_STOP_REENTRY');
      if (stopping) return stopping;
      let resolve!: () => void;
      let reject!: (error: unknown) => void;
      stopping = new Promise<void>((yes, no) => {
        resolve = yes;
        reject = no;
      });
      let failed = !boot.controller.quiesce();
      const pending: Promise<unknown>[] = [];
      for (const release of releases) {
        try {
          pending.push(Promise.resolve(inside.run(true, release)));
        } catch {
          failed = true;
        }
      }
      void (async () => {
        const results = await Promise.allSettled(pending);
        if (results.some((result) => result.status === 'rejected')) failed = true;
        if (failed) boot.controller.drain.block();
        try {
          await boot.close();
        } catch {
          failed = true;
        }
        if (failed) throw new Error('APPLICATION_STOP_UNPROVEN');
      })().then(resolve, reject);
      return stopping;
    },
  };
}
