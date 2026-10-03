import { AsyncLocalStorage } from 'node:async_hooks';
import type { Logger } from 'pino';
import {
  assertBrowserSettlementOpen,
  runBrowserOperation,
  withBrowserOperationSettlement,
} from '../agent/vision-loop/browser-operation.js';
import {
  currentOperationLifetime,
  startOwnedOperation,
  withOperationDispatchScope,
} from '../execution/owned-operation.js';
import type { BrowserInstance, PoolConfig } from './types.js';

export interface PoolBackgroundWork {
  stop(): Promise<void>;
  isCurrent(): boolean;
}
const backgroundContext = new AsyncLocalStorage<BrowserInstance>();

/** Bound to an instance, not its mutable task key. Does not expose execution authority. */
export function startPoolBackgroundWork(
  instance: BrowserInstance,
  config: PoolConfig,
  logger: Logger,
  isActive: () => boolean,
): PoolBackgroundWork {
  const parent = currentOperationLifetime();
  if (parent && parent.drain.snapshot().unknown > 0) throw new Error('BROWSER_OPERATION_UNKNOWN');
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let wake = () => {};
  let seal = () => {};
  const canDispatch = () => {
    if (stopped || !isActive()) return false;
    try {
      assertBrowserSettlementOpen();
      const lifetime = currentOperationLifetime();
      if (lifetime) {
        lifetime.drain.assertDispatch(lifetime.owner);
        if (lifetime.drain.snapshot().unknown > 0) return false;
      }
      return true;
    } catch {
      return false;
    }
  };
  const invoke = async (kind: 'hook' | 'banner') => {
    if (!canDispatch()) return;
    try {
      await runBrowserOperation(() =>
        withBrowserOperationSettlement(async () => {
          if (!canDispatch()) return;
          if (kind === 'hook') {
            const hook = config.onInstanceReady;
            if (canDispatch() && hook) await hook.call(config, instance.userId, instance.executor);
          } else {
            const dismiss = instance.executor.dismissChromeBanners;
            if (canDispatch()) await dismiss.call(instance.executor);
          }
        }),
      );
    } catch (error) {
      // Actual SDK/hook errors have already retained uncertainty in the raw owner.
      logger.warn(
        { kind, err: error instanceof Error ? error.message : String(error) },
        'pool: background initialization failed',
      );
    }
  };
  const work = () =>
    backgroundContext.run(instance, () =>
      withOperationDispatchScope((scopeSeal) =>
        withBrowserOperationSettlement(async (settlementSeal) => {
          seal = () => {
            scopeSeal();
            settlementSeal();
          };
          try {
            if (!canDispatch()) return;
            const delay = new Promise<void>((resolve) => {
              wake = resolve;
              timer = setTimeout(resolve, 3000);
            });
            // Keep the callback promises separate from their enclosing observer result.
            await Promise.allSettled([invoke('hook'), delay.then(() => invoke('banner'))]);
          } finally {
            seal();
            if (timer) clearTimeout(timer);
          }
        }),
      ),
    );
  const result = parent
    ? startOwnedOperation(parent.drain, 'execution', work, {
        parent: parent.owner,
        dispatch: 'deferred',
        errorOutcome: 'known',
      }).result
    : Promise.resolve().then(work);
  void result.catch(() => {});
  return Object.freeze({
    stop: () => {
      stopped = true;
      seal();
      if (timer) clearTimeout(timer);
      wake();
      return result;
    },
    isCurrent: () => backgroundContext.getStore() === instance,
  });
}
