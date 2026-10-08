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
interface Ticket {
  target: UserBrowserTargetDescription;
  action: string;
  handle: ElementHandle<Element>;
  frame: Frame;
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
    await ticket?.handle.dispose().catch(() => undefined);
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
  private async focused(): Promise<{ handle: ElementHandle<Element>; frame: Frame }> {
    let frame = this.page.mainFrame();
    for (let depth = 0; depth < 6; depth++) {
      this.origin(frame);
      const js = await frame.evaluateHandle(() => {
        let el = document.activeElement;
        while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
        return el && el !== document.body && el !== document.documentElement ? el : null;
      });
      const handle = js.asElement() as ElementHandle<Element> | null;
      if (!handle) {
        await js.dispose();
        throw new Error('target_missing');
      }
      const child = await handle.contentFrame();
      if (!child) return { handle, frame };
      await handle.dispose();
      frame = child;
    }
    throw new Error('target_missing');
  }
  private async resolve(
    action: DriverAction,
  ): Promise<{ handle: ElementHandle<Element>; frame: Frame }> {
    if (action.kind === 'key') return this.focused();
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
    const { handle, frame } = await this.resolve(action);
    try {
      await this.assertFresh(frame, expected);
      const signals = (await handle.evaluate(readElement)) as Pick<
        UserBrowserTargetDescription,
        'elementId' | 'objectDigest' | 'element' | 'form'
      >;
      if (!(await handle.isVisible())) throw new Error('target_unreadable');
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
      };
      await this.assertFresh(frame, expected);
      this.ticket = { target, action: JSON.stringify(action), handle, frame };
      return target;
    } catch (error) {
      await handle.dispose();
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
      await ticket?.handle.dispose();
      throw new Error('target_binding_required');
    }
    try {
      await this.assertFresh(ticket.frame, binding.observationRevision);
      const fresh = await ticket.handle.evaluate(readElement);
      if (
        !(await ticket.handle.isVisible()) ||
        JSON.stringify(fresh) !==
          JSON.stringify({
            elementId: ticket.target.elementId,
            objectDigest: ticket.target.objectDigest,
            element: ticket.target.element,
            form: ticket.target.form,
          })
      )
        throw new Error('target_changed');
      if (action.kind === 'key') {
        const focused = await this.focused();
        const same = await ticket.handle.evaluate(
          (el: Element, other: Element) => el === other,
          focused.handle,
        );
        await focused.handle.dispose();
        if (!same) throw new Error('target_changed');
      }
      const timeout = action.deadlineMs ?? 2000;
      switch (action.kind) {
        case 'click': {
          // Trial performs actionability/hit testing without generating input.
          await ticket.handle.click({ trial: true, timeout });
          await this.assertFresh(ticket.frame, binding.observationRevision);
          const afterTrial = await ticket.handle.evaluate(readElement);
          if (
            JSON.stringify(afterTrial) !==
            JSON.stringify({
              elementId: ticket.target.elementId,
              objectDigest: ticket.target.objectDigest,
              element: ticket.target.element,
              form: ticket.target.form,
            })
          )
            throw new Error('target_changed');
          await ticket.handle.click({ timeout });
          break;
        }
        case 'type':
          await ticket.handle.fill(String(action.payload?.text ?? ''), { timeout });
          break;
        case 'key':
          await ticket.handle.press(String(action.payload?.key ?? ''), { timeout });
          break;
        case 'select': {
          const text = String(action.payload?.text ?? '');
          const options = (await ticket.handle.evaluate((el: Element) =>
            Array.from((el as HTMLSelectElement).options || [])
              .filter((option) => !option.disabled)
              .map((option) => ({ label: option.label, value: option.value })),
          )) as Array<{ label: string; value: string }>;
          const matching = options.filter(
            (option) => option.label === text || option.value === text,
          );
          if (matching.length !== 1 || !matching[0]) throw new Error('target_ambiguous');
          await ticket.handle.selectOption(matching[0], { timeout });
          break;
        }
        default:
          throw new Error('unsupported_action');
      }
    } finally {
      await ticket.handle.dispose();
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
