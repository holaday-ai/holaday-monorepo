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

/**
 * The session policy stored on a task at creation (D17-P1-01). An explicit
 * `anonymous` — or anything unrecognised — stays anonymous; only rows created
 * before the policy existed (no value at all) keep vault access as before.
 */
export function storedBrowserSessionPolicy(sourceContext: unknown): 'anonymous' | 'vault_allowed' {
  if (!sourceContext || typeof sourceContext !== 'object') return 'vault_allowed';
  const value = (sourceContext as { browserSessionPolicy?: unknown }).browserSessionPolicy;
  if (value === undefined) return 'vault_allowed';
  return value === 'vault_allowed' ? 'vault_allowed' : 'anonymous';
}
