const RESTORABLE_BROWSER_STATUSES = new Set([
  'completed',
  'partial_success',
  'failed',
  'cancelled',
]);

interface BrowserTaskSnapshot {
  status: string;
  origin: string;
  result: unknown;
}

export interface RestorableBrowserTarget {
  url: string;
}

/**
 * Deduplicates process-level restore work without coupling BrowserPool to
 * database or navigation policy concerns. Pool identity is part of the key so
 * tests and multi-runtime deployments cannot accidentally share a flight.
 */
export class BrowserSessionRestoreFlights {
  private readonly byPool = new WeakMap<object, Map<string, Promise<unknown>>>();

  run<T>(pool: object, taskId: string, restore: () => Promise<T>): Promise<T> {
    let taskFlights = this.byPool.get(pool);
    if (!taskFlights) {
      taskFlights = new Map();
      this.byPool.set(pool, taskFlights);
    }
    const existing = taskFlights.get(taskId) as Promise<T> | undefined;
    if (existing) return existing;

    const operation = restore();
    taskFlights.set(taskId, operation);
    const clear = (): void => {
      if (taskFlights?.get(taskId) === operation) {
        taskFlights.delete(taskId);
      }
    };
    operation.then(clear, clear);
    return operation;
  }
}

function isHttpUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export function restorableBrowserTarget(task: BrowserTaskSnapshot): RestorableBrowserTarget | null {
  if (task.origin !== 'user' || !RESTORABLE_BROWSER_STATUSES.has(task.status)) {
    return null;
  }
  if (!task.result || typeof task.result !== 'object') return null;

  const result = task.result as {
    finalUrl?: unknown;
    executionMode?: unknown;
    metadata?: { executionMode?: unknown } | null;
  };
  const executionMode = result.metadata?.executionMode ?? result.executionMode ?? null;
  if (executionMode !== 'browser') return null;

  const finalUrl = typeof result.finalUrl === 'string' ? result.finalUrl.trim() : '';
  if (!finalUrl || !isHttpUrl(finalUrl)) return null;
  return { url: finalUrl.slice(0, 2048) };
}

/** A result limitation that promised a logged-out run. */
const LOGGED_OUT_PROMISE = /无登录态|看不到你的个人信息|无法读取个人信息/;

/**
 * The session policy for re-opening a task's browser (D17-P1-01 / D17-P1-02).
 * Fail closed: a task may load a vault session ONLY when it can be shown to be
 * an identity task, i.e. the server stored `browserSessionPolicy: 'vault_allowed'`
 * in its immutable sourceContext at creation (PR #271 onward).
 *
 * Everything else is `anonymous`:
 * - rows created before the policy existed (sourceContext null or without the
 *   field). No older record stores the route that would prove identity: Deploy-16
 *   persisted only `browserLimitation` for logged-out routes and never the
 *   `vault_session` route reason, so there is nothing to prove an identity task;
 * - an unknown or malformed value;
 * - any record whose result promised a logged-out run (`metadata.browserLimitation`
 *   saying 无登录态 / 看不到你的个人信息 / 无法读取个人信息), even if the
 *   sourceContext says otherwise.
 * Old business records are read as they are; nothing is migrated or rewritten.
 * A legacy identity task therefore restores without its saved login; the user
 * re-runs it to use the session again.
 */
export function storedBrowserSessionPolicy(
  task: { sourceContext?: unknown; result?: unknown } | null | undefined,
): 'anonymous' | 'vault_allowed' {
  if (!task || typeof task !== 'object') return 'anonymous';
  const result = task.result && typeof task.result === 'object' ? task.result : null;
  const metadata = (result as { metadata?: unknown } | null)?.metadata;
  const limitation =
    metadata && typeof metadata === 'object'
      ? (metadata as { browserLimitation?: unknown }).browserLimitation
      : undefined;
  if (typeof limitation === 'string' && LOGGED_OUT_PROMISE.test(limitation)) return 'anonymous';
  const source =
    task.sourceContext && typeof task.sourceContext === 'object' ? task.sourceContext : null;
  const value = (source as { browserSessionPolicy?: unknown } | null)?.browserSessionPolicy;
  return value === 'vault_allowed' ? 'vault_allowed' : 'anonymous';
}
