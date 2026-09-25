import { browserControlSessions } from '../agent/supercar/browser-control-sessions.js';
import type { BrowserInstance } from '../browser-pool/types.js';
import {
  type AppliedBrowserViewport,
  DeferredScreencastInputBridge,
} from './screencast-input-bridge.js';

export function createOwnedScreencastInputBridge(options: {
  instance: BrowserInstance;
  peek: (taskId: string) => BrowserInstance | null;
  onViewportApplied?: (viewport: AppliedBrowserViewport) => void;
  releasePressed?: (signal: AbortSignal) => Promise<void>;
}): DeferredScreencastInputBridge {
  const { instance } = options;
  const current = () => {
    if (options.peek(instance.taskId) !== instance || instance.status !== 'ready')
      throw new Error('browser_session_changed');
    return browserControlSessions.get(instance, instance.userId, instance.taskId);
  };
  return new DeferredScreencastInputBridge({
    onViewportApplied: options.onViewportApplied,
    runOwnedInput: async (lease, action) => {
      const session = current();
      if (!session) throw new Error('browser_control_unavailable');
      await session.control.runHuman(lease ?? '', async (signal) => {
        if (current() !== session) throw new Error('browser_session_changed');
        if (options.releasePressed) session.control.beforeHandback(options.releasePressed);
        await action(signal);
      });
    },
    queueViewport: (action) => {
      const session = current();
      if (!session) return; // no runner: keep viewing without mutating its layout
      session.control.queueViewport(async (signal) => {
        if (current() !== session) return;
        await action(signal);
      });
    },
  });
}
