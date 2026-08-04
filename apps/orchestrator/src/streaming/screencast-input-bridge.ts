import type { InputMessage } from './cdp-input.js';

export interface ScreencastInputSink {
  handle(message: InputMessage): Promise<void>;
}

export interface AppliedBrowserViewport {
  width: number;
  height: number;
}

interface DeferredScreencastInputBridgeOptions {
  onViewportApplied?: (viewport: AppliedBrowserViewport) => void;
}

interface InputEnvelope {
  type?: string;
  payload?: InputMessage;
}

/**
 * Keeps the browser's initial viewport request across the asynchronous CDP
 * startup window. Pointer and keyboard events are intentionally not buffered:
 * replaying a stale click after the page becomes available would be unsafe.
 */
export class DeferredScreencastInputBridge {
  private sink: ScreencastInputSink | null = null;
  private latestViewport: Extract<InputMessage, { type: 'viewport' }> | null = null;
  private readonly onViewportApplied?: (viewport: AppliedBrowserViewport) => void;

  constructor(options: DeferredScreencastInputBridgeOptions = {}) {
    this.onViewportApplied = options.onViewportApplied;
  }

  async receive(raw: string): Promise<void> {
    let envelope: InputEnvelope | null = null;
    try {
      envelope = JSON.parse(raw) as InputEnvelope;
    } catch {
      return;
    }
    if (envelope?.type !== 'input' || !envelope.payload) return;

    if (envelope.payload.type === 'viewport') {
      this.latestViewport = envelope.payload;
    }

    if (!this.sink) {
      return;
    }

    await this.dispatch(envelope.payload);
  }

  async attach(sink: ScreencastInputSink): Promise<void> {
    this.sink = sink;
    if (this.latestViewport) await this.dispatch(this.latestViewport);
  }

  async reapplyViewport(): Promise<void> {
    if (this.latestViewport) await this.dispatch(this.latestViewport);
  }

  detach(): void {
    this.sink = null;
    this.latestViewport = null;
  }

  private async dispatch(message: InputMessage): Promise<void> {
    const sink = this.sink;
    if (!sink) return;
    await sink.handle(message);
    if (message.type === 'viewport') {
      this.onViewportApplied?.({
        width: Math.round(message.width),
        height: Math.round(message.height),
      });
    }
  }
}
