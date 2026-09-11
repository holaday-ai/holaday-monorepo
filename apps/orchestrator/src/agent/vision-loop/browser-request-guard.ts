import { AsyncLocalStorage } from 'node:async_hooks';
import type { Browser, BrowserContext, Request, Route } from 'playwright';
import { logger } from '../../config/logger.js';
import { currentOperationLifetime } from '../../execution/owned-operation.js';
import type { BrowserNetworkPolicy } from '../browser-network-policy.js';
import { type RouteEventBoundary, createRouteEventBoundary } from './browser-route-events.js';

type Policy = Pick<BrowserNetworkPolicy, 'check'>;
export interface BrowserRequestControl {
  guardContext(context: BrowserContext, policy: Policy): Promise<boolean>;
  stopRequests(): Promise<void>;
  isInRequest(): boolean;
}
interface BrowserRequestGuard extends BrowserRequestControl {
  close(): Promise<void>;
}
const requestContext = new AsyncLocalStorage<object>();
const cancelled = Symbol('request-dispatch-cancelled');
function reportPolicy(outcome: 'blocked' | 'policy_failed') {
  try {
    logger.warn(
      { outcome },
      outcome === 'blocked'
        ? 'browser request blocked by network policy'
        : 'browser request policy failed closed',
    );
  } catch {
    /* Diagnostics must not interfere with fail-closed cleanup. */
  }
}

/** Fixed callbacks owned by the enclosing Browser lease, never a reusable dispatch scope. */
export function createBrowserRequestGuard(
  browser: Browser,
  closeBrowser: () => Promise<void> = () => browser.close(),
): BrowserRequestGuard {
  const lifetime = currentOperationLifetime();
  const identity = {};
  let phase: 'normal' | 'abort-only' | 'closed' | 'failed-sealed' = 'normal';
  const normal = new Set<Promise<unknown>>();
  const callbacks = new Set<Promise<unknown>>();
  const installations = new Map<BrowserContext, Promise<boolean>>();
  const events = new Set<RouteEventBoundary>();
  let eventFailed = false;
  let closing: Promise<void> | undefined;
  let failure: unknown;
  let hasFailure = false;
  const final = () => phase === 'closed' || phase === 'failed-sealed';
  const remember = (error: unknown) => {
    if (phase === 'normal') phase = 'abort-only';
    if (!hasFailure) {
      failure = error;
      hasFailure = true;
    }
    if (lifetime) lifetime.drain.markUnknown(lifetime.owner);
  };
  const allowed = () => {
    if (phase !== 'normal') return false;
    try {
      if (lifetime) {
        lifetime.drain.assertDispatch(lifetime.owner);
        if (lifetime.drain.snapshot().unknown > 0) return false;
      }
      return phase === 'normal';
    } catch {
      return false;
    }
  };
  const track = <T>(set: Set<Promise<unknown>>, promise: Promise<T>): Promise<T> => {
    set.add(promise);
    void promise.then(
      () => set.delete(promise),
      () => set.delete(promise),
    );
    return promise;
  };
  const waitFor = async (set: Set<Promise<unknown>>) => {
    while (set.size) await Promise.allSettled([...set]);
  };
  const normalCall = <T>(action: () => Promise<T> | T | typeof cancelled, sdk = true) =>
    track(
      normal,
      Promise.resolve().then(async () => {
        if (!allowed()) return cancelled;
        try {
          return await action();
        } catch (error) {
          if (sdk) remember(error);
          throw error;
        }
      }),
    );
  const abort = async (route: Route) => {
    if (final()) throw new Error('BROWSER_REQUEST_CLOSED');
    try {
      const method = route.abort;
      if (final()) return;
      // The existing resource owns this fixed fail-closed cleanup, even when dispatch is blocked.
      await method.call(route, 'blockedbyclient');
    } catch (error) {
      remember(error);
      throw error;
    }
  };
  const handle = (route: Route, request: Request, policy: Policy): Promise<void> => {
    // A successful no-op would leave Playwright's _startHandling promise pending forever.
    if (final()) return Promise.reject(new Error('BROWSER_REQUEST_CLOSED'));
    if (callbacks.size >= 1024) {
      phase = 'abort-only';
      const error = new Error('BROWSER_REQUEST_CAPACITY');
      remember(error);
      return Promise.reject(error);
    }
    return track(
      callbacks,
      Promise.resolve().then(() =>
        requestContext.run(identity, async () => {
          if (final()) throw new Error('BROWSER_REQUEST_CLOSED');
          if (!allowed()) return abort(route);
          const url = await normalCall(() => {
            const method = request.url;
            return allowed() ? method.call(request) : cancelled;
          });
          if (url === cancelled) return abort(route);
          let permit = !/^https?:\/\//i.test(url);
          if (!permit) {
            try {
              const decision = await normalCall(() => {
                const method = policy.check;
                return allowed() ? method.call(policy, url) : cancelled;
              }, false);
              permit = decision !== cancelled && decision.allowed;
              if (decision !== cancelled && !decision.allowed) reportPolicy('blocked');
            } catch {
              // DNS/policy failure remains fail-closed; it is not a submitted browser action.
              reportPolicy('policy_failed');
            }
          }
          if (!permit || !allowed()) return abort(route);
          const result = await normalCall(() => {
            const method = route.continue;
            return allowed() ? method.call(route) : cancelled;
          });
          if (result === cancelled) await abort(route);
        }),
      ),
    );
  };
  const isInRequest = () => requestContext.getStore() === identity;
  const assertOutside = () => {
    if (isInRequest()) throw new Error('BROWSER_REQUEST_REENTRY');
  };
  const stopRequests = () => {
    assertOutside();
    if (phase === 'normal') phase = 'abort-only';
    return waitFor(normal);
  };
  return Object.freeze<BrowserRequestGuard>({
    isInRequest,
    stopRequests,
    guardContext: (context, policy) => {
      if (!allowed()) return Promise.reject(new Error('BROWSER_REQUEST_STOPPED'));
      const existing = installations.get(context);
      if (existing) return existing;
      if (installations.size >= 1024) return Promise.reject(new Error('BROWSER_REQUEST_CAPACITY'));
      const result = normalCall(async () => {
        const route = context.route;
        if (!allowed()) return cancelled;
        if (typeof route !== 'function') return false;
        events.add(
          createRouteEventBoundary(
            context,
            browser,
            (action) => requestContext.run(identity, action),
            () => {
              eventFailed = true;
              remember(new Error('BROWSER_ROUTE_EVENT_FAILED'));
            },
          ),
        );
        if (!allowed()) return cancelled;
        await requestContext.run(identity, () =>
          route.call(context, '**/*', (handleRoute, request) =>
            handle(handleRoute, request, policy),
          ),
        );
        return true;
      }).then((value) => {
        if (value === cancelled) throw new Error('BROWSER_REQUEST_STOPPED');
        return value;
      });
      // SDK registers locally before awaiting its RPC, so retain even a failed installation.
      installations.set(context, result);
      return result;
    },
    close: () => {
      assertOutside();
      if (closing) return closing;
      const stopped = stopRequests();
      closing = Promise.resolve().then(async () => {
        await stopped;
        try {
          await requestContext.run(identity, closeBrowser);
          phase = 'closed';
        } catch (error) {
          phase = 'failed-sealed';
          remember(error);
        }
        for (const event of events) event.seal();
        const outcomes = await Promise.allSettled([
          waitFor(callbacks),
          ...[...events].map((event) => event.settled()),
        ]);
        if (outcomes.some((outcome) => outcome.status === 'rejected')) {
          eventFailed = true;
          remember(new Error('BROWSER_ROUTE_EVENT_FAILED'));
        }
        if (eventFailed) throw new Error('BROWSER_ROUTE_EVENT_FAILED');
        if (hasFailure) throw failure;
      });
      return closing;
    },
  });
}
