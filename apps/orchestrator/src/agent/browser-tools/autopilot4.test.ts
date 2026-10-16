import { type Server, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { type Browser, chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { MessagesAdapter } from '../../llm/messages-adapter.js';
import { planSearchFallback } from '../search-fallback/search-engine-fallback.js';
import { prepareBrowserPlan } from './browser-brain-roles.js';
import { completionGap } from './browser-completion.js';
import { assessCompletionFacts } from './completion-fields.js';
import { createPlaywrightUnifiedExecutor } from './playwright-unified-executor.js';
import type { UnifiedToolResult } from './playwright-unified-executor.js';
import { runUnifiedBrowserLoop } from './unified-browser-loop.js';

/** BROWSER-AUTOPILOT-4: the Deploy-22 search fallback and date-control findings. */
const P = '请使用云端浏览器，';
const SORRY =
  'https://www.google.com/sorry/index?continue=https%3A%2F%2Fwww.google.com%2Fsearch%3Fq%3Dx&q=EgTPlEZqGOfHwtYGIjBORW3TMT5P7HWqYSCngjkIhq3drAUd_zY4IqNs1';
const D16 = `${P}【Deploy-16 核心验收 01】使用真实浏览器打开 https://www.google.com/search?q=HOLA+DAY+AI ，读取 Google 搜索「HOLA DAY AI」前5条自然搜索结果，逐条返回标题和实际链接，并保留步骤截图。只读，不提交表单、不购买、不登录、不播放视频。`;

describe('1. the fallback query comes from the task, never from the wall (D16, core-02)', () => {
  const wall = { url: SORRY, captcha: true, visible: true };
  it('uses the quoted or linked query of the original task', () => {
    expect(planSearchFallback(D16, wall)?.query).toBe('HOLA DAY AI');
    expect(planSearchFallback(`${P}Google 搜索「新加坡 天气」读出天气卡片`, wall)?.query).toBe(
      '新加坡 天气',
    );
    expect(planSearchFallback(`${P}Google 搜索「HOLA DAY AI」返回前5条标题和链接`, wall)?.url).toBe(
      'https://www.bing.com/search?q=HOLA+DAY+AI',
    );
  });
  it('does not fall back when the task names no query', () => {
    expect(planSearchFallback(`${P}打开 Google 搜索一下`, wall)).toBeNull();
  });
  it('does not tell the model that searching is a forbidden form submission', () => {
    expect(planSearchFallback(D16, wall)?.intent.split('【搜索引擎回退】')[1]).not.toMatch(
      /不提交/,
    );
  });
});

describe('2. results bound to a redirected search page are grounded (core-01)', () => {
  const cited = 'https://www.bing.com/search?q=HOLA+DAY+AI';
  const pages = [
    {
      text: 'link "HOLA.com, últimas noticias de famosos" /url: https://www.hola.com/',
      tabId: 'tab_1',
      sourceURL: 'https://www.bing.com/search?q=HOLA+DAY+AI&rdr=1&rdrig=D4840FCB893E4330',
    },
  ];
  it('accepts the URL the answer cites without the redirect parameters', () => {
    const result = assessCompletionFacts({
      summary: '1. HOLA.com, últimas noticias de famosos https://www.hola.com/',
      fields: [
        {
          name: '结果1_标题',
          value: 'HOLA.com, últimas noticias de famosos',
          sourceURL: cited,
          tabId: 'tab_1',
        },
        { name: '结果1_链接', value: 'https://www.hola.com/', sourceURL: cited, tabId: 'tab_1' },
      ],
      pages,
    });
    expect(result.contradictions).toEqual([]);
  });
  it('still rejects a page with another query', () => {
    const result = assessCompletionFacts({
      summary: '1. HOLA.com',
      fields: [
        {
          name: '结果1_标题',
          value: 'HOLA.com, últimas noticias de famosos',
          sourceURL: 'https://www.bing.com/search?q=other',
        },
      ],
      pages,
    });
    expect(result.contradictions.join('')).toContain('未成功读取');
  });
});

describe('3. search boxes and visit claims (core-02)', () => {
  const intent = `${D16}`;
  const read = { tool: 'read_page', ok: true, url: 'https://www.bing.com/search?q=HOLA+DAY+AI' };
  const shot = { tool: 'screenshot', ok: true, screenshot: true };
  it('a search box submission is a query, a business form is not', () => {
    const search = {
      tool: 'type',
      ok: true,
      form: { ref: 'e1', filled: true, submitted: true, search: true },
    };
    expect(completionGap(intent, '1. A', [read, shot, search], false)).toBeNull();
    const business = { tool: 'type', ok: true, form: { ref: 'e1', filled: true, submitted: true } };
    expect(completionGap(intent, '1. A', [read, shot, business], false)).toContain('表单已提交');
  });
  it('a site the answer says it opened needs a visit receipt', () => {
    const weather = `${P}Google 搜索「新加坡 天气」读出天气卡片`;
    const claim = '改用 Bing 搜索，并打开其结果中的权威天气来源 weather.com，读取到当前温度 31°C。';
    expect(completionGap(weather, claim, [read], false)).toContain('weather.com');
    const visit = {
      tool: 'read_page',
      ok: true,
      url: 'https://weather.com/weather/today/l/Singapore',
    };
    expect(completionGap(weather, claim, [read, visit], false)).toBeNull();
    expect(
      completionGap(
        weather,
        '访问 google.com 时出现验证墙，已改用 Bing；未能打开 weather.com。',
        [read],
        false,
      ),
    ).toBeNull();
  });
});

describe('4. a requested date control needs a date fill (core-08)', () => {
  const intent = `${P}httpbin.org/forms/post 或 the-internet.herokuapp.com 填表单与日期控件，只填不提交并截图`;
  const scripted = (calls: Array<{ name: string; input: Record<string, unknown> }>) => {
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
  };
  const run = (date: boolean) => {
    const { adapter, seen } = scripted([
      { name: 'snapshot', input: {} },
      { name: 'type', input: { ref: 'e1', text: '12:30' } },
      { name: 'screenshot', input: {} },
      {
        name: 'finish',
        input: { status: 'completed', summary: '已填写 time=12:30，未提交并截图。' },
      },
      { name: 'type', input: { ref: 'e2', text: '2026-10-15' } },
      {
        name: 'finish',
        input: { status: 'completed', summary: '已填写日期 2026-10-15，未提交并截图。' },
      },
    ]);
    const execute = async (action: { tool: string }): Promise<UnifiedToolResult> =>
      action.tool === 'type'
        ? {
            ok: true,
            text: '已输入',
            form: {
              ref: 'e1',
              filled: true,
              submitted: false,
              ...((action as { ref?: string }).ref === 'e2' && date ? { date: true } : {}),
            },
          }
        : action.tool === 'screenshot'
          ? { ok: true, text: '截图', image: { mediaType: 'image/jpeg', data: 'AA==' } }
          : {
              ok: true,
              text: 'textbox "Preferred delivery time" 12:30 2026-10-15',
              url: 'https://httpbin.org/forms/post',
            };
    return runUnifiedBrowserLoop({ intent, adapter, maxSteps: 10, execute: execute as never }).then(
      (outcome) => ({ outcome, seen }),
    );
  };
  it('asks for a date control once, then completes when one was filled', async () => {
    const { outcome, seen } = await run(true);
    expect(seen.join('\n')).toContain('time 时间控件不算');
    expect(outcome).toMatchObject({ status: 'completed' });
    expect('partial' in outcome && outcome.partial).toBeFalsy();
  });
  it('delivers 部分完成 when no date control was ever filled', async () => {
    const { outcome } = await run(false);
    expect(outcome).toMatchObject({ status: 'completed', partial: { missing: '日期控件' } });
    expect(outcome.status === 'completed' && outcome.summary).toMatch(
      /^部分完成：没有找到可填写的日期控件/,
    );
  });
});

describe('5. field kinds on real Chromium', () => {
  let browser: Browser;
  let server: Server;
  let base: string;
  const html = `<!doctype html><meta charset="utf-8"><body>
<form action="/search" method="get" role="search"><textarea name="q" aria-label="Search"></textarea></form>
<form action="/post" method="post"><input name="custname" aria-label="Customer name"><input type="time" name="delivery" aria-label="Delivery time"><input type="date" name="when" aria-label="Pick a day"><input type="text" name="my-date" aria-label="Date picker"></form></body>`;
  beforeAll(async () => {
    server = createServer((_req, res) => {
      res.setHeader('content-type', 'text/html; charset=utf-8');
      res.end(html);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    browser = await chromium.launch({ headless: true });
  });
  afterAll(async () => {
    await browser?.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  it('marks search boxes and date controls, not time inputs or plain fields', async () => {
    const page = await browser.newPage();
    await page.goto(base);
    const tools = createPlaywrightUnifiedExecutor(page, { observationV2: true });
    const kinds: Record<string, unknown> = {};
    for (const [label, text] of [
      ['Search', 'HOLA DAY AI'],
      ['Customer name', 'Test'],
      ['Delivery time', '12:30'],
      ['Pick a day', '2026-10-15'],
      ['Date picker', '10/15/2026'],
    ] as const) {
      const read = JSON.parse((await tools.execute({ tool: 'read_page' })).text);
      const ref = String(read.tree).match(new RegExp(`"${label}"[^\\n]*\\[ref=(e\\d+)\\]`))![1]!;
      const typed = await tools.execute({
        tool: 'type',
        ref,
        text,
        observationRevision: read.observationRevision,
      });
      expect(typed.ok).toBe(true);
      kinds[label] = typed.form;
    }
    expect(kinds.Search).toMatchObject({ search: true });
    expect(kinds['Customer name']).not.toHaveProperty('search');
    expect(kinds['Delivery time']).not.toHaveProperty('date');
    expect(kinds['Pick a day']).toMatchObject({ date: true });
    expect(kinds['Date picker']).toMatchObject({ date: true });
    tools.dispose();
    await page.close();
  });
});

describe('6. the planner restates the user, it does not add requirements (core-01 r1)', () => {
  it('tells the planning role not to invent conditions or page values', async () => {
    let system = '';
    const adapter = {
      metadata: { provider: 'anthropic', model: 'fixture' },
      async create(request: { system?: string }) {
        system = String(request.system);
        return {
          id: '1',
          metadata: { provider: 'anthropic', model: 'fixture' },
          content: [{ type: 'text', text: '1. 打开搜索页' }],
          stopReason: 'end_turn',
          usage: {
            inputTokens: 1,
            outputTokens: 1,
            cacheReadInputTokens: null,
            cacheCreationInputTokens: null,
            complete: true,
          },
        };
      },
    } as unknown as MessagesAdapter;
    await prepareBrowserPlan(
      adapter,
      `${P}Google 搜索「HOLA DAY AI」返回前5条标题和链接`,
      {} as never,
    );
    expect(system).toContain('不得新增用户没说的要求');
    expect(system).toContain('不得写出页面上的预期文字');
  });
});

describe('ACCEPT-283-R5 D16: a result list bound to its listing tab and each item’s own link', () => {
  const listing = {
    text: '「HOLA DAY AI」的搜索结果 Hola-Dermat:护肤AI助手 https://www.hubwiz.com/blog/x',
    tabId: 'tab_list',
    sourceURL: 'https://search-results.holaday.invalid/search?q=HOLA%20DAY%20AI',
    links: [{ text: 'Hola-Dermat:护肤AI助手', url: 'https://www.hubwiz.com/blog/x' }],
  };
  const fact = (tabId: string, value = 'Hola-Dermat:护肤AI助手') => ({
    name: '第1条标题',
    value,
    sourceURL: 'https://www.hubwiz.com/blog/x',
    tabId,
  });
  it('the listing page in that tab links the title to that URL: grounded', () => {
    const result = assessCompletionFacts({
      summary: '1. Hola-Dermat:护肤AI助手 https://www.hubwiz.com/blog/x',
      fields: [fact('tab_list')],
      pages: [listing],
    });
    expect(result.contradictions).toEqual([]);
  });
  it('another tab, or a title the link does not carry, is still unread', () => {
    for (const f of [fact('tab_other'), fact('tab_list', '另一个标题')]) {
      const result = assessCompletionFacts({
        summary: `1. ${f.value}`,
        fields: [f],
        pages: [listing],
      });
      expect(result.contradictions.length, f.tabId + f.value).toBeGreaterThan(0);
    }
  });
});
