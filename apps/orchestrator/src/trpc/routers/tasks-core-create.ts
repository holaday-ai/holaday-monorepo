import { newExternalId } from '@holaday/shared-types';
import { TRPCError } from '@trpc/server';
import type { CoreAcceptedRequirements, CoreAdmission } from '../../agent/core-task-admission.js';
import { startCoreTaskExecution } from '../../agent/core-task-execution.js';
import { assertCoreTaskInput } from '../../agent/core-task-input.js';
import { CoreTaskRepository } from '../../agent/core-task-repository.js';
import type { CoreSettlement } from '../../agent/core-task-settlement.js';
import type { TaskRepository } from '../../agent/task-repository.js';
import type { parseFileForPrompt } from '../../files/parsers.js';
import type { ProductionModelRuntimeWiring } from '../../llm/model-runtime-wiring.js';
import type { Context } from '../context.js';
import { prepareCoreAdvisoryPlan } from './tasks-core-advisory-plan.js';
import { publishCoreExecutionEvent } from './tasks-core-reply.js';
import { publishCoreSettledSuggestions } from './tasks-core-suggestions.js';

/** Initial draft or direct execution. The caller has authorized files and checked the
 * identical input budget before the existing quota decision. No quota logic here.
 */
export async function createCoreGenerateTask(args: {
  ctx: Context & { userId: string };
  userId: number;
  modelDataRegion: unknown;
  wiring: ProductionModelRuntimeWiring;
  taskRepo: Pick<TaskRepository, 'insertTask'>;
  requirements: CoreAcceptedRequirements;
  blocks: Awaited<ReturnType<typeof parseFileForPrompt>>['blocks'];
  intent: string;
  roleId: string | null;
  opusUsed: boolean;
}) {
  const { ctx, requirements, blocks } = args;
  if (
    (requirements.phase !== 'draft' && requirements.phase !== 'direct') ||
    !requirements.resume ||
    (requirements.resume.legacyWorkflowId !== null &&
      requirements.legacyWorkflow?.id !== requirements.resume.legacyWorkflowId)
  )
    throw new TRPCError({ code: 'BAD_REQUEST', message: '任务方案上下文无法完整恢复。' });
  assertCoreTaskInput({ ...requirements, blocks });
  const taskId = newExternalId('task');
  // The shell INSERT is a separate transaction before C1. A lost response
  // cannot release the create claim or grant a dispatch permit. Late writes
  // are observed only to consume rejection; they never resume this function.
  const deadline = performance.now() + 15_000;
  const withinDeadline = () => performance.now() < deadline;
  const unconfirmed = {
    taskId,
    status: 'executing' as const,
    steps: [],
    executionMode: 'generate' as const,
    admissionState: 'creationUnconfirmed' as const,
    executionId: null,
    executionRevision: 0,
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const inserted = await new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), 15_000);
    void Promise.resolve()
      .then(async () => {
        if (!withinDeadline()) return false;
        await args.taskRepo.insertTask(
          { taskId, status: 'executing', plan: [], cursor: 0, pendingConfirm: null },
          {
            userId: args.userId,
            intent: args.intent,
            roleId: args.roleId,
            opusUsed: args.opusUsed,
          },
        );
        return withinDeadline();
      })
      .then(resolve, () => resolve(false));
  });
  clearTimeout(timer);
  if (!inserted || !withinDeadline()) return unconfirmed;
  const resolve = (lane: 'generate' | 'verifier') =>
    args.wiring.resolveCore({
      actorExternalId: ctx.userId,
      lane,
      ownership: { scope: 'personal', userRegion: args.modelDataRegion },
    });
  const generation = resolve('generate');
  const semantic = resolve('verifier');
  if (!withinDeadline()) return unconfirmed;
  const repo = new CoreTaskRepository(ctx.db);
  const execution = await startCoreTaskExecution({
    scope: { taskId, userId: args.userId },
    before: { status: 'executing', executionId: null, executionRevision: 0, recordVersion: 0 },
    requirements,
    blocks,
    actorExternalId: ctx.userId,
    logger: ctx.logger,
    repo,
    responsesAdapter: generation.kind === 'ready' ? generation.responses('standard') : null,
    semanticAdapter: semantic.kind === 'ready' ? semantic.messages('verify_strict') : undefined,
    publish: (event) => publishCoreExecutionEvent(ctx.userId, event),
    ...(requirements.phase === 'direct'
      ? {
          beforeGeneration: (op: CoreAdmission, isCurrent: () => boolean, deadline: number) =>
            prepareCoreAdvisoryPlan({
              op,
              deadline,
              rawIntent: args.intent,
              isCurrent,
              repo,
              wiring: args.wiring,
              actorExternalId: ctx.userId,
              modelDataRegion: args.modelDataRegion,
              logger: ctx.logger,
            }),
          afterSettlement: (op: CoreSettlement) =>
            publishCoreSettledSuggestions({
              op,
              requirements,
              repo,
              wiring: args.wiring,
              actorExternalId: ctx.userId,
              modelDataRegion: args.modelDataRegion,
              rawIntent: args.intent,
            }),
        }
      : {}),
  });
  void execution.completion.catch(() => {});
  return {
    taskId,
    status: 'executing' as const,
    steps: [],
    executionMode: 'generate' as const,
    admissionState: execution.ack.state,
    executionId: execution.ack.executionId,
    executionRevision: execution.ack.executionRevision,
  };
}
