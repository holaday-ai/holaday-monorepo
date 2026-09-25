import type { ServerMessage } from '@holaday/shared-types';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  _resetExtensionToolInFlightForTests,
  configureExtensionToolRuntime,
  handleExtensionToolCall,
  setExtensionToolTaskStopped,
} from './extension-tools.js';
import { getCurrentWsToken, send } from './ws-client.js';

vi.mock('./ws-client.js', () => ({
  getCurrentWsToken: vi.fn(() => 'owner-a'),
  send: vi.fn(() => true),
}));

const sessionId = 'c4860f52-6b76-4d18-a6ba-04165322af7d';
function sessionCall(
  requestId: string,
): Extract<ServerMessage, { type: 'server.extension.tool_call' }> {
  return {
    type: 'server.extension.tool_call',
    taskId: 'task-a',
    requestId,
    kind: 'session',
    args: {
      session: {
        op: 'act',
        sessionId,
        action: { kind: 'key', payload: { key: 'Enter' } },
      },
    },
    timeoutMs: 1,
  };
}

afterEach(() => {
  _resetExtensionToolInFlightForTests();
  vi.mocked(getCurrentWsToken).mockReturnValue('owner-a');
  vi.mocked(send).mockReset();
  vi.mocked(send).mockReturnValue(true);
  vi.useRealTimers();
});

describe('selected Chrome extension tool handler', () => {
  it('dispatches session commands and preserves nested failure outcome at the wire boundary', async () => {
    const reply = {
      ok: false as const,
      error: 'input_outcome_unknown',
      actionOutcome: 'unknown' as const,
    };
    const transport = { handle: vi.fn(async () => reply), stopTask: vi.fn(async () => {}) };
    configureExtensionToolRuntime({ transport, runLegacy: (run) => run() });

    await handleExtensionToolCall(sessionCall('request-failure'));

    expect(transport.handle).toHaveBeenCalledWith(
      'task-a',
      expect.objectContaining({ op: 'act', sessionId }),
    );
    expect(vi.mocked(send).mock.calls.at(-1)?.[0]).toMatchObject({
      type: 'client.extension.tool_result',
      taskId: 'task-a',
      requestId: 'request-failure',
      ok: false,
      result: reply,
      error: { code: 'input_outcome_unknown' },
    });
    expect(JSON.stringify(vi.mocked(send).mock.calls.at(-1)?.[0])).not.toContain('https://');
  });

  it('keeps top-level error.code identical to every nested bridge error', async () => {
    const reply = {
      ok: false as const,
      error: 'ORIGIN_BLOCKED',
      actionOutcome: 'not_applied' as const,
    };
    configureExtensionToolRuntime({
      transport: { handle: vi.fn(async () => reply), stopTask: vi.fn(async () => {}) },
      runLegacy: (run) => run(),
    });

    await handleExtensionToolCall(sessionCall('request-exact-error'));

    expect(vi.mocked(send).mock.calls.at(-1)?.[0]).toMatchObject({
      ok: false,
      result: reply,
      error: { code: 'ORIGIN_BLOCKED' },
    });
  });

  it('joins duplicate request ids until the real session action settles', async () => {
    let finish!: () => void;
    const handle = vi.fn(
      () =>
        new Promise<{ ok: true; sessionId: string; observation: unknown }>((resolve) => {
          finish = () => resolve({ ok: true, sessionId, observation: { tabId: 42 } });
        }),
    );
    configureExtensionToolRuntime({
      transport: { handle, stopTask: vi.fn(async () => {}) },
      runLegacy: (run) => run(),
    });

    const first = handleExtensionToolCall(sessionCall('request-dedupe'));
    await vi.waitFor(() => expect(handle).toHaveBeenCalledTimes(1));
    const duplicate = handleExtensionToolCall(sessionCall('request-dedupe'));
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(handle).toHaveBeenCalledTimes(1);
    expect(send).not.toHaveBeenCalled();

    finish();
    await Promise.all([first, duplicate]);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('routes pause and cancel cleanup to transport stopTask without a session id', async () => {
    const stopTask = vi.fn(async () => {});
    configureExtensionToolRuntime({
      transport: { handle: vi.fn(), stopTask },
      runLegacy: (run) => run(),
    });

    setExtensionToolTaskStopped('task-open-timeout', true);
    await vi.waitFor(() => expect(stopTask).toHaveBeenCalledWith('task-open-timeout'));
  });
});
