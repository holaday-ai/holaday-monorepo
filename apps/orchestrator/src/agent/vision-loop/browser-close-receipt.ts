import { realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { Browser } from 'playwright';

interface CloseChannel {
  _object: unknown;
  close(options: Record<string, never>): Promise<unknown>;
}
interface CloseConnection {
  _closedError?: unknown;
  on(event: 'close', listener: () => void): unknown;
  off(event: 'close', listener: () => void): unknown;
  addListener(event: 'close', listener: () => void): unknown;
  removeListener(event: 'close', listener: () => void): unknown;
}
interface FixedBrowser extends Browser {
  _channel: CloseChannel;
  _connection: CloseConnection;
  _closedPromise: Promise<void>;
  _shouldCloseConnectionOnClose: boolean;
  _closeReason: string | undefined;
}
const require = createRequire(import.meta.url);

/** Bound close RPC receipt only; never grants control over a shared Connection or OS process. */
export function bindBrowserCloseReceipt(browser: Browser): () => Promise<void> {
  const unsupported = () => new Error('BROWSER_CLOSE_BOUNDARY_UNSUPPORTED');
  let SdkBrowser: new (...args: never[]) => FixedBrowser;
  let Connection: new (...args: never[]) => CloseConnection;
  try {
    // Resolve dependencies from the actual installed package, not a pnpm alias
    // that some module loaders return from their resolver cache.
    const packagePath = realpathSync(require.resolve('playwright/package.json'));
    const sdkRequire = createRequire(packagePath);
    const corePath = sdkRequire.resolve('playwright-core/package.json');
    if (require(packagePath).version !== '1.59.1' || sdkRequire(corePath).version !== '1.59.1')
      throw unsupported();
    SdkBrowser = sdkRequire(path.join(path.dirname(corePath), 'lib/client/browser.js')).Browser;
    Connection = sdkRequire(
      path.join(path.dirname(corePath), 'lib/client/connection.js'),
    ).Connection;
  } catch {
    throw unsupported();
  }
  try {
    if (!(browser instanceof SdkBrowser)) throw unsupported();
    // Native SDK state is stored in own data fields. Never run accessors to validate it.
    const data = (object: object, key: string, optional = false): unknown => {
      const descriptor = Object.getOwnPropertyDescriptor(object, key);
      if (!descriptor && optional) return undefined;
      if (!descriptor || !('value' in descriptor)) throw unsupported();
      return descriptor.value;
    };
    const method = (object: object, key: string, inherited: unknown): unknown =>
      Object.hasOwn(object, key) ? data(object, key) : inherited;
    const channel = data(browser, '_channel') as CloseChannel;
    const connection = data(browser, '_connection') as CloseConnection;
    const closed = data(browser, '_closedPromise') as Promise<void>;
    const nativeClose = SdkBrowser.prototype.close;
    // EventEmitter constructor assigns these aliases as own data fields.
    const on = Connection.prototype.addListener;
    const off = Connection.prototype.removeListener;
    const intact = () =>
      Object.getPrototypeOf(browser) === SdkBrowser.prototype &&
      method(browser, 'close', nativeClose) === nativeClose &&
      data(browser, '_channel') === channel &&
      data(channel, '_object') === browser &&
      data(browser, '_connection') === connection &&
      connection instanceof Connection &&
      Object.getPrototypeOf(connection) === Connection.prototype &&
      method(connection, 'on', on) === on &&
      method(connection, 'off', off) === off &&
      data(browser, '_closedPromise') === closed &&
      closed instanceof Promise &&
      data(browser, '_shouldCloseConnectionOnClose') === false &&
      (data(browser, '_closeReason', true) === undefined ||
        typeof data(browser, '_closeReason') === 'string');
    const disconnectedAlready = () => Boolean(data(connection, '_closedError', true));
    if (!intact() || disconnectedAlready()) throw unsupported();
    // Channel Proxy creates a fresh function on each get. Capture once, never compare repeated gets.
    const channelClose = channel.close;
    if (typeof channelClose !== 'function' || !intact() || disconnectedAlready())
      throw unsupported();
    let receipt: Promise<void> | undefined;
    return () => {
      if (receipt) return receipt;
      receipt = Promise.resolve().then(async () => {
        let disconnected = false;
        let wake!: () => void;
        const lost = new Promise<void>((resolve) => {
          wake = resolve;
        });
        const onDisconnect = () => {
          disconnected = true;
          wake();
        };
        let listening = false;
        try {
          try {
            if (!intact() || disconnectedAlready()) throw unsupported();
            listening = true;
            on.call(connection, 'close', onDisconnect);
            if (!intact() || disconnectedAlready()) throw unsupported();
            browser._closeReason = undefined;
            if (!intact() || disconnectedAlready()) throw unsupported();
            await channelClose.call(channel, {});
            // Transport loss may end the passive wait, never the raw RPC wait above.
            await Promise.race([closed, lost]);
          } finally {
            if (listening) off.call(connection, 'close', onDisconnect);
          }
          // Native removeListener hooks run synchronously during cleanup: check after them too.
          if (disconnected || disconnectedAlready() || !intact()) throw unsupported();
        } catch {
          throw new Error('BROWSER_CLOSE_RECEIPT_FAILED');
        }
      });
      return receipt;
    };
  } catch {
    throw unsupported();
  }
}
