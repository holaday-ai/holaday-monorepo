import { z } from 'zod';
import {
  type TaskVerificationContext,
  VerificationContextError,
  createTaskVerificationContext,
} from '../execution/task-verification-context.js';
import { VERIFICATION_INPUT_LIMITS } from '../execution/verification-input-budget.js';

export type CoreAcceptedRequirements = Pick<
  TaskVerificationContext,
  | 'initialRequest'
  | 'userTurns'
  | 'phase'
  | 'workflow'
  | 'referencePlan'
  | 'referenceContext'
  | 'legacyWorkflow'
> & { readonly fileIds: readonly string[]; readonly resume?: CoreResumeMetadata };

const resumeSchema = z
  .object({
    schemaVersion: z.literal(1),
    expertMode: z.enum(['normal', 'expert', 'auto']),
    skillId: z.string().min(1).max(100).nullable(),
    legacyWorkflowId: z.string().min(1).max(100).nullable(),
    intakeBindings: z
      .array(
        z
          .object({
            turn: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
            field: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/),
          })
          .strict(),
      )
      .max(128),
  })
  .strict();
export type CoreResumeMetadata = Readonly<
  Omit<z.infer<typeof resumeSchema>, 'intakeBindings'> & {
    intakeBindings: readonly Readonly<{ turn: number; field: string }>[];
  }
>;

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
    referenceContext: z.string().optional(),
    legacyWorkflow: z.unknown().optional(),
    fileIds: z
      .array(z.string().min(1).max(32))
      .max(5)
      .refine((ids) => new Set(ids).size === ids.length),
    resume: resumeSchema.optional(),
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
    const { fileIds, resume, ...fields } = parsed.data;
    const context = createTaskVerificationContext({
      ...fields,
      schemaVersion: 1,
      executionId: identity.executionId,
      executionRevision: identity.executionRevision,
      materials: [],
    });
    if (context.legacyWorkflow && context.legacyWorkflow.id !== resume?.legacyWorkflowId)
      throw new CoreRequirementsError();
    if (
      resume &&
      (resume.intakeBindings.some((binding) => binding.turn >= context.userTurns.length) ||
        new Set(resume.intakeBindings.map((binding) => binding.turn)).size !==
          resume.intakeBindings.length ||
        (resume.intakeBindings.length > 0 && !context.workflow))
    )
      throw new CoreRequirementsError();
    const requirements = Object.freeze({
      initialRequest: context.initialRequest,
      userTurns: context.userTurns,
      phase: context.phase,
      workflow: context.workflow,
      referencePlan: context.referencePlan,
      ...(context.referenceContext !== undefined
        ? { referenceContext: context.referenceContext }
        : {}),
      ...(context.legacyWorkflow ? { legacyWorkflow: context.legacyWorkflow } : {}),
      fileIds: Object.freeze(fileIds),
      ...(resume
        ? {
            resume: Object.freeze({
              ...resume,
              intakeBindings: Object.freeze(
                resume.intakeBindings.map((binding) => Object.freeze(binding)),
              ),
            }),
          }
        : {}),
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
