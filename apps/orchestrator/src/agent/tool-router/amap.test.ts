import { describe, expect, it, vi } from 'vitest';
import { parseAmapArgs, runAmap } from './amap.js';
import { createBailianMcpClient } from './bailian-mcp-client.js';
import { enabledInterfaceTools } from './registry.js';
import { InterfaceCallError, type McpSession } from './types.js';

/**
 * Shapes recorded from the live amap-maps MCP on 2026-11-11 (tools/list + one call each;
 * ~/.holaday-recovery/tasks/rebuild-2/probe/amap-calls.json), trimmed.
 */
const GEO_EAST_STATION = {
  results: [
    { city: '杭州市', district: '上城区', location: '120.212600,30.290851', level: '门牌号' },
  ],
};
/** 「西湖断桥」 geocodes only to the district: not a route end. */
const GEO_DUANQIAO_COARSE = {
  results: [
    { city: '杭州市', district: '西湖区', location: '120.130396,30.259242', level: '区县' },
  ],
};
const POI_DUANQIAO = { pois: [{ id: 'B023B173VP', name: '断桥残雪', address: '北山街' }] };
const DETAIL_DUANQIAO = { id: 'B023B173VP', name: '断桥残雪', location: '120.151510,30.258870' };
const TRANSIT = {
  origin: '120.212600,30.290851',
  destination: '120.151510,30.258870',
  distance: '11408',
  transits: [
    {
      duration: '3270',
      walking_distance: '819',
      segments: [
        {
          bus: {
            buslines: [
              {
                name: '8028路(火车东站西--浙大玉泉校区)',
                departure_stop: { name: '火车东站西' },
                arrival_stop: { name: '浙大附中' },
              },
            ],
          },
        },
        { bus: { buslines: [] } },
      ],
    },
    {
      duration: '3731',
      walking_distance: '2777',
      segments: [
        {
          bus: {
            buslines: [
              {
                name: '地铁1号线(萧山国际机场--湘湖)',
                departure_stop: { name: '火车东站' },
                arrival_stop: { name: '西湖文化广场' },
              },
            ],
          },
        },
      ],
    },
  ],
};
const WEATHER = {
  city: '杭州市',
  forecasts: [
    {
      date: '2026-11-11',
      dayweather: '晴',
      nightweather: '多云',
      daytemp: '17',
      nighttemp: '11',
      daywind: '东北',
      daypower: '1-3',
    },
  ],
};
const QUOTA = 'API 调用失败：USER_DAILY_QUERY_OVER_LIMIT';

type Reply = Record<string, unknown> | { error: string };
function fakeSession(replies: Record<string, Reply | ((args: Record<string, unknown>) => Reply)>) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const session: McpSession = {
    async callTool(name, args) {
      calls.push({ name, args });
      const entry = replies[name];
      const reply = typeof entry === 'function' ? entry(args) : entry;
      if (!reply) throw new Error(`unexpected tool ${name}`);
      if ('error' in reply && typeof reply.error === 'string')
        return { isError: true, content: [{ type: 'text', text: reply.error }] };
      return { isError: false, content: [{ type: 'text', text: JSON.stringify(reply) }] };
    },
  };
  return { session, calls };
}

describe('parseAmapArgs', () => {
  it('accepts each action only with what it needs', () => {
    expect(parseAmapArgs({ action: 'route', origin: '杭州东站', destination: '断桥' })).toEqual({
      action: 'route',
      origin: '杭州东站',
      destination: '断桥',
    });
    expect(parseAmapArgs({ action: 'route', origin: '杭州东站' })).toBeNull();
    expect(parseAmapArgs({ action: 'place' })).toBeNull();
    expect(parseAmapArgs({ action: 'around', origin: '西湖', keywords: '咖啡' })).not.toBeNull();
    expect(parseAmapArgs({ action: 'weather', city: '杭州' })).not.toBeNull();
    expect(parseAmapArgs({ action: 'teleport' })).toBeNull();
    expect(parseAmapArgs(undefined)).toBeNull();
  });
});

describe('runAmap', () => {
  it('route: geocodes both ends, looks a coarse one up as a POI, and summarises transit', async () => {
    const { session, calls } = fakeSession({
      maps_geo: (args) => (args.address === '杭州东站' ? GEO_EAST_STATION : GEO_DUANQIAO_COARSE),
      maps_text_search: POI_DUANQIAO,
      maps_search_detail: DETAIL_DUANQIAO,
      maps_direction_transit_integrated: TRANSIT,
    });
    const rows = await runAmap(session, {
      query: '杭州东站到断桥怎么走',
      args: { action: 'route', origin: '杭州东站', destination: '西湖断桥', city: '杭州' },
    });
    expect(calls.map((call) => call.name)).toEqual([
      'maps_geo',
      'maps_geo',
      'maps_text_search',
      'maps_search_detail',
      'maps_direction_transit_integrated',
    ]);
    // The district centre (120.130396) is never used as the destination.
    expect(calls[4]?.args).toEqual({
      origin: '120.212600,30.290851',
      destination: '120.151510,30.258870',
      city: '杭州市',
      cityd: '杭州市',
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.title).toBe('高德地图公交地铁路线：杭州东站 → 西湖断桥');
    expect(rows[0]?.url).toMatch(
      /^https:\/\/uri\.amap\.com\/navigation\?from=120\.212600,30\.290851,/,
    );
    expect(rows[0]?.snippet).toContain('全程约 11.4 公里');
    expect(rows[0]?.snippet).toContain(
      '方案1：约 55 分钟，步行 0.8 公里；8028路(火车东站西--浙大玉泉校区)（火车东站西 → 浙大附中）',
    );
    expect(rows[0]?.snippet).toContain('地铁1号线');
  });

  it('route: a coarse place the POI search cannot pin down fails as imprecise (→ browser)', async () => {
    const { session } = fakeSession({
      maps_geo: GEO_DUANQIAO_COARSE,
      maps_text_search: { pois: [] },
    });
    await expect(
      runAmap(session, {
        query: 'q',
        args: { action: 'route', origin: '断桥', destination: '断桥' },
      }),
    ).rejects.toMatchObject({ reason: 'imprecise' });
  });

  it('names the trial key daily quota, and fails a tool error (both → browser)', async () => {
    const quota = fakeSession({
      maps_geo: GEO_DUANQIAO_COARSE,
      maps_text_search: { error: QUOTA },
    });
    await expect(
      runAmap(quota.session, {
        query: 'q',
        args: { action: 'route', origin: '断桥', destination: '断桥' },
      }),
    ).rejects.toMatchObject({ reason: 'quota' });
    const broken = fakeSession({ maps_weather: { error: 'INVALID_PARAMS' } });
    await expect(
      runAmap(broken.session, { query: 'q', args: { action: 'weather', city: '杭州' } }),
    ).rejects.toBeInstanceOf(InterfaceCallError);
  });

  it('refuses to run without usable arguments', async () => {
    const { session, calls } = fakeSession({});
    await expect(runAmap(session, { query: '杭州东站到断桥' })).rejects.toMatchObject({
      reason: 'invalid_arguments',
    });
    expect(calls).toEqual([]);
  });

  it('weather, place and around read their rows', async () => {
    const weather = await runAmap(fakeSession({ maps_weather: WEATHER }).session, {
      query: 'q',
      args: { action: 'weather', city: '杭州' },
    });
    expect(weather[0]?.snippet).toBe('2026-11-11：白天晴 17℃，夜间多云 11℃，东北风 1-3 级');

    const place = await runAmap(fakeSession({ maps_text_search: POI_DUANQIAO }).session, {
      query: 'q',
      args: { action: 'place', keywords: '断桥', city: '杭州' },
    });
    expect(place).toEqual([
      {
        title: '高德地图地点：断桥残雪',
        url: 'https://www.amap.com/place/B023B173VP',
        snippet: '地址：北山街',
        host: 'amap.com',
      },
    ]);

    const around = fakeSession({
      maps_geo: GEO_EAST_STATION,
      maps_around_search: {
        pois: [{ id: 'P1', name: '星巴克', address: '东站', distance: '120' }],
      },
    });
    const rows = await runAmap(around.session, {
      query: 'q',
      args: { action: 'around', origin: '杭州东站', keywords: '咖啡' },
    });
    expect(around.calls[1]?.args).toEqual({
      keywords: '咖啡',
      location: '120.212600,30.290851',
      radius: '1000',
    });
    expect(rows[0]?.snippet).toBe('地址：东站；距离：120 米');
  });

  it('runs through the MCP client on one session and returns the 高德 source', async () => {
    const [amap] = enabledInterfaceTools('amap_maps');
    const seen: string[] = [];
    const fetchFn = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      if (body.method === 'initialize')
        return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: {} }), {
          headers: { 'content-type': 'application/json', 'mcp-session-id': 's-1' },
        });
      if (body.method === 'notifications/initialized') return new Response('', { status: 202 });
      seen.push(body.params.name);
      return new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: body.id,
          result: { content: [{ type: 'text', text: JSON.stringify(WEATHER) }], isError: false },
        }),
        { headers: { 'content-type': 'application/json' } },
      );
    }) as unknown as typeof fetch;
    const client = createBailianMcpClient({
      apiKey: 'sk-test0000000000000000',
      fetch: fetchFn,
      now: () => new Date('2026-11-11T02:30:00.000Z'),
    });
    const result = await client.call(amap!, '杭州天气', {
      args: { action: 'weather', city: '杭州' },
    });
    expect(seen).toEqual(['maps_weather']);
    expect(result).toMatchObject({
      ok: true,
      source: { name: '高德地图', nameEn: 'Amap', at: '2026-11-11T02:30:00.000Z' },
    });
    // Without arguments the plan never calls a tool and the call fails (→ browser).
    seen.length = 0;
    expect(await client.call(amap!, '杭州天气')).toEqual({
      ok: false,
      reason: 'invalid_arguments',
    });
    expect(seen).toEqual([]);
  });
});
