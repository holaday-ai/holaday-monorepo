import type { DriverAction, DriverResult, HolaDayBrowserDriver } from './driver.js';

/**
 * MockDriver — used by orchestrator integration tests and by the extension
 * when running in a non-CRX context (e.g. during `pnpm --filter
 * @holaday/extension build` on a host without Chrome).
 *
 * Two ways to use it:
 *
 * 1. Default: returns `{status:'ok', data:{stub:true, kind}}` after an
 *    optional small delay. Same shape as the Phase 0 stub the SW used
 *    before Day 4.
 *
 * 2. Per-kind handler: `mock.on('click', async (action) => ...)` lets
 *    a test drive the loop deterministically.
 */
export class MockDriver implements HolaDayBrowserDriver {
  private handlers = new Map<
    DriverAction['kind'],
    (action: DriverAction) => Promise<DriverResult>
  >();
  constructor(private readonly opts: { autoAckDelayMs?: number } = {}) {}

  on(kind: DriverAction['kind'], handler: (action: DriverAction) => Promise<DriverResult>): this {
    this.handlers.set(kind, handler);
    return this;
  }

  async execute(action: DriverAction): Promise<DriverResult> {
    const h = this.handlers.get(action.kind);
    if (h) return h(action);
    if (this.opts.autoAckDelayMs && this.opts.autoAckDelayMs > 0) {
      await new Promise((r) => setTimeout(r, this.opts.autoAckDelayMs));
    }
    return {
      status: 'ok',
      data: { stub: true, kind: action.kind },
    };
  }

  async dispose(): Promise<void> {
    this.handlers.clear();
  }
}
