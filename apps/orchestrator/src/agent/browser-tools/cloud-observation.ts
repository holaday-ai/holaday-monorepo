import { createHash, randomUUID } from 'node:crypto';
import type { Frame, Page, Request } from 'playwright';
import { stripTrackingFromUrl } from '../../execution/url-identity.js';
import { redactPageText } from './page-redaction.js';
import { isMutatingBrowserAction, type UnifiedBrowserAction } from './unified-tools.js';
import type { UnifiedToolResult } from './playwright-unified-executor.js';

const hash = (s: string) => createHash('sha256').update(s).digest('hex');
export function safeObservationUrl(value: string): string {
  try {
    const url = new URL(value);
    url.username = '';
    url.password = '';
    for (const key of [...url.searchParams.keys()]) {
      if (/token|secret|password|signature|authorization|cookie|code|key|session/i.test(key))
        url.searchParams.set(key, '[redacted]');
    }
    if (/token|secret|password|access_token|id_token/i.test(url.hash)) url.hash = '[redacted]';
    return stripTrackingFromUrl(url.href);
  } catch {
    return 'about:blank';
  }
}

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
    const sensitive =
      !!document.querySelector(
        'input[type="password"],input[autocomplete="one-time-code"],input[autocomplete^="cc-"],input[name*="otp" i],input[name*="card" i],input[name*="cvv" i]',
      ) ||
      /\b(login|signin|sign-in|checkout|payment|2fa|verify-identity)\b/i.test(location.pathname) ||
      /登录|验证码|两步验证|信用卡|银行卡|支付密码|\b(sign in|log in|verification code|card number|CVV)\b/i.test(
        text,
      );
    return {
      documentId: root.__holadayObservation.id,
      version: root.__holadayObservation.version,
      interceptedEnter: root.__holadayObservation.interceptedEnter,
      forms: JSON.stringify(form),
      text,
      sensitive,
      geometry: [scrollX, scrollY, innerWidth, innerHeight],
    };
  });
  return { ...state, forms: hash(state.forms), dom: hash(state.text), url: frame.url() };
}

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
  private pendingWrite = false;
  interruption() {
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
  }
  get page() {
    return this.active;
  }
  register(page: Page) {
    if ([...this.tabs.values()].includes(page)) return;
    this.tabs.set(`tab_${randomUUID()}`, page);
  }
  private recordRequest(r: Request) {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(r.method())) this.pendingWrite = true;
    this.requests.push({
      category: `${r.method()}:${r.resourceType()}`,
      write: !['GET', 'HEAD', 'OPTIONS'].includes(r.method()),
    });
    if (this.requests.length > 400) this.requests.shift();
  }
  private onRequest = (request: Request) => {
    let page: Page;
    try {
      page = request.frame().page();
    } catch {
      // Popup navigation and service-worker requests may have no Frame yet.
      // No payload is read; an unattributed write conservatively pauses this context.
      if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) this.recordRequest(request);
      return;
    }
    if ([...this.tabs.values()].includes(page)) {
      this.recordRequest(request);
      return;
    }
    void page
      .opener()
      .then((opener) => {
        if (opener && [...this.tabs.values()].includes(opener)) {
          this.register(page);
          this.recordRequest(request);
        }
      })
      .catch(() => {});
  };
  dispose() {
    this.active.context().off('request', this.onRequest);
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
        tree: '敏感页面：请用户接管',
        end: true,
        truncated: false,
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
        (_m, p, u) => p + safeObservationUrl(String(u).replace(/^"|"$/g, '')),
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
      const items = raw
        .filter((item) => /^https?:/.test(item.url))
        .slice(start, start + limit)
        .map((item) => ({ ...item, url: safeObservationUrl(item.url) }));
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
        links: clean
          .map((i: { url: string }) => i.url)
          .filter((u: string) => !/(?:\[redacted\]|%5Bredacted%5D)/i.test(u)),
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
        item.paginationSource = item.paginationSource.map(safeObservationUrl);
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
    const opened: Page[] = [];
    const popup = (p: Page) => {
      this.register(p);
      opened.push(p);
    };
    page.on('popup', popup);
    let result: UnifiedToolResult;
    try {
      result = await execute();
      await page.waitForTimeout(200).catch(() => {});
    } finally {
      page.off('popup', popup);
    }
    const after = await observationState(frame).catch(() => null);
    const writes = this.requests.filter((r) => r.write).map((r) => r.category);
    const dangerous = (s: string) =>
      /\b(payment|checkout|purchase|order|deleted|sent)\b|支付|付款|订单|已删除|已发送/i.test(s);
    const unexpected =
      this.pendingWrite ||
      writes.length > 0 ||
      !after ||
      (action.tool === 'type' &&
        action.submit &&
        after.interceptedEnter > before.interceptedEnter) ||
      opened.some((p) => dangerous(p.url())) ||
      (dangerous(after.url) && after.url !== before.url) ||
      (after.dom !== before.dom && dangerous(after.text) && !dangerous(before.text));
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
