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
  | { type: 'viewport'; width: number; height: number };

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
    string,
    Extract<InputMessage, { type: 'mouseDown' | 'mouseUp' }>
  >();

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
        case 'viewport': {
          if (
            !Number.isFinite(msg.width) ||
            !Number.isFinite(msg.height) ||
            msg.width < 240 ||
            msg.width > 1920 ||
            msg.height < 240 ||
            msg.height > 1600
          ) {
            return;
          }
          const width = Math.round(msg.width);
          const height = Math.round(msg.height);
          await send('Emulation.setDeviceMetricsOverride', {
            width,
            height,
            deviceScaleFactor: 1,
            mobile: false,
            screenWidth: width,
            screenHeight: height,
          });
          break;
        }
        case 'mouseMove':
          await send('Input.dispatchMouseEvent', {
            type: 'mouseMoved',
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
          const text = printableKeyText(msg);
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
      this.onInputDispatched?.(msg);
    } catch (err) {
      this.logger.debug(
        { err: err instanceof Error ? err.message : String(err), type: msg.type },
        'cdp-input: dispatch failed',
      );
      if (signal) {
        interrupt();
        throw new BrowserInputOutcomeUnknownError();
      }
    } finally {
      if (timer) clearTimeout(timer);
      signal?.removeEventListener('abort', interrupt);
    }
  }

  async releasePressed(signal: AbortSignal): Promise<void> {
    if (!this.pressedKeys.size && !this.pressedButtons.size && !this.activeModifiers) return;
    if (!this.getSession()) {
      this.onInputUncertain?.();
      throw new BrowserInputOutcomeUnknownError();
    }
    for (const key of [...this.pressedKeys.values()]) {
      await this.handle(
        { ...key, type: 'keyUp', altKey: false, ctrlKey: false, metaKey: false, shiftKey: false },
        signal,
      );
    }
    for (const modifier of MODIFIER_KEYS) {
      if (this.activeModifiers & modifier.bit)
        await this.handle({ type: 'keyUp', ...modifier }, signal);
    }
    for (const button of [...this.pressedButtons.values()]) {
      await this.handle({ ...button, type: 'mouseUp' }, signal);
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
