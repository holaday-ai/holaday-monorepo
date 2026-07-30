import { describe, expect, it } from 'vitest';
import {
  INITIAL_CDP_INPUT_BRIDGE_STATE,
  INITIAL_CDP_RECONNECT_STATE,
  cdpCompositionEndTransition,
  cdpCompositionStartTransition,
  cdpKeyTransition,
  cdpReconnectTransition,
  cdpTextInputTransition,
  shouldPaintCdpFrame,
} from './cdp-screencast-state';

describe('CDP screencast reconnect state', () => {
  it('backs off repeated sockets that open and close without painting a frame', () => {
    const firstClose = cdpReconnectTransition(
      INITIAL_CDP_RECONNECT_STATE,
      'socket-closed',
    );
    expect(firstClose).toEqual({
      state: { consecutiveFailures: 1 },
      delayMs: 500,
    });

    const opened = cdpReconnectTransition(firstClose.state, 'socket-opened');
    expect(opened.state).toEqual({ consecutiveFailures: 1 });

    const secondClose = cdpReconnectTransition(opened.state, 'socket-closed');
    expect(secondClose).toEqual({
      state: { consecutiveFailures: 2 },
      delayMs: 1_000,
    });
  });

  it('resets reconnect backoff only after a real frame is ready', () => {
    const failed = { consecutiveFailures: 4 };
    const painted = cdpReconnectTransition(failed, 'frame-ready');
    expect(painted.state).toEqual({ consecutiveFailures: 0 });

    expect(cdpReconnectTransition(painted.state, 'socket-closed')).toEqual({
      state: { consecutiveFailures: 1 },
      delayMs: 500,
    });
  });

  it('rejects a decoded frame after its socket has already closed', () => {
    expect(
      shouldPaintCdpFrame({
        mounted: true,
        connectionSeq: 3,
        currentConnectionSeq: 3,
        frameSeq: 9,
        currentFrameSeq: 9,
        socketOpen: false,
      }),
    ).toBe(false);
    expect(
      shouldPaintCdpFrame({
        mounted: true,
        connectionSeq: 3,
        currentConnectionSeq: 3,
        frameSeq: 9,
        currentFrameSeq: 9,
        socketOpen: true,
      }),
    ).toBe(true);
  });
});

describe('CDP screencast input bridge', () => {
  it('forwards a physical printable key exactly once', () => {
    const keyDown = cdpKeyTransition(INITIAL_CDP_INPUT_BRIDGE_STATE, {
      phase: 'down',
      key: 'a',
      code: 'KeyA',
      keyCode: 65,
    });
    expect(keyDown.payload).toMatchObject({ type: 'keyDown', key: 'a' });

    const mirroredInput = cdpTextInputTransition(keyDown.state, {
      value: 'a',
      inputType: 'insertText',
      isComposing: false,
    });
    expect(mirroredInput).toEqual({
      state: { composing: false, mirroredText: null },
      payload: null,
      clearInput: true,
    });
  });

  it('ignores IME key noise and inserts only the final composed text', () => {
    const composing = cdpCompositionStartTransition(
      INITIAL_CDP_INPUT_BRIDGE_STATE,
    );
    const keyNoise = cdpKeyTransition(composing, {
      phase: 'down',
      key: 'Process',
      code: 'KeyN',
      keyCode: 229,
      isComposing: true,
    });
    expect(keyNoise.payload).toBeNull();

    const interimInput = cdpTextInputTransition(keyNoise.state, {
      value: 'ni',
      inputType: 'insertCompositionText',
      isComposing: true,
    });
    expect(interimInput.payload).toBeNull();
    expect(interimInput.clearInput).toBe(false);

    const completed = cdpCompositionEndTransition(interimInput.state, '你');
    expect(completed.payload).toEqual({ type: 'insertText', text: '你' });

    const mirroredFinalInput = cdpTextInputTransition(completed.state, {
      value: '你',
      inputType: 'insertText',
      isComposing: false,
    });
    expect(mirroredFinalInput.payload).toBeNull();
    expect(mirroredFinalInput.clearInput).toBe(true);
  });

  it('still forwards input events that have no matching physical key', () => {
    expect(
      cdpTextInputTransition(INITIAL_CDP_INPUT_BRIDGE_STATE, {
        value: 'pasted text',
        inputType: 'insertFromPaste',
        isComposing: false,
      }),
    ).toEqual({
      state: { composing: false, mirroredText: null },
      payload: { type: 'insertText', text: 'pasted text' },
      clearInput: true,
    });
  });
});
