import { describe, expect, it, vi } from 'vitest';
import { pino } from 'pino';
import type { CDPSession } from 'playwright';
import { CdpInputHandler } from './cdp-input.js';

function handlerWithSend() {
  const send = vi.fn().mockResolvedValue(undefined);
  const session = { send } as unknown as CDPSession;
  return {
    send,
    handler: new CdpInputHandler(() => session, pino({ level: 'silent' })),
  };
}

describe('CdpInputHandler responsive viewport', () => {
  it('reflows the remote page to the visible browser workspace', async () => {
    const { handler, send } = handlerWithSend();

    await handler.handle({ type: 'viewport', width: 612, height: 844 });

    expect(send).toHaveBeenCalledWith('Emulation.setDeviceMetricsOverride', {
      width: 612,
      height: 844,
      deviceScaleFactor: 1,
      mobile: false,
      screenWidth: 612,
      screenHeight: 844,
    });
  });

  it('drops invalid or abusive viewport messages', async () => {
    const { handler, send } = handlerWithSend();

    await handler.handle({ type: 'viewport', width: 0, height: 844 });
    await handler.handle({ type: 'viewport', width: 10_000, height: 844 });
    await handler.handle({ type: 'viewport', width: 612, height: Number.NaN });

    expect(send).not.toHaveBeenCalled();
  });
});

describe('CdpInputHandler keyboard input', () => {
  it('requests a visible-frame refresh after accepted input', async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const refreshFrame = vi.fn();
    const handler = new CdpInputHandler(
      () => ({ send }) as unknown as CDPSession,
      pino({ level: 'silent' }),
      refreshFrame,
    );

    await handler.handle({ type: 'insertText', text: '继续' });

    expect(refreshFrame).toHaveBeenCalledOnce();
  });

  it('includes text when dispatching a printable key', async () => {
    const { handler, send } = handlerWithSend();

    await handler.handle({
      type: 'keyDown',
      key: 'h',
      code: 'KeyH',
      keyCode: 72,
    });

    expect(send).toHaveBeenCalledWith('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'h',
      code: 'KeyH',
      windowsVirtualKeyCode: 72,
      modifiers: 0,
      text: 'h',
      unmodifiedText: 'h',
    });
  });

  it('does not insert text for keyboard shortcuts', async () => {
    const { handler, send } = handlerWithSend();

    await handler.handle({
      type: 'keyDown',
      key: 'c',
      code: 'KeyC',
      keyCode: 67,
      metaKey: true,
    });

    expect(send).toHaveBeenCalledWith('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'c',
      code: 'KeyC',
      windowsVirtualKeyCode: 67,
      modifiers: 4,
    });
  });

  it('dispatches the native select-all command for Meta+A', async () => {
    const { handler, send } = handlerWithSend();

    await handler.handle({
      type: 'keyDown',
      key: 'a',
      code: 'KeyA',
      keyCode: 65,
      metaKey: true,
    });

    expect(send).toHaveBeenCalledWith('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'a',
      code: 'KeyA',
      windowsVirtualKeyCode: 65,
      modifiers: 4,
      commands: ['selectAll'],
    });
  });

  it('clears a released modifier even when the DOM keyup still reports it pressed', async () => {
    const { handler, send } = handlerWithSend();

    await handler.handle({
      type: 'keyDown',
      key: 'Meta',
      code: 'MetaLeft',
      keyCode: 91,
      metaKey: true,
    });
    await handler.handle({
      type: 'keyUp',
      key: 'Meta',
      code: 'MetaLeft',
      keyCode: 91,
      metaKey: true,
    });

    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenLastCalledWith('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'Meta',
      code: 'MetaLeft',
      windowsVirtualKeyCode: 91,
      modifiers: 0,
    });
  });

  it('releases a stale Meta modifier before the next plain key when keyup was lost', async () => {
    const { handler, send } = handlerWithSend();

    await handler.handle({
      type: 'keyDown',
      key: 'Meta',
      code: 'MetaLeft',
      keyCode: 91,
      metaKey: true,
    });
    await handler.handle({
      type: 'keyDown',
      key: 'a',
      code: 'KeyA',
      keyCode: 65,
      metaKey: true,
    });
    await handler.handle({
      type: 'keyUp',
      key: 'a',
      code: 'KeyA',
      keyCode: 65,
      metaKey: true,
    });
    await handler.handle({
      type: 'keyDown',
      key: 'x',
      code: 'KeyX',
      keyCode: 88,
    });

    expect(send).toHaveBeenNthCalledWith(4, 'Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'Meta',
      code: 'MetaLeft',
      windowsVirtualKeyCode: 91,
      modifiers: 0,
    });
    expect(send).toHaveBeenNthCalledWith(5, 'Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'x',
      code: 'KeyX',
      windowsVirtualKeyCode: 88,
      modifiers: 0,
      text: 'x',
      unmodifiedText: 'x',
    });
  });
});
