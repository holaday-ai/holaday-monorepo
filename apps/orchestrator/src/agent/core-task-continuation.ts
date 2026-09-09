import { TRPCError } from '@trpc/server';
import { getExpertWorkflowById } from '../execution/expert-workflow-registry.js';
import { restoreCoreLegacyWorkflow } from './core-legacy-workflow.js';
import { bindCoreIntakeReply, renderCoreIntake } from './core-task-intake.js';
import type { CoreRecordRead } from './core-task-record.js';
import { type CoreAcceptedRequirements, parseCoreRequirements } from './core-task-requirements.js';
import { isExplicitPlanApproval, isPurePlanHold } from './plan-mode.js';

export function prepareCoreContinuation(input: {
  record: Extract<CoreRecordRead, { kind: 'core' }>;
  result: Record<string, unknown>;
  awaitingQuestion: string | null;
  message: string;
  fileIds?: string[];
}): { requirements: CoreAcceptedRequirements; intakeIntent: string; hold: boolean } {
  const { record, message } = input;
  const previous = record.requirements;
  if (record.head.status !== 'awaiting_user' || !record.head.executionId || !previous.resume)
    throw unavailable();
  const legacyId = previous.resume.legacyWorkflowId;
  if (legacyId) {
    if (!previous.legacyWorkflow) throw unavailable();
    try {
      const expected = restoreCoreLegacyWorkflow(legacyId, previous);
      // Do not silently replace a saved policy with a changed or unknown version.
      if (
        expected.promptPreamble !== previous.legacyWorkflow.promptPreamble ||
        expected.routeOverride !== previous.legacyWorkflow.routeOverride ||
        expected.missingInputs.length !== previous.legacyWorkflow.missingInputs.length ||
        expected.missingInputs.some(
          (field) => !previous.legacyWorkflow?.missingInputs.includes(field),
        )
      )
        throw unavailable();
    } catch {
      throw unavailable();
    }
  }
  const workflow = previous.workflow ? getExpertWorkflowById(previous.workflow.id) : null;
  if (previous.workflow && !workflow) throw unavailable();
  const priorIntake = renderCoreIntake(previous, workflow);
  if (isPurePlanHold(message) && !input.fileIds?.length)
    return { requirements: previous, intakeIntent: priorIntake, hold: true };
  const plan = previous.phase === 'draft' || previous.phase === 'revise';
  if (plan && (typeof input.result.planText !== 'string' || !input.result.planText.trim()))
    throw unavailable();
  const userTurns = [...previous.userTurns, message];
  const fileIds = [...new Set([...previous.fileIds, ...(input.fileIds ?? [])])];
  const bindings = bindCoreIntakeReply(previous, workflow, input.awaitingQuestion, message);
  try {
    const requirements = parseCoreRequirements(
      {
        ...previous,
        userTurns,
        phase: plan
          ? isExplicitPlanApproval(message)
            ? 'approved_execution'
            : 'revise'
          : previous.phase,
        referencePlan: plan ? input.result.planText : previous.referencePlan,
        fileIds,
        ...(legacyId
          ? {
              legacyWorkflow: restoreCoreLegacyWorkflow(legacyId, {
                ...previous,
                userTurns,
                fileIds,
              }),
            }
          : {}),
        resume: { ...previous.resume, intakeBindings: bindings },
      },
      { executionId: record.head.executionId, executionRevision: record.head.executionRevision },
    );
    return { requirements, intakeIntent: renderCoreIntake(requirements, workflow), hold: false };
  } catch {
    throw unavailable();
  }
}

function unavailable(): TRPCError {
  return new TRPCError({
    code: 'BAD_REQUEST',
    message: '任务续接上下文无法完整恢复，请保留要求后重新创建任务。',
  });
}
