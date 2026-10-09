/**
 * Unified browser tool set shared by the cloud browser and the Chrome
 * extension executors (batch 04 §4.2). The model always sees the same tools
 * whichever brain (千问 / Claude / GPT) is selected in the model catalog.
 *
 * Element addressing uses Playwright's built-in AI aria snapshot
 * (`ariaSnapshot({ mode: 'ai' })` → `[ref=eN]`) and `aria-ref=eN` locators —
 * the same mechanism as Playwright MCP — instead of a hand-written DOM walker.
 * Coordinate clicks exist only as a fallback for canvas / captcha regions.
 */
import type { NeutralToolDefinition } from '../../llm/messages-adapter.js';

export const UNIFIED_BROWSER_TOOL_NAMES = [
  'snapshot',
  'click',
  'type',
  'select',
  'scroll',
  'navigate',
  'extract',
  'screenshot',
  'wait_for',
  'back',
  'download',
  'upload',
  'click_at',
] as const;
export type UnifiedBrowserToolName = (typeof UNIFIED_BROWSER_TOOL_NAMES)[number];

const ref = {
  type: 'string',
  pattern: '^e[0-9]+$',
  description: '最新 snapshot 中元素的 ref，例如 e12。',
} as const;
const expectation = {
  type: 'string',
  maxLength: 200,
  description: '一句话说明这一步预期看到的结果，用于核对。',
} as const;

export const UNIFIED_BROWSER_TOOLS: ReadonlyArray<NeutralToolDefinition> = [
  {
    name: 'snapshot',
    description:
      '读取当前页面的可访问性树（带元素 ref）。每次动作前先 snapshot，ref 只在最新快照内有效。',
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
  },
  {
    name: 'click',
    description: '点击最新 snapshot 中的元素。',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: { ref, expect: expectation },
      required: ['ref'],
    },
  },
  {
    name: 'type',
    description: '在输入框中填写文本；submit=true 时随后按回车提交。',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        ref,
        text: { type: 'string', maxLength: 16_000 },
        submit: { type: 'boolean' },
        expect: expectation,
      },
      required: ['ref', 'text'],
    },
  },
  {
    name: 'select',
    description: '在下拉框中按可见文本或值选择一项。',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: { ref, value: { type: 'string', minLength: 1 }, expect: expectation },
      required: ['ref', 'value'],
    },
  },
  {
    name: 'scroll',
    description: '滚动页面（或滚动到某个元素）。',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        direction: { type: 'string', enum: ['down', 'up'] },
        ref,
        amount: { type: 'integer', minimum: 1, maximum: 10 },
      },
    },
  },
  {
    name: 'navigate',
    description:
      '打开一个网址。不要直接打开百度/Google 搜索结果页，需要搜索时先用 web_search 拿到网址。',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: { url: { type: 'string', format: 'uri', maxLength: 2048 } },
      required: ['url'],
    },
  },
  {
    name: 'extract',
    description: '按给定字段从当前页面抽取结构化数据（表格、列表、价格等）。',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        instruction: { type: 'string', minLength: 1, maxLength: 2000 },
        fields: { type: 'array', items: { type: 'string' }, maxItems: 30 },
      },
      required: ['instruction'],
    },
  },
  {
    name: 'screenshot',
    description: '截取当前视口截图（仅在可访问性树不足以理解页面时使用）。',
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
  },
  {
    name: 'wait_for',
    description: '等待文本出现、元素出现或网络空闲。',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        text: { type: 'string', minLength: 1 },
        ref,
        networkIdle: { type: 'boolean' },
        timeoutMs: { type: 'integer', minimum: 100, maximum: 30_000 },
      },
    },
  },
  {
    name: 'back',
    description: '浏览器后退一页。',
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
  },
  {
    name: 'download',
    description: '点击下载链接/按钮并保存文件。',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: { ref },
      required: ['ref'],
    },
  },
  {
    name: 'upload',
    description: '向文件输入框上传用户已提供的附件（fileId 来自任务附件）。',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: { ref, fileIds: { type: 'array', items: { type: 'string' }, minItems: 1 } },
      required: ['ref', 'fileIds'],
    },
  },
  {
    name: 'click_at',
    description: '兜底：按截图坐标点击（仅限 canvas 等没有 ref 的区域；验证码一律交给人工）。',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        x: { type: 'integer', minimum: 0 },
        y: { type: 'integer', minimum: 0 },
      },
      required: ['x', 'y'],
    },
  },
];

export type BrowserObservationContext = {
  tabId?: string;
  frameId?: string;
  observationRevision?: string;
};

export type ObservationAction =
  | { tool: 'read_page' }
  | { tool: 'get_page_text'; cursor?: string; maxChars?: number }
  | { tool: 'links' | 'tables'; start?: number; limit?: number }
  | {
      tool: 'scroll_until';
      maxSteps?: number;
      maxMs?: number;
      maxChars?: number;
      maxItems?: number;
      maxTokens?: number;
    }
  | { tool: 'list_tabs' }
  | { tool: 'switch_tab'; targetTabId: string };

export type UnifiedBrowserAction = (
  | ObservationAction
  | { tool: 'snapshot' }
  | { tool: 'click'; ref: string }
  | { tool: 'type'; ref: string; text: string; submit?: boolean }
  | { tool: 'select'; ref: string; value: string }
  | { tool: 'scroll'; direction?: 'down' | 'up'; ref?: string; amount?: number }
  | { tool: 'navigate'; url: string }
  | { tool: 'extract'; instruction: string; fields?: string[] }
  | { tool: 'screenshot' }
  | { tool: 'wait_for'; text?: string; ref?: string; networkIdle?: boolean; timeoutMs?: number }
  | { tool: 'back' }
  | { tool: 'download'; ref: string }
  | { tool: 'upload'; ref: string; fileIds: string[] }
  | { tool: 'click_at'; x: number; y: number }
) &
  BrowserObservationContext;

export class UnifiedToolInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnifiedToolInputError';
  }
}

const REF_RE = /^e[0-9]+$/;

/** Validates a model tool call into a typed action; throws a model-readable error. */
export function parseUnifiedBrowserAction(name: string, input: unknown): UnifiedBrowserAction {
  const action = parseAction(name, input);
  const args = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  for (const key of ['tabId', 'frameId', 'observationRevision'] as const) {
    if (args[key] !== undefined) {
      if (typeof args[key] !== 'string' || args[key].length > 200)
        throw new UnifiedToolInputError('Invalid observation context');
      action[key] = args[key];
    }
  }
  return action;
}
function parseAction(name: string, input: unknown): UnifiedBrowserAction {
  const args = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const str = (key: string, required = true): string | undefined => {
    const value = args[key];
    if (typeof value === 'string' && value.length > 0) return value;
    if (required) throw new UnifiedToolInputError(`${name} 缺少参数 ${key}`);
    return undefined;
  };
  const refArg = (required = true): string | undefined => {
    const value = str('ref', required);
    if (value !== undefined && !REF_RE.test(value))
      throw new UnifiedToolInputError(`${name} 的 ref 无效：请先 snapshot，再使用形如 e12 的 ref`);
    return value;
  };
  const bounded = (key: string, max: number) => {
    if (args[key] === undefined) return undefined;
    if (!Number.isInteger(args[key]) || Number(args[key]) < 1 || Number(args[key]) > max)
      throw new UnifiedToolInputError(`Invalid ${key}`);
    return Number(args[key]);
  };
  switch (name) {
    case 'read_page':
    case 'list_tabs':
      return { tool: name };
    case 'switch_tab':
      return { tool: name, targetTabId: str('targetTabId')! };
    case 'get_page_text':
      return { tool: name, cursor: str('cursor', false), maxChars: bounded('maxChars', 16000) };
    case 'links':
    case 'tables': {
      if (
        args.start !== undefined &&
        (!Number.isInteger(args.start) || Number(args.start) < 0 || Number(args.start) > 100000)
      )
        throw new UnifiedToolInputError('Invalid start');
      return { tool: name, start: args.start as number | undefined, limit: bounded('limit', 100) };
    }
    case 'scroll_until':
      return {
        tool: name,
        maxSteps: bounded('maxSteps', 20),
        maxMs: bounded('maxMs', 10000),
        maxChars: bounded('maxChars', 16000),
        maxItems: bounded('maxItems', 1000),
        maxTokens: bounded('maxTokens', 16000),
      };

    case 'snapshot':
    case 'screenshot':
    case 'back':
      return { tool: name };
    case 'click':
    case 'download':
      return { tool: name, ref: refArg() as string };
    case 'type':
      return {
        tool: 'type',
        ref: refArg() as string,
        text: typeof args.text === 'string' ? args.text : (str('text') as string),
        ...(args.submit === true ? { submit: true } : {}),
      };
    case 'select':
      return { tool: 'select', ref: refArg() as string, value: str('value') as string };
    case 'scroll': {
      const direction =
        args.direction === 'up' ? 'up' : args.direction === 'down' ? 'down' : undefined;
      const scrollRef = refArg(false);
      const amount = Number.isInteger(args.amount)
        ? Math.min(10, Math.max(1, Number(args.amount)))
        : undefined;
      return {
        tool: 'scroll',
        ...(direction ? { direction } : {}),
        ...(scrollRef ? { ref: scrollRef } : {}),
        ...(amount ? { amount } : {}),
      };
    }
    case 'navigate': {
      const url = str('url') as string;
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        throw new UnifiedToolInputError('navigate 的 url 无效');
      }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
        throw new UnifiedToolInputError('navigate 只允许 http/https 网址');
      return { tool: 'navigate', url: parsed.toString() };
    }
    case 'extract':
      return {
        tool: 'extract',
        instruction: str('instruction') as string,
        ...(Array.isArray(args.fields)
          ? { fields: args.fields.filter((f): f is string => typeof f === 'string').slice(0, 30) }
          : {}),
      };
    case 'wait_for': {
      const text = str('text', false);
      const waitRef = refArg(false);
      if (!text && !waitRef && args.networkIdle !== true)
        throw new UnifiedToolInputError('wait_for 需要 text、ref 或 networkIdle 之一');
      return {
        tool: 'wait_for',
        ...(text ? { text } : {}),
        ...(waitRef ? { ref: waitRef } : {}),
        ...(args.networkIdle === true ? { networkIdle: true } : {}),
        ...(Number.isInteger(args.timeoutMs)
          ? { timeoutMs: Math.min(30_000, Math.max(100, Number(args.timeoutMs))) }
          : {}),
      };
    }
    case 'upload': {
      const fileIds = Array.isArray(args.fileIds)
        ? args.fileIds.filter((id): id is string => typeof id === 'string')
        : [];
      if (fileIds.length === 0) throw new UnifiedToolInputError('upload 需要 fileIds');
      return { tool: 'upload', ref: refArg() as string, fileIds };
    }
    case 'click_at': {
      const x = Number(args.x);
      const y = Number(args.y);
      if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0)
        throw new UnifiedToolInputError('click_at 需要非负整数坐标');
      return { tool: 'click_at', x, y };
    }
    default:
      throw new UnifiedToolInputError(`未知工具 ${name}`);
  }
}

/** Mutating tools change page state; read-only ones may be retried freely. */
export function isMutatingBrowserAction(action: UnifiedBrowserAction): boolean {
  return ![
    'snapshot',
    'screenshot',
    'extract',
    'wait_for',
    'read_page',
    'get_page_text',
    'links',
    'tables',
    'list_tabs',
  ].includes(action.tool);
}

/** Only offered to the cloud lane when BROWSER_OBSERVATION_V2 is enabled. */
export const OBSERVATION_TOOL_NAMES = [
  'read_page',
  'get_page_text',
  'links',
  'tables',
  'scroll_until',
  'list_tabs',
  'switch_tab',
] as const;
export function cloudObservationTools(): ReadonlyArray<NeutralToolDefinition> {
  const context = {
    tabId: { type: 'string' },
    frameId: { type: 'string' },
    observationRevision: {
      type: 'string',
      description: '读页返回的版本；交互必须带上，变化后重新读取。',
    },
  };
  const extras: Record<string, Record<string, unknown>> = {
    get_page_text: {
      cursor: { type: 'string' },
      maxChars: { type: 'integer', minimum: 1, maximum: 16000 },
    },
    links: {
      start: { type: 'integer', minimum: 0 },
      limit: { type: 'integer', minimum: 1, maximum: 100 },
    },
    tables: {
      start: { type: 'integer', minimum: 0 },
      limit: { type: 'integer', minimum: 1, maximum: 100 },
    },
    scroll_until: {
      maxItems: { type: 'integer', minimum: 1, maximum: 1000 },
      maxTokens: { type: 'integer', minimum: 1, maximum: 16000 },
      maxSteps: { type: 'integer', minimum: 1, maximum: 20 },
      maxMs: { type: 'integer', minimum: 1, maximum: 10000 },
      maxChars: { type: 'integer', minimum: 1, maximum: 16000 },
    },
    switch_tab: { targetTabId: { type: 'string' } },
  };
  return [
    ...UNIFIED_BROWSER_TOOLS.map((t) => ({
      ...t,
      inputSchema: {
        ...t.inputSchema,
        properties: { ...(t.inputSchema.properties as object), ...context },
      },
    })),
    ...OBSERVATION_TOOL_NAMES.map((name) => ({
      name,
      description: {
        read_page:
          '读取当前 frame 的可访问性树、refs、版本和 frame 列表。页面变化、导航、切换标签后 refs 失效。',
        get_page_text: '分段读取脱敏正文；cursor 绑定页版本，end=true 才是末尾。',
        links: '分页读取真实资源链接；保留查询身份，移除追踪参数。',
        tables: '读取表格列名、行范围及分页来源。',
        scroll_until: '有界滚动读取；返回停滞或数量/时间/token 上限和截断原因。',
        list_tabs: '只列出本任务拥有的标签。',
        switch_tab: '切换到本任务已观察的标签，旧 refs 失效。',
      }[name],
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: { ...context, ...extras[name] },
        ...(name === 'switch_tab' ? { required: ['targetTabId'] } : {}),
      },
    })),
  ];
}
