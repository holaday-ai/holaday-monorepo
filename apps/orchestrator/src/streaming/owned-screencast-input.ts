import { browserControlSessions } from '../agent/supercar/browser-control-sessions.js';
import type { BrowserInstance } from '../browser-pool/types.js';
import { browserCapabilities } from '../config/browser-capabilities.js';
import type { ExecutionAdmission } from '../execution/execution-admission.js';
import {
  type AppliedBrowserViewport,
  DeferredScreencastInputBridge,
  type InputEnvelope,
} from './screencast-input-bridge.js';

export function createOwnedScreencastInputBridge(options: {
  instance: BrowserInstance;
  maxViewportHeight?: number;
  peek: (taskId: string) => BrowserInstance | null;
  onViewportApplied?: (viewport: AppliedBrowserViewport) => void;
  onViewportRequested?: () => void;
  beforeDispatch?: (envelope: InputEnvelope, signal?: AbortSignal) => Promise<void>;
  releasePressed?: (signal: AbortSignal) => Promise<void>;
  executionDrain?: ExecutionAdmission;
}): DeferredScreencastInputBridge {
  const { instance } = options;
  const allowed = () => {
    options.executionDrain?.tick();
    return !options.executionDrain || options.executionDrain.drain.snapshot().mode === 'open';
  };
  const input = async (action: () => Promise<void>) => {
    if (options.executionDrain) await options.executionDrain.runRoot(action).result;
    else await action();
  };
  const current = () => {
    if (options.peek(instance.taskId) !== instance || instance.status !== 'ready')
      throw new Error('browser_session_changed');
    return browserControlSessions.get(instance, instance.userId, instance.taskId);
  };
  return new DeferredScreencastInputBridge({
    maxViewportHeight: options.maxViewportHeight,
    onViewportApplied: options.onViewportApplied,
    beforeDispatch: async (envelope, signal) => {
      if (
        envelope.payload?.type === 'viewport' &&
        !browserCapabilities(instance.userId).viewportV2
      ) {
        envelope.payload.width = Math.max(1280, envelope.payload.width);
        envelope.payload.height = Math.max(800, envelope.payload.height);
      }
      await options.beforeDispatch?.(envelope, signal);
    },
    onViewportRequested: options.onViewportRequested,
    runOwnedInput: async (lease, action) => {
      if (!allowed()) throw new Error('MAINTENANCE_INPUT_CLOSED');
      const session = current();
      if (!session) throw new Error('browser_control_unavailable');
      await session.control.runHuman(lease ?? '', async (signal) => {
        if (current() !== session) throw new Error('browser_session_changed');
        if (options.releasePressed) session.control.beforeHandback(options.releasePressed);
        await input(() => action(signal));
      });
    },
    queueViewport: (action) => {
      if (!allowed()) return;
      const session = current();
      if (!session) return; // no runner: keep viewing without mutating its layout
      session.control.queueViewport(async (signal) => {
        if (!allowed() || current() !== session) return;
        await input(() => action(signal));
      });
    },
  });
}
