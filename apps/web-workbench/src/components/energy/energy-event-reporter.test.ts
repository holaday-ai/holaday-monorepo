import { describe, expect, it, vi } from 'vitest';
import { createEnergyEventReporter } from './energy-event-reporter';

const EVENT = { type: 'energy_feed_refreshed' } as const;
const EVENT_ID = '11111111-1111-4111-8111-111111111111';

describe('energy event reporter', () => {
  it('adds one event id before delivery and reuses it for retry', async () => {
    const send = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('network'))
      .mockResolvedValue({ ok: true });
    const createEventId = vi.fn(() => EVENT_ID);
    const reporter = createEnergyEventReporter({
      send,
      createEventId,
      waitBeforeRetry: () => Promise.resolve(),
    });

    await reporter.report(EVENT);

    expect(send).toHaveBeenNthCalledWith(1, { ...EVENT, eventId: EVENT_ID });
    expect(send).toHaveBeenNthCalledWith(2, { ...EVENT, eventId: EVENT_ID });
    expect(createEventId).toHaveBeenCalledOnce();
  });

  it('preserves a caller-supplied event id', async () => {
    const send = vi.fn().mockResolvedValue({ ok: true });
    const createEventId = vi.fn(() => '22222222-2222-4222-8222-222222222222');
    const reporter = createEnergyEventReporter({ send, createEventId });

    await reporter.report({ ...EVENT, eventId: EVENT_ID });

    expect(send).toHaveBeenCalledWith({ ...EVENT, eventId: EVENT_ID });
    expect(createEventId).not.toHaveBeenCalled();
  });

  it('does not allocate an id for an event dropped at the pending limit', async () => {
    let release: () => void = () => undefined;
    const send = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const createEventId = vi.fn(() => EVENT_ID);
    const reporter = createEnergyEventReporter({ send, createEventId, maxPending: 1 });

    const accepted = reporter.report(EVENT);
    await reporter.report({ type: 'energy_section_viewed' });

    expect(createEventId).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledOnce();
    release();
    await accepted;
  });

  it('retries one network failure and then succeeds without warning', async () => {
    const send = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('network'))
      .mockResolvedValue({ ok: true });
    const warn = vi.fn();
    const reporter = createEnergyEventReporter({
      send,
      warn,
      waitBeforeRetry: () => Promise.resolve(),
    });

    await reporter.report(EVENT);

    expect(send).toHaveBeenCalledTimes(2);
    expect(warn).not.toHaveBeenCalled();
  });

  it('warns once after a retryable error fails twice', async () => {
    const send = vi.fn().mockRejectedValue(new Error('offline'));
    const warn = vi.fn();
    const reporter = createEnergyEventReporter({
      send,
      warn,
      waitBeforeRetry: () => Promise.resolve(),
    });

    await reporter.report(EVENT);
    await reporter.report(EVENT);

    expect(send).toHaveBeenCalledTimes(4);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith('energy event delivery failed', {
      eventType: 'energy_feed_refreshed',
      retryable: true,
      attempts: 2,
    });
  });

  it('does not retry a 4xx error and never logs the event payload', async () => {
    const send = vi.fn().mockRejectedValue({ data: { httpStatus: 400 } });
    const warn = vi.fn();
    const reporter = createEnergyEventReporter({
      send,
      warn,
      waitBeforeRetry: () => Promise.resolve(),
    });

    await reporter.report({ type: 'light_test_completed', testId: 'emotion-battery' });

    expect(send).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith('energy event delivery failed', {
      eventType: 'light_test_completed',
      retryable: false,
      attempts: 1,
    });
    expect(JSON.stringify(warn.mock.calls)).not.toContain('emotion-battery');
  });

  it('drops a queued retry after disposal', async () => {
    let releaseRetry: () => void = () => undefined;
    const send = vi.fn().mockRejectedValue(new TypeError('network'));
    const reporter = createEnergyEventReporter({
      send,
      warn: vi.fn(),
      waitBeforeRetry: () =>
        new Promise<void>((resolve) => {
          releaseRetry = resolve;
        }),
    });

    const pending = reporter.report(EVENT);
    reporter.dispose();
    releaseRetry();
    await pending;

    expect(send).toHaveBeenCalledOnce();
  });

  it('bounds simultaneous event delivery during an outage burst', async () => {
    const releases: Array<() => void> = [];
    const send = vi.fn(
      () =>
        new Promise<never>((_resolve, reject) => {
          releases.push(() => reject(new Error('offline')));
        }),
    );
    const reporter = createEnergyEventReporter({
      send,
      warn: vi.fn(),
      maxPending: 3,
      waitBeforeRetry: () => Promise.resolve(),
    });

    const pending = Array.from({ length: 20 }, (_, index) =>
      reporter.report({ type: `event-${index}` }),
    );

    expect(send).toHaveBeenCalledTimes(3);
    for (const release of releases) release();
    reporter.dispose();
    await Promise.all(pending);
  });
});
