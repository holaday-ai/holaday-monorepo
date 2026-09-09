import { z } from 'zod';
import {
  type TaskVerificationContext,
  VerificationContextError,
  createTaskVerificationContext,
} from '../execution/task-verification-context.js';
import { VERIFICATION_INPUT_LIMITS } from '../execution/verification-input-budget.js';

export type CoreAcceptedRequirements = Pick<
  TaskVerificationContext,
  'initialRequest' | 'userTurns' | 'phase' | 'workflow' | 'referencePlan'
> & { readonly fileIds: readonly string[] };

export class CoreRequirementsError extends Error {
  constructor() {
    super('CORE_REQUIREMENTS_INVALID');
    this.name = 'CoreRequirementsError';
  }
}

const requirementsSchema = z
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
  .strict();

/** Pure validation of authorized server data; no identity allocation or permission grant. */
export function parseCoreRequirements(
  input: unknown,
  identity: { executionId: string; executionRevision: number },
): CoreAcceptedRequirements {
  try {
    const parsed = requirementsSchema.safeParse(input);
    if (!parsed.success) throw new CoreRequirementsError();
    const { fileIds, ...fields } = parsed.data;
    const context = createTaskVerificationContext({
      ...fields,
      schemaVersion: 1,
      executionId: identity.executionId,
      executionRevision: identity.executionRevision,
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
      Buffer.byteLength(JSON.stringify(requirements), 'utf8') >
      VERIFICATION_INPUT_LIMITS.contextBytes
    )
      throw new VerificationContextError('VERIFICATION_INPUT_LIMIT');
    return requirements;
  } catch (error) {
    if (error instanceof VerificationContextError) throw error;
    throw new CoreRequirementsError();
  }
}
