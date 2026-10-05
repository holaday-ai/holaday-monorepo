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

const { hasParkedSupercarHandle, runSupercarTask, supercarReply } = await import(
  '../supercar/qwen-only-agent-loop.js'
);

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
