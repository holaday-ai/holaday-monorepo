import { type EvidenceEntry, EvidenceLedger } from './evidence-ledger.js';
import {
  type ContractInputs,
  type ExecutionContract,
  buildContract,
} from './execution-contract.js';
import {
  type TaskVerificationContext,
  VerificationContextError,
  createTaskVerificationContext,
  renderVerificationUserIntent,
} from './task-verification-context.js';

export interface CoreExecutionHandle {
  readonly taskId: string;
  readonly executionId: string;
  readonly executionRevision: number;
}

export type BeginCoreExecutionInputs = Omit<
  ContractInputs,
  'intent' | 'executionMode' | 'expertWorkflowId'
> & {
  verificationContext: TaskVerificationContext;
};

export interface CoreExecutionState {
  readonly handle: CoreExecutionHandle;
  readonly contract: ExecutionContract;
  readonly ledger: EvidenceLedger;
  readonly context: TaskVerificationContext;
}

export class CoreExecutionRegistry {
  private readonly active = new Map<string, CoreExecutionState>();

  constructor(private readonly maxActiveTasks = 256) {
    if (!Number.isSafeInteger(maxActiveTasks) || maxActiveTasks < 1)
      throw new Error('CORE_EXECUTION_CAPACITY');
  }

  /** Only call after server-side transactional admission; never from a client DTO.
   * Revision comparisons here cover active overlap, not durable/cross-process authority.
   * Replacing/releasing a run drops this registry's old body/material references.
   */
  begin(input: BeginCoreExecutionInputs): CoreExecutionHandle {
    if (!input || typeof input.taskId !== 'string' || !input.taskId.trim()) {
      throw new VerificationContextError('VERIFICATION_CONTEXT_INVALID');
    }
    const context = createTaskVerificationContext(input.verificationContext);
    const current = this.active.get(input.taskId);
    if (
      current &&
      (context.executionRevision <= current.handle.executionRevision ||
        context.executionId === current.handle.executionId)
    ) {
      throw new VerificationContextError('VERIFICATION_CONTEXT_INVALID');
    }
    if (!current && this.active.size >= this.maxActiveTasks)
      throw new Error('CORE_EXECUTION_CAPACITY');
    const { verificationContext: _context, ...contractOptions } = input;
    const contract = freezeSnapshot(
      buildContract({
        ...structuredClone(contractOptions),
        intent: renderVerificationUserIntent(context),
        executionMode: 'generate',
        expertWorkflowId: context.workflow?.id ?? context.legacyWorkflow?.id ?? null,
      }),
    );
    const handle = Object.freeze({
      taskId: input.taskId,
      executionId: context.executionId,
      executionRevision: context.executionRevision,
    });
    const ledger = new EvidenceLedger(input.taskId);
    ledger.add({
      fact: renderVerificationUserIntent(context),
      sourceType: 'user_input',
      sourceDetail: 'core task admission',
      confidence: 'observed',
    });
    this.active.set(input.taskId, Object.freeze({ handle, contract, ledger, context }));
    return handle;
  }

  read(handle: CoreExecutionHandle): CoreExecutionState | null {
    const state = handle && this.active.get(handle.taskId);
    // Frozen object identity prevents stale, cloned, or foreign-registry handles.
    return state && state.handle === handle ? state : null;
  }

  record(
    handle: CoreExecutionHandle,
    entry: Omit<EvidenceEntry, 'id' | 'timestamp' | 'taskId'>,
  ): boolean {
    return Boolean(this.read(handle)?.ledger.add(entry));
  }

  release(handle: CoreExecutionHandle): boolean {
    if (!this.read(handle)) return false;
    return this.active.delete(handle.taskId);
  }
}

function freezeSnapshot<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freezeSnapshot(child);
    Object.freeze(value);
  }
  return value;
}

export const coreExecutionRegistry = new CoreExecutionRegistry();
