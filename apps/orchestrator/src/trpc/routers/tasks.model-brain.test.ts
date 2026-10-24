import { afterEach, describe, expect, it, vi } from 'vitest';

const catalogMocks = vi.hoisted(() => ({ recordTaskModelSelection: vi.fn(async () => {}) }));

vi.mock('../../llm/model-catalog.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../llm/model-catalog.js')>();
  return {
    ...actual,
    // In-memory catalog instead of MySQL; the seed matches migration 0061.
    createDrizzleModelCatalogStore: () => ({
      load: async () => actual.BUILTIN_MODEL_CATALOG.map((entry) => ({ ...entry })),
      save: async () => {},
    }),
    recordTaskModelSelection: catalogMocks.recordTaskModelSelection,
  };
});

import * as planning from '../../agent/core-task-plan.js';
import { CoreTaskRepository } from '../../agent/core-task-repository.js';
import * as generation from '../../agent/generate-runner.js';
import { TaskRepository } from '../../agent/task-repository.js';
import { env } from '../../config/env.js';
import {
  reloadFeatureFlagsForTest,
  setFeatureFlagsForTest,
} from '../../execution/feature-flags.js';
import { QuotaService } from '../../quota/quota-service.js';
import type { Context } from '../context.js';
import { tasksRouter } from './tasks.js';

const original = { ...env };
afterEach(() => {
  reloadFeatureFlagsForTest();
  Object.assign(env, original);
  vi.restoreAllMocks();
});

function context(state = { active: true }): Context {
  const logger = {
    child: () => logger,
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  };
  const db = {
    select(projection: Record<string, unknown>) {
      if ('plan' in projection)
        return {
          from: () => ({
            where: () => ({
              limit: async () => [
                {
                  id: 41,
                  plan: 'free',
                  selectedRoles: [],
                  selectedSkills: [],
                  modelDataRegion: 'cn',
                },
              ],
            }),
          }),
        };
      if ('count' in projection) return { from: () => ({ where: async () => [{ count: 0 }] }) };
      if ('status' in projection)
        return {
          from: () => ({
            where: () => ({
              limit: async () => [{ status: state.active ? 'executing' : 'cancelled' }],
            }),
          }),
        };
      throw new Error('Unexpected test database read');
    },
  };
  return {
    db,
    logger,
    planner: {},
    playwrightExecutor: null,
    executionRouter: null,
    browserPool: null,
    taskQueue: null,
    firecrawl: { scrape: vi.fn(), search: vi.fn() },
    paypalAdapter: null,
    downloadManager: null,
    req: {},
    res: {},
    userId: 'usr_core_plan_test',
  } as unknown as Context;
}

describe('tasks.create model catalog brain', () => {
  it.each([
    ['claude', 'NOT_VISIBLE'],
    ['does-not-exist', 'NOT_FOUND'],
    [undefined, null],
  ] as const)(
    'runs brainId=%s on 千问 and records fallback %s',
    async (brainId, fallbackReason) => {
      catalogMocks.recordTaskModelSelection.mockClear();
      setFeatureFlagsForTest({
        EVIDENCE_LEDGER: true,
        EXECUTION_CONTRACT: true,
        EXECUTION_VERIFIER: true,
      });
      Object.assign(env, {
        ANTHROPIC_API_KEY: 'synthetic-anthropic',
        QWEN_CORE_ROLLOUT_MODE: 'all',
        QWEN_CORE_ENABLED_LANES: '',
        QWEN_RESPONSES_ADAPTER_ENABLED: true,
        QWEN_MESSAGES_ADAPTER_ENABLED: true,
        DASHSCOPE_CN_API_KEY: 'synthetic-cn',
      });
      vi.spyOn(QuotaService.prototype, 'tryConsume').mockResolvedValue({ ok: true });
      vi.spyOn(QuotaService.prototype, 'getActiveTaskCount').mockResolvedValue(0);
      const insertTask = vi.spyOn(TaskRepository.prototype, 'insertTask').mockResolvedValue();
      vi.spyOn(TaskRepository.prototype, 'persistVisionOutcome').mockResolvedValue({
        persisted: true,
      });
      vi.spyOn(planning, 'prepareCoreTaskPlan').mockResolvedValue(null);
      const generate = vi.spyOn(generation, 'runGenerateTask').mockResolvedValue({
        status: 'completed',
        generation: { completeness: 'complete', stopReason: 'end_turn' },
        summary: '这是一份基于所给材料完成的合成测试结果。',
        inputTokens: 10,
        outputTokens: 10,
        durationMs: 1,
      });
      let admitted: import('../../agent/core-task-admission.js').CoreAdmission | undefined;
      vi.spyOn(CoreTaskRepository.prototype, 'admit').mockImplementation(async (op) => {
        admitted = op;
        return { persisted: true };
      });
      vi.spyOn(CoreTaskRepository.prototype, 'readHead').mockImplementation(async () =>
        admitted
          ? {
              status: 'executing',
              executionId: admitted.executionId,
              executionRevision: admitted.executionRevision,
              recordVersion: admitted.recordVersion,
            }
          : null,
      );
      vi.spyOn(CoreTaskRepository.prototype, 'settle').mockResolvedValue({ persisted: true });

      const result = await tasksRouter.createCaller(context()).create({
        intent: '整理给出的材料，提炼关键结论并形成一份简洁的分析提纲。',
        expertMode: 'normal',
        ...(brainId ? { brainId } : {}),
      });

      expect(result.executionMode).toBe('generate');
      await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(1));
      expect(generate.mock.calls[0]?.[0].responsesAdapter?.metadata.provider).toBe(
        'alibaba-model-studio',
      );
      const taskId = insertTask.mock.calls[0]?.[0].taskId;
      expect(catalogMocks.recordTaskModelSelection).toHaveBeenCalledWith(
        expect.anything(),
        taskId,
        expect.objectContaining({
          brain: expect.objectContaining({ id: 'qwen' }),
          requestedBrainId: brainId ?? null,
          fallbackReason,
        }),
      );
    },
  );
});
