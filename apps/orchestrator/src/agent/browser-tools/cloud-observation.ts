import { createHash, randomUUID } from 'node:crypto';
import type { Frame, Page, Request } from 'playwright';
import { stripTrackingFromUrl } from '../../execution/url-identity.js';
import { TRANSACTION_PAGE_RE } from '../supercar/runtime-action-policy.js';
import { ActionCausality } from './action-causality.js';
import {
  ARTICLE_OUTLINE_EXPRESSION,
  type ArticleOutline,
  type OutlineSectionText,
  articleSectionExpression,
} from './article-outline.js';
import { scrollWithEvidence } from './browser-scroll.js';
import { ensureExecutionViewport } from './browser-viewport.js';
import { markEngagementCounts } from './engagement-counts.js';
import { redactPageText } from './page-redaction.js';
import type { UnifiedToolResult } from './playwright-unified-executor.js';
import { type UnifiedBrowserAction, isMutatingBrowserAction } from './unified-tools.js';
import {
  YOUTUBE_CARD_KINDS_EXPRESSION,
  markYoutubeCollections,
  markYoutubeHeadings,
} from './video-count.js';

const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const SENSITIVE_URL_PARAMETER =
  /^(?:ticket|token|access_token|id_token|refresh_token|auth|authorization|sig|sign|signature|secret|password|api_key|apikey|auth_key|session_token|session_id|cookie)$/i;
/** Model-facing copy only; raw accessible addresses stay in host-only evidence. */
export function safeObservationUrl(value: string, base?: string): string {
  try {
    const parsed = new URL(value, base);
    if (!/^https?:$/.test(parsed.protocol)) return 'about:blank';
    const absolute = /^https?:\/\//i.test(value) ? value : parsed.href;
    const accessible = stripTrackingFromUrl(absolute);
    return accessible
      .replace(/^(https?:\/\/)[^/?#]*@/i, '$1')
      .replace(/([?&#])([^&?#=]+)=([^&#]*)/g, (token, separator, rawName) => {
        let name = rawName;
        try {
          name = decodeURIComponent(rawName.replace(/\+/g, ' '));
        } catch {}
        return SENSITIVE_URL_PARAMETER.test(name) ? `${separator}${rawName}=[redacted]` : token;
      });
  } catch {
    return 'about:blank';
  }
}

/**
 * ACCEPT-283-R5: analytics, media statistics and POST-transported reads of the
 * sites tasks use most, sent by fetch/XHR as well as beacons (seen pausing
 * read-only tasks on YouTube results and w3schools). Never a user-visible write.
 */
const KNOWN_TELEMETRY: ReadonlyArray<readonly [host: RegExp, path: RegExp]> = [
  [/(?:^|\.)google-analytics\.com$/, /^\/(?:g\/|j\/)?collect$/],
  [/^analytics\.google\.com$/, /^\/g\/collect$/],
  [/(?:^|\.)google\.com$/, /^\/(?:measurement\/conversion|gen_204)(?:\/|$)/],
  [/(?:^|\.)youtube\.com$/, /^\/(?:api\/stats\/[a-z_]+|youtubei\/v1\/log_event|ptracking)$/],
  // YouTube's InnerTube reads go by POST too: player config, results, pages.
  [/(?:^|\.)youtube\.com$/, /^\/youtubei\/v1\/(?:player|next|browse|search|guide|get_watch)$/],
  [/(?:^|\.)googlevideo\.com$/, /^\/videoplayback$/],
];
/**
 * A request that only reports telemetry: a beacon to a telemetry path, or a
 * known analytics/media-statistics endpoint. A transaction path or action
 * parameter is never telemetry, whatever the host.
 */
export function passiveTelemetryRequest(url: URL, resourceType: string): boolean {
  if (transactionRequest(url)) return false;
  if (KNOWN_TELEMETRY.some(([host, path]) => host.test(url.hostname) && path.test(url.pathname)))
    return true;
  // QWEN-CN-1: Bing beacons its search logging to /fd/ls/lsp.aspx on submit,
  // Google to /gen_204.
  return (
    resourceType === 'ping' &&
    /(?:^|\/)(?:collect|track|logs?|beacon|heartbeat|ping|telemetry|metrics|analytics|rum|ls|lsp\.aspx|gen_204|generate_204)(?:\/|$)/i.test(
      url.pathname,
    )
  );
}

/** Endpoint/operation semantics only; never read a body, header or cookie. */
function transactionRequest(url: URL) {
  if (
    TRANSACTION_PAGE_RE.test(url.pathname) ||
    /(?:^|[/_-])(?:create|submit|confirm|delete|remove|purchase|place[-_]?order|write|send)(?:$|[/_.-])/i.test(
      url.pathname,
    )
  )
    return true;
  for (const [name, value] of url.searchParams) {
    if (
      /^(?:action|op|operation|method|cmd|command)$/i.test(name) &&
      /(?:order|pay|submit|confirm|delete|remove|create|purchase|send)/i.test(value)
    )
      return true;
    if (/^(?:place_order|submit_order|create_order|delete|payment|pay)$/i.test(name)) return true;
    if (/^(?:order|order_id|orderid)$/i.test(name) && /(?:pixel|order|buy)/i.test(url.pathname))
      return true;
  }
  return false;
}
/** Only the operation kind survives this bounded, host-local body inspection. */
function graphqlOperation(request: Request): 'query' | 'mutation' | 'unknown' {
  const parse = (document: string, operationName?: string): 'query' | 'mutation' | 'unknown' => {
    if (document.length > 65536) return 'unknown';
    const token =
      /(?:#[^\n\r]*|[\s,\uFEFF]+)|(?:"""[\s\S]*?"""|"(?:\\.|[^"\\\r\n])*")|(?:[_A-Za-z][_0-9A-Za-z]*|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|\.\.\.|[!$():=@\[\]{|}&])/y;
    const tokens: string[] = [];
    for (let offset = 0; offset < document.length; ) {
      token.lastIndex = offset;
      const match = token.exec(document);
      if (!match) return 'unknown';
      offset = token.lastIndex;
      if (!/^(?:#|[\s,\uFEFF])/.test(match[0])) tokens.push(match[0]);
    }
    let index = 0;
    const name = () => /^[_A-Za-z][_0-9A-Za-z]*$/.test(tokens[index] ?? '');
    const group = (): boolean => {
      const stack: string[] = [];
      do {
        const current = tokens[index++];
        if (!current) return false;
        if (current === '(' || current === '[' || current === '{') stack.push(current);
        if (current === ')' || current === ']' || current === '}') {
          const opening = stack.pop();
          if (opening !== ({ ')': '(', ']': '[', '}': '{' } as Record<string, string>)[current])
            return false;
        }
      } while (stack.length && index < tokens.length);
      return stack.length === 0;
    };
    const directives = (): boolean => {
      while (tokens[index] === '@') {
        index++;
        if (!name()) return false;
        index++;
        if (tokens[index] === '(' && !group()) return false;
      }
      return true;
    };
    const operations: Array<{ kind: 'query' | 'mutation'; name?: string }> = [];
    while (index < tokens.length) {
      const kind = tokens[index++];
      if (kind === '{') {
        index--;
        if (!group()) return 'unknown';
        operations.push({ kind: 'query' });
        continue;
      }
      if (kind === 'fragment') {
        if (!name()) return 'unknown';
        index++;
        if (tokens[index++] !== 'on' || !name()) return 'unknown';
        index++;
        if (!directives() || tokens[index] !== '{' || !group()) return 'unknown';
        continue;
      }
      if (kind !== 'query' && kind !== 'mutation' && kind !== 'subscription') return 'unknown';
      const opName = name() ? tokens[index++] : undefined;
      if (tokens[index] === '(' && !group()) return 'unknown';
      if (!directives() || tokens[index] !== '{' || !group()) return 'unknown';
      operations.push({ kind: kind === 'query' ? 'query' : 'mutation', name: opName });
    }
    const selected = operationName
      ? operations.filter((op) => op.name === operationName)
      : operations;
    return selected.length === 1 ? (selected[0]?.kind ?? 'unknown') : 'unknown';
  };
  try {
    const body = request.postData();
    if (!body || body.length > 65536) return 'unknown';
    let payload: unknown;
    try {
      payload = JSON.parse(body);
    } catch {
      return parse(body);
    }
    const entries = Array.isArray(payload) ? payload : [payload];
    if (!entries.length) return 'unknown';
    const kinds = entries.map((entry) => {
      if (
        !entry ||
        typeof entry !== 'object' ||
        typeof entry.query !== 'string' ||
        (entry.operationName != null && typeof entry.operationName !== 'string')
      )
        return 'unknown';
      return parse(entry.query, entry.operationName ?? undefined);
    });
    if (kinds.includes('mutation')) return 'mutation';
    return kinds.every((kind) => kind === 'query') ? 'query' : 'unknown';
  } catch {
    return 'unknown';
  }
}

const TRANSACTION_RECEIPT_RE =
  /(?:下单|付款|支付|提交|删除|发送)(?:成功|完成)|订单号|(?:order|payment|purchase|booking)\s+(?:created|placed|confirmed|completed|number)|(?:deleted|sent)\s+successfully/i;

/** No raw form values or network payloads leave this host-side verifier. */
function collectObservationState() {
  const root = globalThis as typeof globalThis & {
    __holadayObservation?: {
      id: string;
      version: number;
      /** Mutations that added or removed nodes (not values, attributes or text). */
      nodes: number;
      interceptedEnter: number;
      interceptedSearchEnter: number;
    };
  };
  if (!root.__holadayObservation) {
    const current = {
      id: `${Date.now()}-${Math.random()}`,
      version: 0,
      nodes: 0,
      interceptedEnter: 0,
      interceptedSearchEnter: 0,
    };
    root.__holadayObservation = current;
    new MutationObserver((records) => {
      current.version++;
      if (records.some((record) => record.type === 'childList')) current.nodes++;
    }).observe(document, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    });
    document.addEventListener(
      'keydown',
      (event) => {
        if (event.key !== 'Enter') return;
        // Enter in a search box normally runs a search (a read): counted apart so a
        // search that visibly lands is not mistaken for a submission.
        const field = event.target as HTMLInputElement | null;
        const label = [
          field?.getAttribute?.('name'),
          field?.getAttribute?.('placeholder'),
          field?.getAttribute?.('aria-label'),
          field?.id,
        ]
          .filter(Boolean)
          .join(' ');
        const search =
          !!field &&
          (field.type === 'search' ||
            ['searchbox', 'combobox'].includes(field.getAttribute?.('role') ?? '') ||
            /^(?:q|query|search|search_query|keyword|keywords|wd|k|s)$/i.test(
              field.getAttribute?.('name') ?? '',
            ) ||
            /搜索|search|查找/i.test(label) ||
            !!field.closest?.('form[role="search"], [role="search"]'));
        setTimeout(() => {
          if (!event.defaultPrevented) return;
          if (search) current.interceptedSearchEnter++;
          else current.interceptedEnter++;
        }, 0);
      },
      true,
    );
    document.addEventListener('input', () => current.version++, true);
    document.addEventListener('change', () => current.version++, true);
  }
  const form = Array.from(document.querySelectorAll('input,textarea,select'))
    .slice(0, 200)
    .map((el) => {
      const input = el as HTMLInputElement;
      return [input.type, input.name, input.value, input.checked];
    });
  const text = (document.body?.innerText || '').slice(0, 100_000);
  const roots: ParentNode[] = [document];
  const fields: Element[] = [];
  for (let i = 0; i < roots.length && i < 100; i++) {
    const currentRoot = roots[i];
    if (!currentRoot) break;
    fields.push(...Array.from(currentRoot.querySelectorAll('input,textarea')));
    for (const element of Array.from(currentRoot.querySelectorAll('*')).slice(0, 10000))
      if (element.shadowRoot) roots.push(element.shadowRoot);
  }
  const visible = (element: Element) => {
    const style = getComputedStyle(element);
    return (
      element.getClientRects().length > 0 &&
      style.visibility !== 'hidden' &&
      style.display !== 'none'
    );
  };
  const keypads = new Map<Element, Set<string>>();
  for (const currentRoot of roots.slice(0, 100)) {
    for (const key of Array.from(
      currentRoot.querySelectorAll('button,[role="button"],[role="gridcell"],td'),
    ).slice(0, 2000)) {
      const digit = key.textContent?.trim() ?? '';
      if (!/^[0-9]$/.test(digit) || !visible(key)) continue;
      const container = key.closest('.keypad,[role="grid"],[role="group"]') ?? key.parentElement;
      if (!container) continue;
      const digits = keypads.get(container) ?? new Set<string>();
      digits.add(digit);
      keypads.set(container, digits);
    }
  }
  const sensitiveKeypad =
    [...keypads].some(
      ([container, digits]) =>
        digits.size === 10 &&
        /密码|支付|付款|验证|password|payment|verification/i.test(
          (((container.parentElement ?? container) as HTMLElement).innerText || '').slice(0, 2000),
        ),
    ) ||
    roots
      .slice(0, 100)
      .some((currentRoot) =>
        Array.from(currentRoot.querySelectorAll('.keypad,[role="grid"],[role="group"]')).some(
          (container) =>
            visible(container) &&
            /(?:[●•*]\s*){4,}/.test(container.textContent ?? '') &&
            /支付密码|付款密码|payment password/i.test(
              (((container.parentElement ?? container) as HTMLElement).innerText || '').slice(
                0,
                2000,
              ),
            ),
        ),
      );
  const sensitive =
    sensitiveKeypad ||
    fields.some((element) => {
      const input = element as HTMLInputElement;
      const style = getComputedStyle(input);
      if (
        input.disabled ||
        input.readOnly ||
        input.type === 'hidden' ||
        !input.getClientRects().length ||
        style.visibility === 'hidden' ||
        style.display === 'none'
      )
        return false;
      const identity = [
        input.name,
        input.id,
        input.getAttribute('aria-label'),
        input.labels?.[0]?.innerText,
        input.placeholder,
      ]
        .filter(Boolean)
        .join(' ');
      return (
        input.type === 'password' ||
        /^(?:one-time-code|cc-)/i.test(input.autocomplete) ||
        /(?:otp|cvv|cvc|card[-_ ]?(?:number|no)|credit[-_ ]?card|pay(?:ment)?[-_ ]?(?:password|pin)|验证码|两步验证|银行卡|卡号|支付密码)/i.test(
          identity,
        )
      );
    }) ||
    /(?:^|\/)(?:login|signin|sign-in|log-in|checkout|payment|cashier|pay|2fa|verify-identity)(?:\/|$)/i.test(
      location.pathname,
    );
  return {
    documentId: root.__holadayObservation.id,
    version: root.__holadayObservation.version,
    nodes: root.__holadayObservation.nodes,
    interceptedEnter: root.__holadayObservation.interceptedEnter,
    interceptedSearchEnter: root.__holadayObservation.interceptedSearchEnter ?? 0,
    forms: JSON.stringify(form),
    text,
    receiptRegions: Array.from(
      document.querySelectorAll(
        '[role="status"],[role="alert"],dialog,p,h1,h2,main,article,[data-result],[data-status]',
      ),
    )
      .filter((n) => !n.closest('nav,header,footer') && n.getClientRects().length)
      .slice(0, 200)
      .flatMap((n) =>
        ((n as HTMLElement).innerText || '')
          .slice(0, 8000)
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean),
      ),
    sensitive,
    geometry: [scrollX, scrollY, innerWidth, innerHeight],
  };
}

// tsx/esbuild keepNames adds __name to named local functions. Playwright serialises
// callbacks without their module scope, so supply the helper inside the page.
export const OBSERVATION_STATE_EXPRESSION = `(() => { const __name = (target) => target; return (${collectObservationState.toString()})(); })()`;
export async function observationState(frame: Frame) {
  const state = await frame.evaluate<ReturnType<typeof collectObservationState>>(
    OBSERVATION_STATE_EXPRESSION,
  );
  return { ...state, forms: hash(state.forms), dom: hash(state.text), url: frame.url() };
}

type ActionWindow = {
  token: string;
  interactive: boolean;
  causes: Map<string, number>;
  records: Array<{
    category: string;
    write: boolean;
    candidate: boolean;
    key: string;
    branch: string;
    method: string;
    url: string;
    at: number;
  }>;
  frame: Frame;
  origin: string;
  pages: Set<Page>;
  priorRequests: Set<string>;
  inFlight: Set<Request>;
  lastActivity: number;
  action: string;
};

/**
 * The document's readable root: <body>, or the root element for frameset
 * documents (e.g. the-internet /nested_frames), whose AI snapshot inlines the
 * child frames.
 */
export async function pageRoot(frame: Frame, intent?: string) {
  const video = await videoMainRoot(frame, intent);
  if (video) return video;
  const body = frame.locator('body');
  return (await body.count().catch(() => 0)) > 0 ? body : frame.locator(':root');
}

/**
 * FIX-26 (INTEGRATE-26 core-03): a YouTube watch page is read from its video
 * block — title, channel, views, date, description — not the recommendation
 * list or comments, which tripped the mainland endpoint's content inspection.
 * A task that asks for recommendations or comments reads the whole page.
 */
async function videoMainRoot(frame: Frame, intent?: string) {
  if (!/^https?:\/\/(?:www\.|m\.)?youtube\.com\/(?:watch|shorts\/)/i.test(frame.url())) return null;
  if (intent && /推荐|相关视频|评论|留言|recommend|related|comment/i.test(intent)) return null;
  const block = frame.locator('ytd-watch-metadata').first();
  return (await block.count().catch(() => 0)) > 0 ? block : null;
}

export class CloudObservation {
  private tabs = new Map<string, Page>();
  private frames = new Map<string, Frame>();
  private observations = new Map<
    Frame,
    {
      fingerprint: string;
      /** The fingerprint without form values. */
      structure: string;
      revision: string;
      /** Earlier revisions of the same structure: only form values changed since. */
      accepted: Set<string>;
      refs: Set<string>;
      document: string;
    }
  >();
  /** Every revision a read handed out, with the document and structure it showed. */
  private issued = new Map<string, { document: string; structure: string }>();
  private virtualRefs = new Map<Frame, Map<string, number>>();
  private cursors = new Map<
    string,
    {
      frame: Frame;
      documentId: string;
      text: string;
      offset: number;
      snapshotId: string;
      section?: number;
      sectionTitle?: string;
    }
  >();
  private requests: Array<{
    category: string;
    write: boolean;
    candidate: boolean;
    key: string;
    branch: string;
    method: string;
    url: string;
  }> = [];
  private readonly causality: ActionCausality;
  private readonly windows = new Map<string, ActionWindow>();
  private readonly recentRequests: Array<{ record: ActionWindow['records'][number]; page?: Page }> =
    [];

  private active: Page;
  private backgroundRequests = new Map<string, number>();
  private actionWindow: ActionWindow | null = null;
  private pendingAction: ActionWindow | null = null;
  private pendingWrite = false;
  private pendingTriggers: Array<{ branch: string; method: string; url: string; action: string }> =
    [];
  pendingEffect() {
    return this.pendingWrite
      ? {
          urlChanged: false,
          formChanged: false,
          domChanged: false,
          networkCategories: [],
          unexpected: true,
          triggers: [...this.pendingTriggers],
        }
      : undefined;
  }
  private requestWindows = new Map<Request, ActionWindow>();
  interruption(): { reason: string; message: string } | undefined {
    return this.pendingWrite
      ? {
          reason: 'unexpected_effect',
          message:
            '检测到写请求，已暂停后续操作。第一次副作用无法事前阻止，请核对结果后确认如何继续。',
        }
      : undefined;
  }
  /** The task, for what a read covers (FIX-26: a video page's main block). */
  intent?: string;
  constructor(page: Page) {
    this.active = page;
    this.causality = new ActionCausality(page.context(), (frame, event) => {
      const window = this.windows.get(event.token);
      if (!window?.interactive || !window.pages.has(frame.page())) return;
      let key: string;
      try {
        const url = new URL(event.url);
        key = `${event.method}:${url.origin}${url.pathname}`;
      } catch {
        return;
      }
      window.causes.set(key, Date.now());
      const observed = [...this.recentRequests]
        .reverse()
        .find(
          ({ record, page }) =>
            record.key === key &&
            record.candidate &&
            !record.write &&
            record.at > Date.now() - 500 &&
            (!page || window.pages.has(page)),
        );
      if (observed) {
        observed.record.write = true;
        window.causes.delete(key);
        this.noteWrite(window, observed.record);
      }
    });
    this.register(page);
    page.context().on('request', this.onRequest);
    page.context().on('requestfinished', this.onRequestSettled);
    page.context().on('requestfailed', this.onRequestSettled);
  }
  private noteWrite(
    window: ActionWindow,
    request: { branch: string; method: string; url: string },
  ) {
    this.pendingWrite = true;
    this.pendingTriggers.push({
      branch: request.branch,
      method: request.method,
      url: request.url,
      action: window.action,
    });
    this.pendingTriggers = this.pendingTriggers.slice(-20);
  }
  private backgroundEvidence() {
    return this.requests
      .filter((r) => !r.write && (r.candidate || /^(POST|PUT|PATCH|DELETE)$/.test(r.method)))
      .map((r) => ({
        branch: r.branch,
        method: r.method,
        url: r.url,
        action: this.pendingAction?.action ?? 'background',
      }));
  }
  get page() {
    return this.active;
  }
  ownsPage(page: Page) {
    return [...this.tabs.values()].includes(page);
  }
  register(page: Page) {
    if ([...this.tabs.values()].includes(page)) return;
    this.tabs.set(`tab_${randomUUID()}`, page);
  }
  activate(page: Page): string {
    this.register(page);
    this.active = page;
    this.observations.clear();
    this.cursors.clear();
    return [...this.tabs].find(([, target]) => target === page)![0];
  }
  async manageTab(action: UnifiedBrowserAction): Promise<UnifiedToolResult> {
    if (action.tool === 'new_tab') {
      if ([...this.tabs.values()].filter((p) => !p.isClosed()).length >= 20)
        return { ok: false, text: '任务标签数达到上限' };
      const page = await this.active.context().newPage();
      await ensureExecutionViewport(page);
      this.register(page);
      this.active = page;
    } else if (action.tool === 'close_tab') {
      const target = this.tabs.get(action.targetTabId);
      const live = [...this.tabs.values()].filter((p) => !p.isClosed());
      if (!target || target.isClosed() || live.length <= 1)
        return { ok: false, text: '标签无效或为最后一个任务标签' };
      await target.close();
      this.tabs.delete(action.targetTabId);
      if (this.active === target) this.active = live.find((p) => p !== target)!;
    }
    this.observations.clear();
    this.cursors.clear();
    const observation = await this.read({ tool: 'read_page' });
    return { ...observation!, tabId: this.tabId(this.active), url: this.active.url() };
  }
  private recordRequest(r: Request, window = this.actionWindow ?? this.pendingAction) {
    let url: URL;
    try {
      url = new URL(r.url());
    } catch {
      return;
    }
    const signature = hash(`${r.method()}:${r.resourceType()}:${url.origin}${url.pathname}`);
    if (!window) {
      this.backgroundRequests.set(signature, (this.backgroundRequests.get(signature) ?? 0) + 1);
      if (this.backgroundRequests.size > 400)
        this.backgroundRequests.delete(this.backgroundRequests.keys().next().value ?? '');
      return;
    }
    if (window !== this.actionWindow && window !== this.pendingAction) return;
    const navigation = r.isNavigationRequest();
    const graphql =
      r.method() === 'POST' && /(?:^|\/)(?:graphql|gql)(?:\/|$)/i.test(url.pathname)
        ? graphqlOperation(r)
        : null;
    const transactional =
      transactionRequest(url) || graphql === 'mutation' || graphql === 'unknown';
    let requestPage: Page | undefined;
    try {
      requestPage = r.frame().page();
      if (!this.ownsPage(requestPage)) return;
    } catch {
      /* A task popup's initial navigation may not have a frame yet. */
    }
    const formPost =
      r.method() === 'POST' &&
      (navigation ||
        /application\/x-www-form-urlencoded|multipart\/form-data/i.test(
          r.headers()['content-type'] ?? '',
        ));
    const resourceWrite =
      r.method() === 'POST' &&
      /\/(?:orders?|payments?|messages?|comments?|bookings?)(?:\/|$)/i.test(url.pathname);
    const methodWrite = ['PUT', 'PATCH', 'DELETE'].includes(r.method());
    // A beacon with telemetry semantics is not a form/API mutation. Transaction
    // paths and action parameters still take precedence, even on /collect.
    const passiveBeacon = !transactional && passiveTelemetryRequest(url, r.resourceType());
    const unknownPost = r.method() === 'POST' && graphql !== 'query' && !passiveBeacon;
    const candidate = transactional || resourceWrite || methodWrite || unknownPost;
    const key = `${r.method()}:${url.origin}${url.pathname}`;
    // Timing alone does not establish causation. Only an instrumented trusted
    // interaction (or its async continuation) can attribute a write to us.
    const cause = [...this.windows.values()]
      .reverse()
      .find(
        (w) =>
          w.interactive &&
          (w.causes.get(key) ?? 0) > Date.now() - 500 &&
          (!requestPage || w.pages.has(requestPage)),
      );
    const write = candidate && !!cause;
    const branch =
      transactional || resourceWrite
        ? 'transaction_request'
        : formPost
          ? 'form_submit'
          : methodWrite
            ? 'mutation_method'
            : unknownPost
              ? 'unknown_post'
              : 'read_request';
    window.lastActivity = Date.now();
    window.inFlight.add(r);
    this.requestWindows.set(r, window);
    const record = {
      category: `${r.method()}:${r.resourceType()}`,
      write,
      candidate,
      key,
      branch,
      method: r.method(),
      url: safeObservationUrl(url.origin + url.pathname),
      at: Date.now(),
    };
    if (write && cause) {
      cause.causes.delete(key);
      this.noteWrite(cause, record);
    }
    this.requests.push(record);
    window.records.push(record);
    this.recentRequests.push({ record, page: requestPage });
    if (this.recentRequests.length > 400) this.recentRequests.shift();
    if (this.requests.length > 400) this.requests.shift();
  }
  private onRequest = (request: Request) => {
    const window = this.actionWindow ?? this.pendingAction;
    let page: Page;
    try {
      page = request.frame().page();
    } catch {
      this.recordRequest(request, window);
      return;
    }
    if ([...this.tabs.values()].includes(page)) {
      this.recordRequest(request, window);
      return;
    }
    void page
      .opener()
      .then((opener) => {
        if (opener && [...this.tabs.values()].includes(opener)) {
          this.register(page);
          if (window?.pages.has(opener)) window.pages.add(page);
          this.recordRequest(request, window);
        }
      })
      .catch(() => {});
  };
  private onRequestSettled = (request: Request) => {
    const window = this.requestWindows.get(request);
    if (!window) return;
    window.inFlight.delete(request);
    window.lastActivity = Date.now();
    this.requestWindows.delete(request);
  };
  private async waitForNetworkQuiet(window: ActionWindow) {
    const deadline = Date.now() + 3000;
    window.lastActivity = Date.now();
    while (Date.now() < deadline) {
      if (window.inFlight.size === 0 && Date.now() - window.lastActivity >= 500) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  dispose() {
    this.causality.dispose();
    this.active.context().off('request', this.onRequest);
    this.active.context().off('requestfinished', this.onRequestSettled);
    this.active.context().off('requestfailed', this.onRequestSettled);
    this.requestWindows.clear();
    this.windows.clear();
    this.recentRequests.length = 0;
    this.pendingAction = this.actionWindow = null;
    this.cursors.clear();
  }
  private frameId(frame: Frame) {
    for (const [id, item] of this.frames) if (item === frame) return id;
    const id = `frame_${randomUUID()}`;
    this.frames.set(id, frame);
    return id;
  }
  private tabId(page: Page) {
    return [...this.tabs].find(([, p]) => p === page)![0];
  }
  resolve(action: UnifiedBrowserAction): { page: Page; frame: Frame } {
    const page = action.tabId ? this.tabs.get(action.tabId) : this.active;
    if (!page || page.isClosed()) throw new Error('stale_context');
    const frame = action.frameId ? this.frames.get(action.frameId) : page.mainFrame();
    if (!frame || frame.isDetached() || frame.page() !== page) throw new Error('stale_context');
    return { page, frame };
  }
  /** The document itself (not its changing text): same load, same URL. */
  private async documentKey(frame: Frame) {
    return `${(await observationState(frame)).documentId}|${frame.url()}`;
  }
  private async fingerprint(frame: Frame) {
    const state = await observationState(frame);
    // Structure: the same nodes, text and place. Value edits (input/change events
    // and the attributes they touch) are not structure.
    // Scrolling (a focused field scrolls into view) moves no element either.
    const structure = [
      state.documentId,
      state.nodes,
      state.dom,
      state.url,
      state.geometry.slice(2),
    ];
    return {
      fingerprint: hash(JSON.stringify([...structure, state.version, state.forms])),
      structure: hash(JSON.stringify(structure)),
    };
  }
  async validate(action: UnifiedBrowserAction) {
    if (['new_tab', 'switch_tab', 'close_tab', 'list_tabs'].includes(action.tool)) return;
    const { frame } = this.resolve(action);
    if ('ref' in action && action.ref) {
      const current = this.observations.get(frame);
      const sent = action.observationRevision ?? '';
      if (
        !current ||
        !current.refs.has(action.ref) ||
        // FIX-24 (core-08): typing into one field changes only form values; the
        // other refs of that snapshot (the next field in the same turn) still hold.
        (sent !== current.revision &&
          !current.accepted.has(sent) &&
          !this.miscopied(sent, current)) ||
        // BROWSER-AUTOPILOT-1: an aria ref stays bound to the element the model
        // saw; unrelated text changes (carousels, clocks) on a live page must not
        // invalidate it. A different document or URL still does.
        (await this.documentKey(frame)) !== current.document ||
        // …and the element itself must still be on the page (a removed or
        // replaced node, even with the same label, is not what the model saw).
        (await this.locator(frame, action.ref)
          .count()
          .catch(() => 0)) !== 1
      )
        throw new Error('stale_observation');
    }
  }
  /**
   * FIX-27 (za core-02): a revision no read ever issued — mis-copied or left
   * out — clicked the same ref three times and failed the task. Such a ref can
   * only mean what the model saw when every read of this document showed the
   * current structure; a revision that was issued but is out of date, or a
   * document whose structure changed, stays stale.
   */
  private miscopied(sent: string, current: { document: string; structure: string }) {
    if (this.issued.has(sent)) return false;
    for (const seen of this.issued.values())
      if (seen.document === current.document && seen.structure !== current.structure) return false;
    return true;
  }
  private issue(current: { revision: string; document: string; structure: string }) {
    this.issued.set(current.revision, { document: current.document, structure: current.structure });
  }
  async metadata(frame: Frame) {
    const { fingerprint, structure } = await this.fingerprint(frame);
    let current = this.observations.get(frame);
    if (!current || current.fingerprint !== fingerprint) {
      const document = await this.documentKey(frame);
      const valuesOnly =
        !!current && current.structure === structure && current.document === document;
      current = {
        fingerprint,
        structure,
        revision: randomUUID(),
        accepted: valuesOnly ? new Set([...current!.accepted, current!.revision]) : new Set(),
        refs: valuesOnly ? current!.refs : new Set(),
        document,
      };
      this.observations.set(frame, current);
      this.issue(current);
    }
    return {
      tabId: this.tabId(frame.page()),
      frameId: this.frameId(frame),
      observationRevision: current.revision,
      sourceURL: safeObservationUrl(frame.url()),
      capturedAt: new Date().toISOString(),
    };
  }
  locator(frame: Frame, ref: string) {
    const index = this.virtualRefs.get(frame)?.get(ref);
    return index === undefined
      ? frame.locator(`aria-ref=${ref}`)
      : frame.locator('input').nth(index);
  }
  async sensitive(page: Page) {
    // An unreadable child frame cannot be asserted safe to record.
    for (const frame of page.frames()) {
      try {
        if ((await observationState(frame)).sensitive) return true;
      } catch {
        return true;
      }
    }
    return false;
  }
  async read(action: UnifiedBrowserAction): Promise<UnifiedToolResult | null> {
    const { page, frame } = ['switch_tab', 'list_tabs'].includes(action.tool)
      ? { page: this.active, frame: this.active.mainFrame() }
      : this.resolve(action);
    const json = (value: unknown): UnifiedToolResult => ({
      ok: true,
      text: JSON.stringify(value),
      url: safeObservationUrl(frame.url()),
      ...(this.backgroundEvidence().length
        ? {
            effect: {
              urlChanged: false,
              formChanged: false,
              domChanged: false,
              unexpected: false,
              observationAvailable: false,
              networkCategories: [],
              backgroundRequests: this.backgroundEvidence(),
            },
          }
        : {}),
    });
    if (action.tool === 'list_tabs')
      return json({
        tabs: await Promise.all(
          [...this.tabs]
            .filter(([, p]) => !p.isClosed())
            .map(async ([tabId, p]) => ({
              tabId,
              sourceURL: safeObservationUrl(p.url()),
              title: await redactPageText(p, await p.title()),
            })),
        ),
      });
    if (action.tool === 'switch_tab') {
      const target = this.tabs.get(action.targetTabId);
      if (!target || target.isClosed()) throw new Error('stale_context');
      this.active = target;
      await target.bringToFront();
      this.observations.clear();
      this.cursors.clear();
      // "分别读标题": the read of the tab switched to also carries its document title.
      const read = await this.read({ tool: 'read_page' });
      if (!read) return read;
      try {
        const value = JSON.parse(read.text) as Record<string, unknown>;
        if (value.redacted) return read;
        const title = await redactPageText(target, await target.title());
        return title ? { ...read, text: JSON.stringify({ title, ...value }) } : read;
      } catch {
        return read;
      }
    }
    if (
      ![
        'snapshot',
        'read_page',
        'sections',
        'get_page_text',
        'links',
        'tables',
        'scroll_until',
      ].includes(action.tool)
    )
      return null;
    if (await this.sensitive(page))
      return json({
        ...(await this.metadata(frame)),
        redacted: true,
        tree: '已遮挡，未读取：敏感输入页面，请用户接管',
        status: 'redacted_unread',
        end: false,
        truncated: true,
      });
    if (action.tool === 'scroll_until') {
      const budget = Math.min(action.maxChars ?? 8000, Math.floor((action.maxTokens ?? 8000) / 4));
      const started = Date.now();
      let stalls = 0;
      let steps = 0;
      let itemCount = 0;
      let reason = 'step_limit';
      const receipts: Array<{
        beforeHeight: number;
        afterHeight: number;
        addedChars: number;
        grew: boolean;
      }> = [];
      for (; steps < (action.maxSteps ?? 10); steps++) {
        if (Date.now() - started >= (action.maxMs ?? 5000)) {
          reason = 'time_limit';
          break;
        }
        itemCount = await frame.locator('li,[role=listitem],tbody tr').count();
        if (itemCount >= (action.maxItems ?? 1000)) {
          reason = 'item_limit';
          break;
        }
        const receipt = await scrollWithEvidence(
          frame,
          'down',
          1,
          Math.max(1, Math.min(3500, (action.maxMs ?? 5000) - (Date.now() - started))),
        );
        receipts.push(receipt);
        stalls = !receipt.grew && receipt.afterTop === receipt.beforeTop ? stalls + 1 : 0;
        if (stalls >= 2) {
          reason = 'stalled';
          break;
        }
      }
      return {
        ...json({
          ...(await this.metadata(frame)),
          steps: receipts.length,
          itemCount,
          reason,
          tokenBudget: action.maxTokens ?? 8000,
          truncated: true,
          end: false,
          text: (await redactPageText(frame, (await observationState(frame)).text)).slice(
            0,
            budget,
          ),
        }),
        scroll: {
          beforeHeight: receipts[0]?.beforeHeight ?? 0,
          afterHeight: receipts.at(-1)?.afterHeight ?? 0,
          addedChars: receipts.reduce((n, r) => n + r.addedChars, 0),
          grew: receipts.some((r) => r.grew),
          steps: receipts,
        },
      };
    }
    if (action.tool === 'snapshot' || action.tool === 'read_page') {
      let tree = await redactPageText(
        frame,
        await (await pageRoot(frame, this.intent)).ariaSnapshot({ mode: 'ai', timeout: 5000 }),
      );
      // AI snapshots inline child frames, including cross-origin documents.
      // Expose child refs only through the separately scoped frame records below.
      let frameIndent = -1;
      tree = tree
        .split('\n')
        .filter((line) => {
          const indent = line.length - line.trimStart().length;
          if (frameIndent >= 0 && indent > frameIndent) return false;
          frameIndent = /^\s*- iframe\b/.test(line) ? indent : -1;
          return true;
        })
        .join('\n');
      const dates = await frame.locator('input').evaluateAll((nodes) =>
        nodes
          .map((n, index) => ({
            index,
            type: (n as HTMLInputElement).type,
            label:
              (n as HTMLInputElement).labels?.[0]?.innerText ||
              n.getAttribute('aria-label') ||
              'Date',
          }))
          .filter((n) => ['date', 'datetime-local', 'month', 'time', 'week'].includes(n.type)),
      );
      const virtual = new Map<string, number>();
      for (const item of dates) {
        const ref = `e${900000 + item.index}`;
        virtual.set(ref, item.index);
        tree += `\n- textbox "${item.label}" [ref=${ref}] [type=${item.type}]`;
      }
      this.virtualRefs.set(frame, virtual);
      // Snapshot reads may overlap harmless page updates; mutation actions still validate the resulting revision.
      // Rewrite only URL scalar lines; never shorten real resource identities.
      const urlSafe = tree.replace(
        /^(\s*- \/url: )(.*)$/gm,
        (_m, p, u) => p + safeObservationUrl(String(u).replace(/^"|"$/g, ''), frame.url()),
      );
      // FIX-28 (Deploy-27 core-04): course cards and playlists read as such.
      let host = '';
      try {
        host = new URL(frame.url()).hostname;
      } catch {}
      // FIX-29: a bare count next to an icon says which counter it is (点赞/评论/收藏/分享).
      const safeTree = await markEngagementCounts(
        frame,
        /(?:^|\.)youtube\.com$/.test(host) ? markYoutubeCollections(urlSafe) : urlSafe,
      );
      const before = this.observations.get(frame);
      const prior = before && {
        revision: before.revision,
        structure: before.structure,
        document: before.document,
        accepted: before.accepted,
      };
      const meta = await this.metadata(frame);
      const current = this.observations.get(frame)!;
      // The same structure keeps the same elements and refs (only values may
      // differ): refs from the earlier revision still hold. Anything else does not.
      current.accepted =
        prior && prior.structure === current.structure && prior.document === current.document
          ? new Set([...prior.accepted, ...current.accepted, prior.revision])
          : new Set();
      current.revision = randomUUID();
      this.issue(current);
      meta.observationRevision = current.revision;
      current.refs = new Set(
        [...safeTree.slice(0, 24000).matchAll(/\[ref=((?:f\d+)?e\d+)\]/g)].map((m) => m[1]!),
      );
      // Section numbers come from the article body outline (目录/导航不计), the
      // same numbering get_page_text(section) and sections use.
      const title = await frame
        .locator('h1')
        .first()
        .textContent({ timeout: 1000 })
        .catch(() => null);
      const outline = (await frame
        .evaluate(ARTICLE_OUTLINE_EXPRESSION)
        .catch(() => null)) as ArticleOutline | null;
      const rawHeadings = [
        ...(title?.trim() ? [{ level: 1, text: title.trim().slice(0, 200) }] : []),
        ...(outline?.sections ?? []).slice(0, 120).map((entry) => ({
          level: entry.level,
          text: entry.title,
          ...(entry.index.includes('.') ? {} : { section: Number(entry.index) }),
        })),
      ];
      // FIX-28: on YouTube, each heading that titles a result card says what the card is.
      const cards = /(?:^|\.)youtube\.com$/.test(host)
        ? ((await frame.evaluate(YOUTUBE_CARD_KINDS_EXPRESSION).catch(() => [])) as Array<{
            title: string;
            kind: string;
          }>)
        : [];
      const headings = JSON.parse(
        await redactPageText(frame, JSON.stringify(markYoutubeHeadings(rawHeadings, cards))),
      );
      const frames: Array<Record<string, unknown>> = [];
      if (frame === page.mainFrame()) {
        let remaining = 16_000;
        const origin = (child: Frame): string => {
          if (['about:blank', 'about:srcdoc', ''].includes(child.url()) && child.parentFrame())
            return origin(child.parentFrame()!);
          try {
            return new URL(child.url()).origin;
          } catch {
            return '';
          }
        };
        for (const child of page
          .frames()
          .filter((f) => f !== frame)
          .slice(0, 30)) {
          const info = { frameId: this.frameId(child), sourceURL: safeObservationUrl(child.url()) };
          if (!origin(frame) || origin(child) !== origin(frame)) {
            frames.push({ ...info, limitation: '跨源 iframe：父页面快照不暴露其内部引用。' });
          } else if (remaining > 0) {
            try {
              const value = JSON.parse(
                (await this.read({ tool: 'read_page', tabId: meta.tabId, frameId: info.frameId }))!
                  .text,
              );
              const tree = String(value.tree ?? '').slice(0, Math.min(4000, remaining));
              remaining -= tree.length;
              frames.push({
                ...value,
                ...info,
                tree,
                frames: undefined,
                instruction: '使用此 iframe 的 frameId 和 observationRevision 操作其中的 ref。',
              });
            } catch {
              frames.push({ ...info, limitation: 'iframe 尚未就绪，请重新读取。' });
            }
          } else frames.push({ ...info, limitation: 'iframe 内容超过本次快照预算。' });
        }
      }
      return json({
        ...meta,
        tree: safeTree.slice(0, 24000),
        headings,
        truncated: safeTree.length > 24000,
        refExpiresOn: ['DOM mutation', 'form change', 'navigation', 'tab switch'],
        frames,
      });
    }
    if (action.tool === 'sections') {
      // FIX-26: a video page has no article sections; its headings are the
      // recommendation list. Point at the video block instead.
      if (await videoMainRoot(frame, this.intent))
        return json({
          ...(await this.metadata(frame)),
          scope: 'video',
          sections: [],
          instruction:
            '这是视频页：用 read_page 或 get_page_text 读取视频信息区（标题、频道、播放量、发布时间、描述）。',
        });
      const outline = (await frame.evaluate(ARTICLE_OUTLINE_EXPRESSION)) as ArticleOutline;
      const sections = JSON.parse(
        await redactPageText(frame, JSON.stringify(outline.sections)),
      ) as ArticleOutline['sections'];
      return json({
        ...(await this.metadata(frame)),
        scope: outline.scope,
        sections,
        excluded: outline.excluded,
        instruction:
          '「第N节」= index 为 N 的正文章节（目录、导航、参考文献不计）；用 get_page_text(section=N) 读取，N.k 是第N节的小节。',
      });
    }
    if (action.tool === 'get_page_text') {
      const documentId = (await observationState(frame)).documentId;
      const meta = await this.metadata(frame);
      let snapshotId: string = randomUUID();
      let text: string;
      let offset = 0;
      let section = action.section;
      let sectionTitle: string | undefined;
      if (action.cursor) {
        const cursor = this.cursors.get(action.cursor);
        this.cursors.delete(action.cursor);
        if (
          !cursor ||
          cursor.frame !== frame ||
          cursor.documentId !== documentId ||
          (section !== undefined && section !== cursor.section)
        )
          throw new Error('stale_cursor');
        text = cursor.text;
        offset = cursor.offset;
        snapshotId = cursor.snapshotId;
        section = cursor.section;
        sectionTitle = cursor.sectionTitle;
      } else if (section === undefined)
        text = await redactPageText(
          frame,
          await (await pageRoot(frame, this.intent)).innerText({ timeout: 5000 }),
        );
      else {
        // `section` is the article body outline index (see sections).
        const read = (await frame.evaluate(
          articleSectionExpression(section),
        )) as OutlineSectionText;
        text = await redactPageText(frame, read.text);
        sectionTitle = await redactPageText(frame, read.title);
      }
      if (documentId !== (await observationState(frame)).documentId)
        throw new Error('stale_cursor');
      const endOffset = Math.min(text.length, offset + (action.maxChars ?? 8000));
      const end = endOffset >= text.length;
      const cursor = end ? null : randomUUID();
      if (cursor) {
        if (this.cursors.size >= 32) this.cursors.delete(this.cursors.keys().next().value!);
        this.cursors.set(cursor, {
          frame,
          documentId,
          text,
          offset: endOffset,
          snapshotId,
          section,
          sectionTitle,
        });
      }
      return json({
        ...meta,
        text: text.slice(offset, endOffset),
        range: [offset, endOffset],
        snapshotId,
        section,
        ...(sectionTitle ? { sectionTitle } : {}),
        snapshotMode: 'immutable-document-text',
        position: {
          paragraph: text.slice(0, offset).split(/\n+/).length - 1,
          characterOffset: offset,
        },
        cursor,
        end,
        truncated: !end,
      });
    }
    if (action.tool === 'links') {
      const before = (await observationState(frame)).documentId;
      const beforeUrl = frame.url();
      // FIX-26: on a video page only the video block's links (not recommendations).
      const anchors = ((await videoMainRoot(frame, this.intent)) ?? frame).locator('a[href]');
      const anchorCount = await anchors.count();
      const raw = await anchors.evaluateAll((nodes) =>
        nodes
          .filter((n) => n.getClientRects().length)
          .slice(0, 10000)
          .map((n) => ({
            text: (n.textContent || '').slice(0, 500),
            url: (n as HTMLAnchorElement).href,
            kind:
              n.closest('ytd-playlist-renderer, ytd-radio-renderer') ||
              /[?&]list=|\/playlist(?:\?|$)/.test((n as HTMLAnchorElement).href)
                ? 'playlist'
                : n.closest('ytd-channel-renderer') ||
                    /youtube\.com\/(?:@|channel\/|c\/)/.test((n as HTMLAnchorElement).href)
                  ? 'channel'
                  : /youtube\.com\/(?:watch\?v=|shorts\/)/.test((n as HTMLAnchorElement).href)
                    ? 'video'
                    : 'link',
          })),
      );
      const start = action.start ?? 0;
      const limit = action.limit ?? 50;
      const accessibleItems = raw
        .filter((item) => /^https?:/.test(item.url))
        .slice(start, start + limit)
        .map((item) => ({ ...item, url: stripTrackingFromUrl(item.url) }));
      const items = accessibleItems.map((item) => ({
        ...item,
        url: safeObservationUrl(item.url),
        containsSensitiveParameters: safeObservationUrl(item.url) !== item.url,
      }));
      const clean = JSON.parse(await redactPageText(frame, JSON.stringify(items)));
      const meta = await this.metadata(frame);
      if (before !== (await observationState(frame)).documentId || beforeUrl !== frame.url())
        throw new Error('stale_observation');
      return {
        ...json({
          ...meta,
          items: clean,
          range: [start, start + items.length],
          sourceTruncated: anchorCount > 10000,
          end: start + items.length >= raw.length,
          truncated: start + items.length < raw.length,
        }),
        // Host-only: never serialised into the tool text or model messages.
        links: accessibleItems.map((item) => item.url),
      };
    }
    if (action.tool === 'tables') {
      const before = (await observationState(frame)).documentId;
      const beforeUrl = frame.url();
      const tableCount = await frame.locator('table').count();
      const start = action.start ?? 0;
      const limit = action.limit ?? 50;
      const items = await frame.locator('table').evaluateAll(
        (nodes, { start, limit }) =>
          nodes.slice(0, 20).map((node, index) => {
            const table = node as HTMLTableElement;
            const all = Array.from(table.rows);
            const header =
              table.tHead?.rows[table.tHead.rows.length - 1] ??
              (all[0] && Array.from(all[0].cells).every((c) => c.tagName === 'TH') ? all[0] : null);
            const columns = header
              ? Array.from(header.cells).map((c) => (c.innerText || '').slice(0, 500))
              : Array.from(
                  { length: Math.max(0, ...all.map((r) => r.cells.length)) },
                  (_, i) => `Column ${i + 1}`,
                );
            const rows = all.filter((row) =>
              table.tHead ? !table.tHead.contains(row) : row !== header,
            );
            return {
              table: index,
              caption: table.caption?.innerText ?? '',
              columnSource: header ? 'header' : 'generated',
              columns,
              rows: rows
                .slice(start, start + limit)
                .map((r) => Array.from(r.cells).map((c) => (c.innerText || '').slice(0, 500))),
              range: [Math.min(start, rows.length), Math.min(start + limit, rows.length)],
              cellsTruncated: all.some((r) =>
                Array.from(r.cells).some((c) => (c.innerText || '').length > 500),
              ),
              end: start + limit >= rows.length,
              truncated: start + limit < rows.length,
              sourceURL: location.href,
              paginationSource: Array.from(document.querySelectorAll('a[rel="next"]')).map(
                (n) => (n as HTMLAnchorElement).href,
              ),
            };
          }),
        { start, limit },
      );
      for (const item of items) {
        item.sourceURL = safeObservationUrl(item.sourceURL);
        item.paginationSource = item.paginationSource.map((url) => safeObservationUrl(url));
      }
      const clean = JSON.parse(await redactPageText(frame, JSON.stringify(items)));
      const meta = await this.metadata(frame);
      if (before !== (await observationState(frame)).documentId || beforeUrl !== frame.url())
        throw new Error('stale_observation');
      return json({
        ...meta,
        items: clean,
        truncated: tableCount > 20 || items.some((t) => t.truncated || t.cellsTruncated),
      });
    }
    return null;
  }
  async act(
    action: UnifiedBrowserAction,
    execute: () => Promise<UnifiedToolResult>,
  ): Promise<UnifiedToolResult> {
    await this.causality.prepare();
    await this.validate(action);
    const { page, frame } = this.resolve(action);
    const before = await observationState(frame);
    this.requests = [];
    let origin = '';
    try {
      origin = new URL(action.tool === 'navigate' ? action.url : before.url, before.url).origin;
    } catch {}
    const pending = this.interruption();
    if (pending)
      return {
        ok: false,
        text: pending.message,
        interruption: pending,
        effect: this.pendingEffect(),
      };
    const window: ActionWindow = {
      token: randomUUID(),
      interactive: ['click', 'click_at', 'type', 'select'].includes(action.tool),
      causes: new Map(),
      records: [],
      frame,
      origin,
      pages: new Set([page]),
      priorRequests: new Set(
        [...this.backgroundRequests].filter(([, count]) => count >= 2).map(([key]) => key),
      ),
      inFlight: new Set(),
      lastActivity: Date.now(),
      action: action.tool,
    };
    this.actionWindow = window;
    this.pendingAction = window;
    this.windows.set(window.token, window);
    if (this.windows.size > 64) this.windows.delete(this.windows.keys().next().value!);
    if (window.interactive)
      await this.causality.arm(
        frame,
        window.token,
        'ref' in action && action.ref ? this.locator(frame, action.ref) : undefined,
      );
    const opened: Page[] = [];
    const popup = (p: Page) => {
      this.register(p);
      window.pages.add(p);
      opened.push(p);
    };
    page.on('popup', popup);
    page.context().on('page', popup);
    let result: UnifiedToolResult;
    try {
      result = await execute();
      if (window.interactive) await this.causality.disarm(frame, window.token);
      await this.waitForNetworkQuiet(window);
    } finally {
      if (window.interactive) await this.causality.disarm(frame, window.token);
      page.off('popup', popup);
      page.context().off('page', popup);
      this.actionWindow = null;
    }
    const after = await observationState(frame).catch(() => null);
    const writes = this.requests.filter((r) => r.write);
    const triggers = writes.map((r) => ({
      branch: r.branch,
      method: r.method,
      url: r.url,
      action: action.tool,
    }));
    const newReceipt =
      (window.interactive &&
        after?.receiptRegions.some(
          (text) => TRANSACTION_RECEIPT_RE.test(text) && !before.receiptRegions.includes(text),
        )) ??
      false;
    // A script-handled Enter is a possible submission — except in a search box
    // whose search visibly landed (new URL or new content).
    const enterIntercepted =
      (after?.interceptedEnter ?? 0) > before.interceptedEnter ||
      ((after?.interceptedSearchEnter ?? 0) > (before.interceptedSearchEnter ?? 0) &&
        after?.url === before.url &&
        after?.dom === before.dom);
    const unexpected =
      writes.length > 0 ||
      (action.tool === 'type' && action.submit && enterIntercepted) ||
      (window.interactive && opened.some((p) => TRANSACTION_PAGE_RE.test(p.url()))) ||
      (window.interactive &&
        !!after &&
        TRANSACTION_PAGE_RE.test(after.url) &&
        after.url !== before.url) ||
      (after?.dom !== before.dom && newReceipt);
    if (newReceipt)
      triggers.push({
        branch: 'new_transaction_receipt',
        method: '',
        url: safeObservationUrl(after?.url ?? before.url),
        action: action.tool,
      });
    if (action.tool === 'type' && action.submit && enterIntercepted)
      triggers.push({
        branch: 'intercepted_submit',
        method: '',
        url: safeObservationUrl(before.url),
        action: action.tool,
      });
    if (window.interactive && opened.some((p) => TRANSACTION_PAGE_RE.test(p.url())))
      triggers.push({
        branch: 'transaction_popup',
        method: '',
        url: '[task popup]',
        action: action.tool,
      });
    if (
      window.interactive &&
      after &&
      TRANSACTION_PAGE_RE.test(after.url) &&
      after.url !== before.url
    )
      triggers.push({
        branch: 'transaction_navigation',
        method: '',
        url: safeObservationUrl(after.url),
        action: action.tool,
      });
    const effect = {
      urlChanged: before.url !== after?.url,
      formChanged: before.forms !== after?.forms,
      domChanged: before.dom !== after?.dom,
      networkCategories: [...new Set(this.requests.map((r) => r.category))],
      triggers,
      backgroundRequests: this.backgroundEvidence(),
      observationAvailable: !!after,
      unexpected,
    };
    result.effect = effect;
    if (unexpected)
      result.interruption = {
        reason: 'unexpected_effect',
        message:
          '检测到写请求或交易状态变化，已暂停后续操作。第一次副作用无法事前阻止，请核对结果后确认如何继续。',
      };
    if (opened.length) {
      const observations = [];
      for (const p of opened) {
        await ensureExecutionViewport(p);
        await p.waitForLoadState('domcontentloaded', { timeout: 3000 }).catch(() => {});
        observations.push(
          JSON.parse((await this.read({ tool: 'read_page', tabId: this.tabId(p) }))!.text),
        );
      }
      result.text += `\npopup: ${JSON.stringify(observations)}`;
    }
    if (isMutatingBrowserAction(action)) {
      // FIX-24 (core-08): an edit that changed only form values (same URL, text,
      // nodes and nothing opened) keeps the snapshot's refs for the next field.
      const kept = this.observations.get(frame);
      const valuesOnly =
        !!kept &&
        !!after &&
        result.ok &&
        !unexpected &&
        !opened.length &&
        !effect.urlChanged &&
        !effect.domChanged &&
        (await this.fingerprint(frame).catch(() => null))?.structure === kept.structure;
      if (!valuesOnly) this.observations.delete(frame);
    }
    return result;
  }
}
