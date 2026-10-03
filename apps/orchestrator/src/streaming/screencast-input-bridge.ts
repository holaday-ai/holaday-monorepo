import type { InputMessage } from './cdp-input.js';

export interface ScreencastInputSink {
  handle(message: InputMessage, signal?: AbortSignal): Promise<void>;
}

export interface AppliedBrowserViewport {
  width: number;
  height: number;
}

interface DeferredScreencastInputBridgeOptions {
  onViewportApplied?: (viewport: AppliedBrowserViewport) => void;
  /** Optional until the session/route and frontend negotiate owner leases. */
  runOwnedInput?: (
    lease: string | undefined,
    action: (signal: AbortSignal) => Promise<void>,
  ) => Promise<void>;
  /** Accepted immediately; applied and acknowledged only at a runner checkpoint. */
  queueViewport?: (action: (signal: AbortSignal) => Promise<void>) => void;
}

interface InputEnvelope {
  type?: string;
  payload?: InputMessage;
  controlLease?: string;
}

/**
 * Keeps the browser's initial viewport request across the asynchronous CDP
 * startup window. Pointer and keyboard events are intentionally not buffered:
 * replaying a stale click after the page becomes available would be unsafe.
 */
export class DeferredScreencastInputBridge {
  private sink: ScreencastInputSink | null = null;
  private sinkGeneration = 0;
  private latestViewport: Extract<InputMessage, { type: 'viewport' }> | null = null;
  private readonly onViewportApplied?: (viewport: AppliedBrowserViewport) => void;
  private readonly runOwnedInput?: DeferredScreencastInputBridgeOptions['runOwnedInput'];
  private readonly queueViewport?: DeferredScreencastInputBridgeOptions['queueViewport'];

  constructor(options: DeferredScreencastInputBridgeOptions = {}) {
    this.onViewportApplied = options.onViewportApplied;
    this.runOwnedInput = options.runOwnedInput;
    this.queueViewport = options.queueViewport;
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
      const { width, height } = envelope.payload;
      if (
        !Number.isFinite(width) ||
        !Number.isFinite(height) ||
        width < 240 ||
        width > 1920 ||
        height < 240 ||
        height > 1600
      )
        return;
      this.latestViewport = envelope.payload;
    }

    if (!this.sink) {
      return;
    }

    await this.dispatch(
      envelope.payload,
      typeof envelope.controlLease === 'string' ? envelope.controlLease : undefined,
    );
  }

  async attach(sink: ScreencastInputSink): Promise<void> {
    this.sinkGeneration++;
    this.sink = sink;
    if (this.latestViewport) await this.dispatch(this.latestViewport);
  }

  async reapplyViewport(): Promise<void> {
    if (this.latestViewport) await this.dispatch(this.latestViewport);
  }

  detach(): void {
    this.sinkGeneration++;
    this.sink = null;
    this.latestViewport = null;
  }

  private async dispatch(message: InputMessage, lease?: string): Promise<void> {
    const sink = this.sink;
    if (!sink) return;
    const generation = this.sinkGeneration;
    const action = async (signal?: AbortSignal): Promise<void> => {
      if (this.sink !== sink || this.sinkGeneration !== generation) return;
      await sink.handle(message, signal);
      if (message.type === 'viewport' && this.sink === sink && this.sinkGeneration === generation) {
        this.onViewportApplied?.({
          width: Math.round(message.width),
          height: Math.round(message.height),
        });
      }
    };
    if (message.type === 'viewport' && this.queueViewport) {
      this.queueViewport(action);
    } else if (this.runOwnedInput) {
      // A guarded input connection must never silently bypass layout coordination.
      if (message.type === 'viewport') throw new Error('browser_viewport_coordinator_required');
      await this.runOwnedInput(lease, action);
    } else {
      await action();
    }
  }
}
