import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BrowserControl,
  BrowserInputOutcomeUnknownError,
  HUMAN_IDLE_MS,
} from './browser-control.js';

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

/** Tracks whether a promise has settled without awaiting it. */
function track<T>(promise: Promise<T>) {
  const state: { done: boolean; value?: T } = { done: false };
  void promise.then((value) => {
    state.done = true;
    state.value = value;
  });
  return state;
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

const makeControl = () => new BrowserControl(() => Date.now());

describe('BrowserControl (REBUILD-4 共同操作)', () => {
  it('accepts the person’s input at any time with no lease and no phase change', async () => {
    const control = makeControl();
    expect(control.snapshot()).toEqual({ phase: 'agent', lease: null, error: null });
    expect(await control.runHuman(async () => 'clicked', 'mouseDown')).toBe('clicked');
    expect(await control.runHuman(async () => 'typed', 'insertText')).toBe('typed');
    expect(control.snapshot()).toEqual({ phase: 'agent', lease: null, error: null });
    expect(control.canAgentAct()).toBe(true);
  });

  it('yieldToHuman returns at once when the person is idle', async () => {
    const control = makeControl();
    const onWait = vi.fn();
    expect(await control.yieldToHuman({ onWait })).toEqual({ yielded: false, waitedMs: 0 });
    expect(onWait).not.toHaveBeenCalled();
    control.noteHumanInput('mouseDown');
    await vi.advanceTimersByTimeAsync(HUMAN_IDLE_MS);
    expect(control.humanBusy()).toBe(false);
    expect(await control.yieldToHuman({ onWait })).toEqual({ yielded: false, waitedMs: 0 });
    expect(onWait).not.toHaveBeenCalled();
  });

  it('waits until 2 s after the person’s last busy input, and a new input extends the wait', async () => {
    const control = makeControl();
    control.noteHumanInput('mouseDown');
    await vi.advanceTimersByTimeAsync(500);
    const onWait = vi.fn();
    const waiting = track(control.yieldToHuman({ onWait }));
    await vi.advanceTimersByTimeAsync(0);
    expect(onWait).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(waiting.done).toBe(false);
    control.noteHumanInput('keyDown');
    await vi.advanceTimersByTimeAsync(1_999);
    expect(waiting.done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(waiting.done).toBe(true);
    expect(waiting.value).toEqual({ yielded: true, waitedMs: 3_000 });
    expect(onWait).toHaveBeenCalledOnce();
  });

  it.each(['mouseDown', 'keyDown', 'insertText', 'navigate', 'scroll'] as const)(
    '%s makes the person busy',
    (kind) => {
      const control = makeControl();
      control.noteHumanInput(kind);
      expect(control.humanBusy()).toBe(true);
    },
  );

  it.each(['mouseMove', 'mouseUp', 'keyUp'] as const)(
    '%s does not make the person busy',
    async (kind) => {
      const control = makeControl();
      control.noteHumanInput(kind);
      await control.runHuman(async () => {}, kind);
      expect(control.humanBusy()).toBe(false);
      expect(await control.yieldToHuman()).toEqual({ yielded: false, waitedMs: 0 });
    },
  );

  it('counts only acting inputs (not scroll or pointer moves) in the input log', async () => {
    const control = makeControl();
    control.noteHumanInput('mouseMove');
    control.noteHumanInput('scroll');
    expect(control.humanInputLog()).toEqual({ count: 0, firstAt: null, lastAt: null });
    const first = Date.now();
    control.noteHumanInput('mouseDown');
    await vi.advanceTimersByTimeAsync(100);
    control.noteHumanInput('navigate');
    expect(control.humanInputLog()).toEqual({ count: 2, firstAt: first, lastAt: first + 100 });
    expect(control.humanInputLog(first + 1)).toEqual({
      count: 1,
      firstAt: first + 100,
      lastAt: first + 100,
    });
  });

  it('waits for an input that is still running, whatever its age', async () => {
    const control = makeControl();
    const finish = deferred();
    const input = control.runHuman(() => finish.promise);
    const waiting = track(control.yieldToHuman());
    await vi.advanceTimersByTimeAsync(10_000);
    expect(control.humanBusy()).toBe(true);
    expect(waiting.done).toBe(false);
    finish.resolve();
    await input;
    await vi.advanceTimersByTimeAsync(0);
    expect(waiting.done).toBe(true);
    expect(waiting.value).toMatchObject({ yielded: true });
  });

  it('gives up waiting on a person who never stops after maxWaitMs', async () => {
    const control = makeControl();
    control.noteHumanInput('scroll');
    const waiting = track(control.yieldToHuman({ maxWaitMs: 3_000 }));
    for (let i = 0; i < 5 && !waiting.done; i++) {
      await vi.advanceTimersByTimeAsync(500);
      control.noteHumanInput('scroll');
      await vi.advanceTimersByTimeAsync(500);
      control.noteHumanInput('scroll');
    }
    expect(waiting.done).toBe(true);
    expect(waiting.value).toEqual({ yielded: true, waitedMs: 3_000 });
    expect(control.humanBusy()).toBe(true);
  });

  it('stops waiting when the control closes', async () => {
    const control = makeControl();
    control.noteHumanInput('keyDown');
    const waiting = track(control.yieldToHuman());
    await vi.advanceTimersByTimeAsync(100);
    expect(waiting.done).toBe(false);
    control.close();
    await vi.advanceTimersByTimeAsync(0);
    expect(waiting.done).toBe(true);
    expect(waiting.value).toEqual({ yielded: true, waitedMs: 100 });
    expect(await control.yieldToHuman()).toEqual({ yielded: false, waitedMs: 0 });
  });

  it('checkpoint re-reads the page only after it waited for the person', async () => {
    const control = makeControl();
    const observe = vi.fn(async () => {});
    expect(await control.checkpoint(observe)).toEqual({ resumed: false, waitedMs: 0 });
    expect(observe).not.toHaveBeenCalled();
    control.noteHumanInput('insertText');
    const parked = control.checkpoint(observe);
    await vi.advanceTimersByTimeAsync(HUMAN_IDLE_MS - 1);
    expect(observe).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(await parked).toEqual({ resumed: true, waitedMs: HUMAN_IDLE_MS });
    expect(observe).toHaveBeenCalledOnce();
  });

  it('checkpoint closes the control when the fresh observation fails', async () => {
    const control = makeControl();
    control.noteHumanInput('mouseDown');
    const parked = control.checkpoint(async () => {
      throw new Error('camera unavailable');
    });
    await vi.advanceTimersByTimeAsync(HUMAN_IDLE_MS);
    expect(await parked).toMatchObject({ resumed: false });
    expect(control.snapshot()).toMatchObject({ phase: 'closed', error: 'observation_failed' });
  });

  it('checkpoint does not observe for a control closed during the wait', async () => {
    const control = makeControl();
    const observe = vi.fn(async () => {});
    control.noteHumanInput('mouseDown');
    const parked = control.checkpoint(observe);
    await vi.advanceTimersByTimeAsync(100);
    control.close();
    expect(await parked).toMatchObject({ resumed: false });
    expect(observe).not.toHaveBeenCalled();
  });

  it('waitForReply: a reply with no browser use is not a resume', async () => {
    const control = makeControl();
    const reply = deferred<string>();
    const observe = vi.fn(async () => {});
    const waiting = control.waitForReply(reply.promise, observe, 10_000);
    control.noteHumanInput('mouseMove');
    control.noteHumanInput('scroll');
    await vi.advanceTimersByTimeAsync(300);
    reply.resolve('继续');
    expect(await waiting).toEqual({
      reason: 'reply',
      value: '继续',
      resumed: false,
      waitedMs: 300,
    });
    expect(observe).not.toHaveBeenCalled();
  });

  it('waitForReply: when the person acted meanwhile it waits for them to be still, then re-reads', async () => {
    const control = makeControl();
    const reply = deferred<string>();
    const observe = vi.fn(async () => {});
    const waiting = track(control.waitForReply(reply.promise, observe, 10_000));
    await vi.advanceTimersByTimeAsync(100);
    await control.runHuman(async () => {}, 'mouseDown');
    reply.resolve('好了');
    await vi.advanceTimersByTimeAsync(HUMAN_IDLE_MS - 1);
    expect(observe).not.toHaveBeenCalled();
    expect(waiting.done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(waiting.done).toBe(true);
    expect(waiting.value).toMatchObject({ reason: 'reply', value: '好了', resumed: true });
    expect(observe).toHaveBeenCalledOnce();
  });

  it('waitForReply: an acting input before the wait does not count', async () => {
    const control = makeControl();
    control.noteHumanInput('keyDown');
    await vi.advanceTimersByTimeAsync(5_000);
    const observe = vi.fn(async () => {});
    const result = await control.waitForReply(Promise.resolve('x'), observe, 1_000);
    expect(result).toMatchObject({ reason: 'reply', resumed: false });
    expect(observe).not.toHaveBeenCalled();
  });

  it('waitForReply: times out, and a close ends it without observing', async () => {
    const control = makeControl();
    const observe = vi.fn(async () => {});
    const timedOut = control.waitForReply(new Promise<string>(() => {}), observe, 1_000);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await timedOut).toMatchObject({ reason: 'timeout', resumed: false, waitedMs: 1_000 });

    const closing = control.waitForReply(new Promise<string>(() => {}), observe, 60_000);
    control.noteHumanInput('mouseDown');
    await vi.advanceTimersByTimeAsync(10);
    control.close();
    expect(await closing).toMatchObject({ reason: 'closed', resumed: false });
    expect(observe).not.toHaveBeenCalled();
  });

  it('waitForReply: a rejected reply rethrows', async () => {
    const control = makeControl();
    const reply = deferred<string>();
    const waiting = control.waitForReply(reply.promise, async () => {}, 10_000);
    const rejected = expect(waiting).rejects.toThrow('reply store down');
    reply.reject(new Error('reply store down'));
    await rejected;
  });

  it('waitForReply: a failed re-read closes the control', async () => {
    const control = makeControl();
    const waiting = control.waitForReply(
      new Promise<string>(() => {}),
      async () => {
        throw new Error('camera unavailable');
      },
      1_000,
    );
    control.noteHumanInput('insertText');
    await vi.advanceTimersByTimeAsync(1_000 + HUMAN_IDLE_MS);
    expect(await waiting).toMatchObject({ reason: 'closed', resumed: false });
    expect(control.snapshot()).toMatchObject({ phase: 'closed', error: 'observation_failed' });
  });

  it('runs accepted inputs one at a time in the order accepted', async () => {
    const control = makeControl();
    const firstStarted = deferred();
    const finishFirst = deferred();
    const events: string[] = [];
    const first = control.runHuman(async () => {
      events.push('first-start');
      firstStarted.resolve();
      await finishFirst.promise;
      events.push('first-end');
    }, 'mouseDown');
    const second = control.runHuman(async () => {
      events.push('second');
    }, 'mouseUp');
    const third = control.runHuman(async () => {
      events.push('third');
    }, 'insertText');
    await firstStarted.promise;
    await vi.advanceTimersByTimeAsync(0);
    expect(events).toEqual(['first-start']);
    expect(control.isSettled()).toBe(false);
    finishFirst.resolve();
    await Promise.all([first, second, third]);
    expect(events).toEqual(['first-start', 'first-end', 'second', 'third']);
    expect(control.isSettled()).toBe(true);
  });

  it('a rejected input does not poison later inputs', async () => {
    const control = makeControl();
    const effects: string[] = [];
    await expect(
      control.runHuman(async () => {
        throw new Error('input rejected');
      }, 'mouseDown'),
    ).rejects.toThrow('input rejected');
    await control.runHuman(async () => {
      effects.push('next');
    }, 'mouseDown');
    expect(effects).toEqual(['next']);
    expect(control.snapshot().phase).toBe('agent');
  });

  it('close skips queued input but lets the active one finish; settled waits for it', async () => {
    const control = makeControl();
    const started = deferred();
    const finish = deferred();
    const events: string[] = [];
    const active = control.runHuman(async (signal) => {
      started.resolve();
      await finish.promise;
      events.push(`active-ended:${signal.aborted}`);
    });
    const queued = control.runHuman(async () => {
      events.push('queued');
    });
    const rejected = expect(queued).rejects.toThrow('browser_control_closed');
    await started.promise;
    control.close();
    const settled = track(control.settled());
    await vi.advanceTimersByTimeAsync(0);
    expect(settled.done).toBe(false);
    expect(control.isSettled()).toBe(false);
    finish.resolve();
    await active;
    await rejected;
    await vi.advanceTimersByTimeAsync(0);
    expect(settled.done).toBe(true);
    expect(events).toEqual(['active-ended:true']);
    await expect(control.runHuman(async () => {}, 'mouseDown')).rejects.toThrow(
      'browser_control_closed',
    );
  });

  it('a missing transport receipt (stop proven) is outcome-unknown and closes the control', async () => {
    const control = makeControl();
    expect(() => control.confirmBrowserStopped()).toThrow('browser_stop_not_requested');
    const input = control.runHuman(() => new Promise<void>(() => {}), 'mouseDown');
    const rejected = expect(input).rejects.toBeInstanceOf(BrowserInputOutcomeUnknownError);
    await vi.advanceTimersByTimeAsync(0);
    control.close();
    expect(control.isSettled()).toBe(false);
    control.confirmBrowserStopped();
    await rejected;
    expect(control.snapshot()).toEqual({
      phase: 'closed',
      lease: null,
      error: 'input_outcome_unknown',
    });
    expect(control.isSettled()).toBe(true);
  });
});
