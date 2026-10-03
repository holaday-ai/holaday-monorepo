export class BrowserExecutionBusyError extends Error {
  readonly code = 'browser_busy';

  constructor() {
    super('browser_busy');
    this.name = 'BrowserExecutionBusyError';
  }
}

export interface SelectedBrowserExecutionLease {
  release(): void;
}

export interface BrowserExecutionOwnership {
  acquireSelected(): SelectedBrowserExecutionLease | null;
  runLegacy<T>(run: () => Promise<T>): Promise<T>;
}

/**
 * One service-worker-local arbiter for every native browser execution path.
 * Legacy leases are counted until their real promises settle. A selected
 * lease is exclusive and intentionally spans the whole selected session.
 */
export function createBrowserExecutionOwnership(): BrowserExecutionOwnership {
  let legacyInFlight = 0;
  let selectedOwner: symbol | null = null;

  return {
    acquireSelected(): SelectedBrowserExecutionLease | null {
      if (selectedOwner || legacyInFlight > 0) return null;
      const owner = Symbol('selected-browser-execution');
      selectedOwner = owner;
      let released = false;
      return {
        release() {
          if (released) return;
          released = true;
          if (selectedOwner === owner) selectedOwner = null;
        },
      };
    },

    async runLegacy<T>(run: () => Promise<T>): Promise<T> {
      if (selectedOwner) throw new BrowserExecutionBusyError();
      legacyInFlight += 1;
      try {
        return await run();
      } finally {
        legacyInFlight -= 1;
      }
    },
  };
}

export const browserExecutionOwnership = createBrowserExecutionOwnership();
