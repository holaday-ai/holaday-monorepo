import { describe, expect, it, vi } from 'vitest';
import { envSchema } from '../../config/env.js';
import { toolRouterSettings } from './index.js';
import {
  INTERFACE_TOOLS,
  enabledInterfaceTools,
  isCallable,
  readBailianSearchPages,
  toolsForRegion,
} from './registry.js';

const BASE_ENV = {
  DATABASE_URL: 'mysql://holaday:holaday-dev@127.0.0.1:3306/holaday',
  REDIS_URL: 'redis://127.0.0.1:6379',
  JWT_SECRET: '0123456789abcdef0123456789abcdef',
};

describe('tool router config', () => {
  it('is off by default and enables only the web search tool when turned on', () => {
    const parsed = envSchema.parse(BASE_ENV);
    expect(parsed.TOOL_ROUTER_V2).toBe(false);
    expect(parsed.TOOL_ROUTER_TOOLS).toBe('bailian_web_search');
    expect(envSchema.parse({ ...BASE_ENV, TOOL_ROUTER_V2: 'true' }).TOOL_ROUTER_V2).toBe(true);
  });

  it('offers no interface while the flag is off or the cn key is missing', () => {
    expect(toolRouterSettings({ TOOL_ROUTER_V2: false, DASHSCOPE_CN_API_KEY: 'k' }).tools).toEqual(
      [],
    );
    expect(toolRouterSettings({ TOOL_ROUTER_V2: true, DASHSCOPE_CN_API_KEY: '' }).tools).toEqual(
      [],
    );
    const on = toolRouterSettings({
      TOOL_ROUTER_V2: true,
      TOOL_ROUTER_TOOLS: 'bailian_web_search',
      DASHSCOPE_CN_API_KEY: 'k',
    });
    expect(on.enabled).toBe(true);
    expect(on.tools.map((tool) => tool.id)).toEqual(['bailian_web_search']);
  });
});

describe('enabledInterfaceTools', () => {
  it('defaults to bailian_web_search', () => {
    expect(enabledInterfaceTools(undefined).map((tool) => tool.id)).toEqual(['bailian_web_search']);
  });

  it('parses a comma list, trims, ignores case and keeps registry order', () => {
    expect(
      enabledInterfaceTools(' Bailian_Search_Pro , bailian_web_search ').map((tool) => tool.id),
    ).toEqual(['bailian_web_search', 'bailian_search_pro']);
  });

  it('ignores unknown ids and entries without a call shape, with a warning', () => {
    const warn = vi.fn();
    const tools = enabledInterfaceTools('nope,amap_maps,kuaidi100,zhidemai,manmanbuy,web_parser', {
      warn,
    });
    expect(tools).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(6);
    expect(warn.mock.calls[0]?.[0]).toContain('unknown tool "nope"');
    expect(warn.mock.calls[1]?.[0]).toContain('amap_maps');
  });

  it('enables nothing for an empty list', () => {
    expect(enabledInterfaceTools('')).toEqual([]);
  });
});

describe('registry entries', () => {
  it('has one entry per interface, only the two Bailian searches callable', () => {
    expect(INTERFACE_TOOLS.map((tool) => [tool.id, tool.kind, isCallable(tool)])).toEqual([
      ['bailian_web_search', 'search', true],
      ['bailian_search_pro', 'search', true],
      ['amap_maps', 'map', false],
      ['kuaidi100', 'express', false],
      ['zhidemai', 'price', false],
      ['manmanbuy', 'price', false],
      ['web_parser', 'page', false],
    ]);
  });

  it('marks price-comparison interfaces as candidates only', () => {
    const candidates = INTERFACE_TOOLS.filter((tool) => tool.pricesAreCandidates).map(
      (tool) => tool.id,
    );
    expect(candidates).toEqual(['zhidemai', 'manmanbuy']);
    expect(INTERFACE_TOOLS.find((tool) => tool.id === 'manmanbuy')?.serviceCode).toBeNull();
  });

  it('builds the probed call arguments', () => {
    const [web, pro] = enabledInterfaceTools('bailian_web_search,bailian_search_pro');
    expect(web?.serviceCode).toBe('WebSearch');
    expect(web?.mcpTool).toBe('bailian_web_search');
    expect(web?.buildArguments('上证指数')).toEqual({ query: '上证指数', count: 5 });
    expect(pro?.serviceCode).toBe('EnhancedSearch');
    expect(pro?.mcpTool).toBe('search_pro');
    expect(pro?.buildArguments('上证指数')).toEqual({ query: '上证指数' });
  });

  it('keeps cn interfaces away from intl users', () => {
    const tools = enabledInterfaceTools('bailian_web_search');
    expect(toolsForRegion(tools, 'cn')).toHaveLength(1);
    expect(toolsForRegion(tools, 'intl')).toEqual([]);
    expect(toolsForRegion(tools, null)).toEqual([]);
  });
});

describe('readBailianSearchPages', () => {
  it('reads the pages JSON and drops rows without a web URL', () => {
    const rows = readBailianSearchPages([
      {
        type: 'text',
        text: JSON.stringify({
          pages: [
            {
              title: ' 上证指数 ',
              url: 'https://a.example/1',
              hostname: '新浪',
              snippet: '3663.72',
            },
            { title: 'x', url: 'javascript:alert(1)', snippet: 'bad' },
            { title: 'no url', snippet: 'bad' },
          ],
        }),
      },
      { type: 'text', text: 'not json' },
      { type: 'image' },
    ]);
    expect(rows).toEqual([
      { title: '上证指数', url: 'https://a.example/1', snippet: '3663.72', host: '新浪' },
    ]);
  });
});
