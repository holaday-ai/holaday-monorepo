/**
 * G2a — TOOL_ROUTER_V2 for chosen model data regions only (DEPLOY-R1: cn entry first), and who
 * decides a colloquial 「搜一下」 request: the router when it is on for the user, the mainline
 * keyword rules (LEAK-1 root fix) otherwise.
 */
import type { Logger } from 'pino';
import { describe, expect, it, vi } from 'vitest';
import { envSchema } from '../../config/env.js';
import type { MessagesAdapter } from '../../llm/messages-adapter.js';
import { explainExecutionMode } from '../intent-classifier.js';
import { toolRouterRegions, toolRouterSettings } from './index.js';
import { enabledInterfaceTools } from './registry.js';
import { type ToolRouteDecision, decideExecutionRoute, routeTask } from './router.js';

const BASE_ENV = {
  DATABASE_URL: 'mysql://holaday:holaday-dev@127.0.0.1:3306/holaday',
  REDIS_URL: 'redis://127.0.0.1:6379',
  JWT_SECRET: '0123456789abcdef0123456789abcdef',
  DASHSCOPE_CN_API_KEY: 'k',
};

function fakeLogger(): Logger {
  const noop = vi.fn();
  return {
    info: noop,
    warn: noop,
    debug: noop,
    error: noop,
    fatal: noop,
    trace: noop,
    child: () => fakeLogger(),
  } as unknown as Logger;
}

describe('TOOL_ROUTER_V2_REGIONS', () => {
  it('defaults to empty: the router runs for no region even with TOOL_ROUTER_V2 on', () => {
    const parsed = envSchema.parse({ ...BASE_ENV, TOOL_ROUTER_V2: 'true' });
    expect(parsed.TOOL_ROUTER_V2_REGIONS).toBe('');
    const settings = toolRouterSettings(parsed);
    expect(settings.enabled).toBe(true);
    expect(settings.regions).toEqual([]);
    for (const region of ['cn', 'intl', null, undefined]) {
      expect(settings.enabledFor(region)).toBe(false);
    }
  });

  it('cn only: on for a cn account, off for intl and for an account without a region', () => {
    const settings = toolRouterSettings(
      envSchema.parse({ ...BASE_ENV, TOOL_ROUTER_V2: 'true', TOOL_ROUTER_V2_REGIONS: 'cn' }),
    );
    expect(settings.regions).toEqual(['cn']);
    expect(settings.enabledFor('cn')).toBe(true);
    expect(settings.enabledFor('intl')).toBe(false);
    expect(settings.enabledFor(null)).toBe(false);
    expect(settings.enabledFor('CN')).toBe(false);
  });

  it('the master flag off wins over any region list', () => {
    const settings = toolRouterSettings(
      envSchema.parse({ ...BASE_ENV, TOOL_ROUTER_V2_REGIONS: 'cn,intl' }),
    );
    expect(settings.enabled).toBe(false);
    expect(settings.regions).toEqual([]);
    expect(settings.enabledFor('cn')).toBe(false);
    expect(settings.enabledFor('intl')).toBe(false);
  });

  it('parses a comma list, case and spaces tolerated, unknown entries ignored with a warning', () => {
    const warn = vi.fn();
    expect(toolRouterRegions(' CN , intl ,cn,, eu', warn)).toEqual(['cn', 'intl']);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(toolRouterRegions(undefined)).toEqual([]);
    const both = toolRouterSettings({
      TOOL_ROUTER_V2: true,
      TOOL_ROUTER_V2_REGIONS: 'cn,intl',
      DASHSCOPE_CN_API_KEY: 'k',
    });
    expect(both.enabledFor('cn')).toBe(true);
    expect(both.enabledFor('intl')).toBe(true);
  });
});

describe('「搜一下」: LEAK-1 keyword rule vs the router', () => {
  const INTENT = '帮我搜一下 2025 年诺贝尔文学奖得主是谁';
  const settings = toolRouterSettings({
    TOOL_ROUTER_V2: true,
    TOOL_ROUTER_V2_REGIONS: 'cn',
    TOOL_ROUTER_TOOLS: 'bailian_web_search',
    DASHSCOPE_CN_API_KEY: 'k',
  });
  const legacy = () => explainExecutionMode({ intent: INTENT, logger: fakeLogger() });

  it('router off for the user (intl): the mainline search-verb rule decides, the router never runs', async () => {
    const route = vi.fn(
      async (): Promise<ToolRouteDecision> => ({ lane: 'generate', source: 'tool-router:model' }),
    );
    const result = await decideExecutionRoute({
      enabled: settings.enabledFor('intl'),
      legacy,
      route,
    });
    expect(route).not.toHaveBeenCalled();
    expect(result.toolRoute).toBeNull();
    expect(result.decision).toMatchObject({ mode: 'scrape', source: 'kw:search-verb' });
  });

  it('router on for the user (cn): the router decides', async () => {
    const route = vi.fn(
      async (): Promise<ToolRouteDecision> => ({
        lane: 'interface',
        source: 'tool-router:model',
        toolId: 'bailian_web_search',
        title: '百炼联网搜索',
        query: '2025 年诺贝尔文学奖得主',
      }),
    );
    const result = await decideExecutionRoute({
      enabled: settings.enabledFor('cn'),
      legacy,
      route,
    });
    expect(route).toHaveBeenCalledTimes(1);
    expect(result.decision).toEqual({
      mode: 'scrape',
      source: 'tool-router:model',
      match: 'bailian_web_search',
    });
  });

  it('the router prompt tells the model a 「搜一下」 request is a lookup, not answer_directly', async () => {
    const create = vi.fn(async () => ({
      content: [
        {
          type: 'tool_use',
          id: 'call_1',
          name: 'choose_route',
          input: { choice: 'bailian_web_search', query: '2025 诺贝尔文学奖', reason: '联网查' },
        },
      ],
      stopReason: 'tool_use',
      usage: { inputTokens: 1, outputTokens: 1 },
    }));
    const messages = { metadata: {}, create } as unknown as MessagesAdapter;
    await routeTask({
      intent: INTENT,
      messages,
      tools: enabledInterfaceTools('bailian_web_search'),
    });
    const request = (create.mock.calls[0] as unknown as [{ system: string }])[0];
    expect(request.system).toContain('搜一下');
    expect(request.system).toContain('不要选 answer_directly');
  });
});
