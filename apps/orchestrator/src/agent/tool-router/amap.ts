/**
 * REBUILD-2 review #1 item 3 — 高德地图 (Bailian MCP `amap-maps`) as a router tool.
 *
 * The MCP tools take coordinates, not free text (tools/list probed 2026-11-11), so the router model
 * fills structured arguments (`amap: { action, origin, destination, mode, city, keywords }`) and this
 * file runs a fixed plan over one MCP session:
 *
 *   route   maps_geo(origin) + maps_geo(destination) → maps_direction_{driving|walking|bicycling|
 *           transit_integrated}
 *   place   maps_text_search(keywords, city)
 *   around  maps_geo(origin) → maps_around_search(keywords, location)
 *   weather maps_weather(city)
 *
 * A place geocoded only to a district / city / province (「西湖断桥」 → 西湖区) is not used as a
 * route end: the plan looks the name up as a POI (maps_text_search → maps_search_detail) and fails
 * as `imprecise` when that does not give a point. Any failure — including the trial key's daily
 * quota (`USER_DAILY_QUERY_OVER_LIMIT`) — ends the call, and the task goes to the browser (hard
 * rule 1). Nothing is guessed.
 */
import { z } from 'zod';
import type { InterfaceToolEntry } from './registry.js';
import {
  InterfaceCallError,
  type InterfaceRequest,
  type InterfaceResult,
  type McpContentItem,
  type McpSession,
} from './types.js';

export const AMAP_ACTIONS = ['route', 'place', 'around', 'weather'] as const;
export const AMAP_MODES = ['transit', 'driving', 'walking', 'bicycling'] as const;

const AmapArgsSchema = z
  .object({
    action: z.enum(AMAP_ACTIONS),
    origin: z.string().trim().min(1).max(80).optional(),
    destination: z.string().trim().min(1).max(80).optional(),
    mode: z.enum(AMAP_MODES).optional(),
    city: z.string().trim().min(1).max(30).optional(),
    keywords: z.string().trim().min(1).max(60).optional(),
  })
  .strip();
export type AmapArgs = z.infer<typeof AmapArgsSchema>;

/** The arguments a plan needs, or null (→ browser). */
export function parseAmapArgs(raw: unknown): AmapArgs | null {
  const parsed = AmapArgsSchema.safeParse(raw);
  if (!parsed.success) return null;
  const args = parsed.data;
  switch (args.action) {
    case 'route':
      return args.origin && args.destination ? args : null;
    case 'place':
      return args.keywords ? args : null;
    case 'around':
      return args.origin && args.keywords ? args : null;
    case 'weather':
      return args.city ? args : null;
  }
}

const AMAP_ROUTER_SCHEMA = {
  type: 'object',
  description: '只在选 amap_maps 时填写',
  properties: {
    action: {
      type: 'string',
      enum: [...AMAP_ACTIONS],
      description:
        'route=两地之间怎么走；place=找某个地点/店；around=某地附近的店或设施；weather=城市天气',
    },
    origin: { type: 'string', description: 'route 的起点；around 的中心地点（地名或地址原文）' },
    destination: { type: 'string', description: 'route 的终点（地名或地址原文）' },
    mode: {
      type: 'string',
      enum: [...AMAP_MODES],
      description:
        'route 的方式：transit=公交地铁（默认），driving=驾车，walking=步行，bicycling=骑行',
    },
    city: { type: 'string', description: '所在城市（中文），如 杭州；weather 必填' },
    keywords: { type: 'string', description: 'place / around 的搜索词，如 咖啡' },
  },
  required: ['action'],
} as const;

const MAX_SNIPPET_CHARS = 2_000;
/** Geocode levels too coarse to be a route end or a search centre. */
const COARSE_LEVELS = new Set(['国家', '省', '市', '区县', '开发区', '乡镇', '村庄', '热点商圈']);

interface Place {
  name: string;
  location: string;
  city?: string;
}

function textOf(content: readonly McpContentItem[]): string {
  return content
    .filter((item) => item.type === 'text' && typeof item.text === 'string')
    .map((item) => item.text as string)
    .join('\n');
}

function jsonOf(content: readonly McpContentItem[]): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(textOf(content));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** One tools/call; an error result becomes a failure (the daily quota is named). */
async function call(
  session: McpSession,
  name: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const result = await session.callTool(name, args);
  if (result.isError) {
    const text = textOf(result.content);
    if (/OVER_LIMIT|QUOTA|超出|限额/i.test(text))
      throw new InterfaceCallError('quota', text.slice(0, 120));
    throw new InterfaceCallError('tool_error', text.slice(0, 120));
  }
  const json = jsonOf(result.content);
  if (!json) throw new InterfaceCallError('malformed', name);
  return json;
}

const str = (value: unknown): string => (typeof value === 'string' ? value : '');
const LOCATION = /^-?\d{1,3}\.\d+,-?\d{1,2}\.\d+$/;

async function poiPlace(
  session: McpSession,
  name: string,
  city: string | undefined,
): Promise<Place | null> {
  const found = await call(session, 'maps_text_search', {
    keywords: name,
    ...(city ? { city, citylimit: true } : {}),
  });
  const poi = (Array.isArray(found.pois) ? found.pois : [])[0] as
    | Record<string, unknown>
    | undefined;
  if (!poi) return null;
  let location = str(poi.location);
  if (!LOCATION.test(location) && str(poi.id)) {
    const detail = await call(session, 'maps_search_detail', { id: str(poi.id) });
    location = str(detail.location);
  }
  if (!LOCATION.test(location)) return null;
  return {
    name: str(poi.name) || name,
    location,
    ...(str(poi.city) ? { city: str(poi.city) } : {}),
  };
}

/** A point for a named place: a precise geocode, else the first POI of that name. */
async function locate(session: McpSession, name: string, city: string | undefined): Promise<Place> {
  const geo = await call(session, 'maps_geo', { address: name, ...(city ? { city } : {}) });
  const first = (Array.isArray(geo.results) ? geo.results : [])[0] as
    | Record<string, unknown>
    | undefined;
  const location = str(first?.location);
  const placeCity = str(first?.city) || city;
  if (first && LOCATION.test(location) && !COARSE_LEVELS.has(str(first.level)))
    return { name, location, ...(placeCity ? { city: placeCity } : {}) };
  const poi = await poiPlace(session, name, placeCity || undefined);
  if (!poi) throw new InterfaceCallError('imprecise', name.slice(0, 40));
  return { ...poi, name, ...(poi.city || placeCity ? { city: poi.city ?? placeCity } : {}) };
}

const minutes = (seconds: unknown): string => {
  const value = Number(seconds);
  return Number.isFinite(value) && value > 0 ? `${Math.round(value / 60)} 分钟` : '';
};
const km = (meters: unknown): string => {
  const value = Number(meters);
  return Number.isFinite(value) && value > 0 ? `${(value / 1000).toFixed(1)} 公里` : '';
};

function summariseTransit(route: Record<string, unknown>): string {
  const transits = (Array.isArray(route.transits) ? route.transits : []) as Array<
    Record<string, unknown>
  >;
  const lines = transits.slice(0, 3).map((transit, index) => {
    const segments = (Array.isArray(transit.segments) ? transit.segments : []) as Array<
      Record<string, unknown>
    >;
    const legs = segments.flatMap((segment) => {
      const bus = segment.bus as { buslines?: Array<Record<string, unknown>> } | undefined;
      const line = bus?.buslines?.[0];
      if (!line) return [];
      const from = str((line.departure_stop as Record<string, unknown> | undefined)?.name);
      const to = str((line.arrival_stop as Record<string, unknown> | undefined)?.name);
      return [`${str(line.name)}${from && to ? `（${from} → ${to}）` : ''}`];
    });
    const walk = km(transit.walking_distance);
    return `方案${index + 1}：约 ${minutes(transit.duration) || '?'}${walk ? `，步行 ${walk}` : ''}；${legs.join(' → ') || '全程步行'}`;
  });
  const total = km(route.distance);
  return [total ? `全程约 ${total}` : '', ...lines].filter(Boolean).join('\n');
}

function summarisePaths(route: Record<string, unknown>): string {
  const inner = (route.route as Record<string, unknown> | undefined) ?? route;
  const paths = (Array.isArray(inner.paths) ? inner.paths : []) as Array<Record<string, unknown>>;
  const path = paths[0];
  if (!path) return '';
  const steps = (Array.isArray(path.steps) ? path.steps : []) as Array<Record<string, unknown>>;
  const head = [km(path.distance), minutes(path.duration)].filter(Boolean).join('，约 ');
  const lines = steps
    .slice(0, 12)
    .map((step) => str(step.instruction))
    .filter(Boolean);
  return [head ? `全程约 ${head}` : '', ...lines].filter(Boolean).join('\n');
}

function rawSnippet(json: Record<string, unknown>): string {
  return JSON.stringify(json).slice(0, MAX_SNIPPET_CHARS);
}

const MODE_TOOL: Record<(typeof AMAP_MODES)[number], string> = {
  transit: 'maps_direction_transit_integrated',
  driving: 'maps_direction_driving',
  walking: 'maps_direction_walking',
  bicycling: 'maps_direction_bicycling',
};
const MODE_LABEL: Record<(typeof AMAP_MODES)[number], string> = {
  transit: '公交地铁',
  driving: '驾车',
  walking: '步行',
  bicycling: '骑行',
};
const MODE_URI: Record<(typeof AMAP_MODES)[number], string> = {
  transit: 'bus',
  driving: 'car',
  walking: 'walk',
  bicycling: 'ride',
};

/** amap.com's own link for the route (opens the same plan on 高德). */
function navigationUrl(from: Place, to: Place, mode: (typeof AMAP_MODES)[number]): string {
  const point = (place: Place) => `${place.location},${encodeURIComponent(place.name)}`;
  return `https://uri.amap.com/navigation?from=${point(from)}&to=${point(to)}&mode=${MODE_URI[mode]}&callnative=0`;
}

function poiRows(found: Record<string, unknown>, label: string): InterfaceResult[] {
  const pois = (Array.isArray(found.pois) ? found.pois : []) as Array<Record<string, unknown>>;
  return pois.slice(0, 8).flatMap((poi) => {
    const id = str(poi.id);
    const name = str(poi.name);
    if (!id || !name) return [];
    const details = [
      str(poi.address) && `地址：${str(poi.address)}`,
      str(poi.distance) && `距离：${str(poi.distance)} 米`,
      str(poi.typecode) && `类型码：${str(poi.typecode)}`,
    ].filter(Boolean);
    return [
      {
        title: `${label}：${name}`,
        url: `https://www.amap.com/place/${encodeURIComponent(id)}`,
        snippet: details.join('；').slice(0, MAX_SNIPPET_CHARS),
        host: 'amap.com',
      },
    ];
  });
}

export async function runAmap(
  session: McpSession,
  request: InterfaceRequest,
): Promise<InterfaceResult[]> {
  const args = parseAmapArgs(request.args);
  if (!args) throw new InterfaceCallError('invalid_arguments');
  switch (args.action) {
    case 'route': {
      const mode = args.mode ?? 'transit';
      const from = await locate(session, args.origin!, args.city);
      const to = await locate(session, args.destination!, args.city);
      const route = await call(session, MODE_TOOL[mode], {
        origin: from.location,
        destination: to.location,
        ...(mode === 'transit'
          ? { city: from.city ?? args.city ?? '', cityd: to.city ?? args.city ?? '' }
          : {}),
      });
      const summary = mode === 'transit' ? summariseTransit(route) : summarisePaths(route);
      if (!summary) return [];
      return [
        {
          title: `高德地图${MODE_LABEL[mode]}路线：${args.origin} → ${args.destination}`,
          url: navigationUrl(from, to, mode),
          snippet: summary.slice(0, MAX_SNIPPET_CHARS),
          host: 'amap.com',
        },
      ];
    }
    case 'place': {
      const found = await call(session, 'maps_text_search', {
        keywords: args.keywords!,
        ...(args.city ? { city: args.city, citylimit: true } : {}),
      });
      return poiRows(found, '高德地图地点');
    }
    case 'around': {
      const centre = await locate(session, args.origin!, args.city);
      const found = await call(session, 'maps_around_search', {
        keywords: args.keywords!,
        location: centre.location,
        radius: '1000',
      });
      return poiRows(found, `高德地图 ${args.origin} 附近`);
    }
    case 'weather': {
      const weather = await call(session, 'maps_weather', { city: args.city! });
      const forecasts = (Array.isArray(weather.forecasts) ? weather.forecasts : []) as Array<
        Record<string, unknown>
      >;
      if (forecasts.length === 0) return [];
      const lines = forecasts.map(
        (day) =>
          `${str(day.date)}：白天${str(day.dayweather)} ${str(day.daytemp)}℃，夜间${str(day.nightweather)} ${str(day.nighttemp)}℃，${str(day.daywind)}风 ${str(day.daypower)} 级`,
      );
      return [
        {
          title: `高德地图天气：${str(weather.city) || args.city}`,
          url: 'https://www.amap.com/',
          snippet: lines.join('\n').slice(0, MAX_SNIPPET_CHARS) || rawSnippet(weather),
          host: 'amap.com',
        },
      ];
    }
  }
}

export const AMAP_MAPS: InterfaceToolEntry = {
  id: 'amap_maps',
  title: '高德地图',
  titleEn: 'Amap',
  kind: 'map',
  siteAliases: ['高德地图', '高德', 'amap', 'gaode'],
  description:
    '高德地图接口：两地之间的路线（公交地铁/驾车/步行/骑行，含时长和距离）、找地点、某地附近的店或设施、城市天气预报。选它时必须填 amap 参数。不适合：要在高德网页上登录或操作、需要实时路况截图。',
  serviceCode: 'amap-maps',
  mcpTool: null,
  buildArguments: null,
  readResults: null,
  run: runAmap,
  routerArguments: { key: 'amap', schema: AMAP_ROUTER_SCHEMA, parse: parseAmapArgs },
  pricesAreCandidates: false,
  regions: ['cn'],
};
