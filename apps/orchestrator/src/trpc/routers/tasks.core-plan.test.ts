import { afterEach, describe, expect, it, vi } from 'vitest';
import * as planning from '../../agent/core-task-plan.js';
import * as generation from '../../agent/generate-runner.js';
import * as scraping from '../../agent/scrape-runner.js';
import { TaskRepository } from '../../agent/task-repository.js';
import { env } from '../../config/env.js';
import { QuotaService } from '../../quota/quota-service.js';
import type { Context } from '../context.js';
import { tasksRouter } from './tasks.js';

const original = { ...env };
afterEach(() => {
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

describe('tasks.create Qwen core planning reachability', () => {
  it.each([
    ['generate', false],
    ['scrape', false],
    ['generate', true],
    ['scrape', true],
  ] as const)(
    'handles %s planning without legacy dependencies, cancelled=%s',
    async (lane, cancelled) => {
      Object.assign(env, {
        ANTHROPIC_API_KEY: '',
        QWEN_CORE_ROLLOUT_MODE: 'synthetic',
        QWEN_CORE_ALLOWLIST: 'usr_core_plan_test',
        QWEN_CORE_ENABLED_LANES: 'plan,generate,scrape',
        QWEN_RESPONSES_ADAPTER_ENABLED: true,
        QWEN_MESSAGES_ADAPTER_ENABLED: true,
        DASHSCOPE_CN_API_KEY: 'synthetic-cn',
      });
      vi.spyOn(QuotaService.prototype, 'tryConsume').mockResolvedValue({ ok: true });
      vi.spyOn(QuotaService.prototype, 'getActiveTaskCount').mockResolvedValue(0);
      vi.spyOn(TaskRepository.prototype, 'insertTask').mockResolvedValue();
      vi.spyOn(TaskRepository.prototype, 'persistVisionOutcome').mockResolvedValue({
        persisted: true,
      });
      let finishPlan!: (value: string | null) => void;
      const plan = vi.spyOn(planning, 'prepareCoreTaskPlan').mockImplementation(
        () =>
          new Promise((resolve) => {
            finishPlan = resolve;
          }),
      );
      const generate = vi.spyOn(generation, 'runGenerateTask').mockResolvedValue({
        status: 'completed',
        generation: { completeness: 'complete', stopReason: 'end_turn' },
        summary: '这是一份基于所给材料完成的合成测试结果。',
        inputTokens: 10,
        outputTokens: 10,
        durationMs: 1,
      });
      const scrape = vi.spyOn(scraping, 'runScrapeTask').mockResolvedValue({
        status: 'completed',
        summary: '这是公开页面的合成摘要。[来源](https://public.example.test/article)',
        source: 'scrape',
        sources: ['https://public.example.test/article'],
        inputTokens: 10,
        outputTokens: 10,
        durationMs: 1,
      });
      const run = lane === 'generate' ? generate : scrape;
      const state = { active: true };
      const result = await tasksRouter.createCaller(context(state)).create({
        intent:
          lane === 'generate'
            ? '整理给出的材料，提炼关键结论并形成一份简洁的分析提纲。'
            : '总结 https://public.example.test/article 这篇文章的主要内容。',
        expertMode: 'normal',
      });
      expect(result.executionMode).toBe(lane);
      await vi.waitFor(() => expect(plan).toHaveBeenCalledTimes(1));
      state.active = !cancelled;
      finishPlan(cancelled ? null : '1. 整理材料\n2. 归纳结论');
      if (cancelled) {
        // Drain the detached pipeline, including a prospective active-state read.
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(generate).not.toHaveBeenCalled();
        expect(scrape).not.toHaveBeenCalled();
        expect(TaskRepository.prototype.persistVisionOutcome).not.toHaveBeenCalled();
        return;
      }
      await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));
      expect(plan).toHaveBeenCalledTimes(1);
      expect(plan).toHaveBeenCalledWith(
        expect.objectContaining({ modelDataRegion: 'cn', actorExternalId: 'usr_core_plan_test' }),
      );
      expect(run).toHaveBeenCalledWith(
        expect.objectContaining({ executionPlan: '1. 整理材料\n2. 归纳结论' }),
      );
    },
  );
});
