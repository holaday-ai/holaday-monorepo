import type { ResilientSelector } from '@holaday/shared-types';

/**
 * The seven action kinds the orchestrator can dispatch. Matches the WS
 * protocol's `server.task.dispatch.action.kind` enum so driver translation
 * is a 1:1 mapping.
 */
export type ActionKind = 'goto' | 'click' | 'type' | 'extract' | 'wait' | 'eval' | 'screenshot';

export interface DriverAction {
  kind: ActionKind;
  selector?: ResilientSelector;
  payload?: Record<string, unknown>;
  /** Total budget for this action, including selector resolution. */
  deadlineMs?: number;
}

/**
 * Shape mirrors `client.step.result` minus the task/step IDs (the SW adds
 * those when sending the WS frame). `awaiting_user` is carried through when
 * the driver itself knows the action needs human input — e.g. the page
 * redirected to a login URL and a Skill's login detection caveat fires.
 */
export interface DriverResult {
  status: 'ok' | 'error' | 'awaiting_user';
  data?: unknown;
  error?: { code: string; message: string };
}

/**
 * Runtime contract for any browser driver. The extension SW ships
 * `PlaywrightCrxAdapter`; unit tests substitute `MockDriver`; Phase 2+
 * could have a CDP adapter behind the same interface.
 */
export interface HolaDayBrowserDriver {
  /** Execute one action and resolve to a DriverResult. Must not throw. */
  execute(action: DriverAction): Promise<DriverResult>;
  /** Release any browser-side resources (close CRX app / detach). */
  dispose(): Promise<void>;
}

// ---------- Error codes emitted by adapters ----------

export const DRIVER_ERRORS = {
  SELECTOR_NOT_FOUND: 'SELECTOR_NOT_FOUND',
  SELECTOR_MISSING: 'SELECTOR_MISSING',
  PAYLOAD_MISSING: 'PAYLOAD_MISSING',
  ORIGIN_BLOCKED: 'ORIGIN_BLOCKED',
  NAV_FAILED: 'NAV_FAILED',
  CLICK_FAILED: 'CLICK_FAILED',
  TYPE_FAILED: 'TYPE_FAILED',
  EXTRACT_FAILED: 'EXTRACT_FAILED',
  EVAL_FAILED: 'EVAL_FAILED',
  SCREENSHOT_FAILED: 'SCREENSHOT_FAILED',
  WAIT_TIMEOUT: 'WAIT_TIMEOUT',
  NOT_ATTACHED: 'NOT_ATTACHED',
  UNKNOWN_KIND: 'UNKNOWN_KIND',
} as const;

export type DriverErrorCode = (typeof DRIVER_ERRORS)[keyof typeof DRIVER_ERRORS];

export function driverError(code: DriverErrorCode, message: string): DriverResult {
  return { status: 'error', error: { code, message } };
}
