import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  type TaskVerificationContext,
  VerificationContextError,
  createTaskVerificationContext,
} from '../execution/task-verification-context.js';
import { VERIFICATION_INPUT_LIMITS } from '../execution/verification-input-budget.js';

export interface CoreTaskScope {
  readonly taskId: string;
  readonly userId: number;
}
export interface CoreTaskHead {
  readonly status: string;
  readonly executionId: string | null;
  readonly executionRevision: number;
  readonly recordVersion: number;
}
export type CoreAcceptedRequirements = Pick<
  TaskVerificationContext,
  'initialRequest' | 'userTurns' | 'phase' | 'workflow' | 'referencePlan'
> & { readonly fileIds: readonly string[] };
export interface CoreAdmission {
  readonly scope: CoreTaskScope;
  readonly before: CoreTaskHead;
  readonly executionId: string;
  readonly executionRevision: number;
  readonly recordVersion: number;
  readonly requirements: CoreAcceptedRequirements;
}

export class CoreAdmissionError extends Error {
  constructor(
    code:
      | 'CORE_ADMISSION_INVALID'
      | 'CORE_ADMISSION_WRITE_INVALID'
      | 'CORE_ADMISSION_UNCONFIRMED'
      | 'CORE_EXECUTION_READ_UNAVAILABLE',
  ) {
    super(code);
    this.name = 'CoreAdmissionError';
  }
}

const integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const scopeSchema = z
  .object({
    taskId: z.string().trim().min(1).max(32),
    userId: integer.positive(),
  })
  .strict();
const headSchema = z
  .object({
    status: z.string().min(1).max(24),
    executionId: z.string().trim().min(1).max(64).nullable(),
    executionRevision: integer,
    recordVersion: integer,
  })
  .strict()
  .refine((head) => (head.executionId === null) === (head.executionRevision === 0));
const inputSchema = z
  .object({
    scope: scopeSchema,
    before: headSchema,
    requirements: z
      .object({
        initialRequest: z.string().min(1),
        userTurns: z.array(z.string()),
        phase: z.enum(['direct', 'draft', 'revise', 'approved_execution']),
        workflow: z.unknown(),
        referencePlan: z.string().nullable(),
        fileIds: z
          .array(z.string().min(1).max(32))
          .max(5)
          .refine((ids) => new Set(ids).size === ids.length),
      })
      .strict(),
  })
  .strict();
const prepared = new WeakSet<object>();

export function parseCoreTaskScope(input: unknown): CoreTaskScope {
  const parsed = scopeSchema.safeParse(input);
  if (!parsed.success) throw new CoreAdmissionError('CORE_ADMISSION_INVALID');
  return Object.freeze(parsed.data);
}

export function parseCoreTaskHead(input: unknown): CoreTaskHead {
  const parsed = headSchema.safeParse(input);
  if (!parsed.success) throw new CoreAdmissionError('CORE_ADMISSION_INVALID');
  return Object.freeze(parsed.data);
}

/** Server-only preparation after authorization. Not a client DTO or permission grant.
 * The same frozen operation must survive write errors for read-only reconciliation.
 * No parsed material bodies or unpersisted model candidates enter this record.
 */
export function prepareCoreAdmission(input: {
  scope: CoreTaskScope;
  before: CoreTaskHead;
  requirements: CoreAcceptedRequirements;
}): CoreAdmission {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) throw new CoreAdmissionError('CORE_ADMISSION_INVALID');
  const { scope, before, requirements: supplied } = parsed.data;
  if (
    (before.status !== 'awaiting_user' &&
      !(before.status === 'executing' && before.executionId === null)) ||
    before.executionRevision >= Number.MAX_SAFE_INTEGER ||
    before.recordVersion >= Number.MAX_SAFE_INTEGER
  )
    throw new CoreAdmissionError('CORE_ADMISSION_INVALID');
  const executionId = randomUUID();
  const executionRevision = before.executionRevision + 1;
  const { fileIds, ...contextFields } = supplied;
  const context = createTaskVerificationContext({
    ...contextFields,
    schemaVersion: 1,
    executionId,
    executionRevision,
    materials: [],
  });
  const requirements = Object.freeze({
    initialRequest: context.initialRequest,
    userTurns: context.userTurns,
    phase: context.phase,
    workflow: context.workflow,
    referencePlan: context.referencePlan,
    fileIds: Object.freeze(fileIds),
  });
  if (
    Buffer.byteLength(JSON.stringify(requirements), 'utf8') > VERIFICATION_INPUT_LIMITS.contextBytes
  )
    throw new VerificationContextError('VERIFICATION_INPUT_LIMIT');
  const operation = Object.freeze({
    scope: Object.freeze(scope),
    before: Object.freeze(before),
    requirements,
    executionId,
    executionRevision,
    recordVersion: before.recordVersion + 1,
  });
  prepared.add(operation);
  return operation;
}

export function assertPreparedCoreAdmission(
  operation: unknown,
): asserts operation is CoreAdmission {
  if (!operation || typeof operation !== 'object' || !prepared.has(operation))
    throw new CoreAdmissionError('CORE_ADMISSION_INVALID');
}
