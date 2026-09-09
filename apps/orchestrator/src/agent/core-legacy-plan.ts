import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { runIntake } from '../execution/expert-workflow-intake.js';
import { getExpertWorkflowById } from '../execution/expert-workflow-registry.js';
import type { CoreAdmission, CoreTaskHead } from './core-task-admission.js';
import { bindCoreIntakeReply, renderCoreIntake } from './core-task-intake.js';
import { parseCoreRequirements } from './core-task-requirements.js';
import { isExplicitPlanApproval, isPurePlanHold } from './plan-mode.js';

const savedPlanSchema = z.object({
  executionMode: z.literal('generate'),
  expertMode: z.enum(['normal', 'expert', 'auto']),
  selectedRole: z.string().min(1).max(100).nullable(),
  planMode: z.literal('awaiting_approval').optional(),
  approvedPlanText: z.string().optional(),
  fallbackChain: z.array(z.string()).optional(),
  planText: z.string().min(1),
  planInitialIntent: z.string().min(1),
  planReplyHistory: z.array(z.string()),
  planFileIds: z.array(z.string().min(1).max(32)).max(5),
  planWorkflowId: z.string().min(1).nullable(),
  planLegacyWorkflowId: z.null(),
  // These old derived strings do not retain their source turn/field identity.
  planIntakeContext: z.array(z.string()).max(0).optional(),
});

/** A compatibility decoder, not a fabricated prior core execution or permission. */
export function prepareLegacyPlanContinuation(input: {
  head: CoreTaskHead;
  result: unknown;
  roleId: string | null | undefined;
  origin: string;
  message: string;
  awaitingQuestion?: string | null;
  fileIds?: string[];
}) {
  const raw = input.result as Record<string, unknown> | null;
  if (
    !raw ||
    raw.executionMode !== 'generate' ||
    raw.planLegacyWorkflowId !== null ||
    !(
      raw.planMode === 'awaiting_approval' ||
      (raw.planMode === undefined && raw.approvedPlanText !== undefined)
    )
  )
    return null;
  try {
    if (
      input.head.status !== 'awaiting_user' ||
      input.head.executionId !== null ||
      input.head.executionRevision !== 0 ||
      input.head.recordVersion !== 0
    )
      throw new Error('INVALID_LEGACY_HEAD');
    const saved = savedPlanSchema.parse(raw);
    if (!saved.planText.trim() || saved.selectedRole !== input.roleId)
      throw new Error('INVALID_LEGACY_ROLE');
    const workflow = saved.planWorkflowId ? getExpertWorkflowById(saved.planWorkflowId) : null;
    if (saved.planWorkflowId && !workflow) throw new Error('UNAVAILABLE_LEGACY_WORKFLOW');
    const hold = isPurePlanHold(input.message) && !input.fileIds?.length;
    const approved = saved.planMode === undefined;
    if (
      approved &&
      (saved.approvedPlanText !== saved.planText ||
        saved.fallbackChain?.length !== 1 ||
        saved.fallbackChain[0] !== 'generate-resume' ||
        !isExplicitPlanApproval(saved.planReplyHistory.at(-1) ?? '') ||
        !workflow)
    )
      throw new Error('INVALID_LEGACY_APPROVAL');
    const previous = parseCoreRequirements(
      {
        initialRequest: saved.planInitialIntent,
        userTurns: saved.planReplyHistory,
        phase: approved ? 'approved_execution' : 'draft',
        workflow: workflow ? { id: workflow.workflowId, sections: workflow.reportSections } : null,
        referencePlan: saved.planText,
        fileIds: [...new Set([...saved.planFileIds, ...(input.fileIds ?? [])])],
        resume: {
          schemaVersion: 1,
          expertMode: saved.expertMode,
          skillId: saved.selectedRole,
          legacyWorkflowId: null,
          intakeBindings: [],
        },
      },
      { executionId: 'legacy-input-validation', executionRevision: 1 },
    );
    if (approved && workflow) {
      const intake = runIntake(workflow, renderCoreIntake(previous, workflow));
      if (intake.kind !== 'missing' || intake.question.trim() !== input.awaitingQuestion?.trim())
        throw new Error('INVALID_LEGACY_QUESTION');
    }
    const requirements = hold
      ? previous
      : parseCoreRequirements(
          {
            ...previous,
            userTurns: [...previous.userTurns, input.message],
            phase:
              approved || isExplicitPlanApproval(input.message) ? 'approved_execution' : 'revise',
            resume: {
              ...previous.resume,
              intakeBindings: bindCoreIntakeReply(
                previous,
                workflow,
                input.awaitingQuestion ?? null,
                input.message,
              ),
            },
          },
          { executionId: 'legacy-input-validation', executionRevision: 1 },
        );
    const resultJson = JSON.stringify(raw);
    if (Buffer.byteLength(resultJson, 'utf8') > 128 * 1024)
      throw new Error('LEGACY_SNAPSHOT_LIMIT');
    const legacySnapshot: CoreAdmission['legacySnapshot'] = {
      resultJson,
      roleId: saved.selectedRole,
      origin: input.origin,
      awaitingQuestion: input.awaitingQuestion ?? null,
    };
    return {
      requirements,
      hold,
      legacySnapshot,
      intakeIntent: renderCoreIntake(requirements, workflow),
    };
  } catch {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: '旧方案历史或执行配置无法完整恢复，请保留要求后重新创建任务。',
    });
  }
}
