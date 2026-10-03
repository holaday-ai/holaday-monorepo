import { ChildProcess, type SpawnOptions, spawn } from 'node:child_process';
import type { EventEmitter } from 'node:events';
import { currentOperationLifetime, startOwnedOperation } from '../execution/owned-operation.js';

export interface OwnedPoolProcess {
  readonly child: ChildProcess;
  readonly pid: number;
  readonly ready: Promise<void>;
  terminate(): Promise<void>;
  isRunning(): boolean;
}

/** Leader/stdio receipt only. No authority to signal a PID group or certify descendants. */
export function spawnOwnedPoolProcess(
  command: string,
  args: string[],
  options: SpawnOptions,
): OwnedPoolProcess {
  const parent = currentOperationLifetime();
  if (!parent) throw new Error('POOL_PROCESS_LIFETIME_REQUIRED');
  if (parent.drain.snapshot().unknown) throw new Error('POOL_PROCESS_UNKNOWN');
  let child: ChildProcess | undefined;
  let pid = 0;
  let spawned = false;
  let errored = false;
  let exited = false;
  let closed = false;
  let stopping = false;
  let signalled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let resolveReady!: () => void;
  let rejectReady!: (error: Error) => void;
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  void ready.catch(() => {});
  let requestStop = () => {};
  const operation = startOwnedOperation(
    parent.drain,
    'execution',
    async (owner) => {
      let unknown = false;
      const markUnknown = () => {
        if (!unknown) {
          parent.drain.markUnknown(owner);
          unknown = true;
        }
      };
      try {
        child = spawn(command, args, options);
        const bound = child;
        const kill = ChildProcess.prototype.kill;
        let wake!: () => void;
        const completion = new Promise<void>((resolve) => {
          wake = resolve;
        });
        const signal = (value: NodeJS.Signals) => {
          if (exited || closed || !spawned) return;
          try {
            // Native exit state only prohibits a late signal; it never settles the receipt.
            if (bound.exitCode !== null || bound.signalCode !== null) return;
            const descriptor = Object.getOwnPropertyDescriptor(bound, 'pid');
            if (
              !descriptor ||
              !('value' in descriptor) ||
              descriptor.value !== pid ||
              bound.kill !== kill
            )
              throw new Error('POOL_PROCESS_IDENTITY');
            if (!kill.call(bound, value)) markUnknown();
          } catch {
            markUnknown();
          }
        };
        requestStop = () => {
          if (!stopping || signalled || !spawned || exited || closed) return;
          signalled = true;
          signal('SIGTERM');
          if (!exited && !closed) timer = setTimeout(() => signal('SIGKILL'), 3000);
        };
        const initializationFailed = () => {
          if (closed) return;
          errored = true;
          markUnknown();
          rejectReady(new Error('POOL_PROCESS_START_FAILED'));
          stopping = true;
          requestStop();
        };
        const protect = (action: () => void) => {
          try {
            action();
          } catch {
            initializationFailed();
          }
        };
        const childError = () => {
          if (closed) return;
          errored = true;
          if (pid > 0 || spawned) markUnknown();
          rejectReady(new Error('POOL_PROCESS_START_FAILED'));
        };
        const guardResourceErrors = (target: EventEmitter, observe: () => void) => {
          const emit = target.emit;
          // Only this freshly acquired resource, with a fixed receiver. A native
          // newListener hook may reject every error observer; keep that resource's
          // later errors bounded without changing global or non-error dispatch.
          Object.defineProperty(target, 'emit', {
            configurable: true,
            writable: true,
            value: (event: string | symbol, ...args: unknown[]) => {
              if (event !== 'error') return emit.call(target, event, ...args);
              try {
                return emit.call(target, event, ...args);
              } catch {
                observe();
                return true;
              }
            },
          });
        };
        protect(() => guardResourceErrors(bound, childError));
        // Each observer is independent: one throwing native newListener hook cannot
        // skip all subsequent registrations. If close itself cannot be observed,
        // completion deliberately remains pending with uncertainty, never false idle.
        protect(() =>
          bound.on('close', () => {
            if (closed) return;
            closed = true;
            if (timer) clearTimeout(timer);
            rejectReady(new Error('POOL_PROCESS_CLOSED'));
            wake();
          }),
        );
        protect(() => bound.on('error', childError));
        protect(() =>
          bound.on('exit', () => {
            exited = true;
            if (timer) clearTimeout(timer);
            rejectReady(new Error('POOL_PROCESS_EXITED'));
          }),
        );
        protect(() =>
          bound.on('spawn', () => {
            if (spawned || closed || exited) return;
            spawned = true;
            if (!Number.isSafeInteger(pid) || pid <= 0 || bound.pid !== pid) {
              markUnknown();
              rejectReady(new Error('POOL_PROCESS_IDENTITY'));
              return;
            }
            if (stopping || errored) rejectReady(new Error('POOL_PROCESS_STOPPING'));
            else resolveReady();
            requestStop();
          }),
        );
        protect(() => {
          pid = bound.pid ?? 0;
        });
        for (const field of ['stdout', 'stderr'] as const) {
          protect(() => {
            const stream = bound[field];
            // Keep pipe errors bounded; neither pipe error nor drained text proves child close.
            if (stream) {
              protect(() => guardResourceErrors(stream, initializationFailed));
              protect(() => stream.on('error', initializationFailed));
              protect(() => stream.resume());
            }
          });
        }
        await completion;
        if (unknown || pid > 0 || spawned || !errored) {
          markUnknown();
          throw new Error('POOL_PROCESS_GROUP_EXIT_UNPROVEN');
        }
        // No pid, no spawn event, native error followed by close: no acquired OS process.
      } catch (error) {
        rejectReady(new Error('POOL_PROCESS_START_FAILED'));
        throw error instanceof Error && error.message === 'POOL_PROCESS_GROUP_EXIT_UNPROVEN'
          ? error
          : new Error('POOL_PROCESS_START_FAILED');
      } finally {
        if (timer) clearTimeout(timer);
      }
    },
    { parent: parent.owner, dispatch: 'immediate', errorOutcome: 'known' },
  );
  void operation.result.catch(() => {});
  if (!child) throw new Error('POOL_PROCESS_START_FAILED');
  return Object.freeze({
    child,
    pid,
    ready,
    terminate: () => {
      stopping = true;
      requestStop();
      return operation.result;
    },
    isRunning: () => spawned && !errored && !exited && !closed && !stopping,
  });
}
