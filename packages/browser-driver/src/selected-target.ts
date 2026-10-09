import type {
  UserBrowserBinding,
  UserBrowserElementSignals,
  UserBrowserTargetDescription,
} from '@holaday/shared-types';
import type { ElementHandle, Frame, Locator, Page } from 'playwright-crx';
import type { DriverAction } from './driver.js';
import { type LocatorSpec, buildSelectorPlan } from './selector-plan.js';

type DocumentVersion = { document: string; epoch: number };
// Executed in the document. No values, cookies, storage or network data leave it.
const readVersion = (): DocumentVersion => {
  const win = window as typeof window & { __holadayV2Document?: DocumentVersion };
  if (!win.__holadayV2Document) {
    const state = { document: crypto.randomUUID(), epoch: 0 };
    new MutationObserver(() => {
      state.epoch++;
    }).observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
    win.__holadayV2Document = state;
  }
  return { ...win.__holadayV2Document };
};
const readElement = async (
  node: Element,
): Promise<
  Pick<UserBrowserTargetDescription, 'elementId' | 'objectDigest' | 'element' | 'form'>
> => {
  const selector =
    'button,a[href],input,select,textarea,summary,label,[role=button],[role=link],[role=menuitem],[role=option],[role=tab],[onclick]';
  let el = node;
  for (let cur: Element | null = node, hops = 0; cur && hops < 200; hops++) {
    if (cur.matches(selector)) {
      el = cur;
      break;
    }
    const root = cur.getRootNode();
    cur = cur.parentElement ?? ('host' in root ? (root as ShadowRoot).host : null);
  }
  const win = window as typeof window & { __holadayV2Nodes?: WeakMap<Element, string> };
  const ids = win.__holadayV2Nodes ?? new WeakMap<Element, string>();
  win.__holadayV2Nodes = ids;
  let elementId = ids.get(el);
  if (!elementId) {
    elementId = crypto.randomUUID();
    ids.set(el, elementId);
  }
  const input = el as HTMLInputElement;
  const owner = input.form ?? el.closest('form');
  const link = el.closest('a[href]') as HTMLAnchorElement | null;
  const objects = JSON.stringify([
    link?.href,
    link?.getAttribute('href'),
    (owner as HTMLFormElement | null)?.action,
    owner?.getAttribute('action'),
    owner?.getAttribute('method'),
    el.getAttribute('formaction'),
    el.getAttribute('formmethod'),
    ...Array.from(owner?.querySelectorAll('[formaction],[formmethod]') ?? []).map((control) => [
      control.getAttribute('formaction'),
      control.getAttribute('formmethod'),
    ]),
  ]);
  // Only an opaque digest leaves the page; URL query credentials never enter the model.
  const objectDigest = Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(objects))),
    (byte) => byte.toString(16).padStart(2, '0'),
  ).join('');
  const tag = el.tagName.toLowerCase();
  const text = String((el as HTMLElement).innerText || el.textContent || '')
    .trim()
    .slice(0, 200);
  const element: UserBrowserElementSignals = {
    role:
      el.getAttribute('role') ||
      (
        {
          button: 'button',
          a: 'link',
          select: 'combobox',
          textarea: 'textbox',
          input: 'textbox',
        } as Record<string, string>
      )[tag] ||
      null,
    visibleText:
      text ||
      (tag === 'input' && /^(submit|button)$/.test((el as HTMLInputElement).type)
        ? (el as HTMLInputElement).value.slice(0, 200)
        : null),
    ariaLabel:
      (
        el.getAttribute('aria-label') ||
        (el.getAttribute('aria-labelledby') || '')
          .split(/\s+/)
          .map((id) => el.ownerDocument.getElementById(id)?.textContent || '')
          .join(' ')
          .trim() ||
        Array.from((el as HTMLInputElement).labels || [])
          .map((label) => label.textContent || '')
          .join(' ')
          .trim()
      ).slice(0, 200) || null,
    title: el.getAttribute('title')?.slice(0, 200) ?? null,
    placeholder: el.getAttribute('placeholder')?.slice(0, 200) ?? null,
    name: (el.getAttribute('name') || el.getAttribute('id'))?.slice(0, 200) ?? null,
    inputType: el.getAttribute('type'),
    tagName: tag,
  };
  const form = (el as HTMLInputElement).form ?? el.closest('form');
  if (!form) return { elementId, objectDigest, element, form: null };
  const allFields = Array.from((form as HTMLFormElement).elements).filter((field) =>
    /^(INPUT|TEXTAREA|SELECT)$/.test(field.tagName),
  );
  const fields = allFields.slice(0, 40);
  const fieldSignal = fields
    .map((field) =>
      [
        field.getAttribute('name'),
        field.id,
        field.getAttribute('placeholder'),
        field.getAttribute('aria-label'),
        Array.from((field as HTMLInputElement).labels || [])
          .map((label) => label.textContent || '')
          .join(' '),
      ]
        .filter(Boolean)
        .join(' ')
        .slice(0, 120),
    )
    .join(' ')
    .slice(0, 1200);
  const submitters = Array.from((form as HTMLFormElement).elements).filter(
    (field) =>
      (field.tagName === 'BUTTON' && (field as HTMLButtonElement).type === 'submit') ||
      (field.tagName === 'INPUT' && /^(submit|image)$/.test((field as HTMLInputElement).type)),
  );
  // Clicking a submitter uses its overrides; Enter in a field uses the form's
  // actual default submitter, including controls associated via form=.
  const submit = submitters.includes(el) ? el : submitters[0];
  const method = (
    submit?.getAttribute('formmethod') ||
    form.getAttribute('method') ||
    'get'
  ).toLowerCase();
  const action = submit?.hasAttribute('formaction')
    ? new URL(submit.getAttribute('formaction') || location.href, document.baseURI)
    : new URL((form as HTMLFormElement).action || location.href);
  const transactionalAction =
    /pay|payment|checkout|cashier|order|settle|purchase|transfer|withdraw|delete|remove|destroy|unsubscribe|支付|付款|下单|订单|删除/i.test(
      action.href,
    );
  action.search = '';
  action.hash = '';
  action.username = '';
  action.password = '';
  return {
    elementId,
    objectDigest,
    element,
    form: {
      action: action.href.slice(0, 1200),
      method,
      fieldSignal,
      transactionalAction,
      hasAmountField: fields.some(
        (field) =>
          (field as HTMLInputElement).type === 'number' ||
          (field as HTMLInputElement).inputMode === 'decimal',
      ),
      searchLike:
        method === 'get' &&
        /^https?:$/.test(action.protocol) &&
        allFields.length <= 40 &&
        (form.getAttribute('role') === 'search' ||
          /\/(?:s|search)(?:[/?]|$)/i.test(action.pathname) ||
          /搜索|search|(?:^|\s)(?:q|query|keyword|wd|kw)(?:\s|$)/i.test(fieldSignal)),
      submitControl: submit
        ? {
            role: submit.getAttribute('role') || 'button',
            visibleText:
              String((submit as HTMLElement).innerText || (submit as HTMLInputElement).value || '')
                .trim()
                .slice(0, 200) || null,
            ariaLabel: submit.getAttribute('aria-label')?.slice(0, 200) ?? null,
            title: submit.getAttribute('title')?.slice(0, 200) ?? null,
            placeholder: null,
            name: submit.getAttribute('name')?.slice(0, 200) ?? null,
            inputType: submit.getAttribute('type') || 'submit',
            tagName: submit.tagName.toLowerCase(),
          }
        : null,
    },
  };
};
/** Opaque per-node id shared by every read in the page's main world. */
const nodeId = (node: Element): string => {
  const win = window as typeof window & { __holadayV2Nodes?: WeakMap<Element, string> };
  const ids = win.__holadayV2Nodes ?? new WeakMap<Element, string>();
  win.__holadayV2Nodes = ids;
  let id = ids.get(node);
  if (!id) {
    id = crypto.randomUUID();
    ids.set(node, id);
  }
  return id;
};
type Signals = Pick<
  UserBrowserTargetDescription,
  'elementId' | 'objectDigest' | 'element' | 'form'
>;
/**
 * Runs on the node Chromium hit-tests at the click point (`this`), which can be
 * inside open or closed shadow roots. `inside`: the hit is the selected
 * element or a shadow-including descendant of it; `document`: the observed
 * document it belongs to (bridges back to the Playwright frame). `opaque`:
 * hit testing stopped at an embedded document it cannot see into (an
 * out-of-process or cross-origin frame, e.g. a third-party payment widget).
 */
const HIT_READ = `async function (selectedId) {
  const node = this.nodeType === 1 ? this : this.parentElement;
  if (!node) return null;
  const ids = window.__holadayV2Nodes;
  let inside = false;
  for (let cur = node, hops = 0; cur && hops < 400; hops++) {
    if (ids && ids.get(cur) === selectedId) { inside = true; break; }
    const root = cur.getRootNode();
    cur = cur.parentElement || (root && 'host' in root ? root.host : null);
  }
  const version = window.__holadayV2Document;
  return {
    inside,
    opaque: /^(?:IFRAME|FRAME|OBJECT|EMBED|PORTAL|FENCEDFRAME)$/.test(node.tagName),
    document: version ? version.document : null,
    read: inside ? await (${readElement.toString()})(node) : null,
  };
}`;
/** Same read for the deepest focused element (key actions). */
const FOCUS_READ = `async function () {
  const version = window.__holadayV2Document;
  return {
    document: version ? version.document : null,
    read: await (${readElement.toString()})(this),
  };
}`;
/** Tabs/addresses that are a payment or order step; the full address
 * (path, query and hash) is tested in the extension, only a boolean leaves. */
const TRANSACTION_URL_RE =
  /(?:\/|\b)(?:checkout|payment|cashier|order[-_/]?confirm|confirm[-_/]?order|order[-_/]?submit|submit[-_/]?order|booking\/confirm|settlement|pay)(?:\/|\b)|订单提交|确认订单|提交订单|收银台|支付|付款|结算/i;
/** Key-order independent: chrome.debugger returns by-value objects with sorted keys. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  );
}
/** Raw CDP on the selected tab (`chrome.debugger.sendCommand` in the extension). */
export type SelectedTabCdp = (method: string, params?: Record<string, unknown>) => Promise<unknown>;
interface Ticket {
  target: UserBrowserTargetDescription;
  action: string;
  handle: ElementHandle<Element> | null;
  frame: Frame;
  /** Clicks: the exact point described and later clicked, and the selected node. */
  point?: { x: number; y: number; selectedId: string };
}

/** One selected page; no selector healing or first-match execution in v2. */
export class SelectedTargetResolver {
  private revision = 0;
  private documents = new Map<Frame, DocumentVersion>();
  private frames = new WeakMap<Frame, string>();
  private ticket: Ticket | null = null;
  constructor(
    private readonly page: Page,
    private readonly tabId: number,
    private readonly origins: readonly string[],
    private readonly cdp: SelectedTabCdp,
  ) {}
  get observationRevision(): number {
    return this.revision;
  }
  private origin(frame: Frame): string {
    let current: Frame | null = frame;
    while (current && /^(about:blank|about:srcdoc)$/.test(current.url()))
      current = current.parentFrame();
    try {
      const url = new URL(current?.url() || '');
      if (
        !/^https?:$/.test(url.protocol) ||
        url.username ||
        url.password ||
        !this.origins.includes(url.origin)
      )
        throw new Error();
      return url.origin;
    } catch {
      throw new Error('origin_grant_required');
    }
  }
  async observe(): Promise<void> {
    this.origin(this.page.mainFrame());
    await this.clearTicket();
    this.documents.clear();
    // Never evaluate an ungranted cross-origin frame.
    for (const frame of this.page.frames().slice(0, 20)) {
      try {
        this.origin(frame);
      } catch {
        continue;
      }
      this.documents.set(frame, await frame.evaluate(readVersion));
      if (!this.frames.has(frame)) this.frames.set(frame, crypto.randomUUID());
    }
    this.revision++;
  }
  async dispose(): Promise<void> {
    await this.clearTicket();
    this.documents.clear();
    this.frames = new WeakMap();
  }
  async assertObservationFresh(): Promise<void> {
    for (const frame of this.documents.keys()) await this.assertFresh(frame, this.revision);
  }
  frameContexts(): Array<{ frame: Frame; frameId: string; origin: string }> {
    return [...this.documents.keys()].map((frame) => ({
      frame,
      frameId: this.frames.get(frame) ?? '',
      origin: this.origin(frame),
    }));
  }
  private async clearTicket(): Promise<void> {
    const ticket = this.ticket;
    this.ticket = null;
    await ticket?.handle?.dispose().catch(() => undefined);
  }
  private async assertFresh(frame: Frame, expected: number): Promise<void> {
    this.origin(this.page.mainFrame());
    this.origin(frame);
    if (expected !== this.revision || !this.documents.has(frame))
      throw new Error('stale_observation');
    const current = await frame.evaluate(readVersion);
    if (JSON.stringify(current) !== JSON.stringify(this.documents.get(frame)))
      throw new Error('stale_observation');
  }
  private frameFor(documentId: unknown): Frame {
    for (const [frame, version] of this.documents)
      if (typeof documentId === 'string' && version.document === documentId) return frame;
    // Not an observed, granted document (or observed before it was replaced).
    throw new Error('stale_observation');
  }
  /** Runs one CDP read and maps transport/page failures to `target_unreadable`. */
  private async withObjects<T>(work: (track: (id: string) => string) => Promise<T>): Promise<T> {
    const objects: string[] = [];
    try {
      return await work((id) => {
        objects.push(id);
        return id;
      });
    } catch (error) {
      const code = error instanceof Error ? error.message : '';
      if (/^(?:target_[a-z_]+|stale_observation|origin_grant_required)$/.test(code)) throw error;
      throw new Error('target_unreadable');
    } finally {
      for (const objectId of objects)
        await this.cdp('Runtime.releaseObject', { objectId }).catch(() => undefined);
    }
  }
  private async callOn(objectId: string, functionDeclaration: string, args: unknown[] = []) {
    const result = (await this.cdp('Runtime.callFunctionOn', {
      objectId,
      functionDeclaration,
      arguments: args.map((value) => ({ value })),
      awaitPromise: true,
      returnByValue: true,
    })) as { result?: { value?: unknown }; exceptionDetails?: unknown };
    if (result.exceptionDetails) throw new Error('target_unreadable');
    return result.result?.value;
  }
  private async objectFrom(objectId: string, functionDeclaration: string): Promise<string | null> {
    const result = (await this.cdp('Runtime.callFunctionOn', {
      objectId,
      functionDeclaration,
      returnByValue: false,
    })) as { result?: { objectId?: string; subtype?: string }; exceptionDetails?: unknown };
    if (result.exceptionDetails) throw new Error('target_unreadable');
    return result.result?.subtype === 'null' ? null : (result.result?.objectId ?? null);
  }
  /**
   * What a real click at viewport point (x, y) lands on: Chromium hit testing
   * pierces open and closed shadow roots and same-process frames and, like
   * the mouse, skips pointer-events:none overlays. The hit must be the
   * selected element or inside it; anything else (an overlay, an
   * out-of-process frame, an unobserved document) is not described.
   */
  private async readAt(
    point: { x: number; y: number },
    selectedId: string,
  ): Promise<{ frame: Frame; signals: Signals }> {
    return this.withObjects(async (track) => {
      const hit = (await this.cdp('DOM.getNodeForLocation', {
        x: point.x,
        y: point.y,
        includeUserAgentShadowDOM: false,
        ignorePointerEventsNone: false,
      })) as { backendNodeId?: number };
      const resolved = (await this.cdp('DOM.resolveNode', {
        backendNodeId: hit.backendNodeId,
      })) as { object?: { objectId?: string } };
      if (!resolved.object?.objectId) throw new Error('target_unreadable');
      const value = (await this.callOn(track(resolved.object.objectId), HIT_READ, [
        selectedId,
      ])) as {
        inside: boolean;
        opaque: boolean;
        document: unknown;
        read: Signals | null;
      } | null;
      if (!value) throw new Error('target_unreadable');
      if (!value.inside || !value.read) throw new Error('target_obscured');
      // What a click inside it would hit is unknown: the user decides.
      if (value.opaque) throw new Error('target_unreadable');
      return { frame: this.frameFor(value.document), signals: value.read };
    });
  }
  /**
   * The deepest focused element, through open and closed shadow roots and
   * same-process frames: Enter/Space act on it, not on a shadow host.
   */
  private async focusTarget(): Promise<{ frame: Frame; signals: Signals }> {
    return this.withObjects(async (track) => {
      const start = (await this.cdp('Runtime.evaluate', {
        expression: 'document.activeElement',
        returnByValue: false,
      })) as { result?: { objectId?: string; subtype?: string } };
      let current = start.result?.subtype === 'null' ? null : (start.result?.objectId ?? null);
      for (let depth = 0; current && depth < 32; depth++) {
        track(current);
        const { node } = (await this.cdp('DOM.describeNode', {
          objectId: current,
          depth: 0,
          pierce: true,
        })) as {
          node: {
            nodeName: string;
            shadowRoots?: Array<{ backendNodeId: number; shadowRootType?: string }>;
          };
        };
        let next: string | null = null;
        const root = node.shadowRoots?.find((r) => r.shadowRootType !== 'user-agent');
        if (root) {
          const resolved = (await this.cdp('DOM.resolveNode', {
            backendNodeId: root.backendNodeId,
          })) as { object?: { objectId?: string } };
          if (!resolved.object?.objectId) throw new Error('target_unreadable');
          next = await this.objectFrom(
            track(resolved.object.objectId),
            'function () { return this.activeElement; }',
          );
        } else if (/^i?frame$/i.test(node.nodeName)) {
          next = await this.objectFrom(
            current,
            'function () { const d = this.contentDocument; return d ? d.activeElement : undefined; }',
          );
          // An out-of-process frame cannot be read from this tab session.
          if (!next) throw new Error('target_unreadable');
        }
        if (!next) {
          const value = (await this.callOn(current, FOCUS_READ)) as {
            document: unknown;
            read: Signals;
          } | null;
          if (!value?.read || /^(?:body|html)$/.test(value.read.element.tagName ?? ''))
            throw new Error('target_missing');
          return { frame: this.frameFor(value.document), signals: value.read };
        }
        current = next;
      }
      throw new Error('target_missing');
    });
  }
  /** The point a click is sent to: the centre of the (scrolled-into-view) element. */
  private async clickPoint(handle: ElementHandle<Element>): Promise<{ x: number; y: number }> {
    await handle.scrollIntoViewIfNeeded({ timeout: 2000 });
    const box = await handle.boundingBox();
    if (!box || box.width < 1 || box.height < 1) throw new Error('target_unreadable');
    return { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) };
  }
  /** The tab's current page: path only (no query/hash values) plus transaction context. */
  private pageContext(frame: Frame): UserBrowserTargetDescription['page'] {
    const main = new URL(this.page.mainFrame().url());
    const decoded = (raw: string) => {
      try {
        return decodeURIComponent(raw);
      } catch {
        return raw;
      }
    };
    return {
      url: `${main.origin}${main.pathname}`.slice(0, 2048),
      transactional: [this.page.mainFrame().url(), frame.url()].some((raw) =>
        TRANSACTION_URL_RE.test(decoded(raw)),
      ),
    };
  }
  private async resolve(
    action: DriverAction,
  ): Promise<{ handle: ElementHandle<Element>; frame: Frame }> {
    if (action.kind === 'key') throw new Error('target_missing');
    if (!action.selector) throw new Error('target_missing');
    const plan = buildSelectorPlan(action.selector);
    for (const spec of plan.attempts) {
      const matches: { locator: Locator; frame: Frame }[] = [];
      for (const frame of this.documents.keys()) {
        try {
          this.origin(frame);
        } catch {
          continue;
        }
        const scope = plan.scopeCss ? frame.locator(plan.scopeCss) : null;
        const locator = locatorFor(frame, scope, spec);
        const count = await locator.count();
        // nth is not a licence to turn an ambiguous description into permission.
        if (count > 1) throw new Error('target_ambiguous');
        if (count === 1) matches.push({ locator, frame });
      }
      if (matches.length > 1) throw new Error('target_ambiguous');
      const match = matches[0];
      if (match) {
        const handle = (await match.locator.elementHandle({
          timeout: 2000,
        })) as ElementHandle<Element> | null;
        if (handle) return { handle, frame: match.frame };
      }
    }
    throw new Error('target_missing');
  }
  async describe(action: DriverAction, expected: number): Promise<UserBrowserTargetDescription> {
    await this.clearTicket();
    let handle: ElementHandle<Element> | null = null;
    try {
      let frame: Frame;
      let signals: Signals;
      let point: Ticket['point'];
      if (action.kind === 'key') {
        ({ frame, signals } = await this.focusTarget());
        await this.assertFresh(frame, expected);
      } else {
        const resolved = await this.resolve(action);
        handle = resolved.handle;
        frame = resolved.frame;
        await this.assertFresh(frame, expected);
        if (!(await handle.isVisible())) throw new Error('target_unreadable');
        if (action.kind === 'click') {
          // Describe what the click will actually hit, not the selector's node:
          // a shadow host's inner payment button is the real target.
          const selectedId = String(await handle.evaluate(nodeId));
          const at = await this.clickPoint(handle);
          const hit = await this.readAt(at, selectedId);
          if (hit.frame !== frame) throw new Error('target_obscured');
          signals = hit.signals;
          point = { ...at, selectedId };
        } else signals = (await handle.evaluate(readElement)) as Signals;
      }
      let frameId = this.frames.get(frame);
      if (!frameId) {
        frameId = crypto.randomUUID();
        this.frames.set(frame, frameId);
      }
      const target: UserBrowserTargetDescription = {
        token: crypto.randomUUID(),
        tabId: this.tabId,
        frameId,
        origin: this.origin(frame),
        observationRevision: expected,
        capturedAt: Date.now(),
        ...signals,
        page: this.pageContext(frame),
      };
      await this.assertFresh(frame, expected);
      this.ticket = { target, action: JSON.stringify(action), handle, frame, point };
      return target;
    } catch (error) {
      await handle?.dispose();
      throw error;
    }
  }
  async execute(action: DriverAction, binding: UserBrowserBinding): Promise<void> {
    const ticket = this.ticket;
    this.ticket = null;
    if (
      !ticket ||
      ticket.target.token !== binding.token ||
      ticket.target.observationRevision !== binding.observationRevision ||
      ticket.action !== JSON.stringify(action)
    ) {
      await ticket?.handle?.dispose();
      throw new Error('target_binding_required');
    }
    const expected = canonical({
      elementId: ticket.target.elementId,
      objectDigest: ticket.target.objectDigest,
      element: ticket.target.element,
      form: ticket.target.form,
    });
    try {
      await this.assertFresh(ticket.frame, binding.observationRevision);
      // The confirmed page context is part of the action (a pushState to
      // /pay keeps the DOM but changes what "继续" means).
      if (canonical(this.pageContext(ticket.frame)) !== canonical(ticket.target.page))
        throw new Error('target_changed');
      const timeout = action.deadlineMs ?? 2000;
      switch (action.kind) {
        case 'click': {
          const point = ticket.point;
          if (!point) throw new Error('target_binding_required');
          // Re-hit-test the very point that will be clicked: same node, same
          // semantics, still inside the selected element.
          const hit = await this.readAt(point, point.selectedId);
          if (hit.frame !== ticket.frame || canonical(hit.signals) !== expected)
            throw new Error('target_changed');
          await this.assertFresh(ticket.frame, binding.observationRevision);
          await this.page.mouse.click(point.x, point.y);
          break;
        }
        case 'key': {
          // The key goes to the focused element; it must be the described one.
          const focus = await this.focusTarget();
          if (focus.frame !== ticket.frame || canonical(focus.signals) !== expected)
            throw new Error('target_changed');
          await this.assertFresh(ticket.frame, binding.observationRevision);
          await this.page.keyboard.press(String(action.payload?.key ?? ''));
          break;
        }
        case 'type':
        case 'select': {
          const handle = ticket.handle;
          if (!handle) throw new Error('target_binding_required');
          const fresh = await handle.evaluate(readElement);
          if (!(await handle.isVisible()) || canonical(fresh) !== expected)
            throw new Error('target_changed');
          if (action.kind === 'type') {
            await handle.fill(String(action.payload?.text ?? ''), { timeout });
            break;
          }
          const text = String(action.payload?.text ?? '');
          const options = (await handle.evaluate((el: Element) =>
            Array.from((el as HTMLSelectElement).options || [])
              .filter((option) => !option.disabled)
              .map((option) => ({ label: option.label, value: option.value })),
          )) as Array<{ label: string; value: string }>;
          const matching = options.filter(
            (option) => option.label === text || option.value === text,
          );
          if (matching.length !== 1 || !matching[0]) throw new Error('target_ambiguous');
          await handle.selectOption(matching[0], { timeout });
          break;
        }
        default:
          throw new Error('unsupported_action');
      }
    } finally {
      await ticket.handle?.dispose();
    }
  }
  async scroll(deltaX: number, deltaY: number): Promise<void> {
    this.origin(this.page.mainFrame());
    await this.page.mouse.wheel(deltaX, deltaY);
  }
}
function locatorFor(frame: Frame, scope: Locator | null, spec: LocatorSpec): Locator {
  const root = scope ?? frame;
  switch (spec.how) {
    case 'role':
      return root.getByRole(spec.role as Parameters<typeof root.getByRole>[0], {
        name: spec.name,
        exact: spec.exact,
      });
    case 'text':
      return root.getByText(spec.value, { exact: spec.exact });
    case 'testid':
      return spec.attr === 'data-testid'
        ? root.getByTestId(spec.value)
        : root.locator(`[${spec.attr}="${spec.value.replace(/[\\"]/g, '\\$&')}"]`);
    case 'css':
      return root.locator(spec.value);
    case 'xpath':
      return root.locator(`xpath=${spec.value}`);
    case 'label':
      return root.getByLabel(spec.value, { exact: spec.exact });
    case 'placeholder':
      return root.getByPlaceholder(spec.value);
  }
}
