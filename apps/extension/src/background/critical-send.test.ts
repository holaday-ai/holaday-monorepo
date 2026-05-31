import { afterEach, describe, expect, it, vi } from 'vitest';
import { sendCriticalClientMessage } from './critical-send.js';
import { send } from './ws-client.js';

vi.mock('./ws-client.js', () => ({
  send: vi.fn(),
}));

describe('sendCriticalClientMessage', () => {
  afterEach(() => {
    vi.useRealTimers();
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
});
