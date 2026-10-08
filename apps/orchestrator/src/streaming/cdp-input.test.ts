import { pino } from 'pino';
import type { CDPSession, Page } from 'playwright';
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

  it('releases held keys and mouse buttons before AI can observe the handed-back page', async () => {
    const effects: string[] = [];
    const session = {
      send: async (_method: string, params: { type?: string }) => {
        effects.push(params.type ?? 'other');
      },
      detach: async () => undefined,
    } as unknown as CDPSession;
    const handler = new CdpInputHandler(() => session, pino({ level: 'silent' }));
    const control = new BrowserControl();
    control.requestHuman();
    const parked = control.checkpoint(async () => {
      effects.push('observe');
    });
    control.beforeHandback((signal) => handler.releasePressed(signal));
    const lease = control.snapshot().lease ?? '';
    await control.runHuman(lease, (signal) =>
      handler.handle({ type: 'keyDown', key: 'a', code: 'KeyA' }, signal),
    );
    await control.runHuman(lease, (signal) =>
      handler.handle({ type: 'mouseDown', x: 20, y: 30 }, signal),
    );
    control.returnToAgent(lease);
    await parked;
    expect(effects).toEqual(['keyDown', 'mousePressed', 'keyUp', 'mouseReleased', 'observe']);
  });
  it('revokes the lease at timeout even when the transport cannot confirm detach', async () => {
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
    control.requestHuman();
    let observed = false;
    const parked = control.checkpoint(async () => {
      observed = true;
    });
    const token = control.snapshot().lease ?? '';
    const input = control.runHuman(token, (signal) =>
      handler.handle({ type: 'insertText', text: 'x' }, signal),
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
      expect(observed).toBe(false);
      await expect(control.runHuman(token, async () => undefined)).rejects.toThrow(
        'browser_control_not_owned',
      );
    } finally {
      control.close();
      rejectSend(new Error('test transport closed'));
      await result;
      await parked;
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
      runOwnedInput: (lease, action) => control.runHuman(lease ?? '', action),
    });
    await bridge.attach(handler);
    control.requestHuman();
    const parked = control.checkpoint(async () => {
      effects.push('observe');
    });
    const input = bridge.receive(
      JSON.stringify({
        type: 'input',
        controlLease: control.snapshot().lease,
        payload: { type: 'insertText', text: 'x' },
      }),
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
      expect(await parked).toMatchObject({ resumed: false });
      expect(effects).toEqual(['dispatch', 'detached']);
      expect(control.snapshot().error).toBe('input_outcome_unknown');
    } finally {
      rejectSend(new Error('test cleanup'));
      await rejected;
      await parked;
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

describe('CdpInputHandler responsive viewport', () => {
  it('reflows the remote page to the visible browser workspace', async () => {
    const { handler, send } = handlerWithSend();

    await handler.handle({ type: 'viewport', width: 612, height: 844 });

    expect(send).toHaveBeenCalledWith('Emulation.setDeviceMetricsOverride', {
      width: 612,
      height: 844,
      deviceScaleFactor: 1,
      mobile: false,
      screenWidth: 612,
      screenHeight: 844,
    });
  });

  it('drops invalid or abusive viewport messages', async () => {
    const { handler, send } = handlerWithSend();

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

    expect(send).toHaveBeenNthCalledWith(4, 'Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'Meta',
      code: 'MetaLeft',
      windowsVirtualKeyCode: 91,
      modifiers: 0,
    });
    expect(send).toHaveBeenNthCalledWith(5, 'Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'x',
      code: 'KeyX',
      windowsVirtualKeyCode: 88,
      modifiers: 0,
      text: 'x',
      unmodifiedText: 'x',
    });
  });
});

it('V2 viewport resize preserves the current remote DPR instead of silently resetting to one', async()=>{
 const send=vi.fn(async(method:string)=>method==='Runtime.evaluate'?{result:{value:2}}:{});
 const handler=new CdpInputHandler(()=>({send,detach:async()=>{}} as unknown as CDPSession),pino({level:'silent'}),undefined,undefined,true);
 await handler.handle({type:'viewport',width:1600,height:900});
 expect(send).toHaveBeenCalledWith('Emulation.setDeviceMetricsOverride',expect.objectContaining({width:1600,height:900,deviceScaleFactor:2,mobile:false}));
});

it('V2 reconnect restores the same Page DPR after a parallel CDP detach reset',async()=>{
 const page={} as Page;
 for(const ratio of [2,1]) {
  const send=vi.fn(async(method:string)=>method==='Runtime.evaluate'?{result:{value:ratio}}:{});
  const h=new CdpInputHandler(()=>({send,detach:async()=>{}} as unknown as CDPSession),pino({level:'silent'}),undefined,undefined,true,async()=>page);
  await h.handle({type:'viewport',width:1600,height:900});
  expect(send).toHaveBeenCalledWith('Emulation.setDeviceMetricsOverride',expect.objectContaining({deviceScaleFactor:2}));
 }
});


it('applies tall V2 device metrics while retaining legacy and maximum bounds',async()=>{
 const send=vi.fn(async(method:string)=>method==='Runtime.evaluate'?{result:{value:1}}:{});
 const session=()=>({send,detach:async()=>{}} as unknown as CDPSession);
 await new CdpInputHandler(session,pino({level:'silent'})).handle({type:'viewport',width:1024,height:2300});expect(send).not.toHaveBeenCalled();
 const v2=new CdpInputHandler(session,pino({level:'silent'}),undefined,undefined,true,undefined,2400);
 await v2.handle({type:'viewport',width:1024,height:2300});expect(send).toHaveBeenCalledWith('Emulation.setDeviceMetricsOverride',expect.objectContaining({width:1024,height:2300,mobile:false}));
 const before=send.mock.calls.length;await v2.handle({type:'viewport',width:1024,height:2401});expect(send).toHaveBeenCalledTimes(before);
});
