import type { BrowserFrameReference } from '@holaday/shared-types';
import type { InputMessage } from './cdp-input.js';

export interface ScreencastInputSink {
  handle(message: InputMessage, signal?: AbortSignal): Promise<void>;
}

interface DeferredScreencastInputBridgeOptions {
  runWithStableViewport?: (action: () => Promise<void>) => Promise<void>;
  /**
   * FIX-62 P1-3: a pointer / key / text input as it arrives; the returned callback runs once it is
   * sent or refused.
   */
  onInputReceived?: (envelope: InputEnvelope) => (() => void) | undefined;
  beforeDispatch?: (envelope: InputEnvelope, signal?: AbortSignal) => Promise<void>;
  /** The person's input through the task's shared control (REBUILD-4: no lease). */
  runOwnedInput?: (
    action: (signal: AbortSignal) => Promise<void>,
    /** FIX-53 #1: which input it is, so only presses, keys and text count as the person acting. */
    kind: InputMessage['type'],
  ) => Promise<void>;
}

export interface InputEnvelope {
  type?: string;
  payload?: InputMessage;
  observation?: BrowserFrameReference;
  confirmationNonce?: string;
}

/**
 * Hands the viewer's input to the page's input sink. Pointer and keyboard events are intentionally
 * not buffered: replaying a stale click after the page becomes available would be unsafe.
 * REBUILD-4 第 4 条: the page is never resized for a viewer — a `viewport` message is ignored.
 */
export class DeferredScreencastInputBridge {
  private sink: ScreencastInputSink | null = null;
  private readonly runWithStableViewport?: DeferredScreencastInputBridgeOptions['runWithStableViewport'];
  private readonly onInputReceived?: DeferredScreencastInputBridgeOptions['onInputReceived'];
  private readonly beforeDispatch?: DeferredScreencastInputBridgeOptions['beforeDispatch'];
  private sinkGeneration = 0;
  private readonly runOwnedInput?: DeferredScreencastInputBridgeOptions['runOwnedInput'];

  constructor(options: DeferredScreencastInputBridgeOptions = {}) {
    this.runWithStableViewport = options.runWithStableViewport;
    this.beforeDispatch = options.beforeDispatch;
    this.onInputReceived = options.onInputReceived;
    this.runOwnedInput = options.runOwnedInput;
  }

  async receive(raw: string): Promise<void> {
    let envelope: InputEnvelope | null = null;
    try {
      envelope = JSON.parse(raw) as InputEnvelope;
    } catch {
      return;
    }
    if (envelope?.type !== 'input' || !envelope.payload) return;
    if (envelope.payload.type === 'viewport') return;
    const settled = this.onInputReceived?.(envelope);
    try {
      if (!this.sink) return;
      await this.dispatch(envelope.payload, envelope);
    } finally {
      settled?.();
    }
  }

  async attach(sink: ScreencastInputSink): Promise<void> {
    this.sinkGeneration++;
    this.sink = sink;
  }

  detach(): void {
    this.sinkGeneration++;
    this.sink = null;
  }

  private async dispatch(message: InputMessage, envelope: InputEnvelope): Promise<void> {
    const sink = this.sink;
    if (!sink) return;
    const generation = this.sinkGeneration;
    const stableAction = async (signal?: AbortSignal): Promise<void> => {
      if (this.sink !== sink || this.sinkGeneration !== generation) return;
      await this.beforeDispatch?.(envelope, signal);
      await sink.handle(message, signal);
    };
    const action = (signal?: AbortSignal) =>
      this.runWithStableViewport
        ? this.runWithStableViewport(() => stableAction(signal))
        : stableAction(signal);
    if (this.runOwnedInput) await this.runOwnedInput(action, message.type);
    else await action();
  }
}
