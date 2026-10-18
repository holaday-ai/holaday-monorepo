import { describe, expect, it } from 'vitest';
import type { MessagesAdapter } from '../../llm/messages-adapter.js';
import type { UnifiedToolResult } from './playwright-unified-executor.js';
import { intentTargetUrl, runUnifiedBrowserLoop } from './unified-browser-loop.js';

/** NAV-EXIT-1 — Deploy-25 core-06 gave up on about:blank without navigating. */
const P = '请使用云端浏览器，';
const CORE06 = `${P}维基百科长页面，分段读取并总结第3节`;

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

function browser() {
  let url = 'about:blank';
  const actions: string[] = [];
  const execute = async (action: { tool: string; url?: string }): Promise<UnifiedToolResult> => {
    actions.push(action.tool === 'navigate' ? `navigate ${action.url}` : action.tool);
    if (action.tool === 'navigate') {
      url = action.url!;
      return { ok: true, text: `已打开 ${url}`, url };
    }
    return {
      ok: true,
      text:
        url === 'about:blank'
          ? ''
          : 'heading "人工智能" [level=1]\n研究课题 目前人工智能的研究方向已分成几个子领域',
      url,
    };
  };
  return { execute, actions, currentPageUrl: () => url };
}

const giveUp = (name: 'finish' | 'request_human' | 'ask') =>
  name === 'finish'
    ? { name, input: { status: 'failed', summary: '浏览器无法判断是否需要登录。' } }
    : name === 'ask'
      ? // NAV-EXIT-1 run n3: a clarification before opening the named site.
        {
          name: 'request_human',
          input: { reason: 'other', message: '请提供您想要总结的维基百科词条名称或链接。' },
        }
      : { name, input: { reason: 'login', message: '可能需要登录。' } };

describe('the target a task names', () => {
  it.each([
    [CORE06, 'https://zh.wikipedia.org/'],
    [`${P}Wikipedia long article, read section 3`, 'https://en.wikipedia.org/'],
    [`${P}打开 https://example.com/a 读标题`, 'https://example.com/a'],
    [`${P}the-internet.herokuapp.com 的 iframe`, 'https://the-internet.herokuapp.com/'],
    [`${P}从一个页面打开3个链接到新标签`, undefined],
  ])('%s → %s', (intent, url) => {
    expect(intentTargetUrl(intent)).toBe(url);
  });
});

describe('giving up on the blank start page (core-06)', () => {
  it.each(['finish', 'request_human', 'ask'] as const)(
    '%s on about:blank is sent back once to navigate first',
    async (name) => {
      const { adapter, seen } = scripted([
        { name: 'snapshot', input: {} },
        giveUp(name),
        { name: 'navigate', input: { url: 'https://zh.wikipedia.org/wiki/人工智能' } },
        { name: 'snapshot', input: {} },
        {
          name: 'finish',
          input: {
            status: 'completed',
            summary: '第3节「研究课题」：人工智能的研究方向已分成几个子领域。',
          },
        },
      ]);
      const b = browser();
      const outcome = await runUnifiedBrowserLoop({
        intent: CORE06,
        adapter,
        maxSteps: 8,
        execute: b.execute as never,
        currentPageUrl: b.currentPageUrl,
      });
      expect(seen.join('\n')).toContain('浏览器还停在空白页（about:blank）');
      expect(seen.join('\n')).toContain('https://zh.wikipedia.org/');
      expect(outcome).toMatchObject({ status: 'completed' });
    },
  );

  it('giving up twice: the host opens the target, then the model goes on', async () => {
    const { adapter, seen } = scripted([
      { name: 'snapshot', input: {} },
      giveUp('finish'),
      giveUp('request_human'),
      { name: 'snapshot', input: {} },
      {
        name: 'finish',
        input: {
          status: 'completed',
          summary: '第3节「研究课题」：人工智能的研究方向已分成几个子领域。',
        },
      },
    ]);
    const b = browser();
    const outcome = await runUnifiedBrowserLoop({
      intent: CORE06,
      adapter,
      maxSteps: 8,
      execute: b.execute as never,
      currentPageUrl: b.currentPageUrl,
    });
    expect(b.actions).toContain('navigate https://zh.wikipedia.org/');
    expect(seen.join('\n')).toContain('宿主先按任务打开了目标网站 https://zh.wikipedia.org/');
    expect(outcome).toMatchObject({ status: 'completed' });
  });

  it('after a navigation was tried, giving up is allowed', async () => {
    const { adapter } = scripted([
      { name: 'navigate', input: { url: 'https://zh.wikipedia.org/wiki/人工智能' } },
      giveUp('finish'),
    ]);
    const actions: string[] = [];
    const outcome = await runUnifiedBrowserLoop({
      intent: CORE06,
      adapter,
      maxSteps: 6,
      // The navigation fails and leaves the tab blank.
      execute: (async (action: { tool: string }) => {
        actions.push(action.tool);
        return { ok: false, text: '打开失败', errorCode: 'browser_navigation_failed' };
      }) as never,
      currentPageUrl: () => 'about:blank',
    });
    expect(outcome.status).toBe('failed');
    expect(actions).toEqual(['navigate']);
  });

  it('a task with no target ends as before', async () => {
    const { adapter, seen } = scripted([{ name: 'snapshot', input: {} }, giveUp('finish')]);
    const b = browser();
    const outcome = await runUnifiedBrowserLoop({
      intent: `${P}从一个页面打开3个链接到新标签，分别读标题后回到第一个`,
      adapter,
      maxSteps: 6,
      execute: b.execute as never,
      currentPageUrl: b.currentPageUrl,
    });
    expect(outcome.status).toBe('failed');
    expect(seen.join('\n')).not.toContain('浏览器还停在空白页');
    expect(b.actions).toEqual(['snapshot']);
  });
});

/**
 * INTEGRATE-26: NAV-EXIT-1's guard comes first on the blank page; when it does
 * not apply (navigation already tried, or no target), FAILURE-COPY-1's
 * "not started" wording and source decide the failure.
 */
describe('blank-page guard × not-started copy (INTEGRATE-26)', () => {
  const NOT_STARTED = '执行未开始：浏览器还没有打开目标页面就结束了。请重试。';
  it('a tried navigation that left the page blank fails as not started, without a nudge', async () => {
    const { adapter, seen } = scripted([
      { name: 'navigate', input: { url: 'https://zh.wikipedia.org/wiki/人工智能' } },
      giveUp('finish'),
    ]);
    const outcome = await runUnifiedBrowserLoop({
      intent: CORE06,
      adapter,
      maxSteps: 6,
      execute: (async () => ({
        ok: false,
        text: '打开失败',
        errorCode: 'browser_navigation_failed',
      })) as never,
      currentPageUrl: () => 'about:blank',
    });
    expect(outcome).toMatchObject({
      status: 'failed',
      reason: NOT_STARTED,
      failureSource: 'not_started',
    });
    expect(seen.join('\n')).not.toContain('浏览器还停在空白页');
  });
  it.each(['finish', 'request_human'] as const)(
    'with no target, %s on the blank page fails as not started (no login wording)',
    async (name) => {
      const { adapter } = scripted([{ name: 'snapshot', input: {} }, giveUp(name)]);
      const b = browser();
      const outcome = await runUnifiedBrowserLoop({
        intent: `${P}从一个页面打开3个链接到新标签，分别读标题后回到第一个`,
        adapter,
        maxSteps: 6,
        execute: b.execute as never,
        currentPageUrl: b.currentPageUrl,
      });
      expect(outcome).toMatchObject({
        status: 'failed',
        reason: NOT_STARTED,
        failureSource: 'not_started',
      });
      expect(b.actions).toEqual(['snapshot']);
    },
  );
  it('with a target, the guard wins: nudged first, never a not-started failure', async () => {
    const { adapter, seen } = scripted([
      { name: 'snapshot', input: {} },
      giveUp('finish'),
      { name: 'navigate', input: { url: 'https://zh.wikipedia.org/wiki/人工智能' } },
      { name: 'snapshot', input: {} },
      {
        name: 'finish',
        input: {
          status: 'completed',
          summary: '第3节「研究课题」：人工智能的研究方向已分成几个子领域。',
        },
      },
    ]);
    const b = browser();
    const outcome = await runUnifiedBrowserLoop({
      intent: CORE06,
      adapter,
      maxSteps: 8,
      execute: b.execute as never,
      currentPageUrl: b.currentPageUrl,
    });
    expect(seen.join('\n')).toContain('浏览器还停在空白页');
    expect(outcome).toMatchObject({ status: 'completed' });
  });
});

describe('neutral pages when the task leaves the page open (INTEGRATE-26)', () => {
  const firstMessage = async (intent: string) => {
    const { adapter, seen } = scripted([
      { name: 'finish', input: { status: 'failed', summary: 'x' } },
    ]);
    await runUnifiedBrowserLoop({
      intent,
      adapter,
      maxSteps: 2,
      execute: (async () => ({ ok: true, text: '' })) as never,
      currentPageUrl: () => 'https://example.com/',
    });
    return seen[0]!;
  };
  it('suggests a neutral page when no page is named', async () => {
    expect(
      await firstMessage(`${P}从一个页面打开3个链接到新标签，分别读标题后回到第一个`),
    ).toContain('请优先选百科、技术文档等中性内容页面');
  });
  it.each([
    `${P}打开 https://www.bbc.com/zhongwen/simp ，从该页面打开3个链接到新标签`,
    `${P}从一个页面打开3个链接：用 news.ycombinator.com`,
    `${P}维基百科长页面，分段读取并总结第3节`,
    `${P}Google 搜索「HOLA DAY AI」返回前5条标题和链接`,
  ])('leaves a named site, or a task without a page to pick, alone: %s', async (intent) => {
    expect(await firstMessage(intent)).not.toContain('中性内容页面');
  });
});

describe('content inspection refusal (INTEGRATE-26 core-03)', () => {
  const PAGE = 'heading "Me at the zoo" [level=1]\nRECOMMENDED: some unrelated title';
  const run = async (refusals: number) => {
    const { MessagesAdapterError } = await import('../../llm/messages-adapter.js');
    const { safeProviderDiagnostics } = await import('../../llm/provider-error-diagnostics.js');
    const requests: string[] = [];
    const script = [
      { name: 'navigate', input: { url: 'https://www.youtube.com/watch?v=jNQXAC9IVRw' } },
      { name: 'snapshot', input: {} },
      { name: 'finish', input: { status: 'completed', summary: '标题是「Me at the zoo」。' } },
    ];
    let answered = 0;
    let refused = 0;
    const adapter: MessagesAdapter = {
      metadata: { provider: 'anthropic', model: 'fixture' },
      async create(request) {
        const sent = JSON.stringify(request.messages);
        requests.push(sent);
        // The provider refuses what holds the recommendation list; with
        // `refusals` > 1 it keeps refusing whatever is sent after the read.
        if ((sent.includes('RECOMMENDED') || (refusals > 1 && refused > 0)) && refused < refusals) {
          refused += 1;
          throw new MessagesAdapterError(
            'PROVIDER_ERROR',
            'x',
            400,
            safeProviderDiagnostics({ httpStatus: 400, providerCode: 'DataInspectionFailed' }),
          );
        }
        const call = script[Math.min(answered++, script.length - 1)]!;
        return {
          id: String(answered),
          metadata: { provider: 'anthropic', model: 'fixture' },
          content: [{ type: 'tool_use', id: String(answered), ...call }],
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
    const outcome = await runUnifiedBrowserLoop({
      intent: `${P}YouTube 公开视频页读标题/频道/播放量/发布日期（不播放）`,
      adapter,
      maxSteps: 8,
      modelRetry: { sleep: async () => {} },
      execute: (async (action: { tool: string; url?: string }) => {
        if (action.tool === 'navigate') {
          url = action.url!;
          return { ok: true, text: '已打开', url };
        }
        return { ok: true, text: PAGE, url };
      }) as never,
      currentPageUrl: () => url,
    });
    return { outcome, requests };
  };
  it('removes the refused page text, tells the model, and goes on', async () => {
    const { outcome, requests } = await run(1);
    const after = requests.at(-1)!;
    expect(after).not.toContain('RECOMMENDED');
    expect(after).toContain('已从对话中移除');
    expect(outcome).toMatchObject({ status: 'completed' });
  });
  it('gives up honestly after two recoveries', async () => {
    const { outcome } = await run(99);
    expect(outcome).toMatchObject({
      status: 'failed',
      failureSource: 'model',
      reason: '模型服务拒绝处理：页面内容未通过内容安全检查，可换一个页面或来源后重试。',
    });
  });
});
