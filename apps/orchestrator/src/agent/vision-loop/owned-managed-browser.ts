import type { Browser } from 'playwright';
import {
  currentOperationLifetime,
  startOwnedOperation,
  withOperationDispatchScope,
} from '../../execution/owned-operation.js';

export interface OwnedManagedBrowser {
  readonly ready: Promise<Browser>;
  /** Bound SDK close receipt, not proof that OS descendants have exited. */
  dispose(): Promise<void>;
}

/** Only for browsers this executor launches, never external CDP handles. */
export function createOwnedManagedBrowser(
  chromium: { launch?: (options: { channel?: string; headless?: boolean }) => Promise<Browser> },
  options: { channel?: string; headless?: boolean },
  isActive: () => boolean,
): OwnedManagedBrowser {
  const parent = currentOperationLifetime();
  if (parent && parent.drain.snapshot().unknown > 0) throw new Error('BROWSER_OPERATION_UNKNOWN');
  let disposeRequested = false;
  let requestDispose!: () => void;
  const disposeSignal = new Promise<void>((resolve) => {
    requestDispose = resolve;
  });
  let resolveReady!: (browser: Browser) => void;
  let rejectReady!: (error: unknown) => void;
  const ready = new Promise<Browser>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  void ready.catch(() => {});
  const work = async () =>
    withOperationDispatchScope(async (seal) => {
      const lifetime = currentOperationLifetime();
      let browser: Browser | undefined;
      const markUnknown = () => {
        if (lifetime) lifetime.drain.markUnknown(lifetime.owner);
      };
      const assertDispatch = () => {
        if (lifetime) {
          lifetime.drain.assertDispatch(lifetime.owner);
          if (lifetime.drain.snapshot().unknown > 0) throw new Error('BROWSER_OPERATION_UNKNOWN');
        }
      };
      const cancelled = () => {
        if (!disposeRequested && isActive()) return false;
        rejectReady(new Error('MANAGED_BROWSER_DISPOSED'));
        return true;
      };
      const closeBrowser = async (bound: Browser) => {
        try {
          await bound.close();
        } catch (error) {
          markUnknown();
          throw error;
        }
      };
      try {
        if (cancelled()) return;
        assertDispatch();
        let launch: typeof chromium.launch;
        try {
          launch = chromium.launch;
        } catch (error) {
          markUnknown();
          throw error;
        }
        if (cancelled()) return;
        assertDispatch();
        if (!launch) {
          rejectReady(new Error('playwright launch is unavailable'));
          return;
        }
        try {
          browser = await launch.call(chromium, options);
        } catch (error) {
          markUnknown();
          throw error;
        }
        if (cancelled()) return;
        assertDispatch();
        seal();
        resolveReady(browser);
        await disposeSignal;
      } finally {
        seal();
        // Already admitted resource ownership permits cleanup even after closure/unknown.
        if (browser) await closeBrowser(browser);
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
