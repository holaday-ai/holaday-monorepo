import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  _resetCriticalSendStateForTests,
  sendCriticalClientMessage,
} from './critical-send.js';
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
    _resetCriticalSendStateForTests();
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

  it('cancels older retries when the same critical result is sent again', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const olderMessage = {
      type: 'client.extension.tool_result',
      taskId: 'tsk_duplicate_result',
      requestId: 'req_duplicate_result',
      at: 100,
      ok: false,
      error: { message: 'older result', code: 'exec_error' },
    } as const;
    const newerMessage = {
      type: 'client.extension.tool_result',
      taskId: 'tsk_duplicate_result',
      requestId: 'req_duplicate_result',
      at: 200,
      ok: true,
      result: { finalUrl: 'https://example.com/', title: 'Example', bodyText: '' },
    } as const;
    vi.mocked(send).mockReturnValueOnce(false).mockReturnValueOnce(true);

    expect(sendCriticalClientMessage(olderMessage, 'extension tool result')).toBe(false);
    expect(sendCriticalClientMessage(newerMessage, 'extension tool result')).toBe(true);
    await vi.advanceTimersByTimeAsync(250);

    expect(send).toHaveBeenCalledTimes(2);
    expect(vi.mocked(send).mock.calls[0]?.[0]).toBe(olderMessage);
    expect(vi.mocked(send).mock.calls[1]?.[0]).toBe(newerMessage);
  });

  it('lets different critical result keys retry independently', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const firstMessage = {
      type: 'client.step.result',
      taskId: 'tsk_parallel',
      stepId: 'step_a',
      status: 'ok',
    } as const;
    const secondMessage = {
      type: 'client.step.result',
      taskId: 'tsk_parallel',
      stepId: 'step_b',
      status: 'ok',
    } as const;
    vi.mocked(send)
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(true);

    expect(sendCriticalClientMessage(firstMessage, 'step result')).toBe(false);
    expect(sendCriticalClientMessage(secondMessage, 'step result')).toBe(false);
    await vi.advanceTimersByTimeAsync(250);

    expect(send).toHaveBeenCalledTimes(4);
    expect(vi.mocked(send).mock.calls[2]?.[0]).toBe(firstMessage);
    expect(vi.mocked(send).mock.calls[3]?.[0]).toBe(secondMessage);
  });

  it('bounds queued critical retries by dropping the oldest unique keys', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.mocked(send).mockReturnValue(false);

    const messages = Array.from({ length: 101 }, (_, index) => ({
      type: 'client.step.result',
      taskId: 'tsk_bounded_retry',
      stepId: `step_${index}`,
      status: 'ok',
    }) as const);

    for (const message of messages) {
      expect(sendCriticalClientMessage(message, 'step result')).toBe(false);
    }
    await vi.advanceTimersByTimeAsync(250);

    expect(send).toHaveBeenCalledTimes(201);
    expect(vi.mocked(send).mock.calls.slice(101).map(([message]) => message)).toEqual(
      messages.slice(1),
    );
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

  it('does not queue required-owner retries without a websocket token', async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    wsMock.currentToken = null;
    vi.mocked(send).mockReturnValue(false);

    const message = {
      type: 'client.extension.tool_result',
      taskId: 'tsk_missing_owner_token',
      requestId: 'req_missing_owner_token',
      at: 123,
      ok: false,
      error: { message: 'tool failed', code: 'exec_error' },
    } as const;

    expect(
      sendCriticalClientMessage(message, 'extension tool result', {
        ownerToken: null,
        requireOwnerToken: true,
      }),
    ).toBe(false);
    wsMock.currentToken = 'token-b';
    await vi.advanceTimersByTimeAsync(250);

    expect(send).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      '[holaday] extension tool result retry skipped without owner token',
      expect.objectContaining({
        taskId: 'tsk_missing_owner_token',
        requestId: 'req_missing_owner_token',
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
