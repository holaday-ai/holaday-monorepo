import { TRPCError } from '@trpc/server';
import type { ExpertWorkflowContract } from '../execution/expert-workflow-contract.js';
import { runIntake } from '../execution/expert-workflow-intake.js';
import { parseInputs } from '../execution/expert-workflow-parser.js';
import type { CoreAcceptedRequirements } from './core-task-requirements.js';
import { isExplicitPlanApproval, isPurePlanHold } from './plan-mode.js';

/** Derived parsing view only. Never replaces the original chronological user words. */
export function renderCoreIntake(
  requirements: CoreAcceptedRequirements,
  workflow: ExpertWorkflowContract | null,
): string {
  const anchored = (requirements.resume?.intakeBindings ?? []).map((binding) => {
    const field = workflow?.requiredInputs.find((field) => field.name === binding.field);
    if (!field?.extractPattern || binding.turn >= requirements.userTurns.length)
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: '任务续接上下文无法完整恢复，请保留要求后重新创建任务。',
      });
    return `${anchor(field.label, field.name)}: ${requirements.userTurns[binding.turn]}`;
  });
  return [...requirements.userTurns]
    .reverse()
    .concat(anchored.reverse(), requirements.initialRequest)
    .join('\n');
}

/** Bind the next original turn only when the current persisted question is unambiguous. */
export function bindCoreIntakeReply(
  previous: CoreAcceptedRequirements,
  workflow: ExpertWorkflowContract | null,
  awaitingQuestion: string | null,
  message: string,
) {
  const bindings = [...(previous.resume?.intakeBindings ?? [])];
  if (
    !workflow ||
    previous.phase === 'draft' ||
    previous.phase === 'revise' ||
    !message.trim() ||
    isExplicitPlanApproval(message) ||
    isPurePlanHold(message)
  )
    return bindings;
  const intake = runIntake(workflow, renderCoreIntake(previous, workflow));
  if (
    intake.kind !== 'missing' ||
    intake.question.trim() !== awaitingQuestion?.trim() ||
    intake.parseResult.missingRequired.length !== 1 ||
    intake.parseResult.malformed.length !== 0
  )
    return bindings;
  const field = intake.parseResult.missingRequired[0];
  const explicitlyNamesField = [...workflow.requiredInputs, ...workflow.optionalInputs].some(
    (candidate) => candidate.extractPattern && new RegExp(candidate.extractPattern).test(message),
  );
  if (field?.extractPattern && !explicitlyNamesField) {
    const anchored = `${anchor(field.label, field.name)}: ${message.trim()}`;
    const match = new RegExp(field.extractPattern).exec(anchored);
    if (
      match?.index === 0 &&
      match[0] === anchored &&
      parseInputs(anchored, workflow).extracted[field.name] !== undefined
    )
      bindings.push({ turn: previous.userTurns.length, field: field.name });
  }
  return bindings;
}

function anchor(label: string | undefined, name: string): string {
  return (label ?? name).split(/[\s/]/)[0] ?? name;
}
