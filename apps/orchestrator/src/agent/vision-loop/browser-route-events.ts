import { createRequire } from 'node:module';
import path from 'node:path';
import type { Browser, BrowserContext } from 'playwright';

type Listener = (...args: unknown[]) => unknown;
interface Channel {
  _object: unknown;
  _pendingHandlers: Map<string, Set<Promise<unknown>>>;
  listeners(name: string): Listener[];
  on(name: string, listener: Listener): unknown;
  removeListener(name: string, listener: Listener): unknown;
}
export interface RouteEventBoundary {
  seal(): void;
  settled(): Promise<void>;
}
const require = createRequire(import.meta.url);
interface FixedContext extends BrowserContext {
  _onRoute: Listener;
  _connection: object;
}
interface FixedBrowser extends Browser {
  _connection: object;
}

/** Pinned SDK adapter: contains errors only on this context's complete route event chain. */
export function createRouteEventBoundary(
  context: BrowserContext,
  browser: Browser,
  enter: (action: () => unknown) => unknown,
  onFailure: () => void,
): RouteEventBoundary {
  const invalid = () => new Error('BROWSER_ROUTE_EVENT_BOUNDARY_UNSUPPORTED');
  let Context: new (...args: never[]) => FixedContext;
  let BoundBrowser: new (...args: never[]) => FixedBrowser;
  try {
    const packagePath = require.resolve('playwright/package.json');
    const sdkRequire = createRequire(packagePath);
    const corePath = sdkRequire.resolve('playwright-core/package.json');
    if (require(packagePath).version !== '1.59.1' || sdkRequire(corePath).version !== '1.59.1')
      throw invalid();
    Context = sdkRequire(
      path.join(path.dirname(corePath), 'lib/client/browserContext.js'),
    ).BrowserContext;
    BoundBrowser = sdkRequire(path.join(path.dirname(corePath), 'lib/client/browser.js')).Browser;
  } catch {
    throw invalid();
  }
  const onRoute = Context.prototype._onRoute;
  const getBrowser = Context.prototype.browser;
  // Fixed trusted SDK compatibility, not a defense against malicious in-process code.
  const belongs = () =>
    context instanceof Context &&
    browser instanceof BoundBrowser &&
    Object.getPrototypeOf(context) === Context.prototype &&
    context._onRoute === onRoute &&
    context.browser === getBrowser &&
    getBrowser.call(context) === browser &&
    context._connection === browser._connection;
  if (!belongs()) throw invalid();
  const channel = (context as unknown as { _channel: Channel })._channel;
  if (
    !channel ||
    channel._object !== context ||
    !(channel._pendingHandlers instanceof Map) ||
    typeof channel.listeners !== 'function' ||
    typeof channel.on !== 'function' ||
    typeof channel.removeListener !== 'function'
  )
    throw invalid();
  const noHooks = () =>
    channel.listeners('newListener').length === 0 &&
    channel.listeners('removeListener').length === 0;
  const originals = channel.listeners('route');
  if (
    !noHooks() ||
    originals.length !== 1 ||
    (channel._pendingHandlers.get('route')?.size ?? 0) !== 0
  )
    throw invalid();
  const original = originals[0];
  if (typeof original !== 'function') throw invalid();
  if (
    Function.prototype.toString.call(original) !==
    '({ route }) => this._onRoute(network.Route.from(route))'
  )
    throw invalid();
  let sealed = false;
  let failed = false;
  const pending = new Set<Promise<void>>();
  const report = () => {
    failed = true;
    // Failure reporting must never create another rejected EventEmitter listener.
    try {
      onFailure();
    } catch {
      /* settled() remains failed even if the sink failed. */
    }
  };
  const intact = () => {
    try {
      const listeners = channel.listeners('route');
      return (
        belongs() &&
        (context as unknown as { _channel: Channel })._channel === channel &&
        channel._object === context &&
        noHooks() &&
        listeners.length === 1 &&
        listeners[0] === wrapper
      );
    } catch {
      return false;
    }
  };
  const wrapper: Listener = (...args) => {
    if (sealed) return;
    if (!intact() || pending.size >= 1024) {
      report();
      return;
    }
    const operation = Promise.resolve()
      .then(() => {
        if (sealed) return;
        if (!intact()) {
          report();
          return;
        }
        return enter(() => Reflect.apply(original, channel, args));
      })
      .then(() => {}, report);
    pending.add(operation);
    void operation.then(() => pending.delete(operation));
    return operation;
  };
  try {
    channel.removeListener('route', original);
    channel.on('route', wrapper);
    if (!intact()) throw invalid();
  } catch {
    sealed = true;
    report();
    // A partially replaced SDK surface is never published as a usable browser.
    throw invalid();
  }
  return Object.freeze({
    seal: () => {
      sealed = true;
      if (!intact()) report();
    },
    settled: async () => {
      while (pending.size) await Promise.allSettled([...pending]);
      if (!intact()) report();
      if (failed) throw new Error('BROWSER_ROUTE_EVENT_FAILED');
    },
  });
}
