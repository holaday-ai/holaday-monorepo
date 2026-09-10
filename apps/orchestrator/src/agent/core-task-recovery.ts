import { type OperationLifetime, startOwnedOperation } from '../execution/owned-operation.js';
import {
  type CoreAdmission,
  type CoreTaskHead,
  assertPreparedCoreAdmission,
  parseCoreTaskHead,
} from './core-task-admission.js';
import type { CoreTaskRepository } from './core-task-repository.js';
import { type CoreSettlement, assertPreparedCoreSettlement } from './core-task-settlement.js';

type RecoveryKind = 'committed' | 'not_committed' | 'stale' | 'unknown';
type RecoveryResult = Readonly<{ kind: RecoveryKind }>;
type AdmissionRecoveryResult = Readonly<{ kind: RecoveryKind; dispatchAllowed: false }>;
type AdmissionStartResult = Readonly<{ kind: RecoveryKind; dispatchAllowed: boolean }>;
type AdmissionReader = Pick<CoreTaskRepository, 'readHead'>;
type SettlementRepository = Pick<CoreTaskRepository, 'settle' | 'readSettlement'>;
type Attempt<T> = { kind: 'ok'; value: T } | { kind: 'error' | 'timeout' };

export interface CoreRecoveryClock {
  /** Test seams only; limits cannot be overridden by callers. */
  now?: () => number;
  wait?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
}

const delays = [1000, 3000] as const;
const settlementStates = new Set(['completed', 'partial_success', 'failed', 'awaiting_user']);
// Operation-lifetime budgets, not invocation-lifetime budgets. Weak keys do not
// create a permanent candidate queue and cannot be reconstructed after restart.
type RecoveryEntry<T> = { lifetime?: OperationLifetime; result: Promise<T> };
const admissions = new WeakMap<CoreAdmission, RecoveryEntry<AdmissionRecoveryResult>>();
const settlements = new WeakMap<CoreSettlement, RecoveryEntry<RecoveryResult>>();

function reuse<T>(entry: RecoveryEntry<T>, lifetime?: OperationLifetime): Promise<T> {
  if (entry.lifetime?.drain !== lifetime?.drain || entry.lifetime?.owner !== lifetime?.owner) {
    // Never pretend an untracked or foreign physical operation belongs to this gate.
    lifetime?.drain.block();
    throw new Error('CORE_RECOVERY_LIFETIME_MISMATCH');
  }
  return entry.result;
}

function trackRecovery<T extends RecoveryResult>(
  lifetime: OperationLifetime | undefined,
  clock: CoreRecoveryClock,
  action: (budget: RecoveryBudget) => Promise<T>,
): Promise<T> {
  const invoke = async (owned?: OperationLifetime): Promise<T> => {
    const budget = new RecoveryBudget(clock, owned);
    try {
      const value = await action(budget);
      // Cleanup may itself run callbacks. Reuse the original deadline after it,
      // rather than giving the new ownership continuation another 15 seconds.
      budget.close();
      const final = budget.canReturn()
        ? value
        : {
            ...value,
            kind: 'unknown' as const,
            ...('dispatchAllowed' in value ? { dispatchAllowed: false } : {}),
          };
      if (final.kind === 'unknown' && owned) owned.drain.markUnknown(owned.owner);
      return final;
    } finally {
      budget.close();
    }
  };
  if (!lifetime) return invoke();
  const { drain, owner: parent } = lifetime;
  return startOwnedOperation(
    drain,
    'database',
    (owner) => invoke(Object.freeze({ drain, owner })),
    { parent, errorOutcome: 'unknown', dispatch: 'immediate' },
  ).result;
}

function entry<T>(result: Promise<T>, lifetime?: OperationLifetime): RecoveryEntry<T> {
  return { result, lifetime: lifetime && Object.freeze({ ...lifetime }) };
}

/** A permit belongs only to this first caller and only to a directly confirmed
 * transaction. Recovery and duplicate callers observe state, never a permit.
 * The server must use the permit immediately, not store it or send it to clients.
 */
export async function admitCoreTask(
  repo: Pick<CoreTaskRepository, 'admit' | 'readHead'>,
  op: CoreAdmission,
  clock: CoreRecoveryClock = {},
  lifetime?: OperationLifetime,
): Promise<AdmissionStartResult> {
  assertPreparedCoreAdmission(op);
  const previous = admissions.get(op);
  if (previous) return reuse(previous, lifetime);
  const pending = trackRecovery(lifetime, clock, (budget) => admitWithinBudget(repo, op, budget));
  // Cache observers never inherit the first caller's dispatch permit, even on rejection.
  const observed = pending.then(
    (value): AdmissionRecoveryResult => Object.freeze({ kind: value.kind, dispatchAllowed: false }),
    (): AdmissionRecoveryResult => Object.freeze({ kind: 'unknown', dispatchAllowed: false }),
  );
  admissions.set(op, entry(observed, lifetime));
  return pending;
}

async function admitWithinBudget(
  repo: Pick<CoreTaskRepository, 'admit' | 'readHead'>,
  op: CoreAdmission,
  budget: RecoveryBudget,
): Promise<AdmissionStartResult> {
  const finish = (kind: RecoveryKind, dispatchAllowed: boolean): AdmissionStartResult =>
    Object.freeze({ kind, dispatchAllowed });
  try {
    const write = await budget.run(() => repo.admit(op), true);
    if (write.kind === 'timeout' || !budget.canWait(0)) return finish('unknown', false);
    if (confirmed(write)) return finish('committed', true);
    const observed = await readAdmissionWithinBudget(repo, op, budget);
    return finish(budget.canWait(0) ? observed.kind : 'unknown', false);
  } catch {
    return finish('unknown', false);
  } finally {
    budget.close();
  }
}

/** Only for uncertain/refused admission. It NEVER grants permission to dispatch. */
export async function recoverCoreAdmission(
  repo: AdmissionReader,
  op: CoreAdmission,
  clock: CoreRecoveryClock = {},
  lifetime?: OperationLifetime,
): Promise<AdmissionRecoveryResult> {
  assertPreparedCoreAdmission(op);
  const previous = admissions.get(op);
  if (previous) return reuse(previous, lifetime);
  const pending = trackRecovery(lifetime, clock, (budget) => recoverAdmission(repo, op, budget));
  admissions.set(op, entry(pending, lifetime));
  return pending;
}

/** Confirmed persistence only. No model/charge replay and no broadcast callback. */
export async function persistCoreSettlement(
  repo: SettlementRepository,
  op: CoreSettlement,
  clock: CoreRecoveryClock = {},
  lifetime?: OperationLifetime,
): Promise<RecoveryResult> {
  assertPreparedCoreSettlement(op);
  const previous = settlements.get(op);
  if (previous) return reuse(previous, lifetime);
  const pending = trackRecovery(lifetime, clock, (budget) => persistSettlement(repo, op, budget));
  settlements.set(op, entry(pending, lifetime));
  return pending;
}

async function recoverAdmission(
  repo: AdmissionReader,
  op: CoreAdmission,
  budget: RecoveryBudget,
): Promise<AdmissionRecoveryResult> {
  try {
    const observed = await readAdmissionWithinBudget(repo, op, budget);
    return budget.canWait(0)
      ? observed
      : Object.freeze({ kind: 'unknown', dispatchAllowed: false });
  } finally {
    budget.close();
  }
}

async function readAdmissionWithinBudget(
  repo: AdmissionReader,
  op: CoreAdmission,
  budget: RecoveryBudget,
): Promise<AdmissionRecoveryResult> {
  for (const delay of delays) {
    if (!(await budget.pause(delay)) || !budget.canWait(0)) break;
    const read = await budget.run(() => repo.readHead(op.scope), true);
    if (read.kind === 'timeout' || !budget.canWait(0)) break;
    if (read.kind !== 'ok') continue;
    const kind = classifyAdmission(read.value, op);
    if (kind !== 'unknown') return Object.freeze({ kind, dispatchAllowed: false });
  }
  return Object.freeze({ kind: 'unknown', dispatchAllowed: false });
}

async function persistSettlement(
  repo: SettlementRepository,
  op: CoreSettlement,
  budget: RecoveryBudget,
): Promise<RecoveryResult> {
  try {
    const initial = await budget.run(() => repo.settle(op), true);
    if (initial.kind === 'timeout' || !budget.canWait(0)) return result('unknown');
    if (confirmed(initial)) return result('committed');
    let retries = 0;
    for (const delay of delays) {
      if (!(await budget.pause(delay)) || !budget.canWait(0)) return result('unknown');
      const read = await budget.run(() => repo.readSettlement(op.scope), true);
      if (read.kind === 'timeout' || !budget.canWait(0)) return result('unknown');
      if (read.kind !== 'ok') continue;
      const kind = classifySettlement(read.value, op);
      if (kind === 'committed' || kind === 'stale') return result(kind);
      if (kind !== 'not_committed') continue;
      const retryDelay = delays[retries];
      // A fresh authoritative read is the only proof of non-commit. Do not
      // reuse it after starting another write whose response may be lost.
      if (retryDelay === undefined || !budget.canWait(retryDelay)) return result('not_committed');
      if (!(await budget.pause(retryDelay)) || !budget.canWait(0)) return result('unknown');
      retries++;
      const write = await budget.run(() => repo.settle(op), true);
      if (write.kind === 'timeout' || !budget.canWait(0)) return result('unknown');
      if (confirmed(write)) return result('committed');
    }
    // The final write may have committed. No remaining read allowance means
    // unknown, NOT the pre-write snapshot's not_committed classification.
    return result('unknown');
  } finally {
    budget.close();
  }
}

function confirmed(attempt: Attempt<{ persisted: boolean }>): boolean {
  return attempt.kind === 'ok' && attempt.value?.persisted === true;
}
function result(kind: RecoveryKind): RecoveryResult {
  return Object.freeze({ kind });
}

function classifyAdmission(value: unknown, op: CoreAdmission): RecoveryKind {
  try {
    const head = parseCoreTaskHead(value);
    if (
      head.status === 'cancelled' ||
      head.status === 'paused' ||
      head.executionRevision > op.executionRevision
    )
      return 'stale';
    if (
      head.executionId === op.executionId &&
      head.executionRevision === op.executionRevision &&
      head.recordVersion >= op.recordVersion &&
      (head.status === 'executing' || settlementStates.has(head.status))
    )
      return 'committed';
    return sameHead(head, op.before) ? 'not_committed' : 'unknown';
  } catch {
    return 'unknown';
  }
}

function classifySettlement(value: unknown, op: CoreSettlement): RecoveryKind {
  try {
    if (!value || typeof value !== 'object' || !('commitId' in value)) return 'unknown';
    const { commitId, ...fields } = value;
    const head = parseCoreTaskHead(fields);
    if (
      head.status === 'cancelled' ||
      head.status === 'paused' ||
      head.executionRevision > op.executionRevision
    )
      return 'stale';
    if (head.executionId !== op.executionId || head.executionRevision !== op.executionRevision)
      return 'unknown';
    if (
      head.status === op.status &&
      head.recordVersion === op.recordVersion &&
      commitId === op.commitId
    )
      return 'committed';
    if (commitId === op.commitId) return 'unknown';
    if (
      head.status === 'executing' &&
      head.recordVersion === op.expectedRecordVersion &&
      commitId === null
    )
      return 'not_committed';
    if (head.recordVersion > op.expectedRecordVersion) return 'stale';
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

function sameHead(a: CoreTaskHead, b: CoreTaskHead): boolean {
  return (
    a.status === b.status &&
    a.executionId === b.executionId &&
    a.executionRevision === b.executionRevision &&
    a.recordVersion === b.recordVersion
  );
}

/** Race every wait/DB promise against the SAME monotonic deadline. A timed-out
 * write is not cancelled by this class: it may commit later, but its callback
 * cannot broadcast, mutate the returned result, or trigger another write.
 */
class RecoveryBudget {
  private readonly controller = new AbortController();
  private readonly now: () => number;
  private readonly wait: (ms: number, signal: AbortSignal) => Promise<void>;
  private readonly endsAt: number;
  private lastNow: number;

  constructor(
    clock: CoreRecoveryClock,
    private readonly lifetime?: OperationLifetime,
  ) {
    this.now = clock.now ?? (() => performance.now());
    this.wait = clock.wait ?? cancellableWait;
    this.lastNow = this.readNow();
    this.endsAt = this.lastNow + 15_000;
  }
  private readNow(): number {
    try {
      return this.now();
    } catch {
      return Number.NaN;
    }
  }
  private remaining(afterCleanup = false): number {
    const now = this.readNow();
    if (
      (!afterCleanup && this.controller.signal.aborted) ||
      !Number.isFinite(this.endsAt) ||
      !Number.isFinite(now) ||
      now < this.lastNow
    )
      return 0;
    this.lastNow = now;
    return Math.max(0, this.endsAt - now);
  }
  canWait(ms: number): boolean {
    return this.remaining() > ms;
  }
  canReturn(): boolean {
    return this.remaining(true) > 0;
  }
  async pause(ms: number): Promise<boolean> {
    if (!this.canWait(ms)) return false;
    return (await this.run(() => this.wait(ms, this.controller.signal))).kind === 'ok';
  }
  async run<T>(action: () => Promise<T>, database = false): Promise<Attempt<T>> {
    const remaining = this.remaining();
    if (remaining <= 0) return { kind: 'timeout' };
    return new Promise((resolve) => {
      let finished = false;
      const finish = (value: Attempt<T>) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        resolve(value.kind === 'timeout' || this.remaining() > 0 ? value : { kind: 'timeout' });
      };
      const timer = setTimeout(() => finish({ kind: 'timeout' }), remaining);
      // Defer action entry so a synchronous adapter cannot re-enter before the
      // operation-lifetime promise is registered. Also absorb synchronous throws.
      Promise.resolve()
        .then(async () => {
          if (this.remaining() <= 0) {
            finish({ kind: 'timeout' });
            return;
          }
          // This owner follows the original DB promise, not this budget's race.
          // The logical recovery result separately retains unresolved commit ambiguity.
          const value =
            database && this.lifetime
              ? await startOwnedOperation(this.lifetime.drain, 'database', action, {
                  parent: this.lifetime.owner,
                  errorOutcome: 'known',
                  dispatch: 'immediate',
                }).result
              : await action();
          finish({ kind: 'ok', value });
        })
        .catch(() => finish({ kind: 'error' }));
    });
  }
  close(): void {
    this.controller.abort();
  }
}

function cancellableWait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error('CORE_RECOVERY_WAIT_ABORTED'));
      return;
    }
    const abort = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      reject(new Error('CORE_RECOVERY_WAIT_ABORTED'));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, ms);
    signal.addEventListener('abort', abort, { once: true });
  });
}
