import { pino } from 'pino';
import type { CDPSession } from 'playwright';
import { describe, expect, it, vi } from 'vitest';
import { BrowserControl } from '../agent/supercar/browser-control.js';
import { CdpInputHandler } from './cdp-input.js';
import { DeferredScreencastInputBridge } from './screencast-input-bridge.js';

describe('CdpInputHandler owned cancellation', () => {
  it('quarantines a rejected owned dispatch without waiting for a timeout', async () => {
    const quarantine = vi.fn();
    const session = {
      send: vi.fn().mockRejectedValue(new Error('connection lost')),
      detach: vi.fn().mockResolvedValue(undefined),
    } as unknown as CDPSession;
    const handler = new CdpInputHandler(
      () => session,
      pino({ level: 'silent' }),
      undefined,
      quarantine,
    );
    await expect(
      handler.handle({ type: 'insertText', text: 'x' }, new AbortController().signal),
    ).rejects.toThrow('browser_input_outcome_unknown');
    expect(quarantine).toHaveBeenCalledTimes(1);
  });

  it('closes the control at timeout even when the transport cannot confirm detach', async () => {
    vi.useFakeTimers();
    const control = new BrowserControl();
    let rejectSend!: (error: Error) => void;
    const pending = new Promise<void>((_, reject) => {
      rejectSend = reject;
    });
    const session = {
      send: () => pending,
      detach: async () => {
        throw new Error('transport lost');
      },
    } as unknown as CDPSession;
    const handler = new CdpInputHandler(
      () => session,
      pino({ level: 'silent' }),
      undefined,
      () => control.close('input_outcome_unknown'),
    );
    const input = control.runHuman(
      (signal) => handler.handle({ type: 'insertText', text: 'x' }, signal),
      'insertText',
    );
    let settled = false;
    const result = input.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    try {
      await vi.advanceTimersByTimeAsync(10_001);
      expect(control.snapshot()).toMatchObject({
        phase: 'closed',
        lease: null,
        error: 'input_outcome_unknown',
      });
      expect(settled).toBe(false);
      expect(control.isSettled()).toBe(false);
      await expect(control.runHuman(async () => undefined, 'mouseDown')).rejects.toThrow(
        'browser_control_closed',
      );
    } finally {
      rejectSend(new Error('test transport closed'));
      await result;
      vi.useRealTimers();
    }
  });

  it('interrupts a hung owned input after its deadline without reporting success', async () => {
    vi.useFakeTimers();
    const effects: string[] = [];
    let rejectSend!: (error: Error) => void;
    const pending = new Promise<void>((_, reject) => {
      rejectSend = reject;
    });
    const session = {
      send: () => {
        effects.push('dispatch');
        return pending;
      },
      detach: async () => {
        effects.push('detach');
        rejectSend(new Error('session closed'));
      },
    } as unknown as CDPSession;
    const handler = new CdpInputHandler(() => session, pino({ level: 'silent' }));
    const result = handler
      .handle({ type: 'insertText', text: 'x' }, new AbortController().signal)
      .then(
        () => 'success',
        (err: Error) => err.message,
      );
    try {
      await vi.advanceTimersByTimeAsync(10_001);
      expect(effects).toEqual(['dispatch', 'detach']);
      expect(await result).toBe('browser_input_outcome_unknown');
    } finally {
      rejectSend(new Error('test cleanup'));
      await result;
      vi.useRealTimers();
    }
  });

  it('does not dispatch an already cancelled input', async () => {
    const effects: string[] = [];
    const session = {
      send: async () => {
        effects.push('input');
      },
    } as unknown as CDPSession;
    const handler = new CdpInputHandler(() => session, pino({ level: 'silent' }));
    const abort = new AbortController();
    abort.abort();
    await expect(handler.handle({ type: 'insertText', text: 'x' }, abort.signal)).rejects.toThrow();
    expect(effects).toEqual([]);
  });

  it('interrupts the actual pending CDP call and reports unknown outcome instead of success', async () => {
    const effects: string[] = [];
    let rejectSend!: (error: Error) => void;
    const pending = new Promise<void>((_, reject) => {
      rejectSend = reject;
    });
    const session = {
      send: () => {
        effects.push('dispatch');
        return pending;
      },
      detach: async () => {
        effects.push('detached');
        rejectSend(new Error('session closed'));
      },
    } as unknown as CDPSession;
    const handler = new CdpInputHandler(
      () => session,
      pino({ level: 'silent' }),
      () => effects.push('success'),
    );
    const control = new BrowserControl();
    const bridge = new DeferredScreencastInputBridge({
      runOwnedInput: (action, kind) =>
        control.runHuman(action, kind === 'viewport' ? undefined : kind),
    });
    await bridge.attach(handler);
    const input = bridge.receive(
      JSON.stringify({ type: 'input', payload: { type: 'insertText', text: 'x' } }),
    );
    const rejected = input.then(
      () => 'success',
      (error: Error) => error.message,
    );
    await vi.waitFor(() => expect(effects).toContain('dispatch'));
    control.close();
    try {
      await vi.waitFor(() => expect(effects).toContain('detached'));
      expect(await rejected).toBe('browser_input_outcome_unknown');
      expect(effects).toEqual(['dispatch', 'detached']);
      expect(control.snapshot()).toMatchObject({ phase: 'closed', error: 'input_outcome_unknown' });
    } finally {
      rejectSend(new Error('test cleanup'));
      await rejected;
    }
  });

  it('does not fake settlement when transport interruption fails', async () => {
    const effects: string[] = [];
    let rejectSend!: (error: Error) => void;
    const pending = new Promise<void>((_, reject) => {
      rejectSend = reject;
    });
    const session = {
      send: () => {
        effects.push('dispatch');
        return pending;
      },
      detach: async () => {
        effects.push('detach-failed');
        throw new Error('transport lost');
      },
    } as unknown as CDPSession;
    const handler = new CdpInputHandler(() => session, pino({ level: 'silent' }));
    const abort = new AbortController();
    let settled = false;
    const result = handler.handle({ type: 'insertText', text: 'x' }, abort.signal).then(
      () => {
        settled = true;
        return 'success';
      },
      (err: Error) => {
        settled = true;
        return err.message;
      },
    );
    abort.abort();
    try {
      await vi.waitFor(() => expect(effects).toContain('detach-failed'));
      expect(settled).toBe(false);
    } finally {
      rejectSend(new Error('transport eventually closed'));
    }
    expect(await result).toBe('browser_input_outcome_unknown');
    await expect(
      handler.handle({ type: 'insertText', text: 'retry' }, new AbortController().signal),
    ).rejects.toThrow();
    expect(effects).toEqual(['dispatch', 'detach-failed']);
  });

  it('does not send the rest of a multi-command key event after cancellation', async () => {
    const effects: string[] = [];
    const abort = new AbortController();
    const session = {
      send: async (_method: string, params: { type: string; key: string }) => {
        effects.push(`${params.type}:${params.key}`);
        if (params.type === 'keyUp') abort.abort();
      },
      detach: async () => {
        effects.push('detach');
      },
    } as unknown as CDPSession;
    const handler = new CdpInputHandler(() => session, pino({ level: 'silent' }));
    await handler.handle({ type: 'keyDown', key: 'Meta', metaKey: true });
    await expect(handler.handle({ type: 'keyDown', key: 'x' }, abort.signal)).rejects.toThrow(
      'browser_input_outcome_unknown',
    );
    expect(effects).toEqual(['keyDown:Meta', 'keyUp:Meta', 'detach']);
  });
});

function handlerWithSend() {
  const send = vi.fn().mockResolvedValue(undefined);
  const session = { send } as unknown as CDPSession;
  return {
    send,
    handler: new CdpInputHandler(() => session, pino({ level: 'silent' })),
  };
}

describe('CdpInputHandler viewport message (REBUILD-4 第 4 条)', () => {
  it('never resizes the page for a viewer, whatever the size', async () => {
    const { handler, send } = handlerWithSend();

    await handler.handle({ type: 'viewport', width: 612, height: 844 });
    await handler.handle({ type: 'viewport', width: 390, height: 760, deviceScaleFactor: 2 });
    await handler.handle({ type: 'viewport', width: 0, height: 844 });
    await handler.handle({ type: 'viewport', width: 10_000, height: 844 });
    await handler.handle({ type: 'viewport', width: 612, height: Number.NaN });

    expect(send).not.toHaveBeenCalled();
  });
});

describe('CdpInputHandler keyboard input', () => {
  it('requests a visible-frame refresh after accepted input', async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const refreshFrame = vi.fn();
    const handler = new CdpInputHandler(
      () => ({ send }) as unknown as CDPSession,
      pino({ level: 'silent' }),
      refreshFrame,
    );

    await handler.handle({ type: 'insertText', text: '继续' });

    expect(refreshFrame).toHaveBeenCalledOnce();
  });

  it('includes text when dispatching a printable key', async () => {
    const { handler, send } = handlerWithSend();

    await handler.handle({
      type: 'keyDown',
      key: 'h',
      code: 'KeyH',
      keyCode: 72,
    });

    expect(send).toHaveBeenCalledWith('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'h',
      code: 'KeyH',
      windowsVirtualKeyCode: 72,
      modifiers: 0,
      text: 'h',
      unmodifiedText: 'h',
    });
  });

  it('DEPLOY-61: Enter (and the numpad one) carries a carriage return so it submits and activates', async () => {
    const { handler, send } = handlerWithSend();
    await handler.handle({ type: 'keyDown', key: 'Enter', code: 'Enter', keyCode: 13 });
    await handler.handle({ type: 'keyDown', key: 'Enter', code: 'NumpadEnter', keyCode: 13 });
    await handler.handle({
      type: 'keyDown',
      key: 'Enter',
      code: 'Enter',
      keyCode: 13,
      metaKey: true,
    });
    const downs = send.mock.calls
      .filter(
        ([method, params]) => method === 'Input.dispatchKeyEvent' && params?.type === 'keyDown',
      )
      .map(([, params]) => params);
    expect(downs[0]).toMatchObject({
      key: 'Enter',
      code: 'Enter',
      text: '\r',
      unmodifiedText: '\r',
    });
    expect(downs[1]).toMatchObject({ code: 'NumpadEnter', text: '\r', unmodifiedText: '\r' });
    expect(downs[2]).not.toHaveProperty('text');
  });

  it('does not insert text for keyboard shortcuts', async () => {
    const { handler, send } = handlerWithSend();

    await handler.handle({
      type: 'keyDown',
      key: 'c',
      code: 'KeyC',
      keyCode: 67,
      metaKey: true,
    });

    expect(send).toHaveBeenCalledWith('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'c',
      code: 'KeyC',
      windowsVirtualKeyCode: 67,
      modifiers: 4,
    });
  });

  it('dispatches the native select-all command for Meta+A', async () => {
    const { handler, send } = handlerWithSend();

    await handler.handle({
      type: 'keyDown',
      key: 'a',
      code: 'KeyA',
      keyCode: 65,
      metaKey: true,
    });

    expect(send).toHaveBeenCalledWith('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'a',
      code: 'KeyA',
      windowsVirtualKeyCode: 65,
      modifiers: 4,
      commands: ['selectAll'],
    });
  });

  it('clears a released modifier even when the DOM keyup still reports it pressed', async () => {
    const { handler, send } = handlerWithSend();

    await handler.handle({
      type: 'keyDown',
      key: 'Meta',
      code: 'MetaLeft',
      keyCode: 91,
      metaKey: true,
    });
    await handler.handle({
      type: 'keyUp',
      key: 'Meta',
      code: 'MetaLeft',
      keyCode: 91,
      metaKey: true,
    });

    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenLastCalledWith('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'Meta',
      code: 'MetaLeft',
      windowsVirtualKeyCode: 91,
      modifiers: 0,
    });
  });

  it('releases a stale Meta modifier before the next plain key when keyup was lost', async () => {
    const { handler, send } = handlerWithSend();
    // FIX-61: the typed-field marker (Runtime.evaluate) is interleaved; compare input calls only.
    const inputCalls = () => send.mock.calls.filter(([method]) => method !== 'Runtime.evaluate');

    await handler.handle({
      type: 'keyDown',
      key: 'Meta',
      code: 'MetaLeft',
      keyCode: 91,
      metaKey: true,
    });
    await handler.handle({
      type: 'keyDown',
      key: 'a',
      code: 'KeyA',
      keyCode: 65,
      metaKey: true,
    });
    await handler.handle({
      type: 'keyUp',
      key: 'a',
      code: 'KeyA',
      keyCode: 65,
      metaKey: true,
    });
    await handler.handle({
      type: 'keyDown',
      key: 'x',
      code: 'KeyX',
      keyCode: 88,
    });

    expect(inputCalls()[3]).toEqual([
      'Input.dispatchKeyEvent',
      {
        type: 'keyUp',
        key: 'Meta',
        code: 'MetaLeft',
        windowsVirtualKeyCode: 91,
        modifiers: 0,
      },
    ]);
    expect(inputCalls()[4]).toEqual([
      'Input.dispatchKeyEvent',
      {
        type: 'keyDown',
        key: 'x',
        code: 'KeyX',
        windowsVirtualKeyCode: 88,
        modifiers: 0,
        text: 'x',
        unmodifiedText: 'x',
      },
    ]);
  });
});

it('retains held buttons through a drag', async () => {
  const send = vi.fn(async (method: string) =>
    method === 'Runtime.evaluate' ? { result: { value: 1 } } : {},
  );
  const cdp = { send, detach: async () => {} } as unknown as CDPSession;
  const handler = new CdpInputHandler(() => cdp, pino({ level: 'silent' }));
  await handler.handle({ type: 'mouseDown', x: 10, y: 20, button: 'left' });
  await handler.handle({ type: 'mouseMove', x: 90, y: 20 });
  expect(send).toHaveBeenCalledWith(
    'Input.dispatchMouseEvent',
    expect.objectContaining({ type: 'mouseMoved', button: 'left', buttons: 1, x: 90 }),
  );
  await handler.handle({ type: 'mouseUp', x: 90, y: 20, button: 'left' });
  await handler.handle({ type: 'mouseMove', x: 100, y: 20 });
  expect(send).toHaveBeenLastCalledWith(
    'Input.dispatchMouseEvent',
    expect.objectContaining({ type: 'mouseMoved', buttons: 0 }),
  );
  send.mockClear();
  await handler.handle({ type: 'viewport', width: 390, height: 600, deviceScaleFactor: 100 });
  expect(send).not.toHaveBeenCalled();
});

// FIX-62 P0-1 (DEPLOY-61 第三次 单列 4): human input reaches only the document it was made on.
describe('CdpInputHandler document guard', () => {
  const recording = (
    evaluate: () => Promise<unknown> = async () => ({ result: { value: null } }),
  ) => {
    const effects: string[] = [];
    const session = {
      send: async (method: string, params: { type?: string }) => {
        if (method === 'Runtime.evaluate') return evaluate();
        effects.push(params.type ?? method);
      },
      detach: async () => undefined,
    } as unknown as CDPSession;
    return { effects, session };
  };
  const ENTER = { type: 'keyDown', key: 'Enter', code: 'Enter', keyCode: 13 } as const;
  const guardFor = (
    state: { revision: number; loader: string; entry?: number; pending?: boolean },
    fresh: () => Promise<string | null>,
  ) => {
    const checked = new WeakMap<object, { revision: number; loader: string }>();
    return {
      check: (m: object) => checked.set(m, { revision: state.revision, loader: state.loader }),
      guard: {
        expected: (m: object) => checked.get(m),
        revision: () => state.revision,
        loader: () => state.loader,
        freshLoader: fresh,
        entry: () => state.entry ?? 1,
        pending: () => state.pending ?? false,
        settled: async () => {
          state.pending = false;
        },
      },
    };
  };

  it('refuses an input whose revision changed since it was checked — no event, no uncertain outcome', async () => {
    const { effects, session } = recording();
    const uncertain = vi.fn();
    const handler = new CdpInputHandler(
      () => session,
      pino({ level: 'silent' }),
      undefined,
      uncertain,
    );
    const state = { revision: 5, loader: 'L1' };
    const g = guardFor(state, async () => state.loader);
    handler.setDocumentGuard(g.guard);
    const msg = { ...ENTER };
    g.check(msg);
    state.revision = 6;
    await expect(handler.handle(msg, new AbortController().signal)).rejects.toThrow(
      'browser_observation_expired',
    );
    expect(effects).toEqual([]);
    expect(uncertain).not.toHaveBeenCalled();
  });

  it('a navigation that commits while the document is being read is caught by the last check (复审 #1 #3)', async () => {
    const { effects, session } = recording();
    const handler = new CdpInputHandler(() => session, pino({ level: 'silent' }));
    const state = { revision: 5, loader: 'L1' };
    // The read's answer arrives after the navigation event was handled — as CDP orders them.
    const g = guardFor(state, async () => {
      state.revision = 6;
      state.loader = 'L2';
      return 'L2';
    });
    handler.setDocumentGuard(g.guard);
    const msg = { ...ENTER };
    g.check(msg);
    await expect(handler.handle(msg, new AbortController().signal)).rejects.toThrow(
      'browser_observation_expired',
    );
    expect(effects).toEqual([]);
  });

  it('a document that cannot be read in time (a JS dialog) refuses instead of hanging (复审 #1 #4)', async () => {
    const { effects, session } = recording();
    const handler = new CdpInputHandler(() => session, pino({ level: 'silent' }));
    const state = { revision: 5, loader: 'L1' };
    const g = guardFor(state, async () => null);
    handler.setDocumentGuard(g.guard);
    const msg = { type: 'mouseDown', x: 1, y: 1 } as const;
    g.check(msg);
    await expect(handler.handle(msg, new AbortController().signal)).rejects.toThrow(
      'browser_observation_expired',
    );
    expect(effects).toEqual([]);
  });

  it('a target lookup that never answers does not hold the input', async () => {
    const { effects, session } = recording(() => new Promise(() => undefined));
    const handler = new CdpInputHandler(() => session, pino({ level: 'silent' }));
    const state = { revision: 5, loader: 'L1' };
    const g = guardFor(state, async () => 'L1');
    handler.setDocumentGuard(g.guard);
    const msg = { type: 'mouseDown', x: 1, y: 1 } as const;
    g.check(msg);
    const started = Date.now();
    await handler.handle(msg, new AbortController().signal);
    expect(effects).toEqual(['mousePressed']);
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it('moves and ordinary key releases are not read fresh (one round trip saved each)', async () => {
    const { effects, session } = recording();
    const fresh = vi.fn(async () => 'L1');
    const handler = new CdpInputHandler(() => session, pino({ level: 'silent' }));
    const state = { revision: 5, loader: 'L1' };
    const g = guardFor(state, fresh);
    handler.setDocumentGuard(g.guard);
    const move = { type: 'mouseMove', x: 1, y: 1 } as const;
    const up = { type: 'keyUp', key: 'a', code: 'KeyA' } as const;
    g.check(move);
    g.check(up);
    await handler.handle(move, new AbortController().signal);
    await handler.handle(up, new AbortController().signal);
    expect(fresh).not.toHaveBeenCalled();
    expect(effects).toEqual(['mouseMoved', 'keyUp']);
  });

  it('a same-document navigation being classified is waited for, then judged (复审 #3 #1)', async () => {
    const { effects, session } = recording();
    // replaceState meanwhile: the read settles, no revision change → the letter goes through.
    const state = { revision: 5, loader: 'L1', pending: true };
    const handler = new CdpInputHandler(() => session, pino({ level: 'silent' }));
    const g = guardFor(state, async () => state.loader);
    handler.setDocumentGuard(g.guard);
    const letter = { type: 'keyDown', key: 'a', code: 'KeyA' } as const;
    g.check(letter);
    await handler.handle(letter, new AbortController().signal);
    expect(effects).toEqual(['keyDown']);
    // pushState meanwhile: the read retires the frames (revision bump) → refused.
    const handler2 = new CdpInputHandler(() => session, pino({ level: 'silent' }));
    const g2 = guardFor(state, async () => state.loader);
    handler2.setDocumentGuard({
      ...g2.guard,
      pending: () => true,
      settled: async () => {
        state.revision = 6;
      },
    });
    const enter = { ...ENTER };
    g2.check(enter);
    await expect(handler2.handle(enter, new AbortController().signal)).rejects.toThrow(
      'browser_observation_expired',
    );
    expect(effects).toEqual(['keyDown']);
  });

  it('a session swap clears held modifiers (restored after 复审 #2 C)', async () => {
    const effects: string[] = [];
    const mk = () =>
      ({
        send: async (method: string, params: { type?: string; key?: string }) => {
          if (method === 'Runtime.evaluate') return { result: { value: null } };
          effects.push(`${params.type}:${params.key ?? ''}`);
        },
        detach: async () => undefined,
      }) as unknown as CDPSession;
    let session = mk();
    const handler = new CdpInputHandler(() => session, pino({ level: 'silent' }));
    const signal = new AbortController().signal;
    await handler.handle(
      { type: 'keyDown', key: 'Shift', code: 'ShiftLeft', shiftKey: true },
      signal,
    );
    session = mk();
    await handler.handle({ type: 'keyDown', key: 'a', code: 'KeyA' }, signal);
    expect(effects).toEqual(['keyDown:Shift', 'keyDown:a']);
  });

  it('still undecided after the wait: an activating input is refused (复审 #4 #2)', async () => {
    const { effects, session } = recording();
    const state = { revision: 5, loader: 'L1' };
    const handler = new CdpInputHandler(() => session, pino({ level: 'silent' }));
    const g = guardFor(state, async () => state.loader);
    handler.setDocumentGuard({ ...g.guard, pending: () => true, settled: async () => undefined });
    const enter = { ...ENTER };
    g.check(enter);
    await expect(handler.handle(enter, new AbortController().signal)).rejects.toThrow(
      'browser_observation_expired',
    );
    // A letter is no activation: it waits, then goes.
    const letter = { type: 'keyDown', key: 'a', code: 'KeyA' } as const;
    g.check(letter);
    await handler.handle(letter, new AbortController().signal);
    expect(effects).toEqual(['keyDown']);
  });
});
