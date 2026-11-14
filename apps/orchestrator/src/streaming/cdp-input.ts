/**
 * Phase 19 — CDP Input dispatch for screencast clients.
 *
 * Receives JSON input messages from the SPA's BrowserPanel canvas
 * and forwards them as `Input.dispatchMouseEvent`,
 * `Input.dispatchKeyEvent`, or `Input.insertText` calls on a CDP
 * session.
 *
 * Why a separate handler from the streamer: the streamer holds the
 * CDP session shared between rendering + input. This module is just
 * the message-shape adapter (one method per message type) so the WS
 * upgrade handler doesn't have to know CDP wire details.
 *
 * IME / CJK note: keyDown/keyUp don't carry composed text. The
 * SPA's `compositionend` / `input` handlers send `insertText`
 * directly, which CDP routes through Brave's IME pathway and lands
 * the composed string at the focused element. This is the fix for
 * the long-standing "VNC eats Chinese characters" bug.
 */

import type { Logger } from 'pino';
import type { CDPSession } from 'playwright';
import { BrowserInputOutcomeUnknownError } from '../agent/supercar/browser-control.js';

/**
 * FIX-61 P0: marks the focused text field (through open shadow roots and
 * same-origin frames) as typed by the user. The agent's page reads mask the
 * values of marked fields, so after the user hands the browser back the agent
 * does not read what the user typed.
 */
export const HUMAN_TYPED_ATTRIBUTE = 'data-hd-human-typed';
export const MARK_HUMAN_TYPED_FIELD = `(() => {
  let el = document.activeElement;
  for (let depth = 0; el && depth < 8; depth++) {
    let inner = null;
    if (el.shadowRoot && el.shadowRoot.activeElement) inner = el.shadowRoot.activeElement;
    else if (el.tagName === 'IFRAME') { try { inner = el.contentDocument && el.contentDocument.activeElement; } catch (e) { inner = null; } }
    if (!inner || inner === el) break;
    el = inner;
  }
  if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) {
    el.setAttribute('${HUMAN_TYPED_ATTRIBUTE}', '1');
    return true;
  }
  return false;
})()`;

/**
 * HOTFIX-R4A（协调方改，2026-11-14）: the person's input is delivered like a remote desktop's — what
 * they see is what they click or type, with no frame freshness check. The one guard left: an Enter
 * or Space within 300 ms of a cross-document navigation (a new document, a pushState history entry,
 * another tab) is dropped, because it was meant for the page before.
 */
export interface InputNavigationGuard {
  /** When the page last changed document (performance.now() ms; 0 = never). */
  lastNavigationAt(): number;
  /**
   * 复审 P2-1: when this input reached the server (performance.now() ms). A navigation from 300 ms
   * before it arrived until it is sent counts — an Enter that waited behind other input while the
   * page left is still the old page's.
   */
  receivedAt?(msg: InputMessage): number | undefined;
  /** A same-document navigation whose kind (push or replace) is still being read. */
  pending?(): boolean;
  /** Waits (bounded) until no such navigation is being read. */
  settled?(timeoutMs?: number): Promise<void>;
}
/** How long after a cross-document navigation an Enter / Space is dropped. */
export const NAVIGATION_KEY_GUARD_MS = 300;

/** Error for an Enter / Space dropped right after a navigation (the screen asks once again). */
export const PAGE_CHANGED_ERROR = 'browser_page_just_navigated';

const NAMED_KEYS = new Set([
  'Enter',
  'Tab',
  'Escape',
  'Backspace',
  'Delete',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  'Shift',
  'Control',
  'Alt',
  'Meta',
  'CapsLock',
  'Insert',
  'F1',
  'F2',
  'F3',
  'F4',
  'F5',
  'F6',
  'F7',
  'F8',
  'F9',
  'F10',
  'F11',
  'F12',
]);

/** What a key is, for logs: Enter / Space / a named key; anything else is 「char」 — never the character. */
export function keyClass(m: { key?: string; code?: string; keyCode?: number }): string {
  if (m.key === 'Enter' || m.code === 'Enter' || m.code === 'NumpadEnter' || m.keyCode === 13)
    return 'Enter';
  if (m.key === ' ' || m.key === 'Spacebar' || m.code === 'Space' || m.keyCode === 32)
    return 'Space';
  return m.key && NAMED_KEYS.has(m.key) ? m.key : 'char';
}

/** Presses that can activate something: a mouse press / release, Enter, Space. */
function activates(msg: InputMessage): boolean {
  if (msg.type === 'mouseDown' || msg.type === 'mouseUp') return true;
  if (msg.type === 'keyDown' || msg.type === 'keyUp') {
    const k = keyClass(msg);
    return k === 'Enter' || k === 'Space';
  }
  return false;
}

/**
 * The element an input hits, for the audit log: its role, and a name only for controls whose
 * name is their own label (buttons, tabs, menu items, check boxes) — never an option, a link or
 * a field, whose text can be what someone typed (复审 #1 #5) — and the page's origin only.
 */
export function describeTargetExpression(msg: InputMessage): string {
  const pick =
    'x' in msg && Number.isFinite(msg.x)
      ? `document.elementFromPoint(${Number(msg.x)}, ${Number((msg as { y: number }).y)})`
      : 'document.activeElement';
  return `(() => {
  const el = ${pick};
  const page = /^https?:$/.test(location.protocol) ? location.origin : location.protocol;
  if (!el) return { role: null, name: null, page };
  const tag = el.tagName.toLowerCase();
  const role = el.getAttribute('role') || tag;
  const labelled = ['button', 'summary'].includes(tag) || ['button', 'menuitem', 'tab', 'checkbox', 'radio', 'switch'].includes(role);
  const raw = labelled ? (el.getAttribute('aria-label') || el.getAttribute('title') || el.innerText || '') : '';
  return { role, name: labelled ? String(raw).replace(/\\s+/g, ' ').trim().slice(0, 40) : null, page };
})()`;
}

/** Waits at most `ms` for a browser answer; null when it does not come (a dialog blocks the page). */
function within<T>(p: Promise<T>, ms: number): Promise<T | null> {
  let timer: NodeJS.Timeout | undefined;
  return Promise.race([
    p.catch(() => null),
    new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), ms);
      timer.unref?.();
    }),
  ]).finally(() => timer && clearTimeout(timer));
}

export type InputMessage =
  | { type: 'mouseMove'; x: number; y: number }
  | {
      type: 'mouseDown' | 'mouseUp';
      x: number;
      y: number;
      button?: 'left' | 'middle' | 'right';
      clickCount?: number;
    }
  | { type: 'scroll'; x: number; y: number; deltaX?: number; deltaY?: number }
  | {
      type: 'keyDown' | 'keyUp';
      key?: string;
      code?: string;
      keyCode?: number;
      altKey?: boolean;
      ctrlKey?: boolean;
      metaKey?: boolean;
      shiftKey?: boolean;
    }
  | { type: 'insertText'; text: string }
  | { type: 'viewport'; width: number; height: number; deviceScaleFactor?: number };

/** CDP modifier bitmask: alt=1, ctrl=2, meta=4, shift=8. */
function modifiersBitmask(m: {
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
}): number {
  let bits = 0;
  if (m.altKey) bits |= 1;
  if (m.ctrlKey) bits |= 2;
  if (m.metaKey) bits |= 4;
  if (m.shiftKey) bits |= 8;
  return bits;
}

function keyUpModifiersBitmask(m: {
  key?: string;
  code?: string;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
}): number {
  let bits = modifiersBitmask(m);
  const key = m.key?.toLowerCase();
  const code = m.code?.toLowerCase();

  if (key === 'alt' || code?.startsWith('alt')) bits &= ~1;
  if (key === 'control' || code?.startsWith('control')) bits &= ~2;
  if (key === 'meta' || key === 'os' || code?.startsWith('meta')) bits &= ~4;
  if (key === 'shift' || code?.startsWith('shift')) bits &= ~8;

  return bits;
}

const MODIFIER_KEYS = [
  { bit: 1, key: 'Alt', code: 'AltLeft', keyCode: 18 },
  { bit: 2, key: 'Control', code: 'ControlLeft', keyCode: 17 },
  { bit: 4, key: 'Meta', code: 'MetaLeft', keyCode: 91 },
  { bit: 8, key: 'Shift', code: 'ShiftLeft', keyCode: 16 },
] as const;

function modifierBit(m: { key?: string; code?: string }): number {
  const key = m.key?.toLowerCase();
  const code = m.code?.toLowerCase();

  if (key === 'alt' || code?.startsWith('alt')) return 1;
  if (key === 'control' || code?.startsWith('control')) return 2;
  if (key === 'meta' || key === 'os' || code?.startsWith('meta')) return 4;
  if (key === 'shift' || code?.startsWith('shift')) return 8;
  return 0;
}

function printableKeyText(m: {
  key?: string;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
}): string | undefined {
  if (m.altKey || m.ctrlKey || m.metaKey || m.key?.length !== 1) {
    return undefined;
  }
  return m.key;
}

/**
 * DEPLOY-61: the text a key generates when dispatched. Enter carries no printable `key`, and a
 * CDP keyDown without `text` raises no keypress: a focused button was not activated and a form
 * was not submitted (「输入 holaday 并回车」 did nothing). Enter sends '\r' as Puppeteer does.
 * Only printable keys mark the field as user-typed (printableKeyText below).
 */
function dispatchKeyText(m: {
  key?: string;
  code?: string;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
}): string | undefined {
  const printable = printableKeyText(m);
  if (printable) return printable;
  if (m.altKey || m.ctrlKey || m.metaKey) return undefined;
  return m.key === 'Enter' || m.code === 'Enter' || m.code === 'NumpadEnter' ? '\r' : undefined;
}

function editingCommands(m: {
  key?: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
}): string[] | undefined {
  if (!(m.ctrlKey || m.metaKey) || m.key?.toLowerCase() !== 'a') {
    return undefined;
  }
  return ['selectAll'];
}

export class CdpInputHandler {
  private activeModifiers = 0;
  private activeSession: CDPSession | null = null;
  private readonly interruptedSessions = new WeakSet<CDPSession>();
  private readonly pressedKeys = new Map<
    string,
    Extract<InputMessage, { type: 'keyDown' | 'keyUp' }>
  >();
  private readonly pressedButtons = new Map<
    'left' | 'middle' | 'right',
    Extract<InputMessage, { type: 'mouseDown' | 'mouseUp' }>
  >();
  private navigationGuard: InputNavigationGuard | null = null;
  /** HOTFIX-R4A: Enter / Space keys dropped after a navigation — their key-ups are dropped too. */
  private readonly droppedKeys = new Set<string>();
  /** The last activating input's target, for the 「outcome unknown」 log. */
  private lastTarget: { role: string | null; name: string | null; page: string } | null = null;

  /** HOTFIX-R4A: the person's input (audit log, the navigation guard); none on legacy input. */
  setNavigationGuard(guard: InputNavigationGuard | null): void {
    this.navigationGuard = guard;
  }

  /**
   * @param getSession Returns the streamer's CURRENT CDP session,
   *   or null if torn down. Looked up lazily on every dispatch so
   *   the handler survives the streamer's hard-restart (phase 19e
   *   watchdog) without needing to be reconstructed.
   */
  constructor(
    private readonly getSession: () => CDPSession | null,
    private readonly logger: Logger,
    private readonly onInputDispatched?: (message: InputMessage) => void,
    /** Revoke ownership immediately; this is NOT a physical-stop receipt. */
    private readonly onInputUncertain?: () => void,
  ) {}

  /**
   * Dispatch a single input message. Per-message errors are logged
   * + swallowed so one malformed event from the SPA can't kill the
   * input pipeline on legacy connections. With an ownership signal, failures
   * propagate and cancellation interrupts the real CDP session. We still await
   * the original send: detach failure must not manufacture a settled action.
   */
  async handle(msg: InputMessage, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    const session = this.getSession();
    if (!session) {
      if (signal) throw new Error('browser_input_session_unavailable');
      this.logger.debug({ type: msg.type }, 'cdp-input: no session, dropping');
      return;
    }
    if (this.interruptedSessions.has(session)) throw new BrowserInputOutcomeUnknownError();
    if (session !== this.activeSession) {
      this.activeSession = session;
      this.activeModifiers = 0;
      this.droppedKeys.clear();
    }
    const guard = this.navigationGuard;
    /** When an Enter / Space reached the server (the navigation guard is checked again at send). */
    let arrived: number | undefined;
    if (guard && msg.type !== 'viewport') {
      const where = {
        type: msg.type,
        ...(msg.type === 'keyDown' || msg.type === 'keyUp' ? { key: keyClass(msg) } : {}),
        ...('x' in msg ? { x: Math.round(msg.x), y: Math.round(msg.y) } : {}),
      };
      const keyId =
        msg.type === 'keyDown' || msg.type === 'keyUp'
          ? (msg.code ?? msg.key ?? String(msg.keyCode))
          : '';
      // The release of a dropped Enter / Space has nothing to release.
      if (msg.type === 'keyUp' && this.droppedKeys.delete(keyId)) return;
      // The release of a button this browser does not hold has nothing to release either.
      if (msg.type === 'mouseUp' && !this.pressedButtons.has(msg.button ?? 'left')) return;
      if (msg.type === 'keyDown' && activates(msg)) {
        // A pushState being classified right now is waited for (bounded) before deciding.
        if (guard.pending?.()) await guard.settled?.(NAVIGATION_KEY_GUARD_MS);
        arrived = guard.receivedAt?.(msg) ?? performance.now();
        if (guard.lastNavigationAt() >= arrived - NAVIGATION_KEY_GUARD_MS) {
          // 复审 P2-3: an auto-repeat of a key already sent keeps that key's release.
          if (!this.pressedKeys.has(keyId)) this.droppedKeys.add(keyId);
          this.logger.info(where, 'cdp-input: human input refused (page just navigated)');
          throw new Error(PAGE_CHANGED_ERROR);
        }
      }
      if (activates(msg)) {
        // FIX-62 audit log: what the person's press or Enter / Space hit (role, own label, origin).
        const target = await within(
          session
            .send('Runtime.evaluate', {
              expression: describeTargetExpression(msg),
              returnByValue: true,
            })
            .then((r) => (r.result?.value as CdpInputHandler['lastTarget']) ?? null),
          1000,
        );
        this.lastTarget = target;
        this.logger.info({ ...where, target }, 'cdp-input: human activation');
      }
    }
    let interrupted = false;
    const interrupt = (): void => {
      if (interrupted) return;
      interrupted = true;
      this.interruptedSessions.add(session);
      // Do not wait for Page.stopScreencast on the already-stalled session.
      // Detach rejects pending CDP requests when its transport is reachable.
      void session.detach().catch((err: unknown) => {
        this.logger.debug({ err }, 'cdp-input: interruption unconfirmed');
      });
      this.onInputUncertain?.();
    };
    signal?.addEventListener('abort', interrupt, { once: true });
    const timer = signal ? setTimeout(interrupt, 10_000) : null;
    timer?.unref();
    const send: CDPSession['send'] = async (method, params) => {
      if (interrupted) throw new BrowserInputOutcomeUnknownError();
      const result = await session.send(method, params);
      if (interrupted) throw new BrowserInputOutcomeUnknownError();
      return result;
    };
    try {
      switch (msg.type) {
        case 'viewport':
          // REBUILD-4 第 4 条: the page is never resized for a viewer.
          break;
        case 'mouseMove':
          await send('Input.dispatchMouseEvent', {
            type: 'mouseMoved',
            button: this.pressedButtons.keys().next().value ?? 'none',
            buttons: [...this.pressedButtons.keys()].reduce(
              (bits, button) => bits | (button === 'left' ? 1 : button === 'right' ? 2 : 4),
              0,
            ),
            x: msg.x,
            y: msg.y,
          });
          break;
        case 'mouseDown':
          await send('Input.dispatchMouseEvent', {
            type: 'mousePressed',
            x: msg.x,
            y: msg.y,
            button: msg.button ?? 'left',
            clickCount: msg.clickCount ?? 1,
          });
          this.pressedButtons.set(msg.button ?? 'left', msg);
          break;
        case 'mouseUp':
          await send('Input.dispatchMouseEvent', {
            type: 'mouseReleased',
            x: msg.x,
            y: msg.y,
            button: msg.button ?? 'left',
            clickCount: msg.clickCount ?? 1,
          });
          this.pressedButtons.delete(msg.button ?? 'left');
          break;
        case 'scroll':
          await send('Input.dispatchMouseEvent', {
            type: 'mouseWheel',
            x: msg.x,
            y: msg.y,
            deltaX: msg.deltaX ?? 0,
            deltaY: msg.deltaY ?? 0,
          });
          break;
        case 'keyDown': {
          const reportedModifiers = modifiersBitmask(msg) | modifierBit(msg);
          await this.releaseStaleModifiers(send, reportedModifiers);
          // 复审 #2 P2-a: the audit lookup and modifier releases above can take up to a second;
          // a navigation meanwhile still keeps this Enter / Space off the new page.
          if (
            guard &&
            arrived !== undefined &&
            guard.lastNavigationAt() >= arrived - NAVIGATION_KEY_GUARD_MS
          ) {
            if (!this.pressedKeys.has(msg.code ?? msg.key ?? String(msg.keyCode)))
              this.droppedKeys.add(msg.code ?? msg.key ?? String(msg.keyCode));
            this.logger.info(
              { type: msg.type, key: keyClass(msg) },
              'cdp-input: human input refused (page just navigated)',
            );
            throw new Error(PAGE_CHANGED_ERROR);
          }
          const text = dispatchKeyText(msg);
          const commands = editingCommands(msg);
          await send('Input.dispatchKeyEvent', {
            type: 'keyDown',
            ...(msg.key ? { key: msg.key } : {}),
            ...(msg.code ? { code: msg.code } : {}),
            ...(msg.keyCode != null ? { windowsVirtualKeyCode: msg.keyCode } : {}),
            modifiers: reportedModifiers,
            ...(text ? { text, unmodifiedText: text } : {}),
            ...(commands ? { commands } : {}),
          });
          this.activeModifiers = reportedModifiers;
          this.pressedKeys.set(msg.code ?? msg.key ?? String(msg.keyCode), msg);
          this.droppedKeys.delete(msg.code ?? msg.key ?? String(msg.keyCode));
          break;
        }
        case 'keyUp': {
          const releasedModifier = modifierBit(msg);
          const reportedModifiers = keyUpModifiersBitmask(msg);
          await this.releaseStaleModifiers(send, reportedModifiers, releasedModifier);
          await send('Input.dispatchKeyEvent', {
            type: 'keyUp',
            ...(msg.key ? { key: msg.key } : {}),
            ...(msg.code ? { code: msg.code } : {}),
            ...(msg.keyCode != null ? { windowsVirtualKeyCode: msg.keyCode } : {}),
            modifiers: reportedModifiers,
          });
          this.activeModifiers = reportedModifiers;
          this.pressedKeys.delete(msg.code ?? msg.key ?? String(msg.keyCode));
          break;
        }
        case 'insertText':
          await send('Input.insertText', { text: msg.text });
          break;
      }
      if (
        msg.type === 'insertText' ||
        (msg.type === 'keyDown' && (printableKeyText(msg) || editingCommands(msg)))
      ) {
        // FIX-61 P0: the field the user typed into is masked from every page
        // text the agent reads afterwards (observation-redaction.ts). Marking
        // never fails the user's input.
        await session
          .send('Runtime.evaluate', { expression: MARK_HUMAN_TYPED_FIELD, returnByValue: true })
          .catch(() => undefined);
      }
      this.onInputDispatched?.(msg);
    } catch (err) {
      // The send-time navigation check refused before anything was sent: no uncertain outcome.
      if (err instanceof Error && err.message === PAGE_CHANGED_ERROR) throw err;
      this.logger.debug(
        { err: err instanceof Error ? err.message : String(err), type: msg.type },
        'cdp-input: dispatch failed',
      );
      if (signal) {
        // FIX-62 P0-1: what was in flight when its outcome became unknown — type, position,
        // the element it was aimed at, the page (origin + path). No typed text.
        this.logger.warn(
          {
            type: msg.type,
            ...(msg.type === 'keyDown' || msg.type === 'keyUp' ? { key: keyClass(msg) } : {}),
            ...('x' in msg ? { x: Math.round(msg.x), y: Math.round(msg.y) } : {}),
            target: activates(msg) ? this.lastTarget : null,
          },
          'cdp-input: human input outcome unknown',
        );
        interrupt();
        throw new BrowserInputOutcomeUnknownError();
      }
    } finally {
      if (timer) clearTimeout(timer);
      signal?.removeEventListener('abort', interrupt);
    }
  }

  private async releaseStaleModifiers(
    send: CDPSession['send'],
    reportedModifiers: number,
    modifierHandledByCurrentKeyUp = 0,
  ): Promise<void> {
    const staleModifiers =
      this.activeModifiers & ~reportedModifiers & ~modifierHandledByCurrentKeyUp;

    for (const modifier of MODIFIER_KEYS) {
      if (!(staleModifiers & modifier.bit)) continue;

      const nextModifiers = this.activeModifiers & ~modifier.bit;
      await send('Input.dispatchKeyEvent', {
        type: 'keyUp',
        key: modifier.key,
        code: modifier.code,
        windowsVirtualKeyCode: modifier.keyCode,
        modifiers: nextModifiers,
      });
      this.activeModifiers = nextModifiers;
    }
  }
}
