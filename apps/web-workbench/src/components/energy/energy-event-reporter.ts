export interface EnergyEventLike {
  type: string;
}

interface EnergyEventReporterOptions<TEvent extends EnergyEventLike> {
  send: (event: TEvent) => Promise<unknown>;
  warn?: (message: string, metadata: EnergyEventWarning) => void;
  waitBeforeRetry?: () => Promise<void>;
  maxPending?: number;
}

interface EnergyEventWarning {
  eventType: string;
  retryable: boolean;
  attempts: 1 | 2;
}

export interface EnergyEventReporter<TEvent extends EnergyEventLike> {
  report: (event: TEvent) => Promise<void>;
  dispose: () => void;
}

export function createEnergyEventReporter<TEvent extends EnergyEventLike>({
  send,
  warn = (message, metadata) => console.warn(message, metadata),
  waitBeforeRetry = () => new Promise((resolve) => window.setTimeout(resolve, 250)),
  maxPending = 8,
}: EnergyEventReporterOptions<TEvent>): EnergyEventReporter<TEvent> {
  let disposed = false;
  let warned = false;
  const pending = new Set<Promise<void>>();
  const configuredLimit = Number.isFinite(maxPending) ? Math.floor(maxPending) : 8;
  const pendingLimit = Math.max(1, Math.min(20, configuredLimit));

  const deliver = async (event: TEvent): Promise<void> => {
    if (disposed) return;
    let attempts: 1 | 2 = 1;
    try {
      await send(event);
      return;
    } catch (error) {
      const retryable = isRetryableEnergyEventError(error);
      if (retryable && !disposed) {
        await waitBeforeRetry();
        if (disposed) return;
        attempts = 2;
        try {
          await send(event);
          return;
        } catch {
          // Report the bounded failure below without exposing the payload.
        }
      }

      if (!warned && !disposed) {
        warned = true;
        warn('energy event delivery failed', {
          eventType: event.type,
          retryable,
          attempts,
        });
      }
    }
  };

  const report = (event: TEvent): Promise<void> => {
    if (disposed || pending.size >= pendingLimit) return Promise.resolve();
    const delivery = deliver(event);
    pending.add(delivery);
    void delivery.then(
      () => pending.delete(delivery),
      () => pending.delete(delivery),
    );
    return delivery;
  };

  return {
    report,
    dispose: () => {
      disposed = true;
    },
  };
}

function isRetryableEnergyEventError(error: unknown): boolean {
  const status = errorStatus(error);
  return status === null || status >= 500;
}

function errorStatus(error: unknown): number | null {
  if (!isRecord(error)) return null;
  const direct = numericStatus(error.httpStatus) ?? numericStatus(error.status);
  if (direct !== null) return direct;
  if (isRecord(error.data)) {
    const dataStatus = numericStatus(error.data.httpStatus);
    if (dataStatus !== null) return dataStatus;
  }
  if (isRecord(error.shape) && isRecord(error.shape.data)) {
    return numericStatus(error.shape.data.httpStatus);
  }
  return null;
}

function numericStatus(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
