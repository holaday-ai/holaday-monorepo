/**
 * Per-model in-process concurrency gate. Alibaba Model Studio enforces
 * per-second burst limits per model; queuing here turns a burst into a short
 * wait instead of a wave of 429s.
 */
export const MODEL_CONCURRENCY_LIMIT = 16;

interface Waiter {
  resolve: () => void;
  reject: (error: unknown) => void;
}

interface Gate {
  active: number;
  waiters: Waiter[];
}

export interface ModelConcurrencyGate {
  /** Resolves with a release function once a slot is free; rejects if `signal` aborts first. */
  acquire(model: string, signal?: AbortSignal): Promise<() => void>;
  snapshot(model: string): { active: number; waiting: number };
}

export function createModelConcurrencyGate(limit = MODEL_CONCURRENCY_LIMIT): ModelConcurrencyGate {
  const gates = new Map<string, Gate>();
  const gateFor = (model: string): Gate => {
    let gate = gates.get(model);
    if (!gate) {
      gate = { active: 0, waiters: [] };
      gates.set(model, gate);
    }
    return gate;
  };

  const releaseFor = (model: string, gate: Gate) => {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = gate.waiters.shift();
      if (next) {
        next.resolve();
        return;
      }
      gate.active -= 1;
      if (gate.active === 0) gates.delete(model);
    };
  };

  return {
    async acquire(model, signal) {
      if (signal?.aborted) throw abortReason(signal);
      const gate = gateFor(model);
      if (gate.active < limit) {
        gate.active += 1;
        return releaseFor(model, gate);
      }
      await new Promise<void>((resolve, reject) => {
        const waiter: Waiter = {
          resolve: () => {
            signal?.removeEventListener('abort', onAbort);
            resolve();
          },
          reject,
        };
        const onAbort = () => {
          const index = gate.waiters.indexOf(waiter);
          if (index >= 0) gate.waiters.splice(index, 1);
          reject(abortReason(signal));
        };
        signal?.addEventListener('abort', onAbort, { once: true });
        gate.waiters.push(waiter);
      });
      // The releasing holder handed its slot over; `active` is unchanged.
      return releaseFor(model, gate);
    },
    snapshot(model) {
      const gate = gates.get(model);
      return { active: gate?.active ?? 0, waiting: gate?.waiters.length ?? 0 };
    },
  };
}

function abortReason(signal: AbortSignal | undefined): unknown {
  return signal?.reason ?? new DOMException('Aborted', 'AbortError');
}

/** Shared by every Qwen transport in this process. */
export const modelConcurrencyGate = createModelConcurrencyGate();
