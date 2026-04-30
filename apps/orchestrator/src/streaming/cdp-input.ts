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

import type { CDPSession } from 'playwright';
import type { Logger } from 'pino';

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
  | { type: 'insertText'; text: string };

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

export class CdpInputHandler {
  constructor(
    private readonly cdpSession: CDPSession,
    private readonly logger: Logger,
  ) {}

  /**
   * Dispatch a single input message. Per-message errors are logged
   * + swallowed so one malformed event from the SPA can't kill the
   * input pipeline.
   */
  async handle(msg: InputMessage): Promise<void> {
    try {
      switch (msg.type) {
        case 'mouseMove':
          await this.cdpSession.send('Input.dispatchMouseEvent', {
            type: 'mouseMoved',
            x: msg.x,
            y: msg.y,
          });
          return;
        case 'mouseDown':
          await this.cdpSession.send('Input.dispatchMouseEvent', {
            type: 'mousePressed',
            x: msg.x,
            y: msg.y,
            button: msg.button ?? 'left',
            clickCount: msg.clickCount ?? 1,
          });
          return;
        case 'mouseUp':
          await this.cdpSession.send('Input.dispatchMouseEvent', {
            type: 'mouseReleased',
            x: msg.x,
            y: msg.y,
            button: msg.button ?? 'left',
            clickCount: msg.clickCount ?? 1,
          });
          return;
        case 'scroll':
          await this.cdpSession.send('Input.dispatchMouseEvent', {
            type: 'mouseWheel',
            x: msg.x,
            y: msg.y,
            deltaX: msg.deltaX ?? 0,
            deltaY: msg.deltaY ?? 0,
          });
          return;
        case 'keyDown':
          await this.cdpSession.send('Input.dispatchKeyEvent', {
            type: 'keyDown',
            ...(msg.key ? { key: msg.key } : {}),
            ...(msg.code ? { code: msg.code } : {}),
            ...(msg.keyCode != null ? { windowsVirtualKeyCode: msg.keyCode } : {}),
            modifiers: modifiersBitmask(msg),
          });
          return;
        case 'keyUp':
          await this.cdpSession.send('Input.dispatchKeyEvent', {
            type: 'keyUp',
            ...(msg.key ? { key: msg.key } : {}),
            ...(msg.code ? { code: msg.code } : {}),
            ...(msg.keyCode != null ? { windowsVirtualKeyCode: msg.keyCode } : {}),
            modifiers: modifiersBitmask(msg),
          });
          return;
        case 'insertText':
          await this.cdpSession.send('Input.insertText', { text: msg.text });
          return;
      }
    } catch (err) {
      this.logger.debug(
        { err: err instanceof Error ? err.message : String(err), type: msg.type },
        'cdp-input: dispatch failed',
      );
    }
  }
}
