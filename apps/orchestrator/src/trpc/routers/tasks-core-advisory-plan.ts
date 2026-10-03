import type { Logger } from 'pino';
import type { CoreAdmission } from '../../agent/core-task-admission.js';
import { prepareCoreTaskPlan } from '../../agent/core-task-plan.js';
import type { CoreTaskRepository } from '../../agent/core-task-repository.js';
import { runAuxiliaryDatabase } from '../../execution/auxiliary-database.js';
import {
  currentOperationLifetime,
  startOwnedOperation,
  withOperationDispatchScope,
} from '../../execution/owned-operation.js';
import type { ProductionModelRuntimeWiring } from '../../llm/model-runtime-wiring.js';
import { broadcastToUser } from '../../ws/server.js';

/** Optional display artifact, not an approved plan or an extra model-input channel. */
export async function prepareCoreAdvisoryPlan(args: {
  op: CoreAdmission;
  rawIntent: string;
  deadline: number;
  isCurrent: () => boolean;
  repo: Pick<CoreTaskRepository, 'persistAdvisoryPlan' | 'readHead'>;
  wiring: ProductionModelRuntimeWiring;
  actorExternalId: string;
  modelDataRegion: unknown;
  logger: Logger;
}): Promise<'ready' | 'stale' | 'unconfirmed'> {
  const parent = currentOperationLifetime();
  if (!parent) return runAdvisoryPlan(args);
  // The final logical deadline decision must outlive the raw work's release.
  return startOwnedOperation(parent.drain, 'execution', () => runAdvisoryPlan(args), {
    parent: parent.owner,
    errorOutcome: 'unknown',
    dispatch: 'immediate',
  }).result;
}

async function runAdvisoryPlan(
  args: Parameters<typeof prepareCoreAdvisoryPlan>[0],
): Promise<'ready' | 'stale' | 'unconfirmed'> {
  const { deadline } = args;
  let open = true;
  const current = () => open && performance.now() < deadline && args.isCurrent();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let savedPlan: string | undefined;
  const work = async (): Promise<'ready' | 'stale' | 'unconfirmed'> => {
    if (!current()) return 'unconfirmed';
    await prepareCoreTaskPlan({
      wiring: args.wiring,
      actorExternalId: args.actorExternalId,
      modelDataRegion: args.modelDataRegion,
      intent: args.op.requirements.initialRequest,
      eligibilityIntent: args.rawIntent,
      logger: args.logger,
      persist: async (text) =>
        current() &&
        (await runAuxiliaryDatabase(() => args.repo.persistAdvisoryPlan(args.op, text))),
      publish: (planText) => {
        if (current()) savedPlan = planText;
      },
    });
    if (!current()) return 'unconfirmed';
    const head = await runAuxiliaryDatabase(() => args.repo.readHead(args.op.scope));
    if (!current() || !head) return 'unconfirmed';
    const sameRound =
      head.status === 'executing' &&
      head.executionId === args.op.executionId &&
      head.executionRevision === args.op.executionRevision &&
      head.recordVersion === args.op.recordVersion;
    if (!sameRound) return 'stale';
    if (savedPlan) {
      try {
        broadcastToUser(args.actorExternalId, {
          type: 'server.task.plan',
          taskId: args.op.scope.taskId,
          executionId: args.op.executionId,
          executionRevision: args.op.executionRevision,
          planText: savedPlan,
          planStatus: [],
        });
      } catch {
        /* Optional notification failure must not block generation. */
      }
    }
    return 'ready';
  };
  const parent = currentOperationLifetime();
  let seal = () => {};
  const trackedWork = async () => {
    return withOperationDispatchScope(async (closeScope) => {
      seal = closeScope;
      try {
        return await work();
      } finally {
        closeScope();
      }
    });
  };
  const owned = parent
    ? startOwnedOperation(parent.drain, 'execution', trackedWork, {
        parent: parent.owner,
        errorOutcome: 'unknown',
        dispatch: 'immediate',
      })
    : undefined;
  try {
    const result = await Promise.race([
      (owned?.result ?? trackedWork()).catch(() => 'unconfirmed' as const),
      new Promise<'unconfirmed'>((resolve) => {
        timer = setTimeout(() => resolve('unconfirmed'), Math.max(0, deadline - performance.now()));
      }),
    ]);
    const readiness = current() ? result : 'unconfirmed';
    if (readiness === 'unconfirmed' && parent) parent.drain.markUnknown(parent.owner);
    return readiness;
  } finally {
    open = false;
    seal();
    clearTimeout(timer);
  }
}
