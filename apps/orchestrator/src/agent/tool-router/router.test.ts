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
          markdown: `# 上证指数\n\n收盘 3663.72\n\n${SOURCE_LINE}`,
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
