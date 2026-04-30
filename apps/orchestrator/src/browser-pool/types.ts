/**
 * Phase 8 browser pool — shared types.
 *
 * The pool hands out "slots", each of which is a deterministic tuple
 * of (display, cdpPort, vncPort, wsPort). Slot i — where i is the
 * offset from the env-configured port starts — always maps to the
 * same ports for the lifetime of the orchestrator, so a user data
 * dir written to /var/lib/holaday-browsers/user_<id>/ can be
 * re-attached to the exact slot it was last spawned on (keeps Brave's
 * per-profile lock happy).
 */

import type { PlaywrightExecutor } from '../agent/vision-loop/playwright-executor.js';

/**
 * Lifecycle status of one instance. Callers never see `allocating`
 * — allocate() waits until the instance reaches `ready` or errors.
 */
export type InstanceStatus = 'allocating' | 'ready' | 'draining' | 'dead';

export interface BrowserSlot {
  /** 0-indexed offset from port starts — determines all derived ports + display. */
  index: number;
  /** Xvfb display number (`:${display}`). */
  display: number;
  cdpPort: number;
  /** x11vnc RFB port — only accessed from inside the box. */
  vncPort: number;
  /** websockify WS port — exposed (through orchestrator proxy) to the browser. */
  wsPort: number;
}

export interface BrowserInstance extends BrowserSlot {
  userId: string;
  userDataDir: string;
  executor: PlaywrightExecutor;
  xvfbPid: number;
  bravePid: number;
  x11vncPid: number;
  websockifyPid: number;
  /** Epoch ms — fresh on every task that uses this instance. */
  lastActiveAt: number;
  createdAt: number;
  status: InstanceStatus;
}

export interface PoolConfig {
  maxInstances: number;
  idleTimeoutMs: number;
  baseDir: string;
  cdpPortStart: number;
  vncPortStart: number;
  wsPortStart: number;
  displayStart: number;
  /** Xvfb screen geometry, e.g. '1720x1440x24'. */
  screenSize: string;
  /**
   * Phase 17 — fired once per allocate, AFTER the PlaywrightExecutor
   * connects + status flips to 'ready'. Used by the cookie-sync
   * service to drain `pending_cookies` into the freshly-spawned
   * Brave context. Best-effort: implementations should swallow
   * errors so a transient sync failure can't block task dispatch.
   *
   * Hook receives the user's external id (usr_…) and the
   * PlaywrightExecutor; resolve a BrowserContext from
   * `executor.getPage().then(p => p.context())`. Optional — pool
   * boots without it for tests / smoke environments.
   */
  onInstanceReady?: (
    userExternalId: string,
    executor: import('../agent/vision-loop/playwright-executor.js').PlaywrightExecutor,
  ) => Promise<void> | void;
}

/**
 * Pool statistics surface — used by /trpc/health and ops
 * dashboards. All counts are point-in-time, no history.
 */
export interface PoolStats {
  active: number;
  idle: number;
  capacity: number;
  byUser: Array<{
    userId: string;
    cdpPort: number;
    status: InstanceStatus;
    lastActiveAt: number;
    createdAt: number;
  }>;
}
