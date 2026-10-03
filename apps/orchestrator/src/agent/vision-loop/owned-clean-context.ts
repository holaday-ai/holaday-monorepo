import type { Browser, BrowserContext } from 'playwright';
import {
  currentOperationLifetime,
  startOwnedOperation,
  withOperationDispatchScope,
} from '../../execution/owned-operation.js';

export interface OwnedCleanContext {
  readonly ready: Promise<BrowserContext>;
  /** Dispose only this context, including an acquisition still in flight. */
  dispose(): Promise<void>;
}

/** Resource pin outlives ready; it is not a reusable dispatch permission. */
export function createOwnedCleanContext(
  browser: Browser,
  options: Parameters<Browser['newContext']>[0] = {},
): OwnedCleanContext {
  const parent = currentOperationLifetime();
  if (parent && parent.drain.snapshot().unknown > 0) throw new Error('BROWSER_OPERATION_UNKNOWN');
  let disposeRequested = false;
  let requestDispose!: () => void;
  const disposeSignal = new Promise<void>((resolve) => {
    requestDispose = resolve;
  });
  let resolveReady!: (context: BrowserContext) => void;
  let rejectReady!: (error: unknown) => void;
  const ready = new Promise<BrowserContext>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  // The executor may request disposal before it starts awaiting ready.
  void ready.catch(() => {});
  const work = async () =>
    withOperationDispatchScope(async (seal) => {
      const lifetime = currentOperationLifetime();
      let context: BrowserContext | undefined;
      const markUnknown = () => {
        if (lifetime) lifetime.drain.markUnknown(lifetime.owner);
      };
      const closeContext = async (bound: BrowserContext) => {
        try {
          await bound.close();
        } catch (error) {
          markUnknown();
          throw error;
        }
      };
      try {
        if (disposeRequested) {
          rejectReady(new Error('CLEAN_CONTEXT_DISPOSED'));
          return;
        }
        if (lifetime && lifetime.drain.snapshot().unknown > 0)
          throw new Error('BROWSER_OPERATION_UNKNOWN');
        try {
          context = await browser.newContext(options);
        } catch (error) {
          markUnknown();
          throw error;
        }
        if (lifetime) {
          lifetime.drain.assertDispatch(lifetime.owner);
          if (lifetime.drain.snapshot().unknown > 0) throw new Error('BROWSER_OPERATION_UNKNOWN');
        }
        if (disposeRequested) {
          rejectReady(new Error('CLEAN_CONTEXT_DISPOSED'));
          return;
        }
        seal();
        resolveReady(context);
        await disposeSignal;
      } finally {
        seal();
        if (context) {
          // The bound resource and private pin already own this physical cleanup.
          // Never use a new dispatch guard or a caller-supplied cleanup action here.
          await closeContext(context);
        }
      }
    });
  const result = parent
    ? startOwnedOperation(parent.drain, 'execution', work, {
        parent: parent.owner,
        dispatch: 'deferred',
        errorOutcome: 'known',
      }).result
    : Promise.resolve().then(work);
  void result.catch(rejectReady);
  return Object.freeze({
    ready,
    dispose: () => {
      disposeRequested = true;
      requestDispose();
      return result;
    },
  });
}
