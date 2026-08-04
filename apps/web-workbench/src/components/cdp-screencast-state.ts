export interface CdpReconnectState {
  consecutiveFailures: number;
}

export const INITIAL_CDP_RECONNECT_STATE: CdpReconnectState = {
  consecutiveFailures: 0,
};

export type CdpReconnectEvent =
  | 'socket-opened'
  | 'frame-ready'
  | 'socket-closed';

export function cdpReconnectTransition(
  state: CdpReconnectState,
  event: CdpReconnectEvent,
): { state: CdpReconnectState; delayMs?: number } {
  if (event === 'frame-ready') {
    return { state: INITIAL_CDP_RECONNECT_STATE };
  }
  if (event === 'socket-opened') {
    return { state };
  }

  const consecutiveFailures = state.consecutiveFailures + 1;
  return {
    state: { consecutiveFailures },
    delayMs: Math.min(
      5_000,
      500 * 2 ** Math.min(consecutiveFailures - 1, 4),
    ),
  };
}

export function shouldPaintCdpFrame(inputs: {
  mounted: boolean;
  connectionSeq: number;
  currentConnectionSeq: number;
  frameSeq: number;
  currentFrameSeq: number;
  socketOpen: boolean;
}): boolean {
  return (
    inputs.mounted &&
    inputs.connectionSeq === inputs.currentConnectionSeq &&
    inputs.frameSeq === inputs.currentFrameSeq &&
    inputs.socketOpen
  );
}

export interface CdpInputBridgeState {
  composing: boolean;
  mirroredText: string | null;
}

export const INITIAL_CDP_INPUT_BRIDGE_STATE: CdpInputBridgeState = {
  composing: false,
  mirroredText: null,
};

export interface CdpKeyInput {
  phase: 'down' | 'up';
  key: string;
  code: string;
  keyCode: number;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  isComposing?: boolean;
}

export interface CdpKeyPayload {
  type: 'keyDown' | 'keyUp';
  key: string;
  code: string;
  keyCode: number;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

export function cdpKeyTransition(
  state: CdpInputBridgeState,
  input: CdpKeyInput,
): { state: CdpInputBridgeState; payload: CdpKeyPayload | null } {
  if (
    state.composing ||
    input.isComposing ||
    input.keyCode === 229 ||
    input.key === 'Process'
  ) {
    return { state, payload: null };
  }

  const payload: CdpKeyPayload = {
    type: input.phase === 'down' ? 'keyDown' : 'keyUp',
    key: input.key,
    code: input.code,
    keyCode: input.keyCode,
    altKey: Boolean(input.altKey),
    ctrlKey: Boolean(input.ctrlKey),
    metaKey: Boolean(input.metaKey),
    shiftKey: Boolean(input.shiftKey),
  };
  const mirroredText =
    input.phase === 'down' &&
    input.key.length === 1 &&
    !input.altKey &&
    !input.ctrlKey &&
    !input.metaKey
      ? input.key
      : null;

  return {
    state: { composing: false, mirroredText },
    payload,
  };
}

export function cdpCompositionStartTransition(
  _state: CdpInputBridgeState,
): CdpInputBridgeState {
  return { composing: true, mirroredText: null };
}

export function cdpCompositionEndTransition(
  _state: CdpInputBridgeState,
  text: string,
): {
  state: CdpInputBridgeState;
  payload: { type: 'insertText'; text: string } | null;
} {
  return {
    state: { composing: false, mirroredText: text || null },
    payload: text ? { type: 'insertText', text } : null,
  };
}

export function cdpTextInputTransition(
  state: CdpInputBridgeState,
  input: {
    value: string;
    inputType: string;
    isComposing: boolean;
  },
): {
  state: CdpInputBridgeState;
  payload: { type: 'insertText'; text: string } | null;
  clearInput: boolean;
} {
  if (state.composing || input.isComposing) {
    return { state, payload: null, clearInput: false };
  }
  if (!input.value) {
    return { state, payload: null, clearInput: false };
  }
  if (state.mirroredText === input.value) {
    return {
      state: { composing: false, mirroredText: null },
      payload: null,
      clearInput: true,
    };
  }
  return {
    state: { composing: false, mirroredText: null },
    payload: { type: 'insertText', text: input.value },
    clearInput: true,
  };
}
