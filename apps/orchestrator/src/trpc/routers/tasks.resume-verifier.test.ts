import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as generation from '../../agent/generate-runner.js';
import { TaskRepository } from '../../agent/task-repository.js';
import { env } from '../../config/env.js';
import { _resetLedgerRegistryForTest } from '../../execution/evidence-ledger.js';
import * as pipeline from '../../execution/execution-pipeline.js';
import {
  reloadFeatureFlagsForTest,
  setFeatureFlagsForTest,
} from '../../execution/feature-flags.js';
import * as websocket from '../../ws/server.js';
import type { Context } from '../context.js';
import { tasksRouter } from './tasks.js';

const originalEnv = { ...env };
beforeEach(() => {
  pipeline._resetExecutionPipelineForTest();
  _resetLedgerRegistryForTest();
  setFeatureFlagsForTest({
    EVIDENCE_LEDGER: true,
    EXECUTION_CONTRACT: true,
    EXECUTION_VERIFIER: true,
  });
});
afterEach(() => {
  Object.assign(env, originalEnv);
  reloadFeatureFlagsForTest();
  pipeline._resetExecutionPipelineForTest();
  _resetLedgerRegistryForTest();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const taskId = 'tsk_resume_semantic_fixture';
const summary =
  '材料梳理：先确认已有条款的适用范围，再区分已知事实与待确认事项。当前内容仅按用户给出的文字重新组织，不增加外部数据，也不代替专业判断。待确认事项：检查材料是否完整，逐项核对相关表述和附件。后续步骤：由用户核对提纲，再决定是否补充其他材料。'.repeat(
    3,
  );

function fixture(
  options: {
    region?: 'cn' | 'intl' | null;
    actor?: string;
    lanes?: string;
    missingRegionKey?: boolean;
    response?: string;
    transportFailure?: boolean;
    transportTimeout?: boolean;
    runnerStatus?: 'completed' | 'failed' | 'awaiting_user';
    answer?: string;
    persisted?: boolean;
    resumed?: boolean;
  } = {},
) {
  const region = options.region === undefined ? 'cn' : options.region;
  Object.assign(env, {
    MODEL_RUNTIME_POLICY: 'qwen_only',
    ANTHROPIC_API_KEY: '',
    OPENAI_API_KEY: '',
    QWEN_CORE_ROLLOUT_MODE: 'synthetic',
    QWEN_CORE_ALLOWLIST: 'usr_resume_fixture',
    QWEN_CORE_ENABLED_LANES: options.lanes ?? 'generate,verifier',
    QWEN_RESPONSES_ADAPTER_ENABLED: true,
    QWEN_MESSAGES_ADAPTER_ENABLED: true,
    DASHSCOPE_CN_API_KEY: options.missingRegionKey && region === 'cn' ? '' : 'synthetic-cn',
    DASHSCOPE_INTL_API_KEY: options.missingRegionKey && region === 'intl' ? '' : 'synthetic-intl',
  });
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)) });
    if (options.transportTimeout)
      return new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new Error('PRIVATE_TIMEOUT_DETAIL')), {
          once: true,
        });
      });
    if (options.transportFailure) throw new Error('PRIVATE_PROVIDER_BODY');
    return new Response(
      JSON.stringify({
        id: 'msg_synthetic',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: options.response ?? '{"status":"pass","issues":[]}' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 20, output_tokens: 15 },
      }),
      { status: 200 },
    );
  });
  const logger = {
    child: () => logger,
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
  const db = {
    select(projection: Record<string, unknown>) {
      const rows =
        'intent' in projection
          ? [
              {
                intent: '整理这些合同材料的文字提纲，仅重组已有内容，不作专业判断。',
                status: 'awaiting_user',
                result: { executionMode: 'generate', expertMode: 'expert' },
                opusUsed: false,
                roleId: null,
              },
            ]
          : [{ id: 42, modelDataRegion: region }];
      return { from: () => ({ where: () => ({ limit: async () => rows }) }) };
    },
  };
  const frames: Array<{ type: string; [key: string]: unknown }> = [];
  vi.spyOn(websocket, 'broadcastToUser').mockImplementation((_actor, frame) => {
    frames.push(frame);
    return 1;
  });
  vi.spyOn(TaskRepository.prototype, 'markAwaitingReplyResumed').mockResolvedValue({
    persisted: options.resumed !== false,
  });
  const saved: Array<Parameters<TaskRepository['persistVisionOutcome']>[1]> = [];
  vi.spyOn(TaskRepository.prototype, 'persistVisionOutcome').mockImplementation(
    async (_id, outcome) => {
      saved.push(outcome);
      return { persisted: options.persisted !== false };
    },
  );
  const awaiting = vi
    .spyOn(TaskRepository.prototype, 'persistAwaitingUser')
    .mockResolvedValue({ persisted: true });
  const runner = vi.spyOn(generation, 'runGenerateTask').mockResolvedValue({
    status: options.runnerStatus ?? 'completed',
    summary: options.answer ?? summary,
    reason: '合成服务不可用',
    inputTokens: 10,
    outputTokens: 50,
    durationMs: 1,
  });
  const persistedVerification: Array<pipeline.VerifyOutput['verification']> = [];
  vi.spyOn(pipeline, 'persistExecution').mockImplementation(async (input) => {
    persistedVerification.push(input.verification);
    return false;
  });
  const ctx = {
    db,
    logger,
    userId: options.actor ?? 'usr_resume_fixture',
    taskOrigin: 'workbench',
    planner: {},
    playwrightExecutor: null,
    executionRouter: null,
    browserPool: null,
    taskQueue: null,
    firecrawl: null,
    paypalAdapter: null,
    downloadManager: null,
    req: {},
    res: {},
  } as unknown as Context;
  return {
    calls,
    saved,
    awaiting,
    runner,
    frames,
    logger,
    persistedVerification,
    start: () =>
      tasksRouter
        .createCaller(ctx)
        .reply({ taskId, message: '请按材料梳理、待确认事项、后续步骤分段。' }),
  };
}

describe('clarification resume semantic verification', () => {
  it.each(['cn', 'intl'] as const)(
    'runs the %s Qwen verifier and persists a real semantic pass',
    async (region) => {
      const f = fixture({ region });
      await f.start();
      await vi.waitFor(() => expect(f.persistedVerification).toHaveLength(1));
      expect(f.persistedVerification[0]).toMatchObject({ passed: true, semanticStatus: 'pass' });
      expect(f.calls).toHaveLength(1);
      expect(f.calls[0]?.url).toBe(
        region === 'cn'
          ? 'https://dashscope.aliyuncs.com/apps/anthropic/v1/messages'
          : 'https://dashscope-intl.aliyuncs.com/apps/anthropic/v1/messages',
      );
      expect(f.calls[0]?.body.model).toBe(env.QWEN_VERIFY_STRICT_MODEL);
      expect(f.saved[0]).toMatchObject({ status: 'completed', summary });
      expect(f.frames).toContainEqual(
        expect.objectContaining({ type: 'server.task.terminal', status: 'completed' }),
      );
    },
  );

  it('does not publish a fully completed task when semantic review rejects the answer', async () => {
    const f = fixture({
      response:
        '{"status":"reject","issues":[{"code":"UNSUPPORTED_CONCLUSION","fixable":false,"summary":"PRIVATE_MODEL_TEXT"}]}',
    });
    await f.start();
    await vi.waitFor(() => expect(f.persistedVerification).toHaveLength(1));
    expect(f.persistedVerification[0]).toMatchObject({ passed: false, semanticStatus: 'reject' });
    // Existing terminal policy treats needs_clarification as failed.
    expect(f.saved[0]).toMatchObject({ status: 'failed' });
    expect(f.frames).not.toContainEqual(
      expect.objectContaining({ type: 'server.task.terminal', status: 'completed' }),
    );
    expect(
      JSON.stringify({ saved: f.saved, frames: f.frames, logs: f.logger.error.mock.calls }),
    ).not.toContain('PRIVATE_MODEL_TEXT');
  });

  it.each([
    { transportFailure: true },
    { response: 'PRIVATE_INVALID_JSON' },
    { lanes: 'generate' },
  ])(
    'surfaces explicit semantic unavailability without failing a deterministic pass',
    async (options) => {
      const f = fixture(options);
      await f.start();
      await vi.waitFor(() => expect(f.persistedVerification).toHaveLength(1));
      expect(f.persistedVerification[0]).toMatchObject({
        passed: true,
        semanticStatus: 'unavailable',
      });
      expect(f.saved[0]).toMatchObject({
        status: 'completed',
        summary: expect.stringContaining('语义复核暂不可用'),
      });
      expect(f.calls).toHaveLength('lanes' in options ? 0 : 1);
      expect(
        JSON.stringify({ saved: f.saved, frames: f.frames, logs: f.logger.error.mock.calls }),
      ).not.toMatch(/PRIVATE_PROVIDER_BODY|PRIVATE_INVALID_JSON/);
    },
  );

  it('bounds semantic timeout and still persists an explicit unavailable terminal result', async () => {
    vi.useFakeTimers();
    const f = fixture({ transportTimeout: true });
    await f.start();
    await vi.advanceTimersByTimeAsync(1);
    expect(f.calls).toHaveLength(1);
    expect(f.saved).toEqual([]);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(f.persistedVerification[0]).toMatchObject({
      passed: true,
      semanticStatus: 'unavailable',
    });
    expect(f.saved[0]).toMatchObject({
      status: 'completed',
      summary: expect.stringContaining('语义复核暂不可用'),
    });
    expect(f.calls).toHaveLength(1);
    expect(JSON.stringify(f.saved)).not.toContain('PRIVATE_TIMEOUT_DETAIL');
  });

  it.each([
    { region: null },
    { actor: 'usr_outside_canary' },
    { region: 'cn' as const, missingRegionKey: true },
    { region: 'intl' as const, missingRegionKey: true },
  ])('does not invoke either model when actor or region is unavailable', async (options) => {
    const f = fixture(options);
    await f.start();
    await vi.waitFor(() => expect(f.persistedVerification).toHaveLength(1));
    expect(f.calls).toEqual([]);
    expect(f.runner).not.toHaveBeenCalled();
    expect(f.saved[0]).toMatchObject({ status: 'failed' });
    expect(f.frames).toContainEqual(
      expect.objectContaining({ type: 'server.task.terminal', status: 'failed' }),
    );
    expect(f.persistedVerification).toEqual([null]);
  });

  it('never asks semantic review to turn a deterministic failure into a pass', async () => {
    const f = fixture({ answer: `行业平均转化率达到80%，所有公司必须直接采用。${summary}` });
    await f.start();
    await vi.waitFor(() => expect(f.persistedVerification).toHaveLength(1));
    expect(f.persistedVerification[0]).toMatchObject({ passed: false });
    expect(f.saved[0]).toMatchObject({ status: 'failed' });
    expect(f.calls).toEqual([]);
  });

  it.each(['failed', 'awaiting_user'] as const)(
    'does not review a %s runner result',
    async (runnerStatus) => {
      const f = fixture({ runnerStatus });
      await f.start();
      await vi.waitFor(() => expect(f.persistedVerification).toHaveLength(1));
      expect(f.calls).toEqual([]);
      expect(f.persistedVerification).toEqual([null]);
      if (runnerStatus === 'awaiting_user') expect(f.awaiting).toHaveBeenCalledTimes(1);
      else expect(f.saved[0]).toMatchObject({ status: 'failed' });
    },
  );

  it('does not publish a completed frame if the terminal write is refused', async () => {
    const f = fixture({ persisted: false });
    await f.start();
    await vi.waitFor(() => expect(f.persistedVerification).toHaveLength(1));
    expect(f.persistedVerification[0]).toMatchObject({ semanticStatus: 'pass' });
    expect(f.frames.some((frame) => frame.type === 'server.task.terminal')).toBe(false);
  });

  it('does not start paid work when the resume state transition is refused', async () => {
    const f = fixture({ resumed: false });
    expect(await f.start()).toEqual({ ok: false, state: 'persistFailed' });
    expect(f.calls).toEqual([]);
    expect(f.runner).not.toHaveBeenCalled();
    expect(f.saved).toEqual([]);
  });
});
