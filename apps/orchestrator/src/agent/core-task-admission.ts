import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  type CoreAcceptedRequirements,
  CoreRequirementsError,
  parseCoreRequirements,
} from './core-task-requirements.js';

export type { CoreAcceptedRequirements } from './core-task-requirements.js';

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
export interface CoreAdmission {
  readonly scope: CoreTaskScope;
  readonly before: CoreTaskHead;
  readonly executionId: string;
  readonly executionRevision: number;
  readonly recordVersion: number;
  readonly requirements: CoreAcceptedRequirements;
  readonly legacySnapshot?: Readonly<{ resultJson: string; roleId: string | null; origin: string }>;
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
    requirements: z.unknown(),
    legacySnapshot: z
      .object({
        resultJson: z.string().refine((value) => {
          if (Buffer.byteLength(value, 'utf8') > 128 * 1024) return false;
          try {
            const parsed = JSON.parse(value);
            return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed);
          } catch {
            return false;
          }
        }),
        roleId: z.string().min(1).max(100).nullable(),
        origin: z.string().min(1).max(32),
      })
      .strict()
      .optional(),
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
  legacySnapshot?: CoreAdmission['legacySnapshot'];
}): CoreAdmission {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) throw new CoreAdmissionError('CORE_ADMISSION_INVALID');
  const { scope, before, requirements: supplied, legacySnapshot } = parsed.data;
  if (
    legacySnapshot &&
    (before.status !== 'awaiting_user' || before.executionId !== null || before.recordVersion !== 0)
  )
    throw new CoreAdmissionError('CORE_ADMISSION_INVALID');
  if (
    (before.status !== 'awaiting_user' &&
      !(before.status === 'executing' && before.executionId === null)) ||
    before.executionRevision >= Number.MAX_SAFE_INTEGER ||
    before.recordVersion >= Number.MAX_SAFE_INTEGER
  )
    throw new CoreAdmissionError('CORE_ADMISSION_INVALID');
  const executionId = randomUUID();
  const executionRevision = before.executionRevision + 1;
  let requirements: CoreAcceptedRequirements;
  try {
    requirements = parseCoreRequirements(supplied, { executionId, executionRevision });
  } catch (error) {
    if (error instanceof CoreRequirementsError)
      throw new CoreAdmissionError('CORE_ADMISSION_INVALID');
    throw error;
  }
  const operation = Object.freeze({
    scope: Object.freeze(scope),
    before: Object.freeze(before),
    requirements,
    ...(legacySnapshot ? { legacySnapshot: Object.freeze(legacySnapshot) } : {}),
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
