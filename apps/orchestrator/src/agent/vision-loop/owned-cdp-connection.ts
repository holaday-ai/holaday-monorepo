import type { Browser } from 'playwright';
import {
  currentOperationLifetime,
  startOwnedOperation,
  withOperationDispatchScope,
} from '../../execution/owned-operation.js';
import { bindBrowserCloseReceipt } from './browser-close-receipt.js';
import { type BrowserRequestControl, createBrowserRequestGuard } from './browser-request-guard.js';

export interface OwnedCdpConnection extends BrowserRequestControl {
  readonly ready: Promise<Browser>;
  /** Bound SDK close receipt, not proof that OS descendants have exited. */
  dispose(): Promise<void>;
}
export type CdpTransportOptions = { headers?: Readonly<Record<string, string>> };

/** Owns this CDP transport handle, not the external browser process. */
export function createOwnedCdpConnection(
  chromium: {
    connectOverCDP: (endpoint: string, options?: CdpTransportOptions) => Promise<Browser>;
  },
  endpoint: string,
  isActive: () => boolean,
  options?: CdpTransportOptions,
): OwnedCdpConnection {
  let headers: Readonly<Record<string, string>> | undefined;
  try {
    const original = options?.headers;
    headers = original ? Object.freeze({ ...original }) : undefined;
  } catch {
    throw new Error('CDP_AUTHENTICATED_CONNECTION_FAILED');
  }
  const parent = currentOperationLifetime();
  if (parent && parent.drain.snapshot().unknown > 0) throw new Error('BROWSER_OPERATION_UNKNOWN');
  let disposeRequested = false;
  let requests: ReturnType<typeof createBrowserRequestGuard> | undefined;
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
      let closeReceipt: (() => Promise<void>) | undefined;
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
        rejectReady(new Error('CDP_CONNECTION_DISPOSED'));
        return true;
      };
      const closeBrowser = async (bound: Browser) => {
        try {
          if (requests) await requests.close();
          else if (closeReceipt) await closeReceipt();
          else if (!lifetime) await bound.close();
          else throw new Error('BROWSER_CLOSE_BOUNDARY_UNSUPPORTED');
        } catch (error) {
          markUnknown();
          throw error;
        }
      };
      try {
        if (cancelled()) return;
        assertDispatch();
        let connect: typeof chromium.connectOverCDP;
        try {
          connect = chromium.connectOverCDP;
        } catch (error) {
          markUnknown();
          throw error;
        }
        if (cancelled()) return;
        assertDispatch();
        if (!connect) {
          rejectReady(new Error('playwright CDP connection is unavailable'));
          return;
        }
        try {
          browser = headers
            ? await connect.call(chromium, endpoint, { headers })
            : await connect.call(chromium, endpoint);
          const bound = browser;
          closeReceipt = lifetime ? bindBrowserCloseReceipt(bound) : () => bound.close();
          requests = createBrowserRequestGuard(browser, closeReceipt);
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
  const operation = parent
    ? startOwnedOperation(parent.drain, 'execution', work, {
        parent: parent.owner,
        dispatch: 'deferred',
        errorOutcome: 'known',
      }).result
    : Promise.resolve().then(work);
  // SDK errors can include handshake diagnostics. Neither ready nor dispose
  // may expose private transport headers to callers or their logs.
  const result = headers
    ? operation.catch(() => {
        throw new Error('CDP_AUTHENTICATED_CONNECTION_FAILED');
      })
    : operation;
  void result.catch(rejectReady);
  return Object.freeze<OwnedCdpConnection>({
    ready,
    guardContext: (context, policy) =>
      requests
        ? requests.guardContext(context, policy)
        : Promise.reject(new Error('CDP_CONNECTION_NOT_READY')),
    stopRequests: () => requests?.stopRequests() ?? Promise.resolve(),
    isInRequest: () => requests?.isInRequest() ?? false,
    dispose: () => {
      if (requests?.isInRequest()) return Promise.reject(new Error('BROWSER_REQUEST_REENTRY'));
      void requests?.stopRequests();
      disposeRequested = true;
      requestDispose();
      return result;
    },
  });
}
