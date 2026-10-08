import type { ElementHandle, Frame, Locator, Page } from 'playwright';
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
}

/** What Enter in a field submits: the real form semantics, not just a button. */
interface SubmitContext {
  hasForm: boolean;
  action: string | null;
  method: string | null;
  submitControl: ElementSignals | null;
  fieldSignal: string;
  hasAmountField: boolean;
  searchLike: boolean;
}

/**
 * Signals of the element a click really acts on: the node at the point (in its
 * own frame) climbed to its closest actionable ancestor, so an icon inside a
 * button reads as the button. Returns `{ iframe: true }` when the point hits a
 * frame element (the caller descends into it). Inline and free of named inner
 * helpers: bundlers' `__name` wrappers must not be serialised into the page.
 */
const READ_TARGET = (
  node: Element,
  point: { x: number | null; y: number | null },
): (ElementSignals & { iframe?: false }) | { iframe: true } | null => {
  let el: Element | null = node;
  if (point.x !== null && point.y !== null) {
    el = document.elementFromPoint(point.x, point.y);
  } else if (node.getBoundingClientRect) {
    const r = node.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) {
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      // What the click lands on, even an overlay covering the node.
      if (hit) el = hit;
    }
  }
  if (!el || el === document.body || el === document.documentElement) return null;
  const tag = String(el.tagName || '').toLowerCase();
  if (tag === 'iframe' || tag === 'frame') return { iframe: true };
  const actionable =
    el.closest(
      'button, a[href], input, select, textarea, summary, label, [role="button"], [role="link"], [role="menuitem"], [role="option"], [role="tab"], [onclick]',
    ) ?? el;
  const text = String((actionable as HTMLElement).innerText || actionable.textContent || '')
    .trim()
    .slice(0, 200);
  const value =
    actionable instanceof HTMLInputElement && ['submit', 'button'].includes(actionable.type)
      ? actionable.value
      : '';
  return {
    visibleText: text || value || null,
    ariaLabel: actionable.getAttribute('aria-label'),
    title: actionable.getAttribute('title'),
    placeholder: actionable.getAttribute('placeholder'),
    name: actionable.getAttribute('name'),
    type: actionable.getAttribute('type'),
    tagName: String(actionable.tagName || '').toLowerCase() || null,
    url: document.location ? document.location.href : null,
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

/**
 * The element at viewport point (x, y), descending through iframes: each hit
 * frame element is resolved to its frame and the point re-based to that
 * frame's content box. Null when any hop cannot be read.
 */
async function signalsAtPoint(page: Page, x: number, y: number): Promise<ElementSignals | null> {
  let frame: Frame = page.mainFrame();
  let px = x;
  let py = y;
  for (let depth = 0; depth <= MAX_FRAME_DEPTH; depth += 1) {
    const handle = (await withTimeout(
      frame.evaluateHandle((point) => document.elementFromPoint(point.x, point.y), {
        x: px,
        y: py,
      }),
    )) as ElementHandle<Element> | null;
    const element = handle?.asElement() ?? null;
    if (!element) return null;
    const read = await withTimeout(element.evaluate(READ_TARGET, { x: null, y: null }));
    if (!read) return null;
    if (!read.iframe) return read;
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

/** Signals of a ref'd element's click point, in its own frame (iframes included). */
async function signalsAtRef(locator: Locator): Promise<ElementSignals | null> {
  // The click scrolls its target into view first; read it where it will be hit.
  await withTimeout(locator.scrollIntoViewIfNeeded({ timeout: DESCRIBE_TIMEOUT_MS }));
  const read = await withTimeout(locator.evaluate(READ_TARGET, { x: null, y: null }));
  if (!read) return null;
  if (!read.iframe) return read;
  // The ref'd node's centre is covered by a frame: descend from that point.
  const box = await withTimeout(locator.boundingBox());
  const page = locator.page();
  return box ? signalsAtPoint(page, box.x + box.width / 2, box.y + box.height / 2) : null;
}

/** Descriptors for one action plus why its target could not be verified, if so. */
export interface UnifiedActionDescription {
  descriptors: RuntimeActionDescriptor[];
  /** Set when a write target could not be read: the gate then asks the user. */
  unverified: string | null;
  /** Gate-level reason that this submission is transactional regardless of labels. */
  transactional: string | null;
}

/**
 * The descriptors the runtime policy judges for one unified action. Mirrors
 * the legacy loop: clicks / typing are judged by their target element, a
 * navigation by its URL. Unified-only shapes map onto those kinds: `click_at`
 * and `download` are clicks, `select` is a click on the chosen option, and
 * `type` with `submit` also submits the field's form (judged by its real
 * semantics, not only a visible submit button). A target that cannot be read
 * is reported as unverified — never treated as harmless.
 */
export async function describeUnifiedAction(
  page: Page,
  action: UnifiedBrowserAction,
  labelForRef: (ref: string) => string | null,
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
    case 'download': {
      const signals = locator ? await signalsAtRef(locator) : null;
      return {
        descriptors: [descriptor('click', signals, labelForRef(action.ref), pageUrl)],
        unverified: signals ? null : '无法读取要点击的元素',
        transactional: null,
      };
    }
    case 'click_at': {
      const signals = await signalsAtPoint(page, action.x, action.y);
      return {
        descriptors: [descriptor('click', signals, null, pageUrl)],
        unverified: signals ? null : '无法识别该坐标处的元素（可能位于无法读取的嵌入页面中）',
        transactional: null,
      };
    }
    case 'select': {
      const signals = locator ? await withTimeout(locator.evaluate(READ_SELF)) : null;
      return {
        descriptors: [{ ...descriptor('click', signals, null, pageUrl), label: action.value }],
        unverified: signals ? null : '无法读取下拉框',
        transactional: null,
      };
    }
    case 'type': {
      const signals = locator ? await withTimeout(locator.evaluate(READ_SELF)) : null;
      const typed = descriptor('type', signals, labelForRef(action.ref), pageUrl);
      if (!signals)
        return { descriptors: [typed], unverified: '无法读取输入框', transactional: null };
      if (!action.submit) return plain([typed]);
      const form = locator ? await withTimeout(locator.evaluate(READ_SUBMIT_CONTEXT)) : null;
      if (!form)
        return { descriptors: [typed], unverified: '无法读取所属表单', transactional: null };
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
      return { descriptors: [typed, submit], unverified, transactional };
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
  return JSON.stringify(
    description.descriptors.map((d) => [
      d.kind,
      d.label ?? null,
      d.ariaLabel ?? null,
      d.tagName ?? null,
      d.inputType ?? null,
      d.url ?? null,
      d.pageUrl ?? null,
    ]),
  );
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
    const description =
      phase === 'before'
        ? await describeUnifiedAction(options.page, action, options.labelForRef)
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
    const fresh = await describeUnifiedAction(options.page, action, options.labelForRef);
    if (
      fresh.unverified !== description.unverified ||
      targetSignature(fresh) !== targetSignature(description)
    ) {
      return { kind: 'skip', message: TARGET_CHANGED_MESSAGE };
    }
    return { kind: 'proceed' };
  };
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
