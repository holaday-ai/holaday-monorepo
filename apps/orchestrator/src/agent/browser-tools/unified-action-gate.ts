import type { Page } from 'playwright';
import { buildAuthParkQuestion } from '../login-detector.js';
import type { RunSupercarOptions, SupercarAwaitingKind } from '../supercar/agent-loop.js';
import { isAffirmativeActionConfirmation } from '../supercar/runtime-action-policy.js';
import type { ActionGateDecision } from './unified-browser-loop.js';
import type { UnifiedBrowserAction } from './unified-tools.js';

type BeforeAction = NonNullable<RunSupercarOptions['onBeforeAction']>;
export type RuntimeActionDescriptor = Parameters<BeforeAction>[0];

const DESCRIBE_TIMEOUT_MS = 2_000;
const CONFIRM_DEFAULT_QUESTION = '即将执行可能产生外部影响的操作。请明确回复“确认执行”后继续。';
const NOT_CONFIRMED_REASON = '用户未确认不可逆操作，本次任务已停止，页面进度已保留。';
const TAKEOVER_RESUME_MESSAGE =
  '用户已完成接管，刚才的操作没有由 Agent 执行。请重新 snapshot 确认页面状态后继续。';

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

/**
 * Read-only DOM signals of one element, the same fields the legacy
 * `captureTargetDescriptor` probe reads. `mode` picks the element: the node
 * itself, the node at its centre (what a click actually hits, as the legacy
 * coordinate probe does) or the submit control of its form (Enter submits).
 * One inline function with no named inner helpers: bundlers' `__name`
 * wrappers must not be serialised into the page.
 */
async function readSignals(
  page: Page,
  ref: string,
  mode: 'self' | 'center' | 'form-submit',
): Promise<ElementSignals | null> {
  const locator = page.locator(`aria-ref=${ref}`);
  const box =
    mode === 'center' ? await locator.boundingBox({ timeout: DESCRIBE_TIMEOUT_MS }) : null;
  return locator
    .evaluate(
      (node, args) => {
        let el: Element | null = node;
        if (args.x !== null && args.y !== null) {
          const hit = document.elementFromPoint(args.x, args.y);
          if (hit && hit !== document.body && hit !== document.documentElement) el = hit;
        }
        if (args.mode === 'form-submit') {
          const form = (node as HTMLInputElement).form ?? node.closest('form');
          const submit = form?.querySelector(
            'button[type="submit"], button:not([type]), input[type="submit"], input[type="image"]',
          );
          if (submit) el = submit;
        }
        if (!el) return null;
        const text = String((el as HTMLElement).innerText || el.textContent || '')
          .trim()
          .slice(0, 200);
        const value =
          el instanceof HTMLInputElement && ['submit', 'button'].includes(el.type) ? el.value : '';
        return {
          visibleText: text || value || null,
          ariaLabel: el.getAttribute('aria-label'),
          title: el.getAttribute('title'),
          placeholder: el.getAttribute('placeholder'),
          name: el.getAttribute('name'),
          type: el.getAttribute('type'),
          tagName: String(el.tagName || '').toLowerCase() || null,
          url: document.location ? document.location.href : null,
        };
      },
      {
        mode,
        x: box ? box.x + box.width / 2 : null,
        y: box ? box.y + box.height / 2 : null,
      },
      { timeout: DESCRIBE_TIMEOUT_MS },
    )
    .catch(() => null);
}

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

/**
 * The descriptors the runtime policy judges for one unified action. Mirrors
 * the legacy loop: clicks / typing are judged by their target element, a
 * navigation by its URL. Unified-only shapes map onto those kinds: `click_at`
 * and `download` are clicks, `select` is a click on the chosen option, and
 * `type` with `submit` is also a click on the form's submit control.
 */
export async function describeUnifiedAction(
  page: Page,
  action: UnifiedBrowserAction,
  labelForRef: (ref: string) => string | null,
): Promise<RuntimeActionDescriptor[]> {
  const pageUrl = page.url();
  switch (action.tool) {
    case 'navigate':
      return [{ kind: 'navigate', url: action.url }];
    case 'click':
    case 'download':
      return [
        descriptor(
          'click',
          await readSignals(page, action.ref, 'center').catch(() => null),
          labelForRef(action.ref),
          pageUrl,
        ),
      ];
    case 'select': {
      const signals = await readSignals(page, action.ref, 'self').catch(() => null);
      return [{ ...descriptor('click', signals, null, pageUrl), label: action.value }];
    }
    case 'type': {
      const signals = await readSignals(page, action.ref, 'self').catch(() => null);
      const typed = descriptor('type', signals, labelForRef(action.ref), pageUrl);
      if (!action.submit) return [typed];
      const submit = await readSignals(page, action.ref, 'form-submit').catch(() => null);
      return [typed, descriptor('click', submit, labelForRef(action.ref), pageUrl)];
    }
    case 'click_at': {
      const signals = await page
        .evaluate(
          (point) => {
            const el = document.elementFromPoint(point.x, point.y);
            if (!el || el === document.body || el === document.documentElement) return null;
            const text = String((el as HTMLElement).innerText || el.textContent || '')
              .trim()
              .slice(0, 200);
            return {
              visibleText: text || null,
              ariaLabel: el.getAttribute('aria-label'),
              title: el.getAttribute('title'),
              placeholder: el.getAttribute('placeholder'),
              name: el.getAttribute('name'),
              type: el.getAttribute('type'),
              tagName: String(el.tagName || '').toLowerCase() || null,
              url: document.location ? document.location.href : null,
            };
          },
          { x: action.x, y: action.y },
        )
        .catch(() => null);
      return [descriptor('click', signals, null, pageUrl)];
    }
    default:
      // snapshot / extract / screenshot / wait_for / back / scroll / upload:
      // the legacy loop gates none of these.
      return [];
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
  onConfirmed?: (descriptor: RuntimeActionDescriptor) => void;
  onVetoed?: (descriptor: RuntimeActionDescriptor, reason: string | undefined) => void;
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
 */
export function createUnifiedActionGate(options: UnifiedActionGateOptions) {
  const judge = async (descriptor: RuntimeActionDescriptor): Promise<ActionGateDecision> => {
    const verdict = await options.onBeforeAction(descriptor);
    if (verdict.allowed) return { kind: 'proceed' };
    const where = descriptor.pageUrl ?? descriptor.url ?? options.page.url();
    if (verdict.requiresTakeover) {
      const kind = verdict.awaitingKind ?? 'login';
      const question = buildAuthParkQuestion(kind, where);
      const reply = await options.park(question, kind);
      if (reply === null) return parkEnded(question);
      return { kind: 'skip', message: TAKEOVER_RESUME_MESSAGE };
    }
    if (verdict.requiresConfirmation) {
      const question = verdict.question ?? CONFIRM_DEFAULT_QUESTION;
      const reply = await options.park(question, 'browser_action');
      if (reply === null) return parkEnded(question);
      if (isAffirmativeActionConfirmation(reply)) {
        options.onConfirmed?.(descriptor);
        return { kind: 'proceed' };
      }
      return {
        kind: 'stop',
        outcome: { status: 'cancelled', reason: NOT_CONFIRMED_REASON, steps: 0 },
      };
    }
    options.onVetoed?.(descriptor, verdict.reason);
    return {
      kind: 'stop',
      outcome: {
        status: 'failed',
        reason: verdict.reason ?? `${descriptor.kind} blocked by safety policy`,
        steps: 0,
      },
    };
  };
  const parkEnded = (question: string): ActionGateDecision =>
    options.aborted()
      ? { kind: 'stop', outcome: { status: 'cancelled', steps: 0 } }
      : {
          kind: 'stop',
          outcome: { status: 'awaiting_user', reason: 'timeout', message: question, steps: 0 },
        };

  return async (
    action: UnifiedBrowserAction,
    phase: 'before' | 'after',
  ): Promise<ActionGateDecision> => {
    const descriptors =
      phase === 'before'
        ? await describeUnifiedAction(options.page, action, options.labelForRef)
        : LANDING_TOOLS.has(action.tool)
          ? [{ kind: 'navigate' as const, url: options.page.url() }]
          : [];
    for (const item of descriptors) {
      const decision = await judge(item);
      if (decision.kind !== 'proceed') return decision;
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
