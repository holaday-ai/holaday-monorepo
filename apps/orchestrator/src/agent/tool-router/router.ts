/**
 * REBUILD-2 part 2 — interface-tool routing (behind `TOOL_ROUTER_V2`, default off).
 *
 * Off: tasks.create decides with the legacy keyword classifier (`explainExecutionMode`) exactly
 * as before; nothing here runs.
 *
 * On, for every request the dedicated media / file lanes (image, video, template fill) do not
 * claim:
 *   1. Hard rule (2): an explicit 「打开 X / 在 X 上」 → browser (`explicit-site.ts`).
 *   2. Otherwise one small model turn (gateway role `judge`, forced tool, JSON schema) picks
 *      `answer_directly` (generate), one of the enabled interface tools, or `browser`.
 *   3. A price-comparison tool (`pricesAreCandidates`) never answers: it routes to the browser.
 *   4. An interface choice runs in the scrape lane through `interfaceSearchLane`; hard rule (1):
 *      any interface failure or empty result hands the task to the browser (tasks.ts).
 * A router model failure goes to the browser (never answered from memory).
 */
import type { Logger } from 'pino';
import { z } from 'zod';
import type { FirecrawlLane, FirecrawlSearchResultBundle } from '../../firecrawl/firecrawl-lane.js';
import type { MessagesAdapter } from '../../llm/messages-adapter.js';
import type { ExecutionModeDecision } from '../intent-classifier.js';
import type { BailianMcpClient, InterfaceSource } from './bailian-mcp-client.js';
import { explicitSiteRequest } from './explicit-site.js';
import type { CallableInterfaceTool } from './registry.js';

export const ANSWER_DIRECTLY = 'answer_directly';
export const BROWSER = 'browser';

export type ToolRouteDecision =
  | { lane: 'generate'; source: 'tool-router:model'; reason?: string }
  | {
      lane: 'browser';
      source:
        | 'tool-router:explicit-site'
        | 'tool-router:model'
        | 'tool-router:price-candidates'
        | 'tool-router:model-unavailable';
      match?: string;
      reason?: string;
      /** A price tool the model wanted: its rows are candidates, the price is read in the browser. */
      candidateToolId?: string;
      query?: string;
    }
  | {
      lane: 'interface';
      source: 'tool-router:model';
      toolId: string;
      title: string;
      query: string;
      reason?: string;
    };

/** Lanes the router never takes over: they are not a search / browser / generate choice. */
const DEDICATED_LANES: ReadonlySet<ExecutionModeDecision['mode']> = new Set([
  'image',
  'video_creation',
  'template_fill',
]);

/**
 * The single switch tasks.create calls. Flag off: the legacy classifier, and only it. Flag on:
 * the legacy classifier still claims the dedicated media / file lanes; everything else is the
 * router's decision.
 */
export async function decideExecutionRoute(opts: {
  enabled: boolean;
  legacy: () => Promise<ExecutionModeDecision>;
  route: () => Promise<ToolRouteDecision>;
}): Promise<{ decision: ExecutionModeDecision; toolRoute: ToolRouteDecision | null }> {
  const legacy = await opts.legacy();
  if (!opts.enabled || DEDICATED_LANES.has(legacy.mode))
    return { decision: legacy, toolRoute: null };
  const toolRoute = await opts.route();
  return { decision: toExecutionModeDecision(toolRoute), toolRoute };
}

/** The router's decision in the shape tasks.create stores as `executionModeReason`. */
export function toExecutionModeDecision(route: ToolRouteDecision): ExecutionModeDecision {
  if (route.lane === 'interface')
    return { mode: 'scrape', source: route.source, match: route.toolId };
  if (route.lane === 'generate') return { mode: 'generate', source: route.source };
  return {
    mode: 'browser',
    source: route.source,
    ...(route.match ? { match: route.match } : {}),
  };
}

const TOOL_NAME = 'choose_route';
const ROUTER_TIMEOUT_MS = 8_000;
const MAX_INTENT_CHARS = 2_000;

function routerSystem(tools: readonly CallableInterfaceTool[]): string {
  const toolLines = tools.map((tool) => `- ${tool.id}：${tool.description}`).join('\n');
  return `你是任务路由员。根据用户的请求，选一种方式完成它，调用 ${TOOL_NAME} 一次。

可选方式：
- ${ANSWER_DIRECTLY}：不用上网就能答好。写作、翻译、改写、解释概念、写代码、出方案，处理用户自己给的材料，以及不会随时间变化的常识。
${toolLines ? `${toolLines}\n` : ''}- ${BROWSER}：用云端浏览器打开网页去看、去操作。需要登录、点击、填写、发布、下单；要看某个指定网站或网页上的内容；某个商店里的商品、价格、库存、前几名结果；需要页面上的实时数字而接口给不准；其他方式都不合适时。

规则：
- 价格、库存这类会变的数字，答案必须来自实时页面，不能凭记忆，也不能只凭搜索摘要。
- 选接口工具时，query 写一条适合搜索的短查询（保留用户的关键词和语言）；其他方式 query 留空。
- reason 用一句话说明理由。
- The request may be in English or Chinese; apply the same rules.`;
}

function routerSchema(choices: readonly string[]) {
  return {
    type: 'object',
    properties: {
      choice: { type: 'string', enum: [...choices], description: '选中的方式' },
      query: { type: 'string', description: '接口工具的搜索查询；其他方式留空' },
      reason: { type: 'string', description: '一句话理由' },
    },
    required: ['choice', 'reason'],
  } as const;
}

const ChoiceSchema = z.object({
  choice: z.string().min(1).max(64),
  query: z.string().max(400).optional(),
  reason: z.string().max(400).optional(),
});

export interface RouteTaskInput {
  intent: string;
  /** The router model (gateway role `judge`); null when the lane is unavailable. */
  messages: MessagesAdapter | null;
  /** Enabled interface tools this user may use (`enabledInterfaceTools` + `toolsForRegion`). */
  tools: readonly CallableInterfaceTool[];
  logger?: Logger;
  timeoutMs?: number;
}

export async function routeTask(input: RouteTaskInput): Promise<ToolRouteDecision> {
  // Hard rule (2): the user named a site to open / to work on.
  const site = explicitSiteRequest(input.intent);
  if (site) return { lane: 'browser', source: 'tool-router:explicit-site', match: site };
  if (!input.messages) return { lane: 'browser', source: 'tool-router:model-unavailable' };

  const choices = [ANSWER_DIRECTLY, ...input.tools.map((tool) => tool.id), BROWSER];
  let parsed: z.infer<typeof ChoiceSchema>;
  try {
    const response = await input.messages.create(
      {
        maxTokens: 300,
        temperature: 0,
        thinking: { type: 'disabled' },
        system: routerSystem(input.tools),
        tools: [
          {
            name: TOOL_NAME,
            description: '选择完成这个请求的方式',
            inputSchema: routerSchema(choices) as unknown as Record<string, unknown>,
          },
        ],
        toolChoice: { type: 'tool', name: TOOL_NAME },
        messages: [
          {
            role: 'user',
            content: `<request>\n${input.intent.slice(0, MAX_INTENT_CHARS)}\n</request>`,
          },
        ],
      },
      { timeoutMs: input.timeoutMs ?? ROUTER_TIMEOUT_MS, maxRetries: 0 },
    );
    const call = response.content.find(
      (block) => block.type === 'tool_use' && block.name === TOOL_NAME,
    );
    const result = call && call.type === 'tool_use' ? ChoiceSchema.safeParse(call.input) : null;
    if (!result?.success || !choices.includes(result.data.choice)) {
      input.logger?.warn({ code: 'TOOL_ROUTER_INVALID_CHOICE' }, 'tool-router: invalid choice');
      return { lane: 'browser', source: 'tool-router:model-unavailable' };
    }
    parsed = result.data;
  } catch (error) {
    input.logger?.warn(
      { code: 'TOOL_ROUTER_FAILED', error: error instanceof Error ? error.name : 'unknown' },
      'tool-router: model call failed; routing to the browser',
    );
    return { lane: 'browser', source: 'tool-router:model-unavailable' };
  }

  const reason = parsed.reason?.trim() || undefined;
  if (parsed.choice === ANSWER_DIRECTLY)
    return { lane: 'generate', source: 'tool-router:model', ...(reason ? { reason } : {}) };
  if (parsed.choice === BROWSER)
    return { lane: 'browser', source: 'tool-router:model', ...(reason ? { reason } : {}) };
  const tool = input.tools.find((candidate) => candidate.id === parsed.choice)!;
  const query = parsed.query?.trim() || input.intent.trim().slice(0, 200);
  if (tool.pricesAreCandidates)
    return {
      lane: 'browser',
      source: 'tool-router:price-candidates',
      candidateToolId: tool.id,
      query,
      ...(reason ? { reason } : {}),
    };
  return {
    lane: 'interface',
    source: 'tool-router:model',
    toolId: tool.id,
    title: tool.title,
    query,
    ...(reason ? { reason } : {}),
  };
}

const SHANGHAI_TIME = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** 「来源：百炼联网搜索 · 2026-11-11 10:32」 (Beijing time). */
export function formatSourceLine(source: InterfaceSource): string {
  const parts = Object.fromEntries(
    SHANGHAI_TIME.formatToParts(new Date(source.at)).map((part) => [part.type, part.value]),
  );
  return `来源：${source.name} · ${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

/** The answer with the interface's source line at the end (added once). */
export function withInterfaceSource(summary: string, source: InterfaceSource | null): string {
  if (!source) return summary;
  const line = formatSourceLine(source);
  if (summary.includes(line)) return summary;
  return `${summary.trimEnd()}\n\n${line}`;
}

export interface InterfaceSearchLane extends FirecrawlLane {
  /** Where the last successful call's rows came from; null before one. */
  lastSource(): InterfaceSource | null;
  /** Why the last call failed; null when it succeeded or none ran. */
  lastFailure(): string | null;
}

/**
 * The interface in the scrape lane's source shape: `search` calls the tool with the router's
 * query (each row carries the source line, so the answer step sees where it came from), `scrape`
 * always fails — a page to read is the browser's (hard rule 1 hands it over). Credits stay 0:
 * interface calls are not Firecrawl credits.
 */
export function interfaceSearchLane(opts: {
  tool: CallableInterfaceTool;
  client: BailianMcpClient;
  query: string;
}): InterfaceSearchLane {
  let source: InterfaceSource | null = null;
  let failure: string | null = null;
  return {
    lastSource: () => source,
    lastFailure: () => failure,
    async scrape() {
      failure = 'page_not_supported';
      return { ok: false, error: `${opts.tool.id}: interface does not read pages` };
    },
    async search(_query, searchOpts): Promise<FirecrawlSearchResultBundle> {
      const result = await opts.client.call(
        opts.tool,
        opts.query,
        searchOpts?.signal ? { signal: searchOpts.signal } : {},
      );
      if (!result.ok) {
        failure = result.reason;
        // Empty is no error: the scrape lane reports it as `empty` and hands over to the browser.
        if (result.reason === 'empty') return { ok: true, results: [], credits: 0 };
        return { ok: false, error: `${opts.tool.id}: ${result.reason}` };
      }
      failure = null;
      source = result.source;
      const line = formatSourceLine(result.source);
      return {
        ok: true,
        credits: 0,
        results: result.results.map((row) => ({
          url: row.url,
          title: row.title,
          markdown: `# ${row.title || row.host || row.url}\n\n${row.snippet}\n\n${line}`,
        })),
      };
    },
  };
}
