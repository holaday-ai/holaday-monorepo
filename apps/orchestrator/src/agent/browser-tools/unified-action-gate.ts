import type { CDPSession, ElementHandle, Frame, Locator, Page } from 'playwright';
import { buildAuthParkQuestion } from '../login-detector.js';
import type { RunSupercarOptions, SupercarAwaitingKind } from '../supercar/agent-loop.js';
import { isAffirmativeActionConfirmation } from '../supercar/runtime-action-policy.js';
import type { ActionGateDecision } from './unified-browser-loop.js';
import type { UnifiedBrowserAction } from './unified-tools.js';

type BeforeAction = NonNullable<RunSupercarOptions['onBeforeAction']>;
export type RuntimeActionDescriptor = Parameters<BeforeAction>[0];

const DESCRIBE_TIMEOUT_MS = 2_000;
const MAX_FRAME_DEPTH = 5;
const CONFIRM_DEFAULT_QUESTION = '即将执行可能产生外部影响的操作。请明确回复“确认执行”后继续。';
const NOT_CONFIRMED_REASON = '用户未确认不可逆操作，本次任务已停止，页面进度已保留。';
const TAKEOVER_RESUME_MESSAGE =
  '用户已完成接管，刚才的操作没有由 Agent 执行。请重新 snapshot 确认页面状态后继续。';
const TARGET_CHANGED_MESSAGE =
  '确认期间页面已变化，刚才确认的操作没有执行。请重新 snapshot，需要时会再次请用户确认。';

/** Form submission targets that move money, place orders or delete things. */
const TRANSACTION_ACTION_RE =
  /pay|payment|checkout|cashier|order|settle|purchase|transfer|withdraw|delete|remove|destroy|unsubscribe|支付|付款|下单|订单|删除/i;
const TRANSACTION_FIELD_RE =
  /金额|价格|总价|付款|支付|银行卡|卡号|有效期|收款|转账|汇款|提现|充值|删除|amount|price|total|payment|card|cvv|cvc|expir|iban|transfer|withdraw|delete/i;

interface ElementSignals {
  visibleText: string | null;
  ariaLabel: string | null;
  title: string | null;
  placeholder: string | null;
  name: string | null;
  type: string | null;
  tagName: string | null;
  url: string | null;
  /** What the action acts on, bound into a confirmation: link target, form submission. */
  href?: string | null;
  formAction?: string | null;
  formMethod?: string | null;
  /** The hit is a host whose internals cannot be seen (closed shadow / custom element). */
  opaque?: boolean;
}

/** What Enter in a field submits: the real form semantics, not just a button. */
interface SubmitContext {
  hasForm: boolean;
  action: string | null;
  /** The `action` attribute as written (a relative target is still bound). */
  rawAction: string | null;
  method: string | null;
  submitControl: ElementSignals | null;
  fieldSignal: string;
  hasAmountField: boolean;
  searchLike: boolean;
}

/**
 * Signals of the element a click on `node` acts on: `node` is the deepest hit
 * (CDP hit-testing pierces open and closed shadow roots and in-process frames),
 * climbed to its closest actionable ancestor across shadow boundaries, so an
 * icon inside a button inside a web component reads as the button. Includes
 * the action's object (link href, form action/method). `{ iframe: true }` when
 * the hit is a frame element the caller must descend into.
 * Serialised into the page via `toString()`: no closures, no named inner
 * helpers (bundlers' `__name` wrappers must not be serialised).
 */
const READ_ACTIONABLE = (
  node: Node,
): (ElementSignals & { iframe?: false }) | { iframe: true } | null => {
  const el = (node.nodeType === 1 ? node : node.parentElement) as Element | null;
  if (!el) return null;
  const doc = el.ownerDocument;
  const tag = String(el.tagName || '').toLowerCase();
  if (tag === 'iframe' || tag === 'frame') return { iframe: true };
  if (el === doc.body || el === doc.documentElement) return null;
  const selector =
    'button, a[href], input, select, textarea, summary, label, [role="button"], [role="link"], [role="menuitem"], [role="option"], [role="tab"], [onclick]';
  let actionable: Element | null = null;
  let cur: Element | null = el;
  for (let hops = 0; cur && hops < 200; hops += 1) {
    if (cur.matches(selector)) {
      actionable = cur;
      break;
    }
    const parent: Element | null = cur.parentElement;
    if (parent) cur = parent;
    else {
      const root = cur.getRootNode() as ShadowRoot | Document;
      cur = 'host' in root ? root.host : null;
    }
  }
  const target = actionable ?? el;
  const text = String((target as HTMLElement).innerText || target.textContent || '')
    .trim()
    .slice(0, 200);
  const input = target as HTMLInputElement;
  const value =
    target.tagName === 'INPUT' && ['submit', 'button'].includes(input.type) ? input.value : '';
  const link = target.closest('a[href]') as HTMLAnchorElement | null;
  const form = (input.form ?? target.closest('form')) as HTMLFormElement | null;
  const submitter = target.tagName === 'BUTTON' || target.tagName === 'INPUT';
  return {
    visibleText: text || value || null,
    ariaLabel: target.getAttribute('aria-label'),
    title: target.getAttribute('title'),
    placeholder: target.getAttribute('placeholder'),
    name: target.getAttribute('name'),
    type: target.getAttribute('type'),
    tagName: String(target.tagName || '').toLowerCase() || null,
    url: doc.location ? doc.location.href : null,
    href: link ? `${link.href} ${link.getAttribute('href') ?? ''}` : null,
    formAction: form
      ? [
          (submitter && input.formAction) || form.action || '',
          target.getAttribute('formaction') ?? form.getAttribute('action') ?? '',
        ].join(' ') || null
      : null,
    formMethod: form ? (form.getAttribute('method') || 'get').toLowerCase() : null,
    // A custom element (or host) with no readable content and no open shadow
    // root: whatever is inside it cannot be seen from here.
    opaque:
      !actionable && !text && String(el.tagName || '').includes('-') && !el.shadowRoot
        ? true
        : undefined,
  };
};

/** Signals of the field itself (typing, selecting): no hit-testing. */
const READ_SELF = (el: Element): ElementSignals => ({
  visibleText:
    String((el as HTMLElement).innerText || '')
      .trim()
      .slice(0, 200) || null,
  ariaLabel: el.getAttribute('aria-label'),
  title: el.getAttribute('title'),
  placeholder: el.getAttribute('placeholder'),
  name: el.getAttribute('name') || el.getAttribute('id'),
  type: el.getAttribute('type'),
  tagName: String(el.tagName || '').toLowerCase() || null,
  url: document.location ? document.location.href : null,
});

const READ_SUBMIT_CONTEXT = (el: Element): SubmitContext => {
  const form = (el as HTMLInputElement).form ?? el.closest('form');
  const fields = form
    ? Array.from(form.querySelectorAll('input, textarea, select')).slice(0, 40)
    : [el];
  const parts: string[] = [];
  let hasAmountField = false;
  for (const field of fields) {
    const input = field as HTMLInputElement;
    const labelText = input.labels
      ? Array.from(input.labels)
          .map((label) => label.textContent || '')
          .join(' ')
      : '';
    const piece = [
      input.name,
      input.id,
      input.getAttribute('placeholder'),
      input.getAttribute('aria-label'),
      labelText,
    ]
      .filter(Boolean)
      .join(' ')
      .slice(0, 120);
    parts.push(piece);
    if (input.type === 'number' || input.inputMode === 'decimal') hasAmountField = true;
  }
  const submit = form?.querySelector(
    'button[type="submit"], button:not([type]), input[type="submit"], input[type="image"]',
  );
  const own = [
    el.getAttribute('type'),
    el.getAttribute('name'),
    el.getAttribute('id'),
    el.getAttribute('placeholder'),
    el.getAttribute('aria-label'),
    el.getAttribute('role'),
  ]
    .filter(Boolean)
    .join(' ');
  const formSearch =
    form?.getAttribute('role') === 'search' ||
    /\/(?:s|search)(?:[/?]|$)/i.test(form?.getAttribute('action') || '');
  const fieldSearch =
    /(?:^|\s)search(?:\s|$)|搜索|搜一搜|查找|search|(?:^|\s)(?:q|query|keyword|keywords|wd|kw)(?:\s|$)/i.test(
      own,
    );
  const method = (form?.getAttribute('method') || 'get').toLowerCase();
  return {
    hasForm: Boolean(form),
    action: form ? (form as HTMLFormElement).action || null : null,
    rawAction: form ? form.getAttribute('action') : null,
    method: form ? method : null,
    submitControl: submit
      ? {
          visibleText:
            String((submit as HTMLElement).innerText || (submit as HTMLInputElement).value || '')
              .trim()
              .slice(0, 200) || null,
          ariaLabel: submit.getAttribute('aria-label'),
          title: submit.getAttribute('title'),
          placeholder: null,
          name: submit.getAttribute('name'),
          type: submit.getAttribute('type') || 'submit',
          tagName: String(submit.tagName || '').toLowerCase() || null,
          url: document.location ? document.location.href : null,
        }
      : null,
    fieldSignal: parts.join(' ').slice(0, 1200),
    hasAmountField,
    searchLike: (formSearch || fieldSearch) && method !== 'post',
  };
};

function descriptor(
  kind: RuntimeActionDescriptor['kind'],
  signals: ElementSignals | null,
  fallbackLabel: string | null,
  pageUrl: string,
): RuntimeActionDescriptor {
  return {
    kind,
    label: signals?.visibleText ?? fallbackLabel,
    ariaLabel: signals?.ariaLabel ?? null,
    title: signals?.title ?? null,
    placeholder: signals?.placeholder ?? null,
    name: signals?.name ?? null,
    inputType: signals?.type ?? null,
    tagName: signals?.tagName ?? null,
    pageUrl: signals?.url ?? pageUrl,
  };
}

async function withTimeout<T>(work: Promise<T>): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work.catch(() => null),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), DESCRIBE_TIMEOUT_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Ties a confirmation to the node it was given for (not just its label). */
type TargetBinding =
  | { kind: 'cdp'; session: CDPSession; objectId: string }
  | { kind: 'handle'; handle: ElementHandle };

interface ReadTarget {
  signals: ElementSignals;
  binding: TargetBinding;
}

/**
 * Per-gate-call helper owning the CDP session used for hit-testing and for
 * comparing bound nodes; closed when the gate decision is made.
 */
export class TargetProbe {
  private session: CDPSession | null | undefined;
  constructor(private readonly page: Page) {}
  async cdp(): Promise<CDPSession | null> {
    if (this.session === undefined) {
      this.session = await withTimeout(
        (async () => {
          const session = await this.page.context().newCDPSession(this.page);
          await session.send('DOM.getDocument', { depth: 0 });
          return session;
        })(),
      );
    }
    return this.session;
  }
  async close(): Promise<void> {
    await this.session?.detach().catch(() => {});
    this.session = undefined;
  }
}

const READ_ACTIONABLE_CALL = `function () { return (${READ_ACTIONABLE.toString()})(this); }`;

/**
 * The real target at viewport point (x, y) via Chromium hit-testing
 * (`DOM.getNodeForLocation`), which pierces open and closed shadow roots and
 * in-process frames. `undefined` when CDP is unavailable or the hit is an
 * out-of-process frame (the caller falls back), null when nothing is there.
 */
async function cdpTargetAt(
  probe: TargetProbe,
  x: number,
  y: number,
): Promise<ReadTarget | null | undefined> {
  const session = await probe.cdp();
  if (!session) return undefined;
  const read = await withTimeout(
    (async () => {
      const hit = await session.send('DOM.getNodeForLocation', {
        x: Math.round(x),
        y: Math.round(y),
        includeUserAgentShadowDOM: false,
        ignorePointerEventsNone: true,
      });
      const { object } = await session.send('DOM.resolveNode', {
        backendNodeId: hit.backendNodeId,
      });
      if (!object.objectId) return null;
      const result = await session.send('Runtime.callFunctionOn', {
        objectId: object.objectId,
        functionDeclaration: READ_ACTIONABLE_CALL,
        returnByValue: true,
      });
      return {
        objectId: object.objectId,
        value: result.result.value as ReturnType<typeof READ_ACTIONABLE>,
      };
    })(),
  );
  if (!read) return undefined;
  if (!read.value) return null;
  if (read.value.iframe) return undefined;
  return { signals: read.value, binding: { kind: 'cdp', session, objectId: read.objectId } };
}

/**
 * Fallback without CDP (or into an out-of-process frame): the element at the
 * point, descending through iframes and open shadow roots. A closed shadow
 * root or unreadable custom element ends as an `opaque` host. Null when any
 * hop cannot be read.
 */
async function fallbackTargetAt(page: Page, x: number, y: number): Promise<ReadTarget | null> {
  let frame: Frame = page.mainFrame();
  let px = x;
  let py = y;
  for (let depth = 0; depth <= MAX_FRAME_DEPTH; depth += 1) {
    const handle = (await withTimeout(
      frame.evaluateHandle(
        (point) => {
          let el = document.elementFromPoint(point.x, point.y);
          for (let level = 0; el?.shadowRoot && level < 32; level += 1) {
            const inner = el.shadowRoot.elementFromPoint(point.x, point.y);
            if (!inner || inner === el) break;
            el = inner;
          }
          return el;
        },
        { x: px, y: py },
      ),
    )) as ElementHandle<Element> | null;
    const element = handle?.asElement() ?? null;
    if (!element) return null;
    const read = await withTimeout(element.evaluate(READ_ACTIONABLE));
    if (!read) return null;
    if (!read.iframe) return { signals: read, binding: { kind: 'handle', handle: element } };
    const child = await withTimeout(element.contentFrame());
    const offset = await withTimeout(
      element.evaluate((frameEl) => {
        const rect = frameEl.getBoundingClientRect();
        const style = getComputedStyle(frameEl);
        return {
          left: rect.left + frameEl.clientLeft + (Number.parseFloat(style.paddingLeft) || 0),
          top: rect.top + frameEl.clientTop + (Number.parseFloat(style.paddingTop) || 0),
        };
      }),
    );
    if (!child || !offset) return null;
    frame = child;
    px -= offset.left;
    py -= offset.top;
  }
  return null;
}

async function targetAtPoint(
  probe: TargetProbe,
  page: Page,
  x: number,
  y: number,
): Promise<ReadTarget | null> {
  const viaCdp = await cdpTargetAt(probe, x, y);
  return viaCdp === undefined ? fallbackTargetAt(page, x, y) : viaCdp;
}

/** A ref'd element is clicked at its centre after scrolling: read what is hit there. */
async function targetAtRef(probe: TargetProbe, locator: Locator): Promise<ReadTarget | null> {
  await withTimeout(locator.scrollIntoViewIfNeeded({ timeout: DESCRIBE_TIMEOUT_MS }));
  const box = await withTimeout(locator.boundingBox());
  if (!box) return null;
  return targetAtPoint(probe, locator.page(), box.x + box.width / 2, box.y + box.height / 2);
}

/** Whether two bindings are the very same node (never true across kinds/sessions). */
async function sameTarget(a: TargetBinding | null, b: TargetBinding | null): Promise<boolean> {
  if (!a || !b) return a === b;
  if (a.kind === 'cdp' && b.kind === 'cdp') {
    if (a.session !== b.session) return false;
    const result = await withTimeout(
      a.session.send('Runtime.callFunctionOn', {
        objectId: b.objectId,
        functionDeclaration: 'function (other) { return this === other; }',
        arguments: [{ objectId: a.objectId }],
        returnByValue: true,
      }),
    );
    return result?.result.value === true;
  }
  if (a.kind === 'handle' && b.kind === 'handle') {
    return (
      (await withTimeout(b.handle.evaluate((node, other) => node === other, a.handle))) === true
    );
  }
  return false;
}

/** Descriptors for one action plus why its target could not be verified, if so. */
export interface UnifiedActionDescription {
  descriptors: RuntimeActionDescriptor[];
  /** Set when a write target could not be read: the gate then asks the user. */
  unverified: string | null;
  /** Gate-level reason that this submission is transactional regardless of labels. */
  transactional: string | null;
  /** The node(s) a confirmation is bound to; re-checked before acting. */
  bindings?: Array<TargetBinding | null>;
  /** What the action acts on (link target, form action/method/fields), bound too. */
  objects?: string;
}

const UNREADABLE_HOST = '目标位于无法读取内部内容的页面组件中';

function clickDescription(
  target: ReadTarget | null,
  fallbackLabel: string | null,
  pageUrl: string,
  unreadable: string,
): UnifiedActionDescription {
  const signals = target?.signals ?? null;
  return {
    descriptors: [descriptor('click', signals, fallbackLabel, pageUrl)],
    unverified: !signals ? unreadable : signals.opaque ? UNREADABLE_HOST : null,
    transactional: null,
    bindings: [target?.binding ?? null],
    objects: JSON.stringify([
      signals?.href ?? null,
      signals?.formAction ?? null,
      signals?.formMethod ?? null,
    ]),
  };
}

/**
 * The descriptors the runtime policy judges for one unified action. Mirrors
 * the legacy loop: clicks / typing are judged by their target element, a
 * navigation by its URL. Unified-only shapes map onto those kinds: `click_at`
 * and `download` are clicks, `select` is a click on the chosen option, and
 * `type` with `submit` also submits the field's form (judged by its real
 * semantics, not only a visible submit button). Click targets are the real
 * hit (shadow roots and frames pierced). A target that cannot be read is
 * reported as unverified — never treated as harmless.
 */
export async function describeUnifiedAction(
  page: Page,
  action: UnifiedBrowserAction,
  labelForRef: (ref: string) => string | null,
  probe: TargetProbe = new TargetProbe(page),
): Promise<UnifiedActionDescription> {
  const pageUrl = page.url();
  const plain = (descriptors: RuntimeActionDescriptor[]): UnifiedActionDescription => ({
    descriptors,
    unverified: null,
    transactional: null,
  });
  const ref = 'ref' in action && action.ref ? action.ref : null;
  const locator = ref ? page.locator(`aria-ref=${ref}`) : null;
  // A ref that resolves to nothing cannot act; the executor reports it stale.
  if (locator && (await withTimeout(locator.count())) === 0) return plain([]);
  switch (action.tool) {
    case 'navigate':
      return plain([{ kind: 'navigate', url: action.url }]);
    case 'click':
    case 'download':
      return clickDescription(
        locator ? await targetAtRef(probe, locator) : null,
        labelForRef(action.ref),
        pageUrl,
        '无法读取要点击的元素',
      );
    case 'click_at':
      return clickDescription(
        await targetAtPoint(probe, page, action.x, action.y),
        null,
        pageUrl,
        '无法识别该坐标处的元素（可能位于无法读取的嵌入页面中）',
      );
    case 'select': {
      const handle = locator ? await withTimeout(locator.elementHandle()) : null;
      const signals = handle ? await withTimeout(handle.evaluate(READ_SELF)) : null;
      return {
        descriptors: [{ ...descriptor('click', signals, null, pageUrl), label: action.value }],
        unverified: signals ? null : '无法读取下拉框',
        transactional: null,
        bindings: [handle ? { kind: 'handle', handle } : null],
        objects: JSON.stringify([action.value]),
      };
    }
    case 'type': {
      const handle = locator ? await withTimeout(locator.elementHandle()) : null;
      const signals = handle ? await withTimeout(handle.evaluate(READ_SELF)) : null;
      const typed = descriptor('type', signals, labelForRef(action.ref), pageUrl);
      const binding: TargetBinding | null = handle ? { kind: 'handle', handle } : null;
      if (!signals)
        return {
          descriptors: [typed],
          unverified: '无法读取输入框',
          transactional: null,
          bindings: [binding],
        };
      if (!action.submit) return { ...plain([typed]), bindings: [binding] };
      const form = handle ? await withTimeout(handle.evaluate(READ_SUBMIT_CONTEXT)) : null;
      if (!form)
        return {
          descriptors: [typed],
          unverified: '无法读取所属表单',
          transactional: null,
          bindings: [binding],
        };
      const submit = descriptor(
        'click',
        form.submitControl ?? { ...signals, tagName: 'button', type: 'submit' },
        labelForRef(action.ref),
        form.action ?? pageUrl,
      );
      const transactional =
        (form.action && TRANSACTION_ACTION_RE.test(form.action)) ||
        TRANSACTION_FIELD_RE.test(form.fieldSignal) ||
        form.hasAmountField
          ? '这次回车会提交一个涉及付款、订单或删除的表单'
          : null;
      // No visible submit control is not an exemption: Enter still submits.
      const unverified =
        !transactional && !form.submitControl && !form.searchLike
          ? '无法确认回车会提交什么（表单没有可识别的提交按钮）'
          : null;
      return {
        descriptors: [typed, submit],
        unverified,
        transactional,
        bindings: [binding],
        objects: JSON.stringify([
          form.action,
          form.rawAction,
          form.method,
          form.fieldSignal,
          form.submitControl?.visibleText ?? null,
        ]),
      };
    }
    default:
      // snapshot / extract / screenshot / wait_for / back / scroll / upload:
      // the legacy loop gates none of these.
      return plain([]);
  }
}

export interface UnifiedActionGateOptions {
  page: Page;
  onBeforeAction: BeforeAction;
  labelForRef: (ref: string) => string | null;
  /** Parks the task until the user replies; null on timeout or abort. */
  park: (question: string, awaitingKind: SupercarAwaitingKind) => Promise<string | null>;
  /** True when the task was cancelled (vs. the takeover window timing out). */
  aborted: () => boolean;
  /**
   * Re-checked after a confirmation and before the action runs: the task must
   * still be live (not cancelled, lease held). A "确认执行" never outranks a
   * cancellation.
   */
  stillLive?: () => Promise<boolean>;
  onConfirmed?: (descriptor: RuntimeActionDescriptor) => void;
  onVetoed?: (descriptor: RuntimeActionDescriptor, reason: string | undefined) => void;
}

/** Comparable identity of the targets a confirmation was given for. */
function targetSignature(description: UnifiedActionDescription): string {
  return JSON.stringify([
    description.objects ?? null,
    ...description.descriptors.map((d) => [
      d.kind,
      d.label ?? null,
      d.ariaLabel ?? null,
      d.tagName ?? null,
      d.inputType ?? null,
      d.url ?? null,
      d.pageUrl ?? null,
    ]),
  ]);
}

/** The confirmed action still acts on the same node(s) and the same object. */
async function sameConfirmedTarget(
  confirmed: UnifiedActionDescription,
  fresh: UnifiedActionDescription,
): Promise<boolean> {
  if (fresh.unverified !== confirmed.unverified) return false;
  if (targetSignature(fresh) !== targetSignature(confirmed)) return false;
  const before = confirmed.bindings ?? [];
  const after = fresh.bindings ?? [];
  if (before.length !== after.length) return false;
  for (const [index, binding] of before.entries()) {
    if (!(await sameTarget(binding, after[index] ?? null))) return false;
  }
  return true;
}

/**
 * Legacy LIVE-VETO for the unified loop (agent-loop `vetoOutcome`): every
 * live write is judged before it runs; the landed URL is judged after it ran.
 *  - requiresConfirmation → park as `browser_action`; only an affirmative reply
 *    runs the action, anything else stops the task as cancelled.
 *  - requiresTakeover (password / OTP fields) → park for takeover; the pending
 *    action is never replayed, the model re-observes the page.
 *  - any other refusal → the task fails with the policy reason.
 *  - no reply within the takeover window → awaiting_user; task cancel → cancelled.
 * Fail closed: a write target that cannot be read, or an Enter that submits a
 * transactional or unidentifiable form, needs the same confirmation. After a
 * confirmation the task must still be live and the target unchanged.
 */
export function createUnifiedActionGate(options: UnifiedActionGateOptions) {
  const cancelled: ActionGateDecision = {
    kind: 'stop',
    outcome: { status: 'cancelled', steps: 0 },
  };
  const parkEnded = (question: string): ActionGateDecision =>
    options.aborted()
      ? cancelled
      : {
          kind: 'stop',
          outcome: { status: 'awaiting_user', reason: 'timeout', message: question, steps: 0 },
        };

  /** 'proceed' | 'confirmed' when the user said yes | a terminal / skip decision. */
  const confirm = async (
    question: string,
    descriptor: RuntimeActionDescriptor,
  ): Promise<'confirmed' | ActionGateDecision> => {
    const reply = await options.park(question, 'browser_action');
    if (reply === null) return parkEnded(question);
    if (options.aborted()) return cancelled;
    if (isAffirmativeActionConfirmation(reply)) {
      options.onConfirmed?.(descriptor);
      return 'confirmed';
    }
    return {
      kind: 'stop',
      outcome: { status: 'cancelled', reason: NOT_CONFIRMED_REASON, steps: 0 },
    };
  };

  const judge = async (
    item: RuntimeActionDescriptor,
    failClosed: string | null,
  ): Promise<'proceed' | 'confirmed' | ActionGateDecision> => {
    const verdict = await options.onBeforeAction(item);
    const where = item.pageUrl ?? item.url ?? options.page.url();
    if (!verdict.allowed && verdict.requiresTakeover) {
      const kind = verdict.awaitingKind ?? 'login';
      const question = buildAuthParkQuestion(kind, where);
      const reply = await options.park(question, kind);
      if (reply === null) return parkEnded(question);
      return { kind: 'skip', message: TAKEOVER_RESUME_MESSAGE };
    }
    if (!verdict.allowed && verdict.requiresConfirmation)
      return confirm(verdict.question ?? CONFIRM_DEFAULT_QUESTION, item);
    if (!verdict.allowed) {
      options.onVetoed?.(item, verdict.reason);
      return {
        kind: 'stop',
        outcome: {
          status: 'failed',
          reason: verdict.reason ?? `${item.kind} blocked by safety policy`,
          steps: 0,
        },
      };
    }
    if (failClosed)
      return confirm(`${failClosed}，它可能是付款、下单、删除或发送等操作。确认继续执行吗？`, item);
    return 'proceed';
  };

  return async (
    action: UnifiedBrowserAction,
    phase: 'before' | 'after',
  ): Promise<ActionGateDecision> => {
    const probe = new TargetProbe(options.page);
    try {
      return await decide(action, phase, probe);
    } finally {
      await probe.close();
    }
  };

  async function decide(
    action: UnifiedBrowserAction,
    phase: 'before' | 'after',
    probe: TargetProbe,
  ): Promise<ActionGateDecision> {
    const description =
      phase === 'before'
        ? await describeUnifiedAction(options.page, action, options.labelForRef, probe)
        : LANDING_TOOLS.has(action.tool)
          ? {
              descriptors: [{ kind: 'navigate' as const, url: options.page.url() }],
              unverified: null,
              transactional: null,
            }
          : { descriptors: [], unverified: null, transactional: null };
    let confirmed = false;
    const last = description.descriptors.length - 1;
    for (const [index, item] of description.descriptors.entries()) {
      // Unknown / transactional context applies to the action as a whole:
      // ask once, on its final (submitting) descriptor.
      const failClosed =
        index === last && !confirmed ? (description.transactional ?? description.unverified) : null;
      const decision = await judge(item, failClosed);
      if (decision === 'confirmed') confirmed = true;
      else if (decision !== 'proceed') return decision;
    }
    if (!confirmed || phase === 'after') return { kind: 'proceed' };
    // The user said yes while parked: before acting, the task must still be
    // live and the target must be the one they confirmed.
    if (options.aborted() || options.page.isClosed()) return cancelled;
    if (options.stillLive && !(await options.stillLive())) return cancelled;
    // Same node and same object as confirmed — a same-name replacement or a
    // changed href / form action is a different action: re-observe, re-confirm.
    const fresh = await describeUnifiedAction(options.page, action, options.labelForRef, probe);
    if (!(await sameConfirmedTarget(description, fresh))) {
      return { kind: 'skip', message: TARGET_CHANGED_MESSAGE };
    }
    return { kind: 'proceed' };
  }
}

/** Actions after which the landed URL is re-judged (a click can navigate or redirect). */
const LANDING_TOOLS = new Set<UnifiedBrowserAction['tool']>([
  'navigate',
  'click',
  'type',
  'select',
  'click_at',
  'download',
  'back',
]);
