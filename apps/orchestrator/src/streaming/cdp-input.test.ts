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

// HOTFIX-R4A（协调方改）: the person's input is delivered like a remote desktop's; only an Enter /
// Space within 300 ms of a cross-document navigation is dropped.
describe('CdpInputHandler navigation guard', () => {
  const recording = (
    evaluate: () => Promise<unknown> = async () => ({ result: { value: null } }),
  ) => {
    const effects: string[] = [];
    const session = {
      send: async (method: string, params: { type?: string; key?: string }) => {
        if (method === 'Runtime.evaluate') return evaluate();
        effects.push(`${params.type ?? method}${params.key ? `:${params.key}` : ''}`);
      },
      detach: async () => undefined,
    } as unknown as CDPSession;
    return { effects, session };
  };
  const ENTER = { type: 'keyDown', key: 'Enter', code: 'Enter', keyCode: 13 } as const;
  const ENTER_UP = { type: 'keyUp', key: 'Enter', code: 'Enter', keyCode: 13 } as const;
  const SPACE = { type: 'keyDown', key: ' ', code: 'Space', keyCode: 32 } as const;

  it('long after a navigation every input goes through — presses, Enter, Space, letters', async () => {
    const { effects, session } = recording();
    const handler = new CdpInputHandler(() => session, pino({ level: 'silent' }));
    handler.setNavigationGuard({ lastNavigationAt: () => performance.now() - 5_000 });
    const signal = new AbortController().signal;
    await handler.handle({ type: 'mouseDown', x: 5, y: 5 }, signal);
    await handler.handle({ type: 'mouseUp', x: 5, y: 5 }, signal);
    await handler.handle({ ...ENTER }, signal);
    await handler.handle({ ...ENTER_UP }, signal);
    await handler.handle({ ...SPACE }, signal);
    await handler.handle({ type: 'keyDown', key: 'a', code: 'KeyA' }, signal);
    expect(effects).toEqual([
      'mousePressed',
      'mouseReleased',
      'keyDown:Enter',
      'keyUp:Enter',
      'keyDown: ',
      'keyDown:a',
    ]);
  });

  it('within 300 ms of a navigation: Enter / Space are dropped with their key-ups; clicks and letters are not', async () => {
    const { effects, session } = recording();
    const handler = new CdpInputHandler(() => session, pino({ level: 'silent' }));
    handler.setNavigationGuard({ lastNavigationAt: () => performance.now() - 100 });
    const signal = new AbortController().signal;
    await expect(handler.handle({ ...ENTER }, signal)).rejects.toThrow(
      'browser_page_just_navigated',
    );
    await handler.handle({ ...ENTER_UP }, signal); // quietly dropped: its key-down was
    await expect(handler.handle({ ...SPACE }, signal)).rejects.toThrow(
      'browser_page_just_navigated',
    );
    await handler.handle({ type: 'mouseDown', x: 5, y: 5 }, signal);
    await handler.handle({ type: 'mouseUp', x: 5, y: 5 }, signal);
    await handler.handle({ type: 'keyDown', key: 'a', code: 'KeyA' }, signal);
    expect(effects).toEqual(['mousePressed', 'mouseReleased', 'keyDown:a']);
  });

  it('a pushState being classified is waited for (bounded) before an Enter is judged', async () => {
    const { effects, session } = recording();
    const handler = new CdpInputHandler(() => session, pino({ level: 'silent' }));
    let navigatedAt = 0;
    let pending = true;
    handler.setNavigationGuard({
      lastNavigationAt: () => navigatedAt,
      pending: () => pending,
      settled: async () => {
        // The read finds a new history entry: a navigation, timed at its event.
        navigatedAt = performance.now() - 50;
        pending = false;
      },
    });
    await expect(handler.handle({ ...ENTER }, new AbortController().signal)).rejects.toThrow(
      'browser_page_just_navigated',
    );
    expect(effects).toEqual([]);
  });

  it('复审 P2-1: an Enter that arrived before the page left, and waited behind other input, is still dropped', async () => {
    const { effects, session } = recording();
    const handler = new CdpInputHandler(() => session, pino({ level: 'silent' }));
    const enter = { ...ENTER };
    const arrived = performance.now() - 2_000; // queued for 2 s
    handler.setNavigationGuard({
      lastNavigationAt: () => arrived + 1_000, // the page left while it waited
      receivedAt: (m) => (m === enter ? arrived : undefined),
    });
    await expect(handler.handle(enter, new AbortController().signal)).rejects.toThrow(
      'browser_page_just_navigated',
    );
    expect(effects).toEqual([]);
  });

  it("复审 P2-3: an auto-repeated Enter dropped after the page left keeps the first one's release", async () => {
    const { effects, session } = recording();
    const handler = new CdpInputHandler(() => session, pino({ level: 'silent' }));
    let navigatedAt = 0;
    handler.setNavigationGuard({ lastNavigationAt: () => navigatedAt });
    const signal = new AbortController().signal;
    await handler.handle({ ...ENTER }, signal); // sent; it makes the page leave
    navigatedAt = performance.now();
    await expect(handler.handle({ ...ENTER }, signal)).rejects.toThrow(
      'browser_page_just_navigated',
    ); // the repeat
    await handler.handle({ ...ENTER_UP }, signal); // the held key is released
    expect(effects).toEqual(['keyDown:Enter', 'keyUp:Enter']);
  });

  it('a release of a button the browser does not hold is dropped (no lone mouse-up)', async () => {
    const { effects, session } = recording();
    const handler = new CdpInputHandler(() => session, pino({ level: 'silent' }));
    handler.setNavigationGuard({ lastNavigationAt: () => 0 });
    await handler.handle({ type: 'mouseUp', x: 5, y: 5 }, new AbortController().signal);
    expect(effects).toEqual([]);
  });

  it('a target lookup that never answers does not hold the input', async () => {
    const { effects, session } = recording(() => new Promise(() => {}));
    const handler = new CdpInputHandler(() => session, pino({ level: 'silent' }));
    handler.setNavigationGuard({ lastNavigationAt: () => 0 });
    await handler.handle({ type: 'mouseDown', x: 5, y: 5 }, new AbortController().signal);
    expect(effects).toEqual(['mousePressed']);
  }, 5000);

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
});
