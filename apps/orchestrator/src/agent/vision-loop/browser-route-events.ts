import { realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { Browser, BrowserContext, Request, Route } from 'playwright';

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
interface FixedRequest extends Request {
  _parent: object;
  _connection: object;
}
interface FixedRoute extends Route {
  _parent: object;
  _connection: object;
  _channel: { _object: unknown };
  _raceWithTargetClose(promise: Promise<unknown>): Promise<unknown>;
  _handleRoute: Listener;
  _innerContinue: Listener;
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
  let SdkRoute: new (...args: never[]) => FixedRoute;
  let SdkRequest: new (...args: never[]) => FixedRequest;
  try {
    const packagePath = realpathSync(require.resolve('playwright/package.json'));
    const sdkRequire = createRequire(packagePath);
    const corePath = sdkRequire.resolve('playwright-core/package.json');
    if (require(packagePath).version !== '1.59.1' || sdkRequire(corePath).version !== '1.59.1')
      throw invalid();
    Context = sdkRequire(
      path.join(path.dirname(corePath), 'lib/client/browserContext.js'),
    ).BrowserContext;
    BoundBrowser = sdkRequire(path.join(path.dirname(corePath), 'lib/client/browser.js')).Browser;
    const network = sdkRequire(path.join(path.dirname(corePath), 'lib/client/network.js'));
    SdkRoute = network.Route;
    SdkRequest = network.Request;
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
  const seenRoutes = new WeakSet<object>();
  const report = () => {
    if (failed) return;
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
  const observeRoute = async (args: unknown[]) => {
    const route = (args[0] as { route?: { _object?: unknown } })?.route?._object;
    if (
      !(route instanceof SdkRoute) ||
      Object.getPrototypeOf(route) !== SdkRoute.prototype ||
      route._connection !== (context as FixedContext)._connection ||
      route._channel?._object !== route ||
      seenRoutes.has(route)
    )
      throw invalid();
    for (const key of [
      'request',
      'abort',
      'continue',
      '_handleRoute',
      '_innerContinue',
      '_raceWithTargetClose',
    ] as const) {
      if (route[key] !== SdkRoute.prototype[key]) throw invalid();
    }
    const request = route.request();
    if (
      !(request instanceof SdkRequest) ||
      Object.getPrototypeOf(request) !== SdkRequest.prototype ||
      route._parent !== request
    )
      throw invalid();
    const routeChannel = route._channel;
    const routeBelongs = () => {
      if (
        !belongs() ||
        Object.getPrototypeOf(route) !== SdkRoute.prototype ||
        Object.getPrototypeOf(request) !== SdkRequest.prototype ||
        route._connection !== (context as FixedContext)._connection ||
        route._channel !== routeChannel ||
        routeChannel._object !== route ||
        route._parent !== request ||
        SdkRoute.prototype.request.call(route) !== request
      )
        return false;
      const ancestors = new Set<object>();
      let parent: object | undefined = request;
      for (let depth = 0; depth < 32 && parent !== context; depth++) {
        if (
          !parent ||
          ancestors.has(parent) ||
          (parent as FixedRequest)._connection !== (context as FixedContext)._connection
        )
          return false;
        ancestors.add(parent);
        parent = (parent as FixedRequest)._parent;
      }
      return parent === context;
    };
    if (!routeBelongs()) throw invalid();
    seenRoutes.add(route);
    const raw = new Set<Promise<void>>();
    const originalRace = route._raceWithTargetClose;
    const originalAbort = route.abort;
    const originalContinue = route.continue;
    let active = true;
    let used = false;
    const race = (promise: Promise<unknown>) => {
      // Observation only: the channel operation has already been invoked. Never discard it.
      const receipt = Promise.resolve(promise).then(() => {}, report);
      raw.add(receipt);
      void receipt.then(() => raw.delete(receipt));
      return originalRace.call(route, promise);
    };
    const methodsIntact = () =>
      routeBelongs() &&
      route.abort === abort &&
      route.continue === continueRoute &&
      route._raceWithTargetClose === race &&
      route.request === SdkRoute.prototype.request &&
      route._handleRoute === SdkRoute.prototype._handleRoute &&
      route._innerContinue === SdkRoute.prototype._innerContinue;
    const claim = () => {
      // Known control refusal must not touch an owner whose resource already settled.
      if (!active || used) throw new Error('BROWSER_ROUTE_ACTION_UNAVAILABLE');
      if (!methodsIntact()) {
        report();
        throw invalid();
      }
      used = true;
    };
    const abort: Route['abort'] = async (...parameters) => {
      claim();
      await originalAbort.apply(route, parameters);
    };
    const continueRoute: Route['continue'] = async (...parameters) => {
      claim();
      await originalContinue.apply(route, parameters);
    };
    try {
      route._raceWithTargetClose = race;
      route.abort = abort;
      route.continue = continueRoute;
      await Reflect.apply(original, channel, args);
    } catch {
      report();
    } finally {
      try {
        while (raw.size) await Promise.allSettled([...raw]);
      } finally {
        // Seal even if installation or the terminal integrity getter itself failed.
        active = false;
        try {
          if (!methodsIntact()) report();
        } catch {
          report();
        }
      }
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
        return enter(() => observeRoute(args));
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
