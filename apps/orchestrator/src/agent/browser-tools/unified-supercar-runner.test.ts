import { type Browser, chromium } from 'playwright';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { env } from '../../config/env.js';
import type {
  MessagesAdapter,
  NeutralMessagesRequest,
  NeutralOutputContentBlock,
} from '../../llm/messages-adapter.js';

const legacy = vi.hoisted(() => ({
  run: vi.fn(async () => ({
    status: 'completed' as const,
    summary: 'legacy',
    iterations: 1,
    toolsUsed: [],
  })),
}));
vi.mock('../supercar/agent-loop.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../supercar/agent-loop.js')>()),
  runSupercarTask: legacy.run,
}));

const { hasParkedSupercarHandle, runSupercarTask, supercarAbort, supercarReply } = await import(
  '../supercar/qwen-only-agent-loop.js'
);
const { classifyRuntimeAction } = await import('../supercar/runtime-action-policy.js');

const PAGE = `<!doctype html><title>合成商城</title><label>关键词 <input /></label>
<button onclick="document.getElementById('r').textContent='结果：'+document.querySelector('input').value">搜索</button><p id="r"></p>`;

function scripted(
  turns: Array<(request: NeutralMessagesRequest) => NeutralOutputContentBlock[]>,
): MessagesAdapter {
  let index = 0;
  return {
    metadata: { provider: 'anthropic', model: 'scripted' },
    async create(request) {
      const turn = turns[index++];
      if (!turn) throw new Error('script exhausted');
      return {
        id: `r${index}`,
        metadata: this.metadata,
        content: turn(request),
        stopReason: 'tool_use',
        usage: {
          inputTokens: 1,
          outputTokens: 1,
          cacheReadInputTokens: null,
          cacheCreationInputTokens: null,
          complete: true,
        },
      };
    },
  };
}
const call = (name: string, input: unknown, id = name): NeutralOutputContentBlock => ({
  type: 'tool_use',
  id,
  name,
  input,
});
const refIn = (request: NeutralMessagesRequest, pattern: RegExp) => {
  const text = JSON.stringify(request.messages.at(-1));
  const line = text.split('\\n').find((candidate) => pattern.test(candidate));
  const ref = line?.match(/\[ref=(e\d+)\]/)?.[1];
  if (!ref) throw new Error(`no ref for ${pattern}`);
  return ref;
};

describe('BROWSER_EXECUTOR switch at the supercar entry', () => {
  let browser: Browser;
  const original = env.BROWSER_EXECUTOR;
  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
  }, 60_000);
  afterAll(async () => {
    await browser?.close();
  });
  afterEach(() => {
    Object.assign(env, { BROWSER_EXECUTOR: original });
    legacy.run.mockClear();
  });

  it('defaults to unified; BROWSER_EXECUTOR=legacy rolls back to the coordinate loop', async () => {
    expect(original).toBe('unified');
    Object.assign(env, { BROWSER_EXECUTOR: 'legacy' });
    const outcome = await runSupercarTask({
      taskId: 't_legacy',
      intent: 'x',
      executor: {} as never,
      messagesAdapter: scripted([]),
    });
    expect(outcome.summary).toBe('legacy');
    expect(legacy.run).toHaveBeenCalledTimes(1);
  });

  it('runs the unified tools with the shared tick, capture and evidence hooks', async () => {
    Object.assign(env, { BROWSER_EXECUTOR: 'unified' });
    const page = await browser.newPage();
    await page.setContent(PAGE);
    const onTick = vi.fn();
    const onAction = vi.fn();
    const onEvidence = vi.fn();
    const outcome = await runSupercarTask({
      taskId: 't_unified',
      intent: '搜索收纳盒',
      executor: { getPage: async () => page } as never,
      messagesAdapter: scripted([
        () => [call('snapshot', {})],
        (request) => [call('type', { ref: refIn(request, /textbox/), text: '收纳盒' })],
        () => [call('snapshot', {}, 's2')],
        (request) => [call('click', { ref: refIn(request, /button/) })],
        () => [
          call('finish', { status: 'completed', summary: '已搜索', evidence: '结果：收纳盒' }),
        ],
      ]),
      onTick,
      onAction,
      onEvidence,
    });
    await page.close();
    expect(legacy.run).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({ status: 'completed', summary: '已搜索' });
    expect(onTick.mock.calls.map((c) => c[0].execution.actionKind)).toEqual([
      'snapshot',
      'type',
      'snapshot',
      'click',
    ]);
    expect(onAction.mock.calls.map((c) => c[0].stepType)).toEqual(['type', 'click']);
    expect(onAction.mock.calls[0]?.[0]).toMatchObject({ inputValue: '收纳盒' });
    expect(onEvidence).toHaveBeenCalledWith(
      expect.objectContaining({ fact: '结果：收纳盒', confidence: 'observed' }),
    );
  }, 60_000);

  it('parks on a human handoff and resumes through supercarReply', async () => {
    Object.assign(env, { BROWSER_EXECUTOR: 'unified' });
    const page = await browser.newPage();
    await page.setContent(PAGE);
    const onAwaitingUser = vi.fn();
    const running = runSupercarTask({
      taskId: 't_handoff',
      intent: '查订单',
      executor: { getPage: async () => page } as never,
      messagesAdapter: scripted([
        () => [call('request_human', { reason: 'login', message: '请先登录' })],
        (request) => {
          expect(JSON.stringify(request.messages.at(-1))).toContain('用户已完成接管');
          return [call('finish', { status: 'failed', summary: '登录后仍无订单' })];
        },
      ]),
      onAwaitingUser,
    });
    await vi.waitFor(() => expect(hasParkedSupercarHandle('t_handoff')).toBe(true));
    expect(onAwaitingUser).toHaveBeenCalledWith(
      expect.objectContaining({ awaitingKind: 'login', question: '请先登录' }),
    );
    expect(supercarReply('t_handoff', '登录好了')).toBe(true);
    expect(await running).toMatchObject({ status: 'failed', reason: '登录后仍无订单' });
    expect(hasParkedSupercarHandle('t_handoff')).toBe(false);
    await page.close();
  }, 60_000);
});

describe('unified runtime safety gate (legacy LIVE-VETO parity)', () => {
  let browser: Browser;
  const original = env.BROWSER_EXECUTOR;
  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
    Object.assign(env, { BROWSER_EXECUTOR: 'unified' });
  }, 60_000);
  afterAll(async () => {
    Object.assign(env, { BROWSER_EXECUTOR: original });
    await browser?.close();
  });

  const ORDER = `<!doctype html><title>确认订单</title>
    <p id="state">待提交</p>
    <button onclick="document.getElementById('state').textContent='已下单'">提交订单</button>
    <button onclick="document.getElementById('state').textContent='已搜索'">搜索</button>
    <form onsubmit="event.preventDefault();document.getElementById('state').textContent='已发送'">
      <label>留言 <input name="msg" /></label><button type="submit">发送消息</button>
    </form>
    <label>登录密码 <input id="pw" type="password" /></label>`;

  async function start(
    taskId: string,
    turns: Parameters<typeof scripted>[0],
    onBeforeAction: NonNullable<Parameters<typeof runSupercarTask>[0]['onBeforeAction']>,
  ) {
    const page = await browser.newPage();
    await page.setContent(ORDER);
    const onAwaitingUser = vi.fn();
    const running = runSupercarTask({
      taskId,
      intent: '处理订单',
      executor: { getPage: async () => page } as never,
      messagesAdapter: scripted(turns),
      onAwaitingUser,
      onBeforeAction,
    });
    return { page, running, onAwaitingUser, state: () => page.textContent('#state') };
  }

  it('parks an irreversible click until the user confirms, then runs it', async () => {
    const policy = vi.fn(classifyRuntimeAction);
    const { page, running, onAwaitingUser, state } = await start(
      't_gate_confirm',
      [
        () => [call('snapshot', {})],
        (request) => [call('click', { ref: refIn(request, /button \\"提交订单\\"/) })],
        () => [call('finish', { status: 'completed', summary: '已下单', evidence: '已下单' })],
      ],
      policy,
    );
    await vi.waitFor(() => expect(hasParkedSupercarHandle('t_gate_confirm')).toBe(true));
    expect(onAwaitingUser).toHaveBeenCalledWith(
      expect.objectContaining({
        awaitingKind: 'browser_action',
        question: expect.stringContaining('提交订单'),
      }),
    );
    // Not executed while waiting for the user.
    expect(await state()).toBe('待提交');
    expect(policy).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'click', label: '提交订单', tagName: 'button' }),
    );
    expect(supercarReply('t_gate_confirm', '确认执行')).toBe(true);
    expect(await running).toMatchObject({ status: 'completed' });
    expect(await state()).toBe('已下单');
    await page.close();
  }, 60_000);

  it('stops the task without running the action when the user does not confirm', async () => {
    const { page, running, state } = await start(
      't_gate_decline',
      [
        () => [call('snapshot', {})],
        (request) => [call('click', { ref: refIn(request, /button \\"提交订单\\"/) })],
      ],
      classifyRuntimeAction,
    );
    await vi.waitFor(() => expect(hasParkedSupercarHandle('t_gate_decline')).toBe(true));
    expect(supercarReply('t_gate_decline', '不要下单')).toBe(true);
    expect(await running).toMatchObject({
      status: 'cancelled',
      reason: '用户未确认不可逆操作，本次任务已停止，页面进度已保留。',
    });
    expect(await state()).toBe('待提交');
    await page.close();
  }, 60_000);

  it('hands password fields to the user and never replays the pending input', async () => {
    const { page, running, onAwaitingUser } = await start(
      't_gate_password',
      [
        () => [call('snapshot', {})],
        (request) => [
          call('type', { ref: refIn(request, /textbox \\"登录密码\\"/), text: 'hunter2' }),
        ],
        (request) => {
          expect(JSON.stringify(request.messages.at(-1))).toContain('刚才的操作没有由 Agent 执行');
          return [call('finish', { status: 'failed', summary: '等待用户登录后再试' })];
        },
      ],
      classifyRuntimeAction,
    );
    await vi.waitFor(() => expect(hasParkedSupercarHandle('t_gate_password')).toBe(true));
    expect(onAwaitingUser).toHaveBeenCalledWith(expect.objectContaining({ awaitingKind: 'login' }));
    expect(supercarReply('t_gate_password', '已登录')).toBe(true);
    expect(await running).toMatchObject({ status: 'failed' });
    expect(await page.inputValue('#pw')).toBe('');
    await page.close();
  }, 60_000);

  it('judges Enter-to-submit by the form submit control', async () => {
    const { page, running, state } = await start(
      't_gate_submit',
      [
        () => [call('snapshot', {})],
        (request) => [
          call('type', { ref: refIn(request, /textbox \\"留言\\"/), text: '你好', submit: true }),
        ],
      ],
      classifyRuntimeAction,
    );
    await vi.waitFor(() => expect(hasParkedSupercarHandle('t_gate_submit')).toBe(true));
    expect(await state()).toBe('待提交');
    expect(supercarReply('t_gate_submit', '取消')).toBe(true);
    expect(await running).toMatchObject({ status: 'cancelled' });
    expect(await state()).toBe('待提交');
    await page.close();
  }, 60_000);

  it('lets ordinary actions through and never gates read-only tools', async () => {
    const policy = vi.fn(classifyRuntimeAction);
    const { page, running, onAwaitingUser, state } = await start(
      't_gate_ordinary',
      [
        () => [call('snapshot', {})],
        (request) => [call('click', { ref: refIn(request, /button \\"搜索\\"/) })],
        () => [call('extract', { instruction: '状态' })],
        () => [call('finish', { status: 'completed', summary: '已搜索', evidence: '已搜索' })],
      ],
      policy,
    );
    expect(await running).toMatchObject({ status: 'completed' });
    expect(await state()).toBe('已搜索');
    expect(onAwaitingUser).not.toHaveBeenCalled();
    // The click before it ran, then its landed page; snapshot/extract never.
    expect(policy.mock.calls.map(([action]) => action.kind)).toEqual(['click', 'navigate']);
    await page.close();
  }, 60_000);

  it('cancels a task cancelled while it waits for confirmation', async () => {
    const { page, running, state } = await start(
      't_gate_abort',
      [
        () => [call('snapshot', {})],
        (request) => [call('click', { ref: refIn(request, /button \\"提交订单\\"/) })],
      ],
      classifyRuntimeAction,
    );
    await vi.waitFor(() => expect(hasParkedSupercarHandle('t_gate_abort')).toBe(true));
    expect(supercarAbort('t_gate_abort')).toBe(true);
    expect(await running).toMatchObject({ status: 'cancelled' });
    expect(await state()).toBe('待提交');
    await page.close();
  }, 60_000);

  it('applies the runtime policy even when the caller passes no onBeforeAction', async () => {
    const page = await browser.newPage();
    await page.setContent(ORDER);
    const onAwaitingUser = vi.fn();
    const running = runSupercarTask({
      taskId: 't_gate_default',
      intent: '处理订单',
      executor: { getPage: async () => page } as never,
      messagesAdapter: scripted([
        () => [call('snapshot', {})],
        (request) => [call('click', { ref: refIn(request, /button \\"提交订单\\"/) })],
      ]),
      onAwaitingUser,
    });
    await vi.waitFor(() => expect(hasParkedSupercarHandle('t_gate_default')).toBe(true));
    expect(onAwaitingUser).toHaveBeenCalledWith(
      expect.objectContaining({ awaitingKind: 'browser_action' }),
    );
    expect(await page.textContent('#state')).toBe('待提交');
    expect(supercarAbort('t_gate_default')).toBe(true);
    expect(await running).toMatchObject({ status: 'cancelled' });
    expect(await page.textContent('#state')).toBe('待提交');
    await page.close();
  }, 60_000);

  it('fails the task when the policy refuses outright', async () => {
    const { page, running, state } = await start(
      't_gate_refuse',
      [
        () => [call('snapshot', {})],
        (request) => [call('click', { ref: refIn(request, /button \\"搜索\\"/) })],
      ],
      () => ({ allowed: false, reason: '探索模式禁止点击' }),
    );
    expect(await running).toMatchObject({ status: 'failed', reason: '探索模式禁止点击' });
    expect(await state()).toBe('待提交');
    await page.close();
  }, 60_000);
});
