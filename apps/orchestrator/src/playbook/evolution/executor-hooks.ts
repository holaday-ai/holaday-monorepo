import type { Logger } from 'pino';
import { MemoryService } from '../../agent/supercar/memory-service.js';
import type { DB } from '../../db/client.js';
import { getFeatureFlags as getExecutionFeatureFlags } from '../../execution/feature-flags.js';
import type { MessagesAdapter } from '../../llm/messages-adapter.js';
import type { ProductionModelRuntimeWiring } from '../../llm/model-runtime-wiring.js';
import type { PlaybookBrowserTools } from '../replay/browser-tools.js';
import { createModelPathMatcher, createModelStepRepairer } from '../replay/model-assist.js';
import { TaskActionCaptureRepository } from '../task-action-capture-repository.js';
import { BrowserActionCaptureRecorder, type ExecutorSource } from './capture-recorder.js';
import { DrizzleEvolutionStore } from './drizzle-evolution-store.js';
import { readEvolutionConfig } from './evolution-config.js';
import { type ReuseResult, tryReuseVerifiedPath } from './self-evolution.js';

/**
 * Batch 06 — the three calls an executor (cloud batch-04 executor, extension
 * executor) makes into the self-evolution loop. Each is flag-gated, never
 * throws into the task, and is a no-op with its flag off:
 *
 *   1. before the agent loop:  `tryPlaybookReuse(...)`        (PLAYBOOK_REUSE_ENABLED)
 *   2. per tool call:          `createTaskCaptureRecorder(...)` (ACTION_CAPTURE_ENABLED)
 *   3. after success:          recorder.recordOutcome(...) +
 *                              `extractTaskMemoryAfterSuccess(...)` (MEMORY_EXTRACTION_ENABLED)
 */

export function createTaskCaptureRecorder(input: {
  db: DB;
  taskId: number;
  executorSource: ExecutorSource;
  logger?: Pick<Logger, 'warn'>;
}): BrowserActionCaptureRecorder | null {
  if (!getExecutionFeatureFlags().ACTION_CAPTURE) return null;
  return new BrowserActionCaptureRecorder(new TaskActionCaptureRepository(input.db), {
    taskId: input.taskId,
    executorSource: input.executorSource,
    onError: (err) =>
      input.logger?.warn(
        { taskId: input.taskId, err: err instanceof Error ? err.message : String(err) },
        'playbook capture: write failed (non-blocking)',
      ),
  });
}

/** Resolve the generate-lane adapter for a user (千问 unless the catalog routes elsewhere). */
export function resolveUserGenerateAdapter(input: {
  wiring: ProductionModelRuntimeWiring;
  actorExternalId: string;
  modelDataRegion: unknown;
}): MessagesAdapter | null {
  const runtime = input.wiring.resolveCore({
    actorExternalId: input.actorExternalId,
    lane: 'generate',
    ownership: { scope: 'personal', userRegion: input.modelDataRegion },
  });
  return runtime.kind === 'ready' ? runtime.messages('fast') : null;
}

export async function tryPlaybookReuse(input: {
  db: DB;
  tools: PlaybookBrowserTools;
  intent: string;
  siteDomain: string | null;
  taskId: number;
  adapter: MessagesAdapter | null;
  logger?: Pick<Logger, 'info' | 'warn'>;
}): Promise<ReuseResult | null> {
  if (!readEvolutionConfig().reuseEnabled || !input.siteDomain || !input.adapter) return null;
  try {
    return await tryReuseVerifiedPath({
      store: new DrizzleEvolutionStore(input.db),
      tools: input.tools,
      intent: input.intent,
      siteDomain: input.siteDomain,
      taskId: input.taskId,
      matcher: createModelPathMatcher(input.adapter),
      repairer: createModelStepRepairer(input.adapter),
      ...(input.logger
        ? {
            logger: {
              info: (o, m) => input.logger?.info(o as object, m),
              warn: (o, m) => input.logger?.warn(o as object, m),
            },
          }
        : {}),
    });
  } catch (err) {
    input.logger?.warn(
      { taskId: input.taskId, err: err instanceof Error ? err.message : String(err) },
      'playbook reuse: failed, falling back to the agent loop',
    );
    return null;
  }
}

export async function extractTaskMemoryAfterSuccess(input: {
  db: DB;
  logger: Logger;
  adapter: MessagesAdapter | null;
  userIdInternal: number;
  intent: string;
  summary: string;
  sitesVisited?: string[];
  taskExternalId?: string;
}): Promise<number> {
  if (process.env.MEMORY_EXTRACTION_ENABLED !== 'true' || !input.adapter) return 0;
  return new MemoryService(input.db, input.logger).extractAndStore({
    adapter: input.adapter,
    userIdInternal: input.userIdInternal,
    intent: input.intent,
    summary: input.summary,
    ...(input.sitesVisited ? { sitesVisited: input.sitesVisited } : {}),
    ...(input.taskExternalId ? { taskId: input.taskExternalId } : {}),
  });
}
