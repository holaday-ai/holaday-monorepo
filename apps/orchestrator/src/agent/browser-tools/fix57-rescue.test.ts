import { describe, expect, it, vi } from 'vitest';
import type { MessagesAdapter } from '../../llm/messages-adapter.js';
import {
  RESCUE_GIVE_UP_RE,
  RESCUE_STATUS,
  WRITE_INTENT_RE,
  runUnifiedBrowserLoop,
} from './unified-browser-loop.js';

/**
 * FIX-57 #5: a read task stopped by a login wall (or about to give up on a blocked page)
 * first tries other public routes — once, at most 2 more sites — and is handed over or
 * fails honestly after that. Never for forms, writes, logins or the person's own data.
 */
function scriptedLoop(calls: Array<{ name: string; input: Record<string, unknown> }>) {
  let turn = 0;
  const seen: string[] = [];
  const adapter: MessagesAdapter = {
    metadata: { provider: 'anthropic', model: 'fixture' },
    async create(request) {
      seen.push(JSON.stringify(request.messages.at(-1)));
      const call = calls[Math.min(turn++, calls.length - 1)]!;
      return {
        id: String(turn),
        metadata: { provider: 'anthropic', model: 'fixture' },
        content: [{ type: 'tool_use', id: String(turn), ...call }],
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
  return { adapter, seen };
}

const JD = '打开 https://item.jd.com/100142621606.html 读商品标题和页面显示的价格';
const WALL = { reason: 'login', message: '页面遇到登录墙，需要你接管登录；当前任务尚未完成。' };
const ROUTE = '换一条不需要登录的公开路线';

function run(
  intent: string,
  calls: Array<{ name: string; input: Record<string, unknown> }>,
  options: { rescue?: boolean; walled?: (url: string) => boolean; maxSteps?: number } = {},
) {
  const { adapter, seen } = scriptedLoop(calls);
  let url = 'about:blank';
  const opened: string[] = [];
  const onRescue = vi.fn();
  const walled = options.walled ?? ((u: string) => /passport\.jd\.com/.test(u));
  return runUnifiedBrowserLoop({
    intent,
    adapter,
    maxSteps: options.maxSteps ?? 12,
    rescue: options.rescue ?? true,
    onRescue,
    currentPageUrl: () => url,
    probeBlocker: async () => (walled(url) ? WALL : null),
    execute: (async (action: { tool: string; url?: string }) => {
      if (action.tool === 'navigate') {
        opened.push(action.url!);
        url = /item\.jd\.com/.test(action.url!)
          ? 'https://passport.jd.com/new/login.aspx?ReturnUrl=x'
          : action.url!;
        return { ok: true, text: '已打开', url };
      }
      return { ok: true, text: JSON.stringify({ tree: '- heading "页面" [level=1] [ref=e1]' }) };
    }) as never,
  } as never).then((outcome) => ({ outcome, seen: seen.join('\n'), opened, onRescue }));
}

describe('FIX-57 #5 · a login wall on a read task: another public route first', () => {
  it('the wall is not handed over at once: the model is told to route around it', async () => {
    const { outcome, seen, opened, onRescue } = await run(JD, [
      { name: 'navigate', input: { url: 'https://item.jd.com/100142621606.html' } },
      { name: 'navigate', input: { url: 'https://www.smzdm.com/search?q=100142621606' } },
      { name: 'finish', input: { status: 'failed', summary: '比价站也没有这款商品的价格' } },
    ]);
    expect(seen).toContain(ROUTE);
    expect(seen).toContain('不要登录');
    // The named site is jd.com; the rescue lets a public site outside it open.
    expect(opened).toContain('https://www.smzdm.com/search?q=100142621606');
    expect(onRescue).toHaveBeenCalledTimes(1);
    expect(onRescue).toHaveBeenCalledWith(RESCUE_STATUS.wall);
    expect(outcome.status).toBe('failed');
  });

  it('a wall met again on another page after the rescue is handed to the user', async () => {
    const { outcome } = await run(
      JD,
      [
        { name: 'navigate', input: { url: 'https://item.jd.com/100142621606.html' } },
        { name: 'navigate', input: { url: 'https://search.jd.com/Search?keyword=100142621606' } },
        { name: 'finish', input: { status: 'completed', summary: '价格 ¥99' } },
      ],
      { walled: (u) => /passport\.jd\.com|search\.jd\.com/.test(u) },
    );
    expect(outcome).toMatchObject({ status: 'awaiting_user', reason: 'login' });
  });

  it('staying on the walled page (snapshot) is a reminder, not the handover', async () => {
    const { outcome, seen } = await run(JD, [
      { name: 'navigate', input: { url: 'https://item.jd.com/100142621606.html' } },
      { name: 'snapshot', input: {} },
      { name: 'finish', input: { status: 'failed', summary: '没有拿到价格，卡在登录页' } },
    ]);
    expect(seen).toContain('仍是被挡住的页面');
    expect(outcome.status).toBe('failed');
  });

  it('at most 2 sites outside the named one', async () => {
    const { seen, opened } = await run(JD, [
      { name: 'navigate', input: { url: 'https://item.jd.com/100142621606.html' } },
      { name: 'navigate', input: { url: 'https://cn.bing.com/search?q=100142621606' } },
      { name: 'navigate', input: { url: 'https://www.smzdm.com/' } },
      { name: 'navigate', input: { url: 'https://www.manmanbuy.com/' } },
      { name: 'navigate', input: { url: 'https://www.example-third.com/' } },
      { name: 'finish', input: { status: 'failed', summary: '公开来源都没有价格' } },
    ]);
    // The search page found the routes; it is not one of the two.
    expect(opened).toContain('https://cn.bing.com/search?q=100142621606');
    expect(opened).toContain('https://www.manmanbuy.com/');
    expect(opened).not.toContain('https://www.example-third.com/');
    expect(seen).toContain('不要换到 example-third.com');
  });

  it('the model asking for a login handover is routed around first, once', async () => {
    const { outcome, seen } = await run(JD, [
      { name: 'navigate', input: { url: 'https://item.jd.com/100142621606.html' } },
      { name: 'request_human', input: { reason: 'login', message: '需要登录' } },
      { name: 'request_human', input: { reason: 'login', message: '还是需要登录' } },
    ]);
    expect(seen).toContain(ROUTE);
    expect(outcome).toMatchObject({ status: 'awaiting_user', reason: 'login' });
  });
});

describe('FIX-57 #5 · giving up on a blocked page: one more route first', () => {
  it('a failed answer about a risk page gets one rescue turn, then fails as before', async () => {
    const { outcome, seen, onRescue } = await run(
      JD,
      [
        { name: 'navigate', input: { url: 'https://www.jd.com/' } },
        {
          name: 'finish',
          input: { status: 'failed', summary: '被京东风控拦截，页面显示暂时无法展示该商品的信息' },
        },
        {
          name: 'finish',
          input: { status: 'failed', summary: '换了公开来源仍被拦截，没有拿到标题和价格' },
        },
      ],
      { walled: () => false },
    );
    expect(seen).toContain('先别结束');
    expect(onRescue).toHaveBeenCalledWith(RESCUE_STATUS.stuck);
    expect(outcome).toMatchObject({ status: 'failed' });
    expect(outcome.status === 'failed' && outcome.reason).toContain('换了公开来源');
  });

  it('a failed answer that is not about a blocked page is not sent back', async () => {
    const { seen, outcome } = await run(
      JD,
      [
        { name: 'navigate', input: { url: 'https://www.jd.com/' } },
        { name: 'finish', input: { status: 'failed', summary: '用户要的型号并不存在' } },
      ],
      { walled: () => false },
    );
    expect(seen).not.toContain(ROUTE);
    expect(outcome.status).toBe('failed');
  });

  it('no rescue near the step limit', async () => {
    const { seen } = await run(
      JD,
      [
        { name: 'navigate', input: { url: 'https://item.jd.com/100142621606.html' } },
        { name: 'finish', input: { status: 'failed', summary: '登录页挡住了' } },
      ],
      { maxSteps: 4 },
    );
    expect(seen).not.toContain(ROUTE);
  });
});

describe('FIX-57 #5 · never routed around', () => {
  it.each([
    ['rescue off', JD, false],
    ['a write task', '打开 https://item.jd.com/1.html 把商品加入购物车', true],
    ['a login task', '打开 https://item.jd.com/1.html 帮我登录京东看价格', true],
    ['own account data', '打开 https://order.jd.com/center/list.action 查我的订单', true],
  ])('%s: the wall is handed over at once', async (_label, intent, rescue) => {
    const { outcome, seen, onRescue } = await run(
      intent as string,
      [
        { name: 'navigate', input: { url: 'https://item.jd.com/100142621606.html' } },
        { name: 'finish', input: { status: 'failed', summary: '登录页' } },
      ],
      { rescue: rescue as boolean, walled: (u) => /passport|order\.jd/.test(u) },
    );
    expect(seen).not.toContain(ROUTE);
    expect(onRescue).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({ status: 'awaiting_user', reason: 'login' });
  });

  it('the intent words', () => {
    expect(WRITE_INTENT_RE.test('读商品标题和价格')).toBe(false);
    expect(WRITE_INTENT_RE.test('在 bestbuy.com 搜 usb c cable 列出前 3 个价格')).toBe(false);
    for (const w of [
      '提交表单',
      '下单',
      '发布一条',
      '登录后',
      '我的订单',
      'add to cart',
      'sign in',
    ])
      expect(WRITE_INTENT_RE.test(w)).toBe(true);
    expect(RESCUE_GIVE_UP_RE.test('页面被拦截')).toBe(true);
    expect(RESCUE_GIVE_UP_RE.test('Instagram 返回 HTTP 429（请求过多），未能加载账号主页')).toBe(
      true,
    );
    expect(RESCUE_GIVE_UP_RE.test('型号不存在')).toBe(false);
  });
});
