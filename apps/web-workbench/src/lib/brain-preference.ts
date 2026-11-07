/**
 * The user's chosen "brain" (model catalog id). Read by the task store on
 * create; the server re-validates it and falls back to the default when the
 * brain is hidden or unknown, so a stale value here is harmless.
 */
const STORAGE_KEY = 'holaday.brainId';
const listeners = new Set<() => void>();

function readStored(): string | null {
  try {
    const value = globalThis.localStorage?.getItem(STORAGE_KEY);
    return value && /^[A-Za-z0-9_-]{1,32}$/.test(value) ? value : null;
  } catch {
    return null;
  }
}

let current: string | null = readStored();

export function getSelectedBrainId(): string | null {
  return current;
}

export function setSelectedBrainId(id: string | null): void {
  if (id === current) return;
  current = id;
  try {
    if (id) globalThis.localStorage?.setItem(STORAGE_KEY, id);
    else globalThis.localStorage?.removeItem(STORAGE_KEY);
  } catch {
    /* Private mode: the choice lasts for this page only. */
  }
  for (const listener of listeners) listener();
}

export function subscribeSelectedBrainId(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
