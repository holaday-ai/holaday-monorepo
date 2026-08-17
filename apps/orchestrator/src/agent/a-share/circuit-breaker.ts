export interface CircuitBreakerOptions {
  failureThreshold?: number;
  resetTimeoutMs?: number;
  now?: () => number;
}

export class CircuitOpenError extends Error {
  readonly code = 'CIRCUIT_OPEN';

  constructor() {
    super('circuit is open');
    this.name = 'CircuitOpenError';
  }
}

export class CircuitBreaker {
  private readonly failureThreshold: number;
  private readonly resetTimeoutMs: number;
  private readonly now: () => number;
  private consecutiveFailures = 0;
  private openedAt: number | null = null;
  private halfOpenProbeInFlight = false;

  constructor(options: CircuitBreakerOptions = {}) {
    this.failureThreshold = options.failureThreshold ?? 3;
    this.resetTimeoutMs = options.resetTimeoutMs ?? 60_000;
    this.now = options.now ?? Date.now;
  }

  async execute<T>(operation: () => Promise<T>): Promise<T> {
    const openedAt = this.openedAt;
    const halfOpen = openedAt !== null;
    if (halfOpen) {
      if (this.now() - openedAt < this.resetTimeoutMs || this.halfOpenProbeInFlight) {
        throw new CircuitOpenError();
      }
      this.halfOpenProbeInFlight = true;
    }

    try {
      const result = await operation();
      this.consecutiveFailures = 0;
      this.openedAt = null;
      return result;
    } catch (error) {
      this.consecutiveFailures += 1;
      if (halfOpen || this.consecutiveFailures >= this.failureThreshold) {
        this.openedAt = this.now();
      }
      throw error;
    } finally {
      if (halfOpen) this.halfOpenProbeInFlight = false;
    }
  }
}
