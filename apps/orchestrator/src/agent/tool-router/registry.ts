import { AMAP_MAPS } from './amap.js';
import type {
  InterfaceRequest,
  InterfaceResult,
  McpContentItem,
  McpSession,
  RouterArguments,
} from './types.js';

export {
  InterfaceCallError,
  type InterfaceCallFailure,
  type InterfaceRequest,
  type InterfaceResult,
  type McpContentItem,
  type McpSession,
  type RouterArguments,
} from './types.js';

/**
 * REBUILD-2 part 2 — the interface tools the router may offer next to the browser.
 *
 * One entry per interface. An entry is offered only when its id is listed in
 * `TOOL_ROUTER_TOOLS` (default `bailian_web_search,amap_maps`) AND it has a call shape (service code + MCP
 * tool + argument builder + result reader, or a multi-step `run`). Entries that still need BOSS to
 * enable the service in the Bailian console (快递100 / 值得买 / 网页解析) or whose service code is
 * unknown (慢慢买)
 * carry no call shape yet: listing them in the config is ignored with a warning until the shape is
 * filled in after a real probe.
 *
 * Price-comparison interfaces set `pricesAreCandidates`: their rows are candidates only, the
 * price itself is always read in the browser (REBUILD-1 G: search snippets were stale or from the
 * wrong store for every price question tried).
 */

export type InterfaceToolKind = 'search' | 'map' | 'express' | 'price' | 'page';

export interface InterfaceToolEntry {
  /** Registry id, used in `TOOL_ROUTER_TOOLS` and in the router's tool choice. */
  id: string;
  /** Name shown to the user in the source line (「来源：<title> · <time>」). */
  title: string;
  /** The same name in English tasks (「Source: <titleEn> · <time>」). */
  titleEn: string;
  /**
   * The site this interface serves, as users name it (「在高德地图上查」「用高德查路线」). An info
   * query that names it goes to this interface; only 「打开…网页/网站」 or operating on the page
   * goes to the browser (review #1 item 3).
   */
  siteAliases?: readonly string[];
  kind: InterfaceToolKind;
  /** What the router model is told the tool is good and bad for. */
  description: string;
  /** Bailian MCP service code (`/api/v1/mcps/{code}/mcp`); null when not known. */
  serviceCode: string | null;
  /** The MCP tool name inside the service; null until probed after enabling. */
  mcpTool: string | null;
  /** Builds the `tools/call` arguments from the router's query. */
  buildArguments: ((query: string) => Record<string, unknown>) | null;
  /** Reads the `tools/call` result content into rows; null until probed. */
  readResults: ((content: readonly McpContentItem[]) => InterfaceResult[]) | null;
  /**
   * A fixed multi-step plan over one MCP session (高德: geocode → route). When set it replaces
   * `mcpTool` / `buildArguments` / `readResults`. Throws InterfaceCallError to fail.
   */
  run?: (session: McpSession, request: InterfaceRequest) => Promise<InterfaceResult[]>;
  routerArguments?: RouterArguments;
  /** Price rows are candidates only: the price must still come from the browser. */
  pricesAreCandidates: boolean;
  /** Model data regions whose users may send queries to this interface. */
  regions: readonly ('cn' | 'intl')[];
  /** Why the entry is not usable yet (reported, never shown to users). */
  pending?: string;
}

const MAX_SNIPPET_CHARS = 1_200;

/**
 * Bailian web-search MCP result: one text item holding `{"pages":[{title,url,hostname,snippet}]}`
 * (REBUILD-1 G, 20/20 calls on both services). Rows without a URL are dropped.
 */
export function readBailianSearchPages(content: readonly McpContentItem[]): InterfaceResult[] {
  const rows: InterfaceResult[] = [];
  for (const item of content) {
    if (item.type !== 'text' || !item.text) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(item.text);
    } catch {
      continue;
    }
    const pages = (parsed as { pages?: unknown })?.pages;
    if (!Array.isArray(pages)) continue;
    for (const page of pages) {
      if (!page || typeof page !== 'object') continue;
      const { title, url, snippet, hostname } = page as Record<string, unknown>;
      if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) continue;
      rows.push({
        title: typeof title === 'string' ? title.trim() : '',
        url,
        snippet: typeof snippet === 'string' ? snippet.trim().slice(0, MAX_SNIPPET_CHARS) : '',
        ...(typeof hostname === 'string' && hostname ? { host: hostname } : {}),
      });
    }
  }
  return rows;
}

const SEARCH_GOOD_FOR =
  '适合：新闻、百科事实、天气、公开的指数/汇率等常识性实时信息，答案能从几条网页摘要里读出来。不适合：某个网站上的商品列表或价格、需要登录或操作页面、指定网站上的内容、路线导航。';

export const INTERFACE_TOOLS: readonly InterfaceToolEntry[] = [
  {
    id: 'bailian_web_search',
    title: '百炼联网搜索',
    titleEn: 'Bailian Web Search',
    kind: 'search',
    description: `联网搜索，返回 5 条网页标题、链接和摘要（无发布时间）。${SEARCH_GOOD_FOR}`,
    serviceCode: 'WebSearch',
    mcpTool: 'bailian_web_search',
    buildArguments: (query) => ({ query, count: 5 }),
    readResults: readBailianSearchPages,
    pricesAreCandidates: false,
    regions: ['cn'],
  },
  {
    id: 'bailian_search_pro',
    title: '百炼联网搜索增强版',
    titleEn: 'Bailian Enhanced Search',
    kind: 'search',
    description: `联网搜索增强版，返回 3–10 条网页标题、链接和摘要（无发布时间），比联网搜索快。${SEARCH_GOOD_FOR}`,
    serviceCode: 'EnhancedSearch',
    mcpTool: 'search_pro',
    buildArguments: (query) => ({ query }),
    readResults: readBailianSearchPages,
    pricesAreCandidates: false,
    regions: ['cn'],
  },
  AMAP_MAPS,
  {
    id: 'kuaidi100',
    title: '快递100',
    titleEn: 'Kuaidi100',
    kind: 'express',
    description: '快递100：按单号查物流轨迹。',
    serviceCode: 'kuaidi100-mcp',
    mcpTool: null,
    buildArguments: null,
    readResults: null,
    pricesAreCandidates: false,
    regions: ['cn'],
    pending: 'BOSS 需开通 kuaidi100-mcp（可能还要快递100 自己的 key）',
  },
  {
    id: 'zhidemai',
    title: '什么值得买',
    titleEn: 'SMZDM',
    kind: 'price',
    description: '什么值得买：商品好价候选（价格只作候选，必须在浏览器页面上核实）。',
    serviceCode: 'zhidemai',
    mcpTool: null,
    buildArguments: null,
    readResults: null,
    pricesAreCandidates: true,
    regions: ['cn'],
    pending: 'BOSS 需开通 zhidemai，并确认就是「什么值得买」',
  },
  {
    id: 'manmanbuy',
    title: '慢慢买',
    titleEn: 'Manmanbuy',
    kind: 'price',
    description: '慢慢买：比价与历史价格候选（价格只作候选，必须在浏览器页面上核实）。',
    serviceCode: null,
    mcpTool: null,
    buildArguments: null,
    readResults: null,
    pricesAreCandidates: true,
    regions: ['cn'],
    pending: '服务代码未找到：请 BOSS 在 MCP 广场搜「慢慢买 / 比价」',
  },
  {
    id: 'web_parser',
    title: '百炼网页解析',
    titleEn: 'Bailian Web Parser',
    kind: 'page',
    description: '网页解析：读取一个给定网址的正文。',
    serviceCode: 'WebParser',
    mcpTool: null,
    buildArguments: null,
    readResults: null,
    pricesAreCandidates: false,
    regions: ['cn'],
    pending: 'BOSS 需开通 WebParser',
  },
];

/** An entry the router can actually call: a service code and a single call or a plan. */
export type CallableInterfaceTool = InterfaceToolEntry & { serviceCode: string };

export function isCallable(entry: InterfaceToolEntry): entry is CallableInterfaceTool {
  if (!entry.serviceCode) return false;
  if (entry.run) return true;
  return Boolean(entry.mcpTool && entry.buildArguments && entry.readResults);
}

/** Review #1 item 3: 高德 is on by default in the candidate (BOSS enabled amap-maps). */
export const DEFAULT_TOOL_ROUTER_TOOLS = 'bailian_web_search,amap_maps';

/**
 * `TOOL_ROUTER_TOOLS` → the callable entries it enables, in registry order. Unknown ids and
 * entries without a call shape yet are ignored with a warning; an empty list enables nothing.
 */
export function enabledInterfaceTools(
  raw: string | undefined,
  options: { warn?: (message: string) => void; registry?: readonly InterfaceToolEntry[] } = {},
): CallableInterfaceTool[] {
  const registry = options.registry ?? INTERFACE_TOOLS;
  const warn = options.warn ?? (() => {});
  const ids = new Set(
    (raw ?? DEFAULT_TOOL_ROUTER_TOOLS)
      .split(',')
      .map((id) => id.trim().toLowerCase())
      .filter(Boolean),
  );
  for (const id of ids) {
    const entry = registry.find((candidate) => candidate.id === id);
    if (!entry) warn(`TOOL_ROUTER_TOOLS: unknown tool "${id.slice(0, 40)}" ignored`);
    else if (!isCallable(entry))
      warn(`TOOL_ROUTER_TOOLS: "${id}" is not callable yet (${entry.pending ?? 'no call shape'})`);
  }
  return registry.filter((entry): entry is CallableInterfaceTool => {
    return ids.has(entry.id) && isCallable(entry);
  });
}

/** The enabled tools a user of this model data region may use (queries stay in-region). */
export function toolsForRegion(
  tools: readonly CallableInterfaceTool[],
  region: 'cn' | 'intl' | null,
): CallableInterfaceTool[] {
  return region ? tools.filter((tool) => tool.regions.includes(region)) : [];
}
