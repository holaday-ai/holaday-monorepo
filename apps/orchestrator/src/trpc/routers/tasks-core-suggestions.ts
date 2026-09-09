import type { CoreAcceptedRequirements } from '../../agent/core-task-admission.js';
import type { CoreTaskRepository } from '../../agent/core-task-repository.js';
import type { CoreSettlement } from '../../agent/core-task-settlement.js';
import { publishCoreTaskSuggestions } from '../../agent/core-task-suggestions.js';
import type { ProductionModelRuntimeWiring } from '../../llm/model-runtime-wiring.js';
import { broadcastToUser } from '../../ws/server.js';

export async function publishCoreSettledSuggestions(args: {
  op: CoreSettlement;
  requirements: CoreAcceptedRequirements;
  repo: Pick<CoreTaskRepository, 'readHead' | 'persistSuggestions'>;
  wiring: ProductionModelRuntimeWiring;
  actorExternalId: string;
  modelDataRegion: unknown;
  rawIntent: string;
}): Promise<void> {
  const { op, repo } = args;
  await publishCoreTaskSuggestions({
    wiring: args.wiring,
    actorExternalId: args.actorExternalId,
    modelDataRegion: args.modelDataRegion,
    rawIntent: args.rawIntent,
    intent: [args.requirements.initialRequest, ...args.requirements.userTurns].join('\n\n'),
    summary: op.result.summary ?? '',
    isCurrent: async () => {
      const head = await repo.readHead(op.scope);
      return (
        head?.status === 'completed' &&
        head.executionId === op.executionId &&
        head.executionRevision === op.executionRevision &&
        head.recordVersion === op.recordVersion
      );
    },
    persist: (suggestions) => repo.persistSuggestions(op, suggestions),
    publish: (suggestions) => {
      broadcastToUser(args.actorExternalId, {
        type: 'server.supercar.suggestions',
        taskId: op.scope.taskId,
        executionId: op.executionId,
        executionRevision: op.executionRevision,
        suggestions,
      });
    },
  });
}
