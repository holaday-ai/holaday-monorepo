export interface MediaActionGuard {
  acquire(): boolean;
  release(): void;
}

/**
 * React state updates are not visible until the next render. This synchronous
 * guard closes the same-tick window where repeated clicks can create or confirm
 * the same paid media action more than once.
 */
export function createMediaActionGuard(): MediaActionGuard {
  let active = false;
  return {
    acquire(): boolean {
      if (active) return false;
      active = true;
      return true;
    },
    release(): void {
      active = false;
    },
  };
}
