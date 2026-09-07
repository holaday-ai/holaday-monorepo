import { afterEach, describe, expect, it, vi } from 'vitest';
import * as planning from '../../agent/core-task-plan.js';
import * as generation from '../../agent/generate-runner.js';
import { TaskRepository } from '../../agent/task-repository.js';
import { env } from '../../config/env.js';
import * as executionPipeline from '../../execution/execution-pipeline.js';
import {
  reloadFeatureFlagsForTest,
  setFeatureFlagsForTest,
} from '../../execution/feature-flags.js';
import { FileService } from '../../files/file-service.js';
import type { ResponsesAdapter } from '../../llm/responses-adapter.js';
import { QuotaService } from '../../quota/quota-service.js';
import * as websocket from '../../ws/server.js';
import type { Context } from '../context.js';
import { tasksRouter } from './tasks.js';

const original = { ...env };
const realRunGenerateTask = generation.runGenerateTask;
afterEach(() => {
  Object.assign(env, original);
  reloadFeatureFlagsForTest();
  executionPipeline._resetExecutionPipelineForTest();
  vi.restoreAllMocks();
});

function fixture({
  persisted = true,
  legacy = false,
  jsonResult = false,
  parentIntent = '',
  expertMode = 'normal' as 'normal' | 'auto',
} = {}) {
  let creating = false;
  Object.assign(env, {
    ANTHROPIC_API_KEY: '',
    QWEN_CORE_ROLLOUT_MODE: 'synthetic',
    QWEN_CORE_ALLOWLIST: 'usr_plan_fixture',
    QWEN_CORE_ENABLED_LANES: 'generate',
    QWEN_RESPONSES_ADAPTER_ENABLED: true,
    DASHSCOPE_CN_API_KEY: 'synthetic-cn',
  });
  const plan = '1. 整理材料\n2. 形成提纲\n确认后执行。';
  const state = {
    status: 'awaiting_user',
    intent: '整理提供的材料，形成一份简洁的汇报提纲。不要发送邮件。',
    result: {
      executionMode: 'generate',
      expertMode: 'normal',
      ...(!legacy ? { planMode: 'awaiting_approval', planText: plan } : {}),
    } as Record<string, unknown>,
  };
  const logger = {
    child: () => logger,
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
  const db = {
    select(projection: Record<string, unknown>) {
      let rows: unknown[];
      if ('intent' in projection)
        rows = [
          creating && parentIntent
            ? {
                intent: parentIntent,
                status: 'completed',
                result: { summary: '合成父任务提纲' },
                opusUsed: false,
                roleId: null,
              }
            : {
                ...state,
                result: jsonResult ? JSON.stringify(state.result) : state.result,
                opusUsed: false,
                roleId: null,
              },
        ];
      else if ('plan' in projection)
        rows = [
          { id: 42, plan: 'free', selectedRoles: [], selectedSkills: [], modelDataRegion: 'cn' },
        ];
      else if ('count' in projection)
        return { from: () => ({ where: async () => [{ count: 0 }] }) };
      else if ('status' in projection) rows = [state];
      else if ('id' in projection) rows = [{ id: 42, modelDataRegion: 'cn' }];
      else throw new Error('Unexpected synthetic database read');
      return { from: () => ({ where: () => ({ limit: async () => rows }) }) };
    },
  };
  vi.spyOn(QuotaService.prototype, 'tryConsume').mockResolvedValue({ ok: true });
  vi.spyOn(QuotaService.prototype, 'getActiveTaskCount').mockResolvedValue(0);
  vi.spyOn(TaskRepository.prototype, 'insertTask').mockImplementation(async () => {
    state.status = 'executing';
  });
  const resume = vi
    .spyOn(TaskRepository.prototype, 'markAwaitingReplyResumed')
    .mockImplementation(async () => {
      if (persisted) state.status = 'executing';
      return { persisted };
    });
  const save = vi
    .spyOn(TaskRepository.prototype, 'persistAwaitingUser')
    .mockImplementation(async ({ result }) => {
      if (persisted) {
        state.status = 'awaiting_user';
        state.result = result ?? {};
      }
      return { persisted };
    });
  const complete = vi
    .spyOn(TaskRepository.prototype, 'persistVisionOutcome')
    .mockResolvedValue({ persisted });
  vi.spyOn(planning, 'prepareCoreTaskPlan').mockResolvedValue(null);
  const run = vi.spyOn(generation, 'runGenerateTask').mockResolvedValue({
    status: 'awaiting_user',
    summary: plan,
    inputTokens: 10,
    outputTokens: 10,
    durationMs: 1,
  });
  const frames: Array<{ type: string; [key: string]: unknown }> = [];
  vi.spyOn(websocket, 'broadcastToUser').mockImplementation((_actor, frame) => {
    frames.push(frame);
    return 1;
  });
  const ctx = {
    db,
    logger,
    userId: 'usr_plan_fixture',
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
    run,
    save,
    complete,
    resume,
    frames,
    plan,
    // Recreate the caller on every request to exercise persisted rather than per-call state.
    create: async (fileIds?: string[]) => {
      creating = true;
      try {
        return await tasksRouter.createCaller(ctx).create({
          intent: state.intent,
          expertMode,
          mode: 'plan',
          fileIds,
          ...(parentIntent ? { replyToTaskId: 'tsk_parent_fixture' } : {}),
        });
      } finally {
        creating = false;
      }
    },
    reply: (message: string, fileIds?: string[]) =>
      tasksRouter.createCaller(ctx).reply({ taskId: 'tsk_plan_fixture', message, fileIds }),
  };
}

describe('generate plan mode durable approval boundary', () => {
  it('keeps the explicit general-purpose decision after later workflow keywords', async () => {
    const f = fixture();
    setFeatureFlagsForTest({ EXPERT_WORKFLOW: true });
    const metadata = {
      provider: 'alibaba-model-studio',
      region: 'cn',
      deploymentScope: 'china_mainland',
      model: 'qwen3.7-plus',
      endpointKind: 'public',
      protocol: 'responses',
    } as const;
    const stream = vi.fn<ResponsesAdapter['stream']>(async () => ({
      id: 'synthetic_response',
      text: '汇报提纲：整理材料，列出两项讨论重点。',
      status: 'completed',
      sources: [],
      usage: { inputTokens: 10, outputTokens: 10 },
      metadata,
    }));
    f.run.mockImplementation((opts) =>
      realRunGenerateTask({ ...opts, responsesAdapter: { metadata, stream } }),
    );
    await f.create();
    await vi.waitFor(() => expect(f.save).toHaveBeenCalledTimes(1));
    await f.reply('修改方案，加入小红书内容选题的讨论方向');
    await vi.waitFor(() => expect(f.save).toHaveBeenCalledTimes(2));
    await f.reply('执行');
    await vi.waitFor(() => expect(f.complete).toHaveBeenCalledTimes(1));
    expect(f.run.mock.calls[2]?.[0].workflowOverride).toBeNull();
  });

  it('retains the original workflow through edits, approval and later clarification', async () => {
    const f = fixture({ expertMode: 'auto' });
    const init = vi.spyOn(executionPipeline, 'initExecution');
    setFeatureFlagsForTest({ EXPERT_WORKFLOW: true, EXECUTION_CONTRACT: true });
    f.state.intent = '帮我做小红书内容选题';
    await f.create();
    await vi.waitFor(() => expect(f.save).toHaveBeenCalledTimes(1));
    await f.reply('修改方案，补充抖音直播复盘作为背景');
    await vi.waitFor(() => expect(f.save).toHaveBeenCalledTimes(2));
    await f.reply('执行');
    await vi.waitFor(() => expect(f.save).toHaveBeenCalledTimes(3));
    await f.reply('美妆护肤');
    await vi.waitFor(() => expect(f.save).toHaveBeenCalledTimes(4));
    expect(f.run.mock.calls.map(([opts]) => opts.workflowOverride?.workflowId)).toEqual([
      'content-topic',
      'content-topic',
      'content-topic',
      'content-topic',
    ]);
    expect(f.state.result.planWorkflowId).toBe('content-topic');
    expect(f.state.result.expertWorkflowId).toBe('content-topic');
    expect(init.mock.calls.at(-1)?.[0].expertWorkflowId).toBe('content-topic');
    expect(init.mock.results.at(-1)?.value.contract.expertWorkflowId).toBe('content-topic');
  });

  it.each([null, 'content-topic'])(
    'does not override saved choice %s with a legacy browser handoff',
    async (planWorkflowId) => {
      const f = fixture();
      f.state.result.planWorkflowId = planWorkflowId;
      await f.reply('背景：昨天抖音直播复盘，电商罗盘，修改方案第二步');
      await vi.waitFor(() => expect(f.save).toHaveBeenCalledTimes(1));
      expect(await f.reply('执行')).toMatchObject({ ok: true, state: 'resumed' });
      await vi.waitFor(() => expect(f.save).toHaveBeenCalledTimes(2));
      expect(f.run.mock.calls[1]?.[0].intent).toMatch(/^整理提供的材料/);
      expect(f.state.result.expertWorkflowId).toBe(planWorkflowId);
    },
  );

  it('rejects an unavailable persisted workflow before releasing the waiting task', async () => {
    const f = fixture();
    f.state.result.planWorkflowId = 'removed-workflow';
    await expect(f.reply('执行')).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(f.resume).not.toHaveBeenCalled();
    expect(f.run).not.toHaveBeenCalled();
  });

  it('retains a legacy-only selection without rematching a typed report on approval', async () => {
    const f = fixture({ expertMode: 'auto' });
    setFeatureFlagsForTest({ EXPERT_WORKFLOW: true });
    f.state.intent = '电商罗盘 GMV 复盘';
    await f.create();
    await vi.waitFor(() => expect(f.save).toHaveBeenCalledTimes(1));
    await f.reply('修改方案，补充所需指标说明');
    await vi.waitFor(() => expect(f.save).toHaveBeenCalledTimes(2));
    await f.reply('执行');
    await vi.waitFor(() => expect(f.save).toHaveBeenCalledTimes(3));
    expect(f.run.mock.calls[2]?.[0].intent).toContain('【专家技能工作流：抖音直播复盘】');
    expect(f.run.mock.calls[2]?.[0].workflowOverride).toBeNull();
    expect(f.state.result.planLegacyWorkflowId).toBe('douyin-livestream-review');
    expect(f.state.result.expertWorkflowId).toBe('douyin-livestream-review');
  });

  it('selects the saved legacy handoff but does not dispatch when its CAS is refused', async () => {
    const f = fixture({ expertMode: 'auto' });
    setFeatureFlagsForTest({ EXPERT_WORKFLOW: true });
    f.state.intent = '电商罗盘 GMV 复盘';
    const handoff = vi
      .spyOn(TaskRepository.prototype, 'markAwaitingReplyCompleted')
      .mockResolvedValue({ persisted: false });
    await f.create();
    await vi.waitFor(() => expect(f.save).toHaveBeenCalledTimes(1));
    await f.reply('修改方案，场次为昨天');
    await vi.waitFor(() => expect(f.save).toHaveBeenCalledTimes(2));
    expect(handoff).not.toHaveBeenCalled();
    expect(await f.reply('执行')).toMatchObject({ ok: false, state: 'persistFailed' });
    expect(handoff).toHaveBeenCalledWith(
      'tsk_plan_fixture',
      expect.objectContaining({ handoffSuggestion: 'browser' }),
    );
    expect(f.run).toHaveBeenCalledTimes(2);
  });

  it('rejects an unknown saved legacy selection before any state transition', async () => {
    const f = fixture();
    f.state.result.planWorkflowId = null;
    f.state.result.planLegacyWorkflowId = 'removed-legacy-workflow';
    await expect(f.reply('执行')).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(f.resume).not.toHaveBeenCalled();
    expect(f.run).not.toHaveBeenCalled();
  });

  it('uses the latest explicit field edit for typed intake, not the original value', async () => {
    const f = fixture({ expertMode: 'auto' });
    setFeatureFlagsForTest({ EXPERT_WORKFLOW: true });
    f.state.intent = '帮我做小红书内容选题，品类：美妆护肤。';
    const metadata = {
      provider: 'alibaba-model-studio',
      region: 'cn',
      deploymentScope: 'china_mainland',
      model: 'qwen3.7-plus',
      endpointKind: 'public',
      protocol: 'responses',
    } as const;
    const stream = vi.fn<ResponsesAdapter['stream']>(async () => ({
      id: 'synthetic_response',
      text: '1. 明确目标\n2. 整理内容方向',
      status: 'completed',
      sources: [],
      usage: { inputTokens: 10, outputTokens: 10 },
      metadata,
    }));
    f.run.mockImplementation((opts) =>
      realRunGenerateTask({ ...opts, responsesAdapter: { metadata, stream } }),
    );
    await f.create();
    await vi.waitFor(() => expect(f.save).toHaveBeenCalledTimes(1));
    await f.reply('修改方案，品类：母婴。');
    await vi.waitFor(() => expect(f.save).toHaveBeenCalledTimes(2));
    await f.reply('执行');
    await vi.waitFor(() => expect(f.complete).toHaveBeenCalledTimes(1));
    expect(stream.mock.calls[2]?.[0].instructions).toContain('母婴');
    expect(stream.mock.calls[2]?.[0].instructions).not.toContain('美妆护肤');
    expect(f.state.result.planReplyHistory).toEqual(['修改方案，品类：母婴。']);
  });
  it('retains typed clarification mappings separately from raw replies after approval', async () => {
    const f = fixture({ expertMode: 'auto' });
    setFeatureFlagsForTest({ EXPERT_WORKFLOW: true });
    f.state.intent = '帮我做小红书内容选题';
    const texts = [
      '1. 确认需求\n2. 拟定选题',
      '[AWAITING_USER_INPUT]还有补充要求吗？',
      '选题草案：围绕所给条件整理内容方向。',
    ];
    let next = 0;
    const metadata = {
      provider: 'alibaba-model-studio',
      region: 'cn',
      deploymentScope: 'china_mainland',
      model: 'qwen3.7-plus',
      endpointKind: 'public',
      protocol: 'responses',
    } as const;
    const stream = vi.fn<ResponsesAdapter['stream']>(async () => ({
      id: 'synthetic_response',
      text: texts[next++] ?? '',
      status: 'completed',
      sources: [],
      usage: { inputTokens: 10, outputTokens: 10 },
      metadata,
    }));
    f.run.mockImplementation((opts) =>
      realRunGenerateTask({ ...opts, responsesAdapter: { metadata, stream } }),
    );
    expect(await f.create()).toMatchObject({ executionMode: 'generate' });
    await vi.waitFor(() => expect(f.save).toHaveBeenCalledTimes(1));
    await f.reply('执行');
    await vi.waitFor(() => expect(f.save).toHaveBeenCalledTimes(2));
    expect(f.save.mock.calls[1]?.[0].question).toContain('品类');
    expect(stream).toHaveBeenCalledTimes(1);
    await f.reply('美妆护肤');
    await vi.waitFor(() => expect(f.save).toHaveBeenCalledTimes(3));
    expect(stream).toHaveBeenCalledTimes(2);
    expect(f.state.result.planReplyHistory).toEqual(['执行', '美妆护肤']);
    expect(f.state.result.planIntakeContext).toEqual(['品类: 美妆护肤']);
    await f.reply('没有其他补充');
    await vi.waitFor(() => expect(f.complete).toHaveBeenCalledTimes(1));
    expect(stream).toHaveBeenCalledTimes(3);
  });
  it('runs the real generator through create, edit and explicit approval using only a synthetic model transport', async () => {
    const f = fixture();
    const texts = [
      '1. 整理材料\n2. 形成提纲',
      '1. 整理材料\n2. 形成提纲（不增加截止时间）',
      '根据提供的材料，整理出汇报提纲：背景、主要事实和待确认事项。',
    ];
    let next = 0;
    const metadata = {
      provider: 'alibaba-model-studio',
      region: 'cn',
      deploymentScope: 'china_mainland',
      model: 'qwen3.7-plus',
      endpointKind: 'public',
      protocol: 'responses',
    } as const;
    const stream = vi.fn<ResponsesAdapter['stream']>(async () => ({
      id: 'synthetic_response',
      text: texts[next++] ?? '',
      status: 'completed',
      sources: [],
      usage: { inputTokens: 10, outputTokens: 10 },
      metadata,
    }));
    f.run.mockImplementation((opts) =>
      realRunGenerateTask({ ...opts, responsesAdapter: { metadata, stream } }),
    );
    await f.create();
    await vi.waitFor(() => expect(f.save).toHaveBeenCalledTimes(1));
    expect(f.complete).not.toHaveBeenCalled();
    await f.reply('不要增加截止时间，修改方案第二步');
    await vi.waitFor(() => expect(f.save).toHaveBeenCalledTimes(2));
    expect(f.complete).not.toHaveBeenCalled();
    await f.reply('执行');
    await vi.waitFor(() => expect(f.complete).toHaveBeenCalledTimes(1));
    expect(f.complete.mock.calls[0]?.[1]).toMatchObject({ status: 'completed', summary: texts[2] });
    expect(f.complete.mock.calls[0]?.[1].metadata).toMatchObject({
      planReplyHistory: ['不要增加截止时间，修改方案第二步', '执行'],
      approvedPlanText: expect.stringContaining('不增加截止时间'),
    });
    expect(f.run.mock.calls[2]?.[0].planExecutionApproved).toBe(true);
    expect(f.run.mock.calls[1]?.[0].planExecutionApproved).not.toBe(true);
    expect(stream.mock.calls[0]?.[0].tools).toEqual([]);
    expect(stream.mock.calls[1]?.[0].tools).toEqual([]);
    expect(JSON.stringify(stream.mock.calls[2]?.[0].input)).toContain('不要增加截止时间');
    expect(stream.mock.calls[2]?.[0].instructions).not.toContain('本轮只拟定或修改方案');
  });

  it.each([
    { planText: '' },
    { planReplyHistory: Array.from({ length: 32 }, () => '修改提纲') },
    { planFileIds: Array.from({ length: 6 }, (_, i) => `fil_${i}`) },
  ])(
    'refuses incomplete or oversized plan context without truncating constraints: %j',
    async (patch) => {
      const f = fixture();
      Object.assign(f.state.result, patch);
      await expect(f.reply('执行')).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      expect(f.run).not.toHaveBeenCalled();
      expect(f.resume).not.toHaveBeenCalled();
    },
  );
  it('retains authenticated parent context without carrying the unapproved preamble into execution', async () => {
    const f = fixture({ parentIntent: '整理材料，仅限附件已有内容，不得编造市场数据。' });
    await f.create();
    await vi.waitFor(() => expect(f.save).toHaveBeenCalledTimes(1));
    await f.reply('执行');
    await vi.waitFor(() => expect(f.save).toHaveBeenCalledTimes(2));
    expect(f.run.mock.calls[1]?.[0].intent).toContain('不得编造市场数据');
    expect(f.run.mock.calls[1]?.[0].intent).not.toContain('【执行模式】先列计划，等用户确认');
  });
  it('preserves user edits even when the model omits them, including later execution clarification', async () => {
    const f = fixture();
    await f.reply('修改第二步，不要添加截止时间');
    await vi.waitFor(() => expect(f.save).toHaveBeenCalledTimes(1));
    // The external model returned the old plan and omitted this restriction.
    expect(f.state.result.planText).toBe(f.plan);
    await f.reply('执行');
    await vi.waitFor(() => expect(f.save).toHaveBeenCalledTimes(2));
    expect(f.run.mock.calls[1]?.[0].intent).toContain('不要添加截止时间');
    await f.reply('补充数据在表格中');
    await vi.waitFor(() => expect(f.save).toHaveBeenCalledTimes(3));
    expect(f.run.mock.calls[2]?.[0].intent).toContain('不要添加截止时间');
    expect(f.run.mock.calls[2]?.[0].executionPlan).toBe(f.plan);
    expect(f.run.mock.calls[2]?.[0].planOnly).toBe(false);
  });

  it.each(['根据新增材料修改第二步', '先别执行'])(
    'reloads original and later attachments after %s',
    async (reply) => {
      const f = fixture();
      const load = vi.spyOn(FileService.prototype, 'loadMany').mockImplementation(
        async (ids) =>
          ids.map((id) => ({
            buffer: Buffer.from(`synthetic attachment ${id}`),
            row: { externalId: id, filename: `${id}.txt`, mimetype: 'text/plain' },
          })) as Awaited<ReturnType<FileService['loadMany']>>,
      );
      await f.create(['fil_original']);
      await vi.waitFor(() => expect(f.save).toHaveBeenCalledTimes(1));
      await f.reply(reply, ['fil_revision']);
      await vi.waitFor(() => expect(f.save).toHaveBeenCalledTimes(2));
      expect(f.state.result.planFileIds).toEqual(['fil_original', 'fil_revision']);
      expect(f.run.mock.calls[1]?.[0].planOnly).toBe(true);
      await f.reply('执行');
      await vi.waitFor(() => expect(f.save).toHaveBeenCalledTimes(3));
      expect(load).toHaveBeenLastCalledWith(['fil_original', 'fil_revision'], 42);
      expect(JSON.stringify(f.run.mock.calls[2]?.[0].attachments)).toContain(
        'synthetic attachment fil_original',
      );
      expect(JSON.stringify(f.run.mock.calls[2]?.[0].attachments)).toContain(
        'synthetic attachment fil_revision',
      );
    },
  );

  it('refuses approval before the state transition if an original file is no longer accessible', async () => {
    const f = fixture();
    f.state.result.planFileIds = ['fil_expired'];
    vi.spyOn(FileService.prototype, 'loadMany').mockResolvedValue([]);
    await expect(f.reply('执行')).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(f.resume).not.toHaveBeenCalled();
    expect(f.run).not.toHaveBeenCalled();
  });
  it('refuses approval when the attachment added during a pure hold has expired', async () => {
    const f = fixture();
    const load = vi.spyOn(FileService.prototype, 'loadMany').mockImplementation(
      async (ids) =>
        ids.map((id) => ({
          buffer: Buffer.from('synthetic notes'),
          row: { externalId: id, filename: `${id}.txt`, mimetype: 'text/plain' },
        })) as Awaited<ReturnType<FileService['loadMany']>>,
    );
    await f.create(['fil_original']);
    await vi.waitFor(() => expect(f.save).toHaveBeenCalledTimes(1));
    await f.reply('先别执行', ['fil_later']);
    await vi.waitFor(() => expect(f.save).toHaveBeenCalledTimes(2));
    load.mockResolvedValue([]);
    f.resume.mockClear();
    f.run.mockClear();
    await expect(f.reply('执行')).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(f.resume).not.toHaveBeenCalled();
    expect(f.run).not.toHaveBeenCalled();
    expect(f.state.status).toBe('awaiting_user');
  });
  it.each([true, false])(
    'create forwards plan mode and only publishes a committed wait: %s',
    async (persisted) => {
      const f = fixture({ persisted });
      expect((await f.create()).executionMode).toBe('generate');
      await vi.waitFor(() => expect(f.save).toHaveBeenCalledTimes(1));
      expect(f.run).toHaveBeenCalledWith(expect.objectContaining({ planOnly: true }));
      expect(f.save).toHaveBeenCalledWith(
        expect.objectContaining({
          question: f.plan,
          result: expect.objectContaining({ planMode: 'awaiting_approval', planText: f.plan }),
        }),
      );
      expect(f.frames.some((frame) => frame.type === 'server.supercar.awaiting_user')).toBe(
        persisted,
      );
      expect(f.complete).not.toHaveBeenCalled();
    },
  );

  it.each([
    '修改第二步',
    '执行并发送邮件',
    '把预算改为3000元，先别执行',
    '第二步只整理附件，不要执行',
  ])('keeps edits or compound replies in plan mode: %s', async (reply) => {
    const f = fixture();
    expect(await f.reply(reply)).toMatchObject({ ok: true, state: 'resumed' });
    await vi.waitFor(() => expect(f.save).toHaveBeenCalledTimes(1));
    expect(f.run).toHaveBeenCalledWith(
      expect.objectContaining({ planOnly: true, executionPlan: f.plan }),
    );
    expect(f.state.result.planMode).toBe('awaiting_approval');
  });

  it.each(['不要执行', '先别执行'])(
    'keeps an explicit hold parked without a model call: %s',
    async (reply) => {
      const f = fixture();
      expect(await f.reply(reply)).toMatchObject({ ok: true, state: 'stillAwaiting' });
      expect(f.run).not.toHaveBeenCalled();
      expect(f.resume).not.toHaveBeenCalled();
      expect(f.state.result.planMode).toBe('awaiting_approval');
    },
  );

  it('does not auto-handoff a plan edit with platform keywords to a browser', async () => {
    const f = fixture();
    f.state.intent = '分析抖音昨天直播表现';
    expect(await f.reply('数据来自电商罗盘，修改方案第二步')).toMatchObject({
      ok: true,
      state: 'resumed',
    });
    await vi.waitFor(() => expect(f.save).toHaveBeenCalledTimes(1));
    expect(f.run).toHaveBeenCalledWith(expect.objectContaining({ planOnly: true }));
    expect(f.frames.some((frame) => frame.type === 'server.task.terminal')).toBe(false);
  });

  it.each([false, true])(
    'preserves revised plans across fresh callers and clears the gate only on approval, JSON=%s',
    async (jsonResult) => {
      const f = fixture({ jsonResult });
      const revised = '1. 只整理已提供的材料\n2. 不要添加截止时间';
      f.run.mockResolvedValueOnce({
        status: 'awaiting_user',
        summary: revised,
        inputTokens: 1,
        outputTokens: 1,
        durationMs: 1,
      });
      await f.reply('修改第二步，不要添加截止时间');
      await vi.waitFor(() => expect(f.save).toHaveBeenCalledTimes(1));
      expect(f.state.result.planText).toBe(revised);
      await f.reply('执行');
      await vi.waitFor(() => expect(f.save).toHaveBeenCalledTimes(2));
      expect(f.run.mock.calls[1]?.[0]).toMatchObject({ planOnly: false, executionPlan: revised });
      expect(f.run.mock.calls[1]?.[0].intent).toContain('不要发送邮件');
      // Further execution clarification is not another plan-approval cycle.
      expect(f.state.result).not.toHaveProperty('planMode');
    },
  );

  it('leaves ordinary generate clarification unchanged', async () => {
    const f = fixture({ legacy: true });
    await f.reply('补充材料如下');
    await vi.waitFor(() => expect(f.save).toHaveBeenCalledTimes(1));
    expect(f.run.mock.calls[0]?.[0].planOnly).toBeFalsy();
    expect(f.run.mock.calls[0]?.[0].executionPlan).toBeUndefined();
    expect(f.state.result).not.toHaveProperty('planMode');
  });

  it('does not dispatch or publish if resume persistence is refused', async () => {
    const f = fixture({ persisted: false });
    expect(await f.reply('执行')).toMatchObject({ ok: false, state: 'persistFailed' });
    expect(f.run).not.toHaveBeenCalled();
    expect(f.frames).toEqual([]);
  });
});
