/**
 * Build-time stub for `@holaday/browser-driver/crx` — used ONLY when
 * vite.config.ts aliases the module to this file (i.e. when the build
 * is invoked with `VITE_BROWSER_DRIVER=mock`).
 *
 * The stub keeps the same named export (`PlaywrightCrxAdapter`) so the
 * static import in `src/background/index.ts` resolves, but the SW's
 * runtime guard `DRIVER_MODE === 'mock'` returns MockDriver before
 * this stub's `execute()` could ever be called. If it somehow is
 * reached, it throws loudly instead of silently stubbing — the whole
 * point of `mock` mode is to avoid the real adapter, so reaching the
 * stub's execute is a configuration bug, not a normal path.
 *
 * Matching the real adapter's public surface here lets `pnpm typecheck`
 * pass without split types.
 */

import type { DriverAction, DriverResult, HolaDayBrowserDriver } from '@holaday/browser-driver';

export interface PlaywrightCrxAdapterOptions {
  allowedOrigins?: readonly string[];
  perStrategyTimeoutMs?: number;
  attachToTabId?: number | null;
}

export class PlaywrightCrxAdapter implements HolaDayBrowserDriver {
  async execute(_action: DriverAction): Promise<DriverResult> {
    throw new Error(
      'PlaywrightCrxAdapter: called in VITE_BROWSER_DRIVER=mock build — ' +
        'the runtime guard in getDriver() should have returned MockDriver first',
    );
  }

  async dispose(): Promise<void> {
    // no-op
  }
}
