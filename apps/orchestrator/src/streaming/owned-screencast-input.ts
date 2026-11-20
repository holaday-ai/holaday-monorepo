import { browserControlSessions } from '../agent/supercar/browser-control-sessions.js';
import type { BrowserInstance } from '../browser-pool/types.js';
import type { ExecutionAdmission } from '../execution/execution-admission.js';
import { DeferredScreencastInputBridge, type InputEnvelope } from './screencast-input-bridge.js';

export function createOwnedScreencastInputBridge(options: {
  instance: BrowserInstance;
  runWithStableViewport?: (action: () => Promise<void>) => Promise<void>;
  peek: (taskId: string) => BrowserInstance | null;
  onInputReceived?: (envelope: InputEnvelope) => (() => void) | undefined;
  beforeDispatch?: (envelope: InputEnvelope, signal?: AbortSignal) => Promise<void>;
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
    return browserControlSessions.openForViewer(instance);
  };
  return new DeferredScreencastInputBridge({
    runWithStableViewport: options.runWithStableViewport,
    beforeDispatch: options.beforeDispatch,
    onInputReceived: options.onInputReceived,
    // REBUILD-4: the person's input goes to the page at any time — no lease. It runs through the
    // task's control so the assistant sees the person busy and yields (2 s idle, then re-reads).
    runOwnedInput: async (action, kind) => {
      if (!allowed()) throw new Error('MAINTENANCE_INPUT_CLOSED');
      const session = current();
      if (!session) throw new Error('browser_control_unavailable');
      await session.control.runHuman(
        async (signal) => {
          if (current() !== session) throw new Error('browser_session_changed');
          await input(() => action(signal));
        },
        kind === 'viewport' ? undefined : kind,
      );
    },
  });
}
