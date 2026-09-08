import { afterEach, describe, expect, it, vi } from 'vitest';
import {type SQL} from 'drizzle-orm';
import {MySqlDialect} from 'drizzle-orm/mysql-core';
import * as planning from '../../agent/core-task-plan.js';
import * as generation from '../../agent/generate-runner.js';
import * as scraping from '../../agent/scrape-runner.js';
import * as suggestions from '../../agent/suggestions-generator.js';
import { TaskRepository } from '../../agent/task-repository.js';
import { env } from '../../config/env.js';
import * as pipeline from '../../execution/execution-pipeline.js';
import { QuotaService } from '../../quota/quota-service.js';
import * as websocket from '../../ws/server.js';
import type { Context } from '../context.js';
import { tasksRouter } from './tasks.js';

const original = { ...env };
afterEach(() => {
  Object.assign(env, original);
  vi.restoreAllMocks();
});

function fixture(lane: 'generate' | 'scrape' | 'resume', persisted = true, followUp = false) {
  Object.assign(env, {
    ANTHROPIC_API_KEY: '',
    QWEN_CORE_ROLLOUT_MODE: 'synthetic',
    QWEN_CORE_ALLOWLIST: 'usr_suggestions_fixture',
    QWEN_CORE_ENABLED_LANES: 'generate,scrape,suggestions',
    QWEN_RESPONSES_ADAPTER_ENABLED: true,
    QWEN_MESSAGES_ADAPTER_ENABLED: true,
    DASHSCOPE_CN_API_KEY: 'synthetic-cn',
  });
  const state: {status:string;result:{summary:string;followUpSuggestions?:string[]}} = { status: 'executing', result: { summary: '' } };
  const logger = {
    child: () => logger,
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
  const db = {
    update() {
      return {set: (patch: {result:SQL})=>({where:async(condition:SQL)=>{
        const dialect=new MySqlDialect();
        const guard=dialect.sqlToQuery(condition);
        if(state.status!=='completed' || guard.params[2]!==state.result.summary) return [{affectedRows:0}];
        const query=dialect.sqlToQuery(patch.result);
        state.result={...state.result,followUpSuggestions:JSON.parse(String(query.params[0]))};
        return [{affectedRows:1}];
      }})};
    },
    select(projection: Record<string, unknown>) {
      if ('intent' in projection)
        return {
          from: () => ({
            where: () => ({
              limit: async () => [
                {
                  intent: '整理提供的材料，归纳关键事实。不要发送邮件。',
                  status: followUp ? 'completed' : 'awaiting_user',
                  result: { executionMode: 'generate', expertMode: 'normal' },
                  opusUsed: false,
                  roleId: null,
                },
              ],
            }),
          }),
        };
      if ('plan' in projection)
        return {
          from: () => ({
            where: () => ({
              limit: async () => [
                {
                  id: 42,
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
        return { from: () => ({ where: () => ({ limit: async () => [state] }) }) };
      if ('id' in projection)
        return {
          from: () => ({
            where: () => ({ limit: async () => [{ id: 42, modelDataRegion: 'cn' }] }),
          }),
        };
      throw new Error('Unexpected test database read');
    },
  };
  vi.spyOn(QuotaService.prototype, 'tryConsume').mockResolvedValue({ ok: true });
  vi.spyOn(QuotaService.prototype, 'getActiveTaskCount').mockResolvedValue(0);
  vi.spyOn(TaskRepository.prototype, 'insertTask').mockResolvedValue();
  vi.spyOn(TaskRepository.prototype, 'markAwaitingReplyResumed').mockResolvedValue({
    persisted: true,
  });
  const save = vi
    .spyOn(TaskRepository.prototype, 'persistVisionOutcome')
    .mockImplementation(async (_id, outcome) => {
      if (persisted) {
        state.status = outcome.status;
        state.result = { summary: 'summary' in outcome ? outcome.summary : '' };
      }
      return { persisted };
    });
  vi.spyOn(planning, 'prepareCoreTaskPlan').mockResolvedValue(null);
  const summary = '这是一份根据提供的材料完成的合成结果，列出了关键事实与待确认事项。';
  vi.spyOn(generation, 'runGenerateTask').mockResolvedValue({
    status: 'completed',
    generation: { completeness: 'complete', stopReason: 'end_turn' },
    summary,
    inputTokens: 10,
    outputTokens: 10,
    durationMs: 1,
  });
  vi.spyOn(scraping, 'runScrapeTask').mockResolvedValue({
    status: 'completed',
    summary,
    source: 'scrape',
    sources: ['https://public.example.test/article'],
    inputTokens: 10,
    outputTokens: 10,
    durationMs: 1,
  });
  const frames: Array<{ type: string; [key: string]: unknown }> = [];
  vi.spyOn(websocket, 'broadcastToUser').mockImplementation((_actor, frame) => {
    frames.push(frame);
    return 1;
  });
  const suggest = vi
    .spyOn(suggestions, 'generateSuggestions')
    .mockResolvedValue(['整理后续执行清单', '比较两种材料结构']);
  const ctx = {
    db,
    logger,
    userId: 'usr_suggestions_fixture',
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
  } as unknown as Context;
  return {
    state,
    save,
    frames,
    suggest,
    summary,
    start: async (input: { intent?: string; mode?: 'plan'; message?: string } = {}) =>
      lane === 'resume'
        ? {
            ...(await tasksRouter.createCaller(ctx).reply({
              taskId: 'tsk_suggestions_resume',
              message: input.message ?? '请按背景、结论、待确认事项组织提纲。',
            })),
            taskId: 'tsk_suggestions_resume',
          }
        : tasksRouter.createCaller(ctx).create({
            intent:
              input.intent ??
              (lane === 'generate'
                ? '整理提供的材料，归纳关键事实并输出一份简洁提纲。'
                : '总结 https://public.example.test/article 这篇文章的主要内容。'),
            expertMode: 'normal',
            ...(input.mode ? { mode: input.mode } : {}),
            ...(followUp ? { replyToTaskId: 'tsk_suggestions_parent' } : {}),
          }),
  };
}

describe('core task post-completion suggestions', () => {
  it.each([
    {
      lane: 'generate' as const,
      followUp: false,
      input: { intent: '你好', mode: 'plan' as const },
    },
    { lane: 'generate' as const, followUp: true, input: { intent: '你好' } },
    { lane: 'resume' as const, followUp: false, input: { message: '谢谢' } },
  ])(
    'skips optional suggestions for an undecorated lightweight request: $lane / $followUp',
    async ({ lane, followUp, input }) => {
      const f = fixture(lane, true, followUp);
      await f.start(input);
      await vi.waitFor(() =>
        expect(f.frames.some((frame) => frame.type === 'server.task.terminal')).toBe(true),
      );
      await new Promise((resolve) => setTimeout(resolve, 15));
      expect(f.suggest).not.toHaveBeenCalled();
      expect(f.frames.some((frame) => frame.type === 'server.supercar.suggestions')).toBe(false);
    },
  );
  it.each(['generate', 'scrape'] as const)(
    '%s retains parent restrictions for follow-up tasks',
    async (lane) => {
      const f = fixture(lane, true, true);
      await f.start();
      await vi.waitFor(() => expect(f.suggest).toHaveBeenCalledTimes(1));
      expect(f.suggest.mock.calls[0]?.[0].intent).toContain('不要发送邮件');
    },
  );
  it.each(['generate', 'scrape', 'resume'] as const)(
    '%s publishes suggestions after committed completion without legacy dependencies',
    async (lane) => {
      const f = fixture(lane);
      let finish!: (items: string[]) => void;
      f.suggest.mockImplementation(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
      const task = await f.start();
      await vi.waitFor(() => expect(f.suggest).toHaveBeenCalledTimes(1));
      expect(f.state.status).toBe('completed');
      expect(f.frames).toContainEqual(
        expect.objectContaining({
          type: 'server.task.terminal',
          taskId: task.taskId,
          status: 'completed',
        }),
      );
      expect(f.frames.some((frame) => frame.type === 'server.supercar.suggestions')).toBe(false);
      finish(['整理后续执行清单']);
      await vi.waitFor(() =>
        expect(f.frames).toContainEqual({
          type: 'server.supercar.suggestions',
          taskId: task.taskId,
          suggestions: ['整理后续执行清单'],
        }),
      );
      expect(f.state.result.followUpSuggestions).toEqual(['整理后续执行清单']);
      expect(f.suggest.mock.calls[0]?.[0].messagesAdapter.metadata).toMatchObject({
        provider: 'alibaba-model-studio',
        region: 'cn',
      });
      if (lane === 'resume') {
        expect(f.suggest.mock.calls[0]?.[0].intent).toContain('不要发送邮件');
        expect(f.suggest.mock.calls[0]?.[0].intent).toContain('请按背景、结论、待确认事项组织提纲');
      }
    },
  );

  it.each(['generate', 'scrape', 'resume'] as const)(
    '%s does not generate for refused or downgraded completion',
    async (lane) => {
      for (const status of ['completed', 'partial_success', 'failed'] as const) {
        const f = fixture(lane, status !== 'completed');
        vi.spyOn(pipeline, 'deriveFinalStatus').mockReturnValue(status);
        await f.start();
        await vi.waitFor(() => expect(f.save).toHaveBeenCalledTimes(1));
        await new Promise((resolve) => setTimeout(resolve, 15));
        expect(f.suggest).not.toHaveBeenCalled();
        expect(f.frames.some((frame) => frame.type === 'server.supercar.suggestions')).toBe(false);
        vi.restoreAllMocks();
      }
    },
  );

  it.each(['generate', 'scrape', 'resume'] as const)(
    '%s suppresses suggestions if the completed result changes while generation is pending',
    async (lane) => {
      const f = fixture(lane);
      let finish!: (items: string[]) => void;
      f.suggest.mockImplementation(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
      await f.start();
      await vi.waitFor(() => expect(f.suggest).toHaveBeenCalledTimes(1));
      f.state.result = { summary: 'different saved outcome' };
      finish(['整理后续执行清单']);
      await new Promise((resolve) => setTimeout(resolve, 15));
      expect(f.frames.some((frame) => frame.type === 'server.supercar.suggestions')).toBe(false);
      expect(f.state.result.summary).toBe('different saved outcome');
    },
  );
});
