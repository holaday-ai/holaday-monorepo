import { TRPCError } from '@trpc/server';
import type { ExpertWorkflowContract } from '../execution/expert-workflow-contract.js';
import { runIntake } from '../execution/expert-workflow-intake.js';
import { parseInputs } from '../execution/expert-workflow-parser.js';
import { getExpertWorkflowById } from '../execution/expert-workflow-registry.js';
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
  const priorIntake = renderIntake(previous, workflow);
  if (isPurePlanHold(message) && !input.fileIds?.length)
    return { requirements: previous, intakeIntent: priorIntake, hold: true };
  const plan = previous.phase === 'draft' || previous.phase === 'revise';
  if (plan && (typeof input.result.planText !== 'string' || !input.result.planText.trim()))
    throw unavailable();
  const userTurns = [...previous.userTurns, message];
  const bindings = [...previous.resume.intakeBindings];
  if (
    !plan &&
    workflow &&
    message.trim() &&
    !isExplicitPlanApproval(message) &&
    !isPurePlanHold(message)
  ) {
    const intake = runIntake(workflow, priorIntake);
    if (
      intake.kind === 'missing' &&
      intake.question.trim() === input.awaitingQuestion?.trim() &&
      intake.parseResult.missingRequired.length === 1 &&
      intake.parseResult.malformed.length === 0
    ) {
      const field = intake.parseResult.missingRequired[0];
      const explicitlyNamesField = [...workflow.requiredInputs, ...workflow.optionalInputs].some(
        (candidate) =>
          candidate.extractPattern && new RegExp(candidate.extractPattern).test(message),
      );
      if (field?.extractPattern && !explicitlyNamesField) {
        const anchored = `${anchor(field.label, field.name)}: ${message.trim()}`;
        const match = new RegExp(field.extractPattern).exec(anchored);
        // A prefix is not an unambiguous answer: never silently bind a truncated
        // value or discard the rest of a qualification supplied by the user.
        if (
          match?.index === 0 &&
          match[0] === anchored &&
          parseInputs(anchored, workflow).extracted[field.name] !== undefined
        )
          bindings.push({ turn: userTurns.length - 1, field: field.name });
      }
    }
  }
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
    return { requirements, intakeIntent: renderIntake(requirements, workflow), hold: false };
  } catch {
    throw unavailable();
  }
}

function renderIntake(
  requirements: CoreAcceptedRequirements,
  workflow: ExpertWorkflowContract | null,
): string {
  const bindings = requirements.resume?.intakeBindings ?? [];
  const anchored = bindings.map((binding) => {
    const field = workflow?.requiredInputs.find((field) => field.name === binding.field);
    if (!field?.extractPattern || binding.turn >= requirements.userTurns.length)
      throw unavailable();
    return `${anchor(field.label, field.name)}: ${requirements.userTurns[binding.turn]}`;
  });
  return [...requirements.userTurns]
    .reverse()
    .concat(anchored.reverse(), requirements.initialRequest)
    .join('\n');
}
function anchor(label: string | undefined, name: string): string {
  return (label ?? name).split(/[\s/]/)[0] ?? name;
}
function unavailable(): TRPCError {
  return new TRPCError({
    code: 'BAD_REQUEST',
    message: '任务续接上下文无法完整恢复，请保留要求后重新创建任务。',
  });
}
