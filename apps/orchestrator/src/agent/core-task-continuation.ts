import { TRPCError } from '@trpc/server';
import { getExpertWorkflowById } from '../execution/expert-workflow-registry.js';
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
  // A legacy prompt lineage is not a typed workflow ID. Migration must restore
  // its separate preamble before this path can support it; never silently drop it.
  if (previous.resume.legacyWorkflowId !== null) throw unavailable();
  const workflow = previous.workflow ? getExpertWorkflowById(previous.workflow.id) : null;
  if (previous.workflow && !workflow) throw unavailable();
  const priorIntake = renderCoreIntake(previous, workflow);
  if (isPurePlanHold(message) && !input.fileIds?.length)
    return { requirements: previous, intakeIntent: priorIntake, hold: true };
  const plan = previous.phase === 'draft' || previous.phase === 'revise';
  if (plan && (typeof input.result.planText !== 'string' || !input.result.planText.trim()))
    throw unavailable();
  const userTurns = [...previous.userTurns, message];
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
        fileIds: [...new Set([...previous.fileIds, ...(input.fileIds ?? [])])],
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
