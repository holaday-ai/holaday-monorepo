import type { ExecutionDrain } from './execution-drain.js';
import type { OperationLifetime, OwnedOperation } from './owned-operation.js';

/** Execution ownership only; does not confer native boot or control authority. */
export interface ExecutionAdmission {
  readonly drain: ExecutionDrain;
  tick(): void;
  runRoot<T>(action: (life: OperationLifetime) => Promise<T>): OwnedOperation<T>;
}
