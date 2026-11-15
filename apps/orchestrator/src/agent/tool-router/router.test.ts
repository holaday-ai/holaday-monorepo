import { describe, expect, it, vi } from 'vitest';
import { envSchema } from '../../config/env.js';
import type { MessagesAdapter } from '../../llm/messages-adapter.js';
import type { ExecutionModeDecision } from '../intent-classifier.js';
import type { BailianMcpClient, InterfaceCallResult } from './bailian-mcp-client.js';
import { toolRouterSettings } from './index.js';
import { type CallableInterfaceTool, INTERFACE_TOOLS, enabledInterfaceTools } from './registry.js';
import {
  type ToolRouteDecision,
  decideExecutionRoute,
  formatSourceLine,
  interfaceSearchLane,
  routeTask,
  toExecutionModeDecision,
  withInterfaceSource,
} from './router.js';

const TOOLS = enabledInterfaceTools('bailian_web_search');
const WEB = TOOLS[0]!;
const AT = '2026-11-11T02:30:00.000Z';
const SOURCE_LINE = '来源：百炼联网搜索 · 2026-11-11 10:30';
// Bench a1 (live-sh): on the rows the retrieval time is labelled as such.
const ROW_LINE = '检索于：百炼联网搜索 · 2026-11-11 10:30（这是检索时间，不是数据本身的时间）';

function fakeModel(input: unknown): MessagesAdapter & { create: ReturnType<typeof vi.fn> } {
  return {
    metadata: {} as MessagesAdapter['metadata'],
    create: vi.fn(async () => ({
      content: [{ type: 'tool_use', id: 'call_1', name: 'choose_route', input }],
      stopReason: 'tool_use',
      usage: { inputTokens: 1, outputTokens: 1 },
    })),
  } as unknown as MessagesAdapter & { create: ReturnType<typeof vi.fn> };
}

function fakeClient(
  result: InterfaceCallResult,
): BailianMcpClient & { call: ReturnType<typeof vi.fn> } {
  return { call: vi.fn(async () => result) };
}

describe('routeTask', () => {
  it('sends an explicit 「打开 / 在…站」 to the browser without asking the model', async () => {
    const model = fakeModel({ choice: 'bailian_web_search', query: 'x', reason: 'r' });
    for (const intent of ['打开 google.com 搜索 Claude', '在亚马逊新加坡站搜 usb c cable']) {
      const decision = await routeTask({ intent, messages: model, tools: TOOLS });
      expect(decision).toMatchObject({ lane: 'browser', source: 'tool-router:explicit-site' });
    }
    expect(model.create).not.toHaveBeenCalled();
  });

  it('lets the model pick an interface for 「上证指数现在多少」', async () => {
    const model = fakeModel({
      choice: 'bailian_web_search',
      query: '上证指数 今日',
      reason: '指数',
    });
    const decision = await routeTask({ intent: '上证指数现在多少', messages: model, tools: TOOLS });
    expect(decision).toEqual({
      lane: 'interface',
      source: 'tool-router:model',
      toolId: 'bailian_web_search',
      title: '百炼联网搜索',
      query: '上证指数 今日',
      reason: '指数',
    });
    const request = model.create.mock.calls[0]?.[0];
    expect(request.toolChoice).toEqual({ type: 'tool', name: 'choose_route' });
    expect(request.tools[0].inputSchema.properties.choice.enum).toEqual([
      'answer_directly',
      'bailian_web_search',
      'browser',
    ]);
    expect(request.system).toContain('bailian_web_search');
  });

  it('honours the model choosing to answer directly or the browser', async () => {
    expect(
      await routeTask({
        intent: '写一首秋天的诗',
        messages: fakeModel({ choice: 'answer_directly', reason: '写作' }),
        tools: TOOLS,
      }),
    ).toEqual({ lane: 'generate', source: 'tool-router:model', reason: '写作' });
    expect(
      await routeTask({
        intent: '京东 iPhone 16 Pro 多少钱',
        messages: fakeModel({ choice: 'browser', reason: '价格' }),
        tools: TOOLS,
      }),
    ).toEqual({ lane: 'browser', source: 'tool-router:model', reason: '价格' });
  });

  it('falls back to the query of the request when the model gives none', async () => {
    const decision = await routeTask({
      intent: '今天的国内新闻头条',
      messages: fakeModel({ choice: 'bailian_web_search', reason: '新闻' }),
      tools: TOOLS,
    });
    expect(decision).toMatchObject({ lane: 'interface', query: '今天的国内新闻头条' });
  });

  it('goes to the browser when the model fails, is missing or picks something not offered', async () => {
    const throwing = {
      metadata: {},
      create: vi.fn(async () => {
        throw new Error('arrears');
      }),
    } as unknown as MessagesAdapter;
    for (const messages of [
      throwing,
      null,
      fakeModel({ choice: 'amap_maps', reason: 'not offered' }),
      fakeModel({ nope: true }),
    ]) {
      expect(await routeTask({ intent: '杭州今天天气', messages, tools: TOOLS })).toEqual({
        lane: 'browser',
        source: 'tool-router:model-unavailable',
      });
    }
  });

  it('never answers from a price-comparison interface: its rows are candidates for the browser', async () => {
    const priceTool = {
      ...INTERFACE_TOOLS.find((tool) => tool.id === 'zhidemai')!,
      mcpTool: 'search',
      buildArguments: (q: string) => ({ q }),
      readResults: () => [],
    } as CallableInterfaceTool;
    const decision = await routeTask({
      intent: 'iPhone 16 Pro 哪里最便宜',
      messages: fakeModel({ choice: 'zhidemai', query: 'iPhone 16 Pro', reason: '比价' }),
      tools: [priceTool],
    });
    expect(decision).toEqual({
      lane: 'browser',
      source: 'tool-router:price-candidates',
      candidateToolId: 'zhidemai',
      query: 'iPhone 16 Pro',
      reason: '比价',
    });
  });
});

describe('decideExecutionRoute', () => {
  const legacyDecision: ExecutionModeDecision = { mode: 'browser', source: 'kw:live-fact' };

  it('flag off: only the legacy classifier runs and its decision is used unchanged', async () => {
    const settings = toolRouterSettings(
      envSchema.parse({
        DATABASE_URL: 'mysql://holaday:holaday-dev@127.0.0.1:3306/holaday',
        REDIS_URL: 'redis://127.0.0.1:6379',
        JWT_SECRET: '0123456789abcdef0123456789abcdef',
        DASHSCOPE_CN_API_KEY: 'k',
      }),
    );
    expect(settings.enabled).toBe(false);
    const legacy = vi.fn(async () => legacyDecision);
    const route = vi.fn(
      async (): Promise<ToolRouteDecision> => ({
        lane: 'generate',
        source: 'tool-router:model',
      }),
    );
    const result = await decideExecutionRoute({ enabled: settings.enabled, legacy, route });
    expect(legacy).toHaveBeenCalledTimes(1);
    expect(route).not.toHaveBeenCalled();
    expect(result).toEqual({ decision: legacyDecision, toolRoute: null });
    expect(result.decision).toBe(legacyDecision);
  });

  it('flag on: the router decides generate / scrape / browser', async () => {
    const route = vi.fn(
      async (): Promise<ToolRouteDecision> => ({
        lane: 'interface',
        source: 'tool-router:model',
        toolId: 'bailian_web_search',
        title: '百炼联网搜索',
        query: '上证指数',
      }),
    );
    const result = await decideExecutionRoute({
      enabled: true,
      legacy: async () => legacyDecision,
      route,
    });
    expect(route).toHaveBeenCalledTimes(1);
    expect(result.decision).toEqual({
      mode: 'scrape',
      source: 'tool-router:model',
      match: 'bailian_web_search',
    });
    expect(result.toolRoute?.lane).toBe('interface');
  });

  it('flag on: the media and file lanes keep their own detectors', async () => {
    for (const mode of ['image', 'video_creation', 'template_fill'] as const) {
      const route = vi.fn();
      const result = await decideExecutionRoute({
        enabled: true,
        legacy: async () => ({ mode, source: `kw:${mode}` }),
        route,
      });
      expect(route).not.toHaveBeenCalled();
      expect(result).toEqual({ decision: { mode, source: `kw:${mode}` }, toolRoute: null });
    }
  });

  it('maps every router decision to an execution mode', () => {
    expect(toExecutionModeDecision({ lane: 'generate', source: 'tool-router:model' })).toEqual({
      mode: 'generate',
      source: 'tool-router:model',
    });
    expect(
      toExecutionModeDecision({
        lane: 'browser',
        source: 'tool-router:explicit-site',
        match: 'google.com',
      }),
    ).toEqual({ mode: 'browser', source: 'tool-router:explicit-site', match: 'google.com' });
  });
});

describe('interfaceSearchLane (hard rule 1 + source line)', () => {
  it('gives the answer step every row with the source line, and remembers the source', async () => {
    const client = fakeClient({
      ok: true,
      results: [{ title: '上证指数', url: 'https://a.example/1', snippet: '收盘 3663.72' }],
      source: { name: '百炼联网搜索', at: AT },
    });
    const lane = interfaceSearchLane({ tool: WEB, client, query: '上证指数 今日' });
    const bundle = await lane.search('ignored', { limit: 5 });
    expect(client.call).toHaveBeenCalledWith(WEB, '上证指数 今日', {});
    expect(bundle).toEqual({
      ok: true,
      credits: 0,
      results: [
        {
          url: 'https://a.example/1',
          title: '上证指数',
          markdown: `# 上证指数\n\n收盘 3663.72\n\n${ROW_LINE}`,
        },
      ],
    });
    expect(lane.lastSource()).toEqual({ name: '百炼联网搜索', at: AT });
    expect(lane.lastFailure()).toBeNull();
  });

  it('reports an empty interface as no results and an error as a failure (both go to the browser)', async () => {
    const empty = interfaceSearchLane({
      tool: WEB,
      client: fakeClient({ ok: false, reason: 'empty' }),
      query: 'q',
    });
    expect(await empty.search('q')).toEqual({ ok: true, results: [], credits: 0 });
    expect(empty.lastFailure()).toBe('empty');
    expect(empty.lastSource()).toBeNull();

    const failing = interfaceSearchLane({
      tool: WEB,
      client: fakeClient({ ok: false, reason: 'timeout' }),
      query: 'q',
    });
    expect(await failing.search('q')).toEqual({ ok: false, error: 'bailian_web_search: timeout' });
    expect(failing.lastFailure()).toBe('timeout');
    expect(await failing.scrape('https://example.com')).toMatchObject({ ok: false });
  });

  it('appends the source line to the answer once', () => {
    const source = { name: '百炼联网搜索', at: AT };
    expect(formatSourceLine(source)).toBe(SOURCE_LINE);
    const answer = withInterfaceSource('上证指数收于 3663.72 点。\n', source);
    expect(answer).toBe(`上证指数收于 3663.72 点。\n\n${SOURCE_LINE}`);
    expect(withInterfaceSource(answer, source)).toBe(answer);
    expect(withInterfaceSource('answer', null)).toBe('answer');
  });
});

describe('高德 routing (review #1 item 3)', () => {
  const WITH_AMAP = enabledInterfaceTools('bailian_web_search,amap_maps');
  const ROUTE_ARGS = { action: 'route', origin: '杭州东站', destination: '西湖断桥', city: '杭州' };

  it.each([
    '在高德地图上查从杭州东站到西湖断桥的路线',
    '用高德查一下杭州东站到断桥怎么走',
    '上高德查一下杭州东站去断桥',
    '打开高德地图查杭州东站到断桥的公交',
    'Use Amap to find the route from Hangzhou East Station to Broken Bridge',
  ])('%s → the 高德 interface (the model fills its arguments)', async (intent) => {
    const model = fakeModel({ choice: 'amap_maps', amap: ROUTE_ARGS, reason: '路线' });
    const decision = await routeTask({ intent, messages: model, tools: WITH_AMAP });
    expect(decision).toMatchObject({
      lane: 'interface',
      toolId: 'amap_maps',
      title: '高德地图',
      args: ROUTE_ARGS,
    });
    expect(decision).toHaveProperty('namedSite');
    // Only 高德 or the browser are offered once the user named 高德.
    const request = model.create.mock.calls[0]?.[0];
    expect(request.tools[0].inputSchema.properties.choice.enum).toEqual(['amap_maps', 'browser']);
    expect(request.tools[0].inputSchema.properties.amap.properties.action.enum).toContain('route');
    expect(request.system).toContain('只有要在它的网页上登录、点击或操作时才选 browser');
  });

  it.each([
    ['打开高德地图网页查一下杭州东站到断桥的路线', '高德地图'],
    ['打开 amap.com 看看杭州东站到断桥', 'amap.com'],
    ['在高德地图网站上登录我的账号看收藏的地点', '高德地图'],
    ['用高德地图帮我截图这条路线', '高德地图'],
    ['open the Amap website and check the route', 'Amap'],
  ])('%s → browser (the page itself, or operating on it)', async (intent, site) => {
    const model = fakeModel({ choice: 'amap_maps', amap: ROUTE_ARGS, reason: 'r' });
    const decision = await routeTask({ intent, messages: model, tools: WITH_AMAP });
    expect(decision).toEqual({ lane: 'browser', source: 'tool-router:explicit-site', match: site });
    expect(model.create).not.toHaveBeenCalled();
  });

  it('without the 高德 tool enabled, naming 高德 is an explicit site (browser)', async () => {
    const model = fakeModel({ choice: 'bailian_web_search', reason: 'r' });
    const decision = await routeTask({
      intent: '在高德地图上查从杭州东站到西湖断桥的路线',
      messages: model,
      tools: TOOLS,
    });
    expect(decision).toMatchObject({ lane: 'browser', source: 'tool-router:explicit-site' });
  });

  it('an unnamed route question lets the model pick 高德 among all tools', async () => {
    const model = fakeModel({ choice: 'amap_maps', amap: ROUTE_ARGS, reason: '路线' });
    const decision = await routeTask({
      intent: '杭州东站到西湖断桥坐地铁怎么走',
      messages: model,
      tools: WITH_AMAP,
    });
    expect(decision).toMatchObject({ lane: 'interface', toolId: 'amap_maps', args: ROUTE_ARGS });
    expect(decision).not.toHaveProperty('namedSite');
    const request = model.create.mock.calls[0]?.[0];
    expect(request.tools[0].inputSchema.properties.choice.enum).toEqual([
      'answer_directly',
      'bailian_web_search',
      'amap_maps',
      'browser',
    ]);
  });

  it('goes to the browser when the model picks 高德 without usable arguments', async () => {
    for (const amap of [undefined, { action: 'route', origin: '杭州东站' }]) {
      const decision = await routeTask({
        intent: '用高德查杭州东站到断桥',
        messages: fakeModel({ choice: 'amap_maps', amap, reason: 'r' }),
        tools: WITH_AMAP,
      });
      expect(decision).toEqual({ lane: 'browser', source: 'tool-router:model-unavailable' });
    }
  });

  it('hands the arguments to the interface and a failed 高德 call stays a failure (→ browser)', async () => {
    const amap = WITH_AMAP.find((tool) => tool.id === 'amap_maps')!;
    const client = fakeClient({
      ok: false,
      reason: 'quota',
      detail: 'USER_DAILY_QUERY_OVER_LIMIT',
    });
    const lane = interfaceSearchLane({ tool: amap, client, query: 'q', args: ROUTE_ARGS });
    expect(await lane.search('q')).toEqual({ ok: false, error: 'amap_maps: quota' });
    expect(client.call).toHaveBeenCalledWith(amap, 'q', { args: ROUTE_ARGS });
    expect(lane.lastFailure()).toBe('quota');
  });
});

describe('source line language (review #1 item 5)', () => {
  const source = { name: '百炼联网搜索', nameEn: 'Bailian Web Search', at: AT };
  const EN_LINE = 'Source: Bailian Web Search · 2026-11-11 10:30 (Beijing time)';

  it('is English for an English task, Chinese otherwise', () => {
    expect(formatSourceLine(source, 'en')).toBe(EN_LINE);
    expect(formatSourceLine(source, 'zh')).toBe(SOURCE_LINE);
    expect(formatSourceLine(source)).toBe(SOURCE_LINE);
    expect(formatSourceLine({ name: '高德地图', at: AT }, 'en')).toBe(
      'Source: 高德地图 · 2026-11-11 10:30 (Beijing time)',
    );
    const answer = withInterfaceSource('The SSE closed at 3663.72.', source, 'en');
    expect(answer).toBe(`The SSE closed at 3663.72.\n\n${EN_LINE}`);
    expect(withInterfaceSource(answer, source, 'en')).toBe(answer);
  });

  it('puts the English line on the rows of an English task', async () => {
    const client = fakeClient({
      ok: true,
      results: [{ title: 'SSE', url: 'https://a.example/1', snippet: '3663.72' }],
      source,
    });
    const lane = interfaceSearchLane({ tool: WEB, client, query: 'q', language: 'en' });
    const bundle = await lane.search('q');
    expect(bundle).toMatchObject({
      ok: true,
      results: [
        { markdown: `# SSE\n\n3663.72\n\n${EN_LINE} — retrieval time, not the data's time` },
      ],
    });
  });
});
