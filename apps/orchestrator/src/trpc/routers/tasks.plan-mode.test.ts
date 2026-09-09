import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SQL } from 'drizzle-orm';
import { MySqlDialect } from 'drizzle-orm/mysql-core';
import * as planning from '../../agent/core-task-plan.js';
import * as generation from '../../agent/generate-runner.js';
import { TaskRepository } from '../../agent/task-repository.js';
import { CoreTaskRepository } from '../../agent/core-task-repository.js';
import * as supercar from '../../agent/supercar/index.js';
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
  parentSummary = '合成父任务提纲',
  expertMode = 'normal' as 'normal' | 'auto',
  ownerSnapshotStatus = undefined as string | undefined,
  ownerSnapshotLegacy = false,
} = {}) {
  let creating = false;
  setFeatureFlagsForTest({ EVIDENCE_LEDGER: true, EXECUTION_CONTRACT: true, EXECUTION_VERIFIER: true });
  Object.assign(env, {
    ANTHROPIC_API_KEY: '',
    QWEN_CORE_ROLLOUT_MODE: 'synthetic',
    QWEN_CORE_ALLOWLIST: 'usr_plan_fixture',
    QWEN_CORE_ENABLED_LANES: 'generate',
    QWEN_RESPONSES_ADAPTER_ENABLED: true,
    DASHSCOPE_CN_API_KEY: 'synthetic-cn',
  });
  const plan = '1. 整理已经提供的合成材料，保留缺失事项\n2. 形成可供用户复核的汇报提纲\n确认后执行。';
  const state = {
    status: 'awaiting_user',
    roleId: null,
    executionId: null as string | null,
    executionRevision: 0,
    coreRecordVersion: 0,
    awaitingQuestion: '确认这个方案吗？',
    intent: '整理提供的材料，形成一份简洁的汇报提纲。不要发送邮件。',
    result: {
      executionMode: 'generate',
      expertMode: 'normal',
      ...(!legacy ? {
        planMode: 'awaiting_approval', planText: plan,
        selectedRole: null, planInitialIntent: '整理提供的材料，形成一份简洁的汇报提纲。不要发送邮件。',
        planReplyHistory: [], planFileIds: [], planWorkflowId: null, planLegacyWorkflowId: null,
      } : {}),
    } as Record<string, unknown>,
  };
  const reads: Array<{ projection: Record<string, unknown>; query: { sql: string; params: unknown[] } }> = [];
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
      if ('id' in projection && 'status' in projection)
        rows = [ownerSnapshotLegacy
          ? { ...state, executionId: null, executionRevision: 0, coreRecordVersion: 0, result: { executionMode: 'browser' } }
          : { ...state, ...(ownerSnapshotStatus ? { status: ownerSnapshotStatus } : {}), result: jsonResult ? JSON.stringify(state.result) : state.result }];
      else if ('intent' in projection)
        rows = [
          creating && parentIntent
            ? {
                intent: parentIntent,
                status: 'completed',
                result: { summary: parentSummary },
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
      else if ('status' in projection) rows = [
        'id' in projection && ownerSnapshotLegacy
          ? { ...state, executionId: null, executionRevision: 0, coreRecordVersion: 0,
              result: { executionMode: 'browser' } }
          : ownerSnapshotStatus && 'result' in projection ? { ...state, status: ownerSnapshotStatus } : state,
      ];
      else if ('id' in projection) rows = [{ id: 42, modelDataRegion: 'cn' }];
      else throw new Error('Unexpected synthetic database read');
      return { from: () => ({ where: (condition: SQL) => {
        reads.push({ projection, query: new MySqlDialect().sqlToQuery(condition) });
        return { limit: async () => rows };
      } }) };
    },
  };
  const charge = vi.spyOn(QuotaService.prototype, 'tryConsume').mockResolvedValue({ ok: true });
  vi.spyOn(QuotaService.prototype, 'getActiveTaskCount').mockResolvedValue(0);
  const insert = vi.spyOn(TaskRepository.prototype, 'insertTask').mockImplementation(async () => {
    state.status = 'executing';
  });
  const resume = vi
    .spyOn(TaskRepository.prototype, 'markAwaitingReplyResumed')
    .mockImplementation(async () => {
      if (persisted) state.status = 'executing';
      return { persisted };
    });
  // Observe the persisted wait boundary for legacy and new core formats;
  // this does not call a legacy writer from the core path.
  const save = vi.fn<TaskRepository['persistAwaitingUser']>(async ({ result, question }) => {
      if (persisted) {
        state.status = 'awaiting_user';
        state.result = result ?? {};
        state.awaitingQuestion = question;
      }
      return { persisted };
    });
  vi.spyOn(TaskRepository.prototype, 'persistAwaitingUser').mockImplementation(save);
  const complete = vi.fn<TaskRepository['persistVisionOutcome']>().mockResolvedValue({ persisted });
  vi.spyOn(TaskRepository.prototype, 'persistVisionOutcome').mockImplementation(complete);
  vi.spyOn(CoreTaskRepository.prototype, 'readHead').mockImplementation(async () => ({
    status: state.status, executionId: state.executionId, executionRevision: state.executionRevision,
    recordVersion: state.coreRecordVersion,
  }));
  vi.spyOn(CoreTaskRepository.prototype, 'admit').mockImplementation(async op => {
    Object.assign(state, { status: 'executing', executionId: op.executionId, executionRevision: op.executionRevision, coreRecordVersion: op.recordVersion, result: { coreRequirements: op.requirements } });
    return { persisted: true };
  });
  const coreSettle = vi.spyOn(CoreTaskRepository.prototype, 'settle').mockImplementation(async op => {
    const coreRequirements = state.result.coreRequirements;
    if (persisted) state.coreRecordVersion = op.recordVersion;
    if (op.status === 'awaiting_user') return save({ taskExternalId: op.scope.taskId, question: op.awaitingQuestion ?? '', awaitingKind: 'clarification', result: { ...op.result, coreRequirements } });
    if (persisted) { state.status = op.status; state.result = { ...op.result, coreRequirements }; }
    if (op.status === 'failed') {
      if (typeof op.result.reason !== 'string') throw new Error('Missing core failure reason');
      return complete(op.scope.taskId, { status: 'failed', reason: op.result.reason, tickCount: 1 });
    }
    if (typeof op.result.summary !== 'string') throw new Error('Missing core result summary');
    return complete(op.scope.taskId, { status: op.status, summary: op.result.summary, tickCount: 1 });
  });
  // A refused settlement is treated as cancelled, not a retryable write, in
  // these boundary fixtures. Recovery/retry mechanics have dedicated tests.
  vi.spyOn(CoreTaskRepository.prototype, 'readSettlement').mockImplementation(async () => ({ status: 'cancelled', executionId: state.executionId, executionRevision: state.executionRevision, recordVersion: state.coreRecordVersion, commitId: null }));
  vi.spyOn(planning, 'prepareCoreTaskPlan').mockResolvedValue(null);
  const run = vi.spyOn(generation, 'runGenerateTask').mockResolvedValue({
    status: 'awaiting_user',
    generation: { completeness: 'complete', stopReason: 'awaiting_user' },
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
    taskOrigin: 'user',
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
    charge,
    insert,
    state,
    run,
    save,
    complete,
    coreSettle,
    resume,
    frames,
    plan,
    reads,
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
  it('does not promote a parent model example into user-supplied legacy data', async () => {
    const f = fixture({ expertMode: 'auto', parentIntent: '展示指标示例', parentSummary: '仅为模型示例\nGMV: 100\nUV: 200' });
    f.state.intent = '复盘昨天抖音直播';
    await f.create();
    await vi.waitFor(() => expect(f.save).toHaveBeenCalledTimes(1));
    expect(f.run.mock.calls[0]?.[0].verificationContext?.legacyWorkflow?.missingInputs).toContain('dataSource');
    expect(f.run.mock.calls[0]?.[0].verificationContext?.initialRequest).not.toContain('GMV: 100');
    expect(f.run.mock.calls[0]?.[0].verificationContext).toMatchObject({ referenceContext: expect.stringContaining('GMV: 100') });
  });
  it.each(['登录好了', '数据如下 GMV 1000'])('does not wake a parked browser handle if a core execution took ownership (%s)', async message => {
    const f = fixture({ legacy: true });
    vi.spyOn(supercar, 'hasParkedSupercarHandle').mockReturnValue(true);
    const wake = vi.spyOn(supercar, 'supercarReply').mockReturnValue(true);
    const handoff = vi.spyOn(supercar, 'supercarHandoffToGenerate').mockReturnValue(true);
    // A new core execution wins while attachments/other work yielded. The real
    // scoped SQL boundary is tested separately; the transport only refuses the
    // guarded call, making omission of the owner observable as a wrongly resumed task.
    f.resume.mockImplementation(async (_id, legacyUserId) => ({ persisted: legacyUserId === undefined }));
    await expect(f.reply(message)).resolves.toEqual({ ok: false, state: 'persistFailed' });
    expect(f.resume).toHaveBeenCalledWith('tsk_plan_fixture', 42);
    expect(wake).not.toHaveBeenCalled();
    expect(handoff).not.toHaveBeenCalled();
    expect(f.run).not.toHaveBeenCalled();
  });
  it.each([null, [], { initialRequest: 'incomplete' }, undefined])(
    'rejects a new execution with missing or malformed requirements before legacy effects (%j)',
    async (requirements) => {
      const f = fixture();
      Object.assign(f.state, { executionId: 'synthetic-execution', executionRevision: 2, coreRecordVersion: 4 });
      if (requirements !== undefined) f.state.result.coreRequirements = requirements;
      const files = vi.spyOn(FileService.prototype, 'loadMany').mockResolvedValue([]);
      await expect(f.reply('确认', ['file_synthetic'])).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      expect(files).not.toHaveBeenCalled();
      expect(f.resume).not.toHaveBeenCalled();
      expect(f.run).not.toHaveBeenCalled();
    },
  );
  it('does not interpret valid core requirements and leftover plan fields as a legacy dispatch permit', async () => {
    const f = fixture();
    Object.assign(f.state, { executionId: 'synthetic-execution', executionRevision: 2, coreRecordVersion: 4 });
    f.state.result.coreRequirements = {
      initialRequest: '合成要求', userTurns: [], phase: 'draft', workflow: null,
      referencePlan: null, fileIds: [],
    };
    await expect(f.reply('确认')).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(f.resume).not.toHaveBeenCalled();
    expect(f.run).not.toHaveBeenCalled();
    expect(f.frames).toEqual([]);
  });
  it.each(['确认', '等一下'])('revalidates the later snapshot instead of trusting the initial legacy read (%s)', async message => {
    const f = fixture({ ownerSnapshotLegacy: true });
    Object.assign(f.state, { executionId: 'synthetic-newer', executionRevision: 2, coreRecordVersion: 4 });
    await expect(f.reply(message)).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(f.reads.some(read => 'status' in read.projection && 'id' in read.projection)).toBe(true);
    expect(f.reads.some(read => message === '等一下'
      ? 'awaitingKind' in read.projection && !('id' in read.projection)
      : 'intent' in read.projection)).toBe(true);
    expect(f.resume).not.toHaveBeenCalled();
    expect(f.run).not.toHaveBeenCalled();
    expect(f.frames).toEqual([]);
  });
  it('refuses a plain legacy generate wait without full history before any write or generation', async () => {
    const f = fixture({ legacy: true });
    await expect(f.reply('补充原始数据')).rejects.toThrow('旧任务缺少完整执行历史');
    expect(f.state.status).toBe('awaiting_user');
    expect(f.run).not.toHaveBeenCalled();
  });
  it('keeps the owner and origin on the authorized read and scoped non-core handle write', async () => {
    const f = fixture({ legacy: true });
    f.state.result.executionMode = 'browser';
    vi.spyOn(supercar, 'hasParkedSupercarHandle').mockReturnValue(true);
    vi.spyOn(supercar, 'supercarReply').mockReturnValue(true);
    await f.reply('确认');
    const parkRead = f.reads.find(read => 'intent' in read.projection);
    expect(parkRead?.query.sql).toContain('`tasks`.`user_id` = ?');
    expect(parkRead?.query.sql).toContain('`tasks`.`origin` = ?');
    expect(parkRead?.query.params).toEqual(['tsk_plan_fixture', 42, 'user']);
    expect(f.resume).toHaveBeenCalledWith('tsk_plan_fixture', 42);
    expect(f.run).not.toHaveBeenCalled();
  });
  // These tests exercise the real router's pre-dispatch boundary. Existing
  // execution/persistence doubles drain the legacy background path on RED;
  // they are not evidence for the later V10 real-runner/DB integration gate.
  function attachFiles(bodies: Readonly<Record<string, string | undefined>>) {
    return vi.spyOn(FileService.prototype, 'loadMany').mockImplementation(async (ids) =>
      ids.flatMap(id => {
        const body = bodies[id];
        return body === undefined ? [] : [{
          buffer: Buffer.from(body),
          row: { externalId: id, filename: `${id}.txt`, mimetype: 'text/plain' },
        }];
      }) as Awaited<ReturnType<FileService['loadMany']>>,
    );
  }

  async function rejectionOrDrain(f: ReturnType<typeof fixture>, request: Promise<unknown>) {
    const error = await request.then(() => null, (reason: unknown) => reason);
    if (error === null) await vi.waitFor(() => expect(f.save).toHaveBeenCalledTimes(1));
    return error;
  }

  it('revalidates new file presence after the task changes into a core wait', async () => {
    const f = fixture({ legacy: true, ownerSnapshotStatus: 'executing' });
    attachFiles({});
    const error = await rejectionOrDrain(f, f.reply('补充材料', ['fil_missing']));
    expect(error).toMatchObject({ code: 'BAD_REQUEST' });
    expect(f.resume).not.toHaveBeenCalled();
    expect(f.run).not.toHaveBeenCalled();
  });

  it('does not reuse a legacy-truncated attachment after the task changes into a core wait', async () => {
    const f = fixture({ legacy: true, ownerSnapshotStatus: 'executing' });
    attachFiles({ fil_one: `${'a'.repeat(55_000)}RACE_TAIL` });
    await expect(f.reply('补充材料', ['fil_one'])).rejects.toThrow('旧任务缺少完整执行历史');
    expect(f.resume).not.toHaveBeenCalled();
    expect(f.run).not.toHaveBeenCalled();
  });

  it.each([
    { fil_one: 'a'.repeat(70_000) },
    { fil_one: '字'.repeat(22_000) },
    { fil_one: 'a'.repeat(34_000), fil_two: 'b'.repeat(34_000) },
    { fil_one: ' \n\t' },
  ])('rejects incomplete or oversized create materials before charge or insert %#', async (bodies) => {
    const f = fixture();
    attachFiles(bodies);
    const error = await rejectionOrDrain(f, f.create(Object.keys(bodies)));
    expect(error).toMatchObject({ code: 'BAD_REQUEST' });
    expect(f.charge).not.toHaveBeenCalled();
    expect(f.insert).not.toHaveBeenCalled();
    expect(f.run).not.toHaveBeenCalled();
  });

  it('does not truncate an accepted create attachment at the old 50K character ceiling', async () => {
    const f = fixture();
    const body = `${'a'.repeat(55_000)}CORE_FILE_TAIL`;
    attachFiles({ fil_one: body });
    await f.create(['fil_one']);
    await vi.waitFor(() => expect(f.save).toHaveBeenCalledTimes(1));
    expect(JSON.stringify(f.run.mock.calls[0]?.[0].verificationContext?.materials).includes('CORE_FILE_TAIL')).toBe(true);
    expect(f.charge).toHaveBeenCalledTimes(1);
  });

  it('rejects file references that the atomic admission schema cannot preserve before charging', async () => {
    const f = fixture();
    const id = 'f'.repeat(33);
    attachFiles({ [id]: 'synthetic readable notes' });
    const error = await rejectionOrDrain(f, f.create([id]));
    expect(error).toMatchObject({ code: 'BAD_REQUEST' });
    expect(f.charge).not.toHaveBeenCalled();
    expect(f.insert).not.toHaveBeenCalled();
    expect(f.run).not.toHaveBeenCalled();
  });

  it.each([65_514, 65_515])('counts the 22-byte file heading at the materials boundary: %s', async length => {
    const f = fixture();
    attachFiles({ fil_one: 'a'.repeat(length) });
    const error = await rejectionOrDrain(f, f.create(['fil_one']));
    if (length === 65_514) {
      expect(error).toBeNull();
      expect(f.charge).toHaveBeenCalledTimes(1);
      const block = f.run.mock.calls[0]?.[0].verificationContext?.materials[0];
      expect(block && 'text' in block && Buffer.byteLength(block.text, 'utf8')).toBe(65_536);
    } else {
      expect(error).toMatchObject({ code: 'BAD_REQUEST' });
      expect(f.charge).not.toHaveBeenCalled();
      expect(f.insert).not.toHaveBeenCalled();
    }
  });

  it('includes authenticated parent context in the create input budget', async () => {
    const f = fixture({ parentIntent: '上下文'.repeat(24_000) });
    const error = await rejectionOrDrain(f, f.create());
    expect(error).toMatchObject({ code: 'BAD_REQUEST' });
    expect(f.insert).not.toHaveBeenCalled();
    expect(f.run).not.toHaveBeenCalled();
  });

  it.each([false, true])('rejects a missing newly attached file before resume, legacy=%s', async legacy => {
    const f = fixture({ legacy });
    attachFiles({});
    const error = await rejectionOrDrain(f, f.reply('补充合成材料', ['fil_missing']));
    expect(error).toMatchObject({ code: 'BAD_REQUEST' });
    expect(f.resume).not.toHaveBeenCalled();
    expect(f.run).not.toHaveBeenCalled();
    expect(f.state.status).toBe('awaiting_user');
  });

  it.each(['a'.repeat(70_000), '字'.repeat(22_000), ' \n\t'])(
    'rejects oversized or empty retained files before approval %#', async body => {
      const f = fixture();
      f.state.result.planFileIds = ['fil_original'];
      attachFiles({ fil_original: body });
      const error = await rejectionOrDrain(f, f.reply('执行'));
      expect(error).toMatchObject({ code: 'BAD_REQUEST' });
      expect(f.resume).not.toHaveBeenCalled();
      expect(f.run).not.toHaveBeenCalled();
      expect(f.state.status).toBe('awaiting_user');
    },
  );

  it('checks all persisted user turns before accepting another revision', async () => {
    const f = fixture();
    f.state.result.planReplyHistory = Array.from({ length: 25 }, () => 'a'.repeat(3_000));
    const error = await rejectionOrDrain(f, f.reply('改成简洁的提纲'));
    expect(error).toMatchObject({ code: 'BAD_REQUEST' });
    expect(f.resume).not.toHaveBeenCalled();
    expect(f.run).not.toHaveBeenCalled();
    expect(f.state.status).toBe('awaiting_user');
  });

  it('retains the complete tail when an in-budget original attachment is reloaded', async () => {
    const f = fixture();
    f.state.result.planFileIds = ['fil_original'];
    attachFiles({ fil_original: `${'a'.repeat(55_000)}RELOADED_TAIL` });
    await f.reply('执行');
    await vi.waitFor(() => expect(f.save).toHaveBeenCalledTimes(1));
    expect(JSON.stringify(f.run.mock.calls[0]?.[0].verificationContext?.materials)).toContain('RELOADED_TAIL');
  });

  it.each([false, true])(
    'persists a typed topic report after ecommerce background edits, verifier=%s',
    async (enabled) => {
      const f = fixture({ expertMode: 'auto' });
      setFeatureFlagsForTest({
        EXPERT_WORKFLOW: true,
        EVIDENCE_LEDGER: enabled,
        EXECUTION_CONTRACT: enabled,
        EXECUTION_VERIFIER: enabled,
      });
      f.state.intent =
        '【Holaday PR235 合成验收】请做小红书内容选题策划。品类：办公文具。目标平台：小红书。目标人群：职场新人。内容形式：图文。生成3个选题方向。所有材料为虚构，只输出对话文字，不访问网站、不发布内容、不发消息、不采购、不生成文件。先给2至5步方案，等我确认后才交付完整的内容选题报告。没有依据的判断标为模型假设。';
      const edit =
        '修改方案：把桌面整理作为主要选题角度，仍然是办公文具、小红书、职场新人。抖音直播复盘与电商罗盘只作为背景词，不切换技能，不做浏览器操作。发布策略仅作建议，不实际发布。其余限制不变，先别执行。';
      const report = [
        '## 数据校验\n[用户提供] 办公文具、小红书、职场新人、图文。所有材料为虚构，无外部数据。',
        '## 选题方向\n[模型假设] 桌面归位、通勤收纳、便签整理三个方向可供选择，尚未经用户调研验证。',
        '## 标题候选\n[模型假设] 新人桌面归位指南；通勤文具怎样收纳；让便签更好找。',
        '## 内容大纲\n[模型假设] 每篇图文先描述一个整理情景，再展示归位过程，最后列出需要读者自行判断的使用限制。',
        '## 发布策略\n[模型假设] 只提供图文表达建议，发布时间需由用户判断，不实际发布，不承诺阅读量或商业效果。',
        '## 执行 Checklist\n核对素材授权，确认办公文具适用范围，检查图文可读性。所有内容仍需用户审核，本次没有访问网站或执行采购。',
      ].join('\n\n');
      const texts = ['1. 整理选题需求\n2. 等待确认', '1. 聚焦桌面整理\n2. 等待确认', report];
      const metadata = {
        provider: 'alibaba-model-studio',
        region: 'cn',
        deploymentScope: 'china_mainland',
        model: 'qwen3.7-plus',
        endpointKind: 'public',
        protocol: 'responses',
      } as const;
      let next = 0;
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
      if (!enabled) {
        await expect(f.create()).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
        expect(f.charge).not.toHaveBeenCalled();
        expect(f.insert).not.toHaveBeenCalled();
        return;
      }
      await f.create();
      await vi.waitFor(() => expect(f.save).toHaveBeenCalledTimes(1));
      await f.reply(edit);
      await vi.waitFor(() => expect(f.save).toHaveBeenCalledTimes(2));
      expect(f.complete).not.toHaveBeenCalled();
      await f.reply('确认');
      await vi.waitFor(() => expect(f.complete).toHaveBeenCalledTimes(1));
      expect(f.complete.mock.calls[0]?.[1]).toMatchObject({
        status: 'partial_success',
        summary: expect.stringContaining(report),
      });
      expect(f.state.result.coreRequirements).toMatchObject({ userTurns: [edit, '确认'], workflow: { id: 'content-topic' } });
      expect(f.coreSettle.mock.calls.at(-1)?.[0].verification.semanticStatus).toBe('unavailable');
      expect(f.run.mock.calls[2]?.[0].intent).toContain(edit);
      expect(stream).toHaveBeenCalledTimes(3);
    },
  );

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
    expect(f.run.mock.calls[2]?.[0].verificationContext?.workflow).toBeNull();
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
    expect(f.run.mock.calls.map(([opts]) => opts.verificationContext?.workflow?.id)).toEqual([
      'content-topic',
      'content-topic',
      'content-topic',
      'content-topic',
    ]);
    expect(f.state.result.coreRequirements).toMatchObject({ workflow: { id: 'content-topic' } });
    expect(init).not.toHaveBeenCalled();
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
      expect(f.state.result.coreRequirements).toMatchObject({
        workflow: planWorkflowId ? { id: planWorkflowId } : null,
        resume: { legacyWorkflowId: null },
      });
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
    expect(f.run.mock.calls[2]?.[0].verificationContext?.legacyWorkflow?.promptPreamble).toContain('【专家技能工作流：抖音直播复盘】');
    expect(f.run.mock.calls[2]?.[0].verificationContext?.workflow).toBeNull();
    expect(f.state.result.coreRequirements).toMatchObject({ resume: { legacyWorkflowId: 'douyin-livestream-review' } });
  });

  it('refuses the unavailable legacy browser handoff before admission under qwen-only', async () => {
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
    const admit = vi.spyOn(CoreTaskRepository.prototype, 'admit').mockClear();
    await expect(f.reply('执行')).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    expect(admit).not.toHaveBeenCalled();
    expect(handoff).not.toHaveBeenCalled();
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
    expect(f.state.result.coreRequirements).toMatchObject({ userTurns: ['修改方案，品类：母婴。', '执行'] });
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
    expect(f.state.result.coreRequirements).toMatchObject({ userTurns: ['执行', '美妆护肤'], resume: { intakeBindings: [{ turn: 1, field: 'category' }] } });
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
    expect(f.complete.mock.calls[0]?.[1]).toMatchObject({ status: 'partial_success', summary: texts[2] });
    expect(f.state.result.coreRequirements).toMatchObject({
      userTurns: ['不要增加截止时间，修改方案第二步', '执行'],
      referencePlan: expect.stringContaining('不增加截止时间'),
    });
    expect(f.run.mock.calls[2]?.[0].verificationContext?.phase).toBe('approved_execution');
    expect(f.run.mock.calls[1]?.[0].verificationContext?.phase).toBe('revise');
    expect(stream.mock.calls[0]?.[0].tools).toEqual([]);
    expect(stream.mock.calls[1]?.[0].tools).toEqual([]);
    expect(JSON.stringify(stream.mock.calls[2]?.[0].input)).toContain('不要增加截止时间');
    expect(stream.mock.calls[2]?.[0].instructions).not.toContain('本轮只拟定或修改方案');
  });

  it.each([
    { planText: '' },
    { planReplyHistory: Array.from({ length: 32 }, () => '修改提纲'.repeat(200)) },
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
    expect(f.run.mock.calls[2]?.[0].verificationContext?.referencePlan).toBe(f.plan);
    expect(f.run.mock.calls[2]?.[0].verificationContext?.phase).toBe('approved_execution');
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
      expect(f.state.result.coreRequirements).toMatchObject({ fileIds: ['fil_original', 'fil_revision'] });
      expect(f.run.mock.calls[1]?.[0].verificationContext?.phase).toBe('revise');
      await f.reply('执行');
      await vi.waitFor(() => expect(f.save).toHaveBeenCalledTimes(3));
      expect(load).toHaveBeenLastCalledWith(['fil_original', 'fil_revision'], 42);
      expect(JSON.stringify(f.run.mock.calls[2]?.[0].verificationContext?.materials)).toContain(
        'synthetic attachment fil_original',
      );
      expect(JSON.stringify(f.run.mock.calls[2]?.[0].verificationContext?.materials)).toContain(
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
      expect(f.run.mock.calls[0]?.[0].verificationContext?.phase).toBe('draft');
      expect(f.save).toHaveBeenCalledWith(
        expect.objectContaining({
          question: f.plan,
          result: expect.objectContaining({ coreRequirements: expect.objectContaining({ phase: 'draft' }), planText: f.plan }),
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
      expect.objectContaining({ verificationContext: expect.objectContaining({ phase: 'revise', referencePlan: f.plan }) }),
    );
    expect(f.state.result.coreRequirements).toMatchObject({ phase: 'revise' });
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
    f.state.result.planInitialIntent = f.state.intent;
    expect(await f.reply('数据来自电商罗盘，修改方案第二步')).toMatchObject({
      ok: true,
      state: 'resumed',
    });
    await vi.waitFor(() => expect(f.save).toHaveBeenCalledTimes(1));
    expect(f.run).toHaveBeenCalledWith(expect.objectContaining({ verificationContext: expect.objectContaining({ phase: 'revise' }) }));
    expect(f.frames.some((frame) => frame.type === 'server.task.terminal')).toBe(false);
  });

  it.each([false, true])(
    'preserves revised plans across fresh callers and clears the gate only on approval, JSON=%s',
    async (jsonResult) => {
      const f = fixture({ jsonResult });
      const revised = '1. 只整理已提供的材料\n2. 不要添加截止时间';
      f.run.mockResolvedValueOnce({
        status: 'awaiting_user',
        generation: { completeness: 'complete', stopReason: 'awaiting_user' },
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
      expect(f.run.mock.calls[1]?.[0].verificationContext).toMatchObject({ phase: 'approved_execution', referencePlan: revised });
      expect(f.run.mock.calls[1]?.[0].intent).toContain('不要发送邮件');
      // Further execution clarification is not another plan-approval cycle.
      expect(f.state.result).not.toHaveProperty('planMode');
    },
  );

  it('keeps unreadable ordinary generate history read-only and allows a pure hold', async () => {
    const f = fixture({ legacy: true });
    await expect(f.reply('稍等')).resolves.toMatchObject({ ok: true, state: 'stillAwaiting' });
    await expect(f.reply('补充材料如下')).rejects.toThrow('旧任务缺少完整执行历史');
    expect(f.run).not.toHaveBeenCalled();
    expect(f.resume).not.toHaveBeenCalled();
    expect(f.state.result).not.toHaveProperty('planMode');
  });

  it('does not dispatch or publish if resume persistence is refused', async () => {
    const f = fixture({ persisted: false });
    vi.spyOn(CoreTaskRepository.prototype, 'admit').mockResolvedValueOnce({ persisted: false });
    expect(await f.reply('执行')).toMatchObject({ ok: false, state: 'persistFailed' });
    expect(f.run).not.toHaveBeenCalled();
    expect(f.frames).toEqual([]);
  });
});
