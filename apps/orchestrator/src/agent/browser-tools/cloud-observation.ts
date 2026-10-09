import { createHash, randomUUID } from 'node:crypto';
import type { Frame, Page, Request } from 'playwright';
import { stripTrackingFromUrl } from '../../execution/url-identity.js';
import { TRANSACTION_PAGE_RE } from '../supercar/runtime-action-policy.js';
import { redactPageText } from './page-redaction.js';
import type { UnifiedToolResult } from './playwright-unified-executor.js';
import { type UnifiedBrowserAction, isMutatingBrowserAction } from './unified-tools.js';

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
export async function observationState(frame: Frame) {
  const state = await frame.evaluate(() => {
    const root = globalThis as typeof globalThis & {
      __holadayObservation?: { id: string; version: number; interceptedEnter: number };
    };
    if (!root.__holadayObservation) {
      const current = { id: `${Date.now()}-${Math.random()}`, version: 0, interceptedEnter: 0 };
      root.__holadayObservation = current;
      new MutationObserver(() => current.version++).observe(document, {
        subtree: true,
        childList: true,
        attributes: true,
        characterData: true,
      });
      document.addEventListener(
        'keydown',
        (event) => {
          if (event.key === 'Enter')
            setTimeout(() => {
              if (event.defaultPrevented) current.interceptedEnter++;
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
            (((container.parentElement ?? container) as HTMLElement).innerText || '').slice(
              0,
              2000,
            ),
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
      interceptedEnter: root.__holadayObservation.interceptedEnter,
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
  });
  return { ...state, forms: hash(state.forms), dom: hash(state.text), url: frame.url() };
}

type ActionWindow = {
  frame: Frame;
  origin: string;
  pages: Set<Page>;
  priorRequests: Set<string>;
  inFlight: Set<Request>;
  lastActivity: number;
};

export class CloudObservation {
  private tabs = new Map<string, Page>();
  private frames = new Map<string, Frame>();
  private observations = new Map<
    Frame,
    { fingerprint: string; revision: string; refs: Set<string> }
  >();
  private virtualRefs = new Map<Frame, Map<string, number>>();
  private cursors = new Map<
    string,
    { frame: Frame; fingerprint: string; text: string; offset: number; revision: string }
  >();
  private requests: Array<{ category: string; write: boolean }> = [];

  private active: Page;
  private backgroundRequests = new Map<string, number>();
  private actionWindow: ActionWindow | null = null;
  private pendingAction: ActionWindow | null = null;
  private pendingWrite = false;
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
  constructor(page: Page) {
    this.active = page;
    this.register(page);
    page.context().on('request', this.onRequest);
    page.context().on('requestfinished', this.onRequestSettled);
    page.context().on('requestfailed', this.onRequestSettled);
  }
  get page() {
    return this.active;
  }
  register(page: Page) {
    if ([...this.tabs.values()].includes(page)) return;
    this.tabs.set(`tab_${randomUUID()}`, page);
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
    try {
      if (!window.pages.has(r.frame().page())) return;
    } catch {
      /* A task popup's initial navigation may not have a frame yet. */
    }
    const telemetryPath = /(?:^|\/)(?:collect|track|log|logs|beacon|heartbeat|ping)(?:\/|$)/i.test(
      url.pathname,
    );
    const telemetryHost =
      /(?:^|\.)(?:google-analytics\.com|googletagmanager\.com|sentry\.io|mixpanel\.com|segment\.(?:com|io)|sensorsdata\.cn)$/i.test(
        url.hostname,
      );
    const ignored =
      (telemetryPath && (url.origin === window.origin || telemetryHost)) ||
      (!navigation && window.priorRequests.has(signature));
    if (ignored && !transactional) return;
    const write =
      transactional || (graphql !== 'query' && !['GET', 'HEAD', 'OPTIONS'].includes(r.method()));
    window.lastActivity = Date.now();
    window.inFlight.add(r);
    this.requestWindows.set(r, window);
    if (write) this.pendingWrite = true;
    this.requests.push({ category: `${r.method()}:${r.resourceType()}`, write });
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
    this.active.context().off('request', this.onRequest);
    this.active.context().off('requestfinished', this.onRequestSettled);
    this.active.context().off('requestfailed', this.onRequestSettled);
    this.requestWindows.clear();
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
  private async fingerprint(frame: Frame) {
    const state = await observationState(frame);
    return hash(
      JSON.stringify([
        state.documentId,
        state.version,
        state.forms,
        state.dom,
        state.url,
        state.geometry,
      ]),
    );
  }
  async validate(action: UnifiedBrowserAction) {
    const { frame } = this.resolve(action);
    if ('ref' in action && action.ref) {
      const current = this.observations.get(frame);
      if (
        !current ||
        !current.refs.has(action.ref) ||
        action.observationRevision !== current.revision ||
        (await this.fingerprint(frame)) !== current.fingerprint
      )
        throw new Error('stale_observation');
    }
  }
  async metadata(frame: Frame) {
    const fingerprint = await this.fingerprint(frame);
    let current = this.observations.get(frame);
    if (!current || current.fingerprint !== fingerprint) {
      current = { fingerprint, revision: randomUUID(), refs: new Set() };
      this.observations.set(frame, current);
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
    const { page, frame } = this.resolve(action);
    const json = (value: unknown): UnifiedToolResult => ({
      ok: true,
      text: JSON.stringify(value),
      url: safeObservationUrl(frame.url()),
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
      this.observations.clear();
      this.cursors.clear();
      return this.read({ tool: 'read_page' });
    }
    if (
      !['snapshot', 'read_page', 'get_page_text', 'links', 'tables', 'scroll_until'].includes(
        action.tool,
      )
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
      let prior = '',
        stalls = 0,
        steps = 0,
        itemCount = 0,
        reason = 'step_limit';
      for (; steps < (action.maxSteps ?? 10); steps++) {
        if (Date.now() - started >= (action.maxMs ?? 5000)) {
          reason = 'time_limit';
          break;
        }
        const state = await observationState(frame);
        itemCount = await frame.locator('li,[role=listitem],tbody tr').count();
        if (itemCount >= (action.maxItems ?? 1000)) {
          reason = 'item_limit';
          break;
        }
        if (state.text.length >= budget) {
          reason = 'text_limit';
          break;
        }
        const progress = await frame.evaluate(() =>
          JSON.stringify([document.body?.scrollHeight, scrollY, document.body?.innerText.length]),
        );
        stalls = progress === prior ? stalls + 1 : 0;
        prior = progress;
        if (stalls >= 2) {
          reason = 'stalled';
          break;
        }
        await frame.evaluate(() => window.scrollBy(0, Math.max(200, innerHeight - 100)));
        await page.waitForTimeout(100);
      }
      return json({
        ...(await this.metadata(frame)),
        steps,
        itemCount,
        reason,
        tokenBudget: action.maxTokens ?? 8000,
        truncated: true,
        end: false,
        text: (await redactPageText(frame, (await observationState(frame)).text)).slice(0, budget),
      });
    }
    if (action.tool === 'snapshot' || action.tool === 'read_page') {
      const before = await this.fingerprint(frame);
      let tree = await redactPageText(
        frame,
        await frame.locator('body').ariaSnapshot({ mode: 'ai', timeout: 5000 }),
      );
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
      if (before !== (await this.fingerprint(frame))) throw new Error('stale_observation');
      // Rewrite only URL scalar lines; never shorten real resource identities.
      const safeTree = tree.replace(
        /^(\s*- \/url: )(.*)$/gm,
        (_m, p, u) => p + safeObservationUrl(String(u).replace(/^"|"$/g, ''), frame.url()),
      );
      const meta = await this.metadata(frame);
      const current = this.observations.get(frame)!;
      if (current.fingerprint !== before) throw new Error('stale_observation');
      current.revision = randomUUID();
      meta.observationRevision = current.revision;
      current.refs = new Set(
        [...safeTree.slice(0, 24000).matchAll(/\[ref=(e\d+)\]/g)].map((m) => m[1]!),
      );
      return json({
        ...meta,
        tree: safeTree.slice(0, 24000),
        truncated: safeTree.length > 24000,
        refExpiresOn: ['DOM mutation', 'form change', 'navigation', 'tab switch'],
        frames: page
          .frames()
          .slice(0, 30)
          .map((f) => ({ frameId: this.frameId(f), sourceURL: safeObservationUrl(f.url()) })),
      });
    }
    if (action.tool === 'get_page_text') {
      const fingerprint = await this.fingerprint(frame);
      const meta = await this.metadata(frame);
      let text: string,
        offset = 0;
      if (action.cursor) {
        const cursor = this.cursors.get(action.cursor);
        this.cursors.delete(action.cursor);
        if (
          !cursor ||
          cursor.frame !== frame ||
          cursor.fingerprint !== fingerprint ||
          cursor.revision !== meta.observationRevision
        )
          throw new Error('stale_cursor');
        text = cursor.text;
        offset = cursor.offset;
      } else
        text = await redactPageText(
          frame,
          await frame.locator('body').innerText({ timeout: 5000 }),
        );
      if (fingerprint !== (await this.fingerprint(frame))) throw new Error('stale_cursor');
      const endOffset = Math.min(text.length, offset + (action.maxChars ?? 8000));
      const end = endOffset >= text.length;
      const cursor = end ? null : randomUUID();
      if (cursor) {
        if (this.cursors.size >= 32) this.cursors.delete(this.cursors.keys().next().value!);
        this.cursors.set(cursor, {
          frame,
          fingerprint,
          text,
          offset: endOffset,
          revision: meta.observationRevision,
        });
      }
      return json({
        ...meta,
        text: text.slice(offset, endOffset),
        range: [offset, endOffset],
        cursor,
        end,
        truncated: !end,
      });
    }
    if (action.tool === 'links') {
      const before = await this.fingerprint(frame);
      const anchorCount = await frame.locator('a[href]').count();
      const raw = await frame.locator('a[href]').evaluateAll((nodes) =>
        nodes
          .filter((n) => n.getClientRects().length)
          .slice(0, 10000)
          .map((n) => ({
            text: (n.textContent || '').slice(0, 500),
            url: (n as HTMLAnchorElement).href,
          })),
      );
      const start = action.start ?? 0,
        limit = action.limit ?? 50;
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
      if (before !== (await this.fingerprint(frame))) throw new Error('stale_observation');
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
      const before = await this.fingerprint(frame);
      const tableCount = await frame.locator('table').count();
      const start = action.start ?? 0,
        limit = action.limit ?? 50;
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
      if (before !== (await this.fingerprint(frame))) throw new Error('stale_observation');
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
    await this.validate(action);
    const { page, frame } = this.resolve(action);
    const before = await observationState(frame);
    this.requests = [];
    let origin = '';
    try {
      origin = new URL(before.url).origin;
    } catch {}
    const pending = this.interruption();
    if (pending) return { ok: false, text: pending.message, interruption: pending };
    const window: ActionWindow = {
      frame,
      origin,
      pages: new Set([page]),
      priorRequests: new Set(
        [...this.backgroundRequests].filter(([, count]) => count >= 2).map(([key]) => key),
      ),
      inFlight: new Set(),
      lastActivity: Date.now(),
    };
    this.actionWindow = window;
    this.pendingAction = window;
    const opened: Page[] = [];
    const popup = (p: Page) => {
      this.register(p);
      window.pages.add(p);
      opened.push(p);
    };
    page.on('popup', popup);
    let result: UnifiedToolResult;
    try {
      result = await execute();
      await this.waitForNetworkQuiet(window);
    } finally {
      page.off('popup', popup);
      this.actionWindow = null;
    }
    const after = await observationState(frame).catch(() => null);
    const writes = this.requests.filter((r) => r.write).map((r) => r.category);
    const newReceipt =
      after?.receiptRegions.some(
        (text) => TRANSACTION_RECEIPT_RE.test(text) && !before.receiptRegions.includes(text),
      ) ?? false;
    const unexpected =
      writes.length > 0 ||
      !after ||
      (action.tool === 'type' &&
        action.submit &&
        after.interceptedEnter > before.interceptedEnter) ||
      opened.some((p) => TRANSACTION_PAGE_RE.test(p.url())) ||
      (TRANSACTION_PAGE_RE.test(after.url) && after.url !== before.url) ||
      (after.dom !== before.dom && newReceipt);
    const effect = {
      urlChanged: before.url !== after?.url,
      formChanged: before.forms !== after?.forms,
      domChanged: before.dom !== after?.dom,
      networkCategories: [...new Set(this.requests.map((r) => r.category))],
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
        await p.waitForLoadState('domcontentloaded', { timeout: 3000 }).catch(() => {});
        observations.push(
          JSON.parse((await this.read({ tool: 'read_page', tabId: this.tabId(p) }))!.text),
        );
      }
      result.text += `\npopup: ${JSON.stringify(observations)}`;
    }
    if (isMutatingBrowserAction(action)) this.observations.delete(frame);
    return result;
  }
}
