import { describe, expect, it, vi } from 'vitest';
import type { MessagesAdapter } from '../../llm/messages-adapter.js';
import { LOGIN_POPUP_NOTICE } from './full-page-read.js';
import type { UnifiedToolResult } from './playwright-unified-executor.js';
import { runUnifiedBrowserLoop } from './unified-browser-loop.js';

vi.mock('./browser-replay-service.js', () => ({ browserReplayStore: {} }));

/**
 * GOAL2 H2 — G7 A/B b-m01 B: 高德 put its login prompt back after every click; the run kept
 * clicking and typing until its 53-step limit (VISION_GAVE_UP). Three tries on the page with the
 * same prompt back: finish with what was read; one more action and the page is the user's.
 */
function scripted(calls: Array<{ name: string; input: Record<string, unknown> }>) {
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

const PROMPT = LOGIN_POPUP_NOTICE;
const tree = [
  '- textbox "起点" [ref=e3]',
  '- textbox "终点" [ref=e4]',
  '- button "搜索" [ref=e5]',
].join('\n');

function run(
  calls: Array<{ name: string; input: Record<string, unknown> }>,
  wall: (url: string) => boolean = () => true,
) {
  let url = 'about:blank';
  const execute = async (action: { tool: string; url?: string }): Promise<UnifiedToolResult> => {
    if (action.tool === 'navigate') url = action.url!;
    return action.tool === 'snapshot'
      ? ({ ok: true, text: JSON.stringify({ tree, sourceURL: url }), url } as UnifiedToolResult)
      : ({ ok: true, text: '已执行', url } as UnifiedToolResult);
  };
  const { adapter, seen } = scripted(calls);
  return runUnifiedBrowserLoop({
    intent: '请使用云端浏览器，高德地图查一下杭州东站到西湖断桥怎么走，大概多久',
    adapter,
    maxSteps: 30,
    execute: execute as never,
    currentPageUrl: () => url,
    probeBlocker: async () =>
      wall(url) ? { reason: 'login', message: PROMPT, disposition: 'continue' as const } : null,
  }).then((outcome) => ({ outcome, seen: seen.join('\n') }));
}

const open = [
  { name: 'navigate', input: { url: 'https://www.amap.com/' } },
  { name: 'snapshot', input: {} },
];
const click = { name: 'click', input: { ref: 'e5' } };

describe('H2 · the same login prompt after three tries ends the run, not 53 steps', () => {
  it('a fourth action after the note hands the page over (awaiting_user, login)', async () => {
    const { outcome, seen } = await run([...open, click, click, click, click, click]);
    expect(seen).toContain('同一个登录提示已经第 3 次挡在页面上');
    expect(outcome).toMatchObject({ status: 'awaiting_user', reason: 'login' });
    expect(outcome.status === 'awaiting_user' && outcome.message).toContain(
      '高德地图反复弹出登录提示',
    );
    expect(outcome.steps).toBeLessThan(8);
  });

  it('a 部分完成 finish after the note is delivered', async () => {
    const { outcome } = await run([
      ...open,
      click,
      click,
      click,
      {
        name: 'finish',
        input: {
          status: 'completed',
          summary: '部分完成：高德地图要求登录才能查路线，没有查到杭州东站到西湖断桥的路线和用时。',
        },
      },
    ]);
    expect(outcome.status).not.toBe('failed');
    expect(outcome.steps).toBeLessThan(8);
  });

  it('reads and scrolls are not tries; a prompt that goes away does not count', async () => {
    const reads = [
      ...open,
      { name: 'scroll', input: { direction: 'down' } },
      { name: 'snapshot', input: {} },
    ];
    const done = { name: 'finish', input: { status: 'failed', summary: '没有查到路线。' } };
    const { seen } = await run([...reads, ...reads, ...reads, click, click, done]);
    expect(seen).not.toContain('同一个登录提示已经');
    let shown = 0;
    const gone = await run([...open, click, click, click, click, done], () => ++shown % 2 === 0);
    expect(gone.seen).not.toContain('同一个登录提示已经');
  });

  it('复审 #2-1: a page that moves on, a new read, or a comment box notice starts no count', async () => {
    const done = { name: 'finish', input: { status: 'failed', summary: '没有查到。' } };
    // Search, open a result, open another: the address changes every click.
    let n = 0;
    const moving = await run(
      [
        ...open,
        { name: 'click', input: { ref: 'e5' } },
        { name: 'navigate', input: { url: 'https://www.amap.com/search?q=1' } },
        { name: 'click', input: { ref: 'e5' } },
        { name: 'navigate', input: { url: 'https://www.amap.com/place/2' } },
        { name: 'click', input: { ref: 'e5' } },
        done,
      ],
      () => ++n > 0,
    );
    expect(moving.seen).not.toContain('同一个登录提示已经');
  });

  it('复审 #2-2: when it triggers, the rest of that turn waits — the finish comes next', async () => {
    const { outcome, seen } = await run([
      ...open,
      click,
      click,
      click,
      {
        name: 'finish',
        input: {
          status: 'completed',
          summary: '部分完成：高德地图要求登录才能查路线，路线和用时没有查到。',
        },
      },
    ]);
    expect(seen).toContain('同一个登录提示已经第 3 次');
    expect(outcome.status).toBe('completed');
  });

  it('复审 #3-1: closing the popup, then trying again, over and over, still ends', async () => {
    const close = { name: 'click', input: { ref: 'e3' } };
    let n = 0;
    const { seen, outcome } = await run(
      [...open, close, click, close, click, close, click, close, click, close, click],
      () => ++n % 2 === 0,
    );
    expect(seen).toContain('同一个登录提示已经第 3 次');
    expect(outcome.steps).toBeLessThan(16);
  });

  it('复审 #3-2: several tries in one turn are one try; a new read starts again', async () => {
    const done = { name: 'finish', input: { status: 'failed', summary: '没有查到。' } };
    let turn = 0;
    const calls = [
      { name: 'navigate', input: { url: 'https://www.amap.com/' } },
      { name: 'snapshot', input: {} },
    ];
    const adapter: MessagesAdapter = {
      metadata: { provider: 'anthropic', model: 'fixture' },
      async create() {
        turn += 1;
        const blocks =
          turn <= calls.length
            ? [{ type: 'tool_use' as const, id: String(turn), ...calls[turn - 1]! }]
            : turn === 3
              ? ['e3', 'e4', 'e5'].map((ref, i) => ({
                  type: 'tool_use' as const,
                  id: `${turn}-${i}`,
                  name: 'click',
                  input: { ref },
                }))
              : [{ type: 'tool_use' as const, id: String(turn), ...done }];
        return {
          id: String(turn),
          metadata: { provider: 'anthropic', model: 'fixture' },
          content: blocks,
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
    let url = 'about:blank';
    const seen: string[] = [];
    await runUnifiedBrowserLoop({
      intent: '请使用云端浏览器，高德地图查一下杭州东站到西湖断桥怎么走',
      adapter: {
        ...adapter,
        create: async (request) => {
          seen.push(JSON.stringify(request.messages.at(-1)));
          return adapter.create(request);
        },
      },
      maxSteps: 10,
      execute: (async (action: { tool: string; url?: string }) => {
        if (action.tool === 'navigate') url = action.url!;
        return action.tool === 'snapshot'
          ? { ok: true, text: JSON.stringify({ tree, sourceURL: url }), url }
          : { ok: true, text: '已执行', url };
      }) as never,
      currentPageUrl: () => url,
      probeBlocker: async () => ({
        reason: 'login',
        message: PROMPT,
        disposition: 'continue' as const,
      }),
    });
    expect(seen.join('\n')).not.toContain('同一个登录提示已经');
  });
});
