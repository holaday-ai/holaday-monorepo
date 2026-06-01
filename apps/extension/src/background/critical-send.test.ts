import { afterEach, describe, expect, it, vi } from 'vitest';
import { sendCriticalClientMessage } from './critical-send.js';
import { send } from './ws-client.js';

const wsMock = vi.hoisted(() => ({
  currentToken: null as string | null,
}));

vi.mock('./ws-client.js', () => ({
  getCurrentWsToken: vi.fn(() => wsMock.currentToken),
  send: vi.fn(),
}));

describe('sendCriticalClientMessage', () => {
  afterEach(() => {
    vi.useRealTimers();
    wsMock.currentToken = null;
    vi.mocked(send).mockReset();
    vi.restoreAllMocks();
  });

  it('sends once when the websocket is open', () => {
    vi.mocked(send).mockReturnValue(true);

    expect(
      sendCriticalClientMessage(
        { type: 'client.step.result', taskId: 'tsk_1', stepId: 'step_1', status: 'ok' },
        'step result',
      ),
    ).toBe(true);

    expect(send).toHaveBeenCalledTimes(1);
  });

  it('retries critical messages across a websocket reconnect', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.mocked(send)
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);

    const message = {
      type: 'client.vision.acted',
      taskId: 'tsk_vision',
      tickIndex: 3,
      ok: true,
    } as const;

    expect(sendCriticalClientMessage(message, 'vision action')).toBe(false);
    await vi.advanceTimersByTimeAsync(250 + 1_000);

    expect(send).toHaveBeenCalledTimes(3);
    expect(vi.mocked(send).mock.calls[2]?.[0]).toBe(message);
  });

  it('keeps retrying while the websocket token is temporarily unavailable', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    wsMock.currentToken = 'token-a';
    vi.mocked(send)
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);

    const message = {
      type: 'client.step.result',
      taskId: 'tsk_gap',
      stepId: 'step_gap',
      status: 'ok',
    } as const;

    expect(sendCriticalClientMessage(message, 'step result')).toBe(false);
    wsMock.currentToken = null;
    await vi.advanceTimersByTimeAsync(250);
    wsMock.currentToken = 'token-a';
    await vi.advanceTimersByTimeAsync(1_000);

    expect(send).toHaveBeenCalledTimes(3);
    expect(vi.mocked(send).mock.calls[2]?.[0]).toBe(message);
  });

  it('stops retrying critical messages after the websocket token changes', async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    wsMock.currentToken = 'token-a';
    vi.mocked(send).mockReturnValue(false);

    const message = {
      type: 'client.extension.tool_result',
      taskId: 'tsk_old_user',
      requestId: 'req_old_user',
      at: 123,
      ok: false,
      error: { message: 'old result', code: 'exec_error' },
    } as const;

    expect(sendCriticalClientMessage(message, 'extension tool result')).toBe(false);
    wsMock.currentToken = 'token-b';
    await vi.advanceTimersByTimeAsync(250);

    expect(send).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      '[holaday] extension tool result retry cancelled after token change',
      expect.objectContaining({
        taskId: 'tsk_old_user',
        requestId: 'req_old_user',
        attempt: 1,
      }),
    );
  });

  it('does not send the first critical message when an explicit owner token is already stale', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    wsMock.currentToken = 'token-b';
    vi.mocked(send).mockReturnValue(true);

    const message = {
      type: 'client.vision.acted',
      taskId: 'tsk_stale_vision',
      tickIndex: 4,
      ok: true,
    } as const;

    expect(
      sendCriticalClientMessage(message, 'vision action', { ownerToken: 'token-a' }),
    ).toBe(false);

    expect(send).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      '[holaday] vision action send cancelled after token change',
      expect.objectContaining({
        taskId: 'tsk_stale_vision',
        tickIndex: 4,
        attempt: 0,
      }),
    );
  });

  it('uses an explicit owner token when the websocket is already disconnected', async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    wsMock.currentToken = null;
    vi.mocked(send).mockReturnValue(false);

    const message = {
      type: 'client.extension.tool_result',
      taskId: 'tsk_owner_token',
      requestId: 'req_owner_token',
      at: 123,
      ok: true,
      result: { finalUrl: 'https://example.com/', title: 'Example', bodyText: '' },
    } as const;

    expect(
      sendCriticalClientMessage(message, 'extension tool result', { ownerToken: 'token-a' }),
    ).toBe(false);
    wsMock.currentToken = 'token-b';
    await vi.advanceTimersByTimeAsync(250);

    expect(send).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      '[holaday] extension tool result retry cancelled after token change',
      expect.objectContaining({
        taskId: 'tsk_owner_token',
        requestId: 'req_owner_token',
        attempt: 1,
      }),
    );
  });
});
