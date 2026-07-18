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

import type { BrowserViewportProfile } from '@holaday/shared-types';
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
  /**
   * Phase 24 — instances are now keyed by taskId (one task = one
   * Brave). userId is retained as the OWNER reference: cookie-sync
   * needs it to drain pending_cookies on instance ready, and the
   * screencast / VNC proxies use peekActiveForUser(userId) to find
   * which task's Brave to attach to (panel-side stays user-keyed).
   */
  taskId: string;
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
  /**
   * Hard expiry for a completed task's short browser-review lease.
   * Retained instances remain streamable after the task reaches a terminal
   * state, but are always reclaimable when a new task needs pool capacity.
   */
  retainedUntil?: number;
  retentionReason?: string;
  /**
   * Optimization #3 R1 — viewport profile this instance was spawned
   * with. Used by the CDP streamer to cap frame dimensions to the
   * Brave's logical viewport, and by /screencast-ws/ handlers to
   * surface the profile to the SPA viewport for display-time math.
   * Undefined on legacy / back-compat allocations (treated as
   * 'desktop' by downstream consumers).
   */
  viewportProfile?: BrowserViewportProfile;
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
  /**
   * Phase 24 — historically named `byUser` for back-compat with
   * /trpc/health consumers. Each entry now also carries `taskId`
   * since the pool keys per-task; multiple entries can share a
   * userId when one user has several concurrent tasks.
   */
  byUser: Array<{
    taskId: string;
    userId: string;
    cdpPort: number;
    status: InstanceStatus;
    lastActiveAt: number;
    createdAt: number;
  }>;
}
