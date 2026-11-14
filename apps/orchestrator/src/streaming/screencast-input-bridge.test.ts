import { describe, expect, it, vi } from 'vitest';
import { BrowserControl } from '../agent/supercar/browser-control.js';
import type { InputMessage } from './cdp-input.js';
import { DeferredScreencastInputBridge } from './screencast-input-bridge.js';

function viewport(width: number, height: number): string {
  return JSON.stringify({
    type: 'input',
    payload: { type: 'viewport', width, height },
  });
}

describe('DeferredScreencastInputBridge (REBUILD-4 共同操作)', () => {
  it('forwards the person’s input through runOwnedInput with no lease', async () => {
    const control = new BrowserControl();
    const applied: InputMessage[] = [];
    const kinds: string[] = [];
    const bridge = new DeferredScreencastInputBridge({
      runOwnedInput: (action, kind) => {
        kinds.push(kind);
        return control.runHuman(action, kind === 'viewport' ? undefined : kind);
      },
    });
    await bridge.attach({
      handle: async (input) => {
        applied.push(input);
      },
    });
    await bridge.receive(
      JSON.stringify({ type: 'input', payload: { type: 'insertText', text: '你好' } }),
    );
    // An old client may still send a lease: it is ignored, never required.
    await bridge.receive(
      JSON.stringify({
        type: 'input',
        controlLease: 'stale',
        payload: { type: 'mouseDown', x: 5, y: 6, button: 'left' },
      }),
    );
    expect(applied).toEqual([
      { type: 'insertText', text: '你好' },
      { type: 'mouseDown', x: 5, y: 6, button: 'left' },
    ]);
    expect(kinds).toEqual(['insertText', 'mouseDown']);
    expect(control.humanInputLog().count).toBe(2);
    expect(control.snapshot()).toEqual({ phase: 'agent', lease: null, error: null });
  });

  it('ignores a viewport message: it never reaches the sink, runOwnedInput or the receipt hook', async () => {
    const handle = vi.fn<(message: InputMessage) => Promise<void>>().mockResolvedValue(undefined);
    const runOwnedInput = vi.fn(async (action: (signal: AbortSignal) => Promise<void>) =>
      action(new AbortController().signal),
    );
    const onInputReceived = vi.fn(() => undefined);
    const bridge = new DeferredScreencastInputBridge({ runOwnedInput, onInputReceived });
    await bridge.receive(viewport(612, 844));
    await bridge.attach({ handle });
    await bridge.receive(viewport(430, 760));
    await bridge.receive(viewport(1024, 2300));
    expect(handle).not.toHaveBeenCalled();
    expect(runOwnedInput).not.toHaveBeenCalled();
    expect(onInputReceived).not.toHaveBeenCalled();
    await bridge.receive(
      JSON.stringify({ type: 'input', payload: { type: 'mouseMove', x: 1, y: 2 } }),
    );
    expect(handle).toHaveBeenCalledOnce();
    expect(handle).toHaveBeenCalledWith({ type: 'mouseMove', x: 1, y: 2 }, expect.any(AbortSignal));
  });

  it('a closed control refuses the input', async () => {
    const control = new BrowserControl();
    const handle = vi.fn(async () => {});
    const bridge = new DeferredScreencastInputBridge({
      runOwnedInput: (action) => control.runHuman(action, 'mouseDown'),
    });
    await bridge.attach({ handle });
    control.close();
    await expect(
      bridge.receive(JSON.stringify({ type: 'input', payload: { type: 'mouseDown', x: 5, y: 6 } })),
    ).rejects.toThrow('browser_control_closed');
    expect(handle).not.toHaveBeenCalled();
  });

  it('drops queued old-connection input after detach and lets the active input finish', async () => {
    const control = new BrowserControl();
    let finish!: () => void;
    let started!: () => void;
    const start = new Promise<void>((resolve) => {
      started = resolve;
    });
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const applied: string[] = [];
    const bridge = new DeferredScreencastInputBridge({
      runOwnedInput: (action, kind) =>
        control.runHuman(action, kind === 'viewport' ? undefined : kind),
    });
    await bridge.attach({
      handle: async () => {
        applied.push('input-started');
        started();
        await pending;
        applied.push('input-ended');
      },
    });
    const input = JSON.stringify({ type: 'input', payload: { type: 'insertText', text: 'x' } });
    const one = bridge.receive(input);
    const two = bridge.receive(input);
    await start;
    bridge.detach();
    try {
      expect(applied).toEqual(['input-started']);
    } finally {
      finish();
      await Promise.all([one, two]);
    }
    expect(applied).toEqual(['input-started', 'input-ended']);
    await control.settled();
  });

  it('runs inputs in the order received', async () => {
    const control = new BrowserControl();
    const applied: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const bridge = new DeferredScreencastInputBridge({
      runOwnedInput: (action, kind) =>
        control.runHuman(action, kind === 'viewport' ? undefined : kind),
    });
    await bridge.attach({
      handle: async (input) => {
        if (input.type === 'mouseDown') await gate;
        applied.push(input.type);
      },
    });
    const down = bridge.receive(
      JSON.stringify({ type: 'input', payload: { type: 'mouseDown', x: 1, y: 1 } }),
    );
    const up = bridge.receive(
      JSON.stringify({ type: 'input', payload: { type: 'mouseUp', x: 1, y: 1 } }),
    );
    const text = bridge.receive(
      JSON.stringify({ type: 'input', payload: { type: 'insertText', text: 'a' } }),
    );
    await Promise.resolve();
    expect(applied).toEqual([]);
    release();
    await Promise.all([down, up, text]);
    expect(applied).toEqual(['mouseDown', 'mouseUp', 'insertText']);
  });

  it('drops stale pointer input before attach and forwards live input afterward', async () => {
    const handle = vi.fn<(message: InputMessage) => Promise<void>>().mockResolvedValue(undefined);
    const bridge = new DeferredScreencastInputBridge();

    await bridge.receive(
      JSON.stringify({
        type: 'input',
        payload: { type: 'mouseDown', x: 24, y: 18, button: 'left' },
      }),
    );
    await bridge.attach({ handle });
    await bridge.receive(
      JSON.stringify({
        type: 'input',
        payload: { type: 'mouseMove', x: 32, y: 40 },
      }),
    );

    expect(handle).toHaveBeenCalledTimes(1);
    expect(handle).toHaveBeenCalledWith({ type: 'mouseMove', x: 32, y: 40 }, undefined);
  });

  it('ignores malformed envelopes without breaking the next valid message', async () => {
    const handle = vi.fn<(message: InputMessage) => Promise<void>>().mockResolvedValue(undefined);
    const bridge = new DeferredScreencastInputBridge();
    await bridge.attach({ handle });

    await bridge.receive('{broken');
    await bridge.receive(JSON.stringify({ type: 'not-input' }));
    await bridge.receive(JSON.stringify({ type: 'input' }));
    await bridge.receive(JSON.stringify({ type: 'input', payload: { type: 'keyDown', key: 'a' } }));

    expect(handle).toHaveBeenCalledTimes(1);
    expect(handle).toHaveBeenCalledWith({ type: 'keyDown', key: 'a' }, undefined);
  });

  it('calls the FIX-62 receipt hook around each input, even when the sink is missing', async () => {
    const events: string[] = [];
    const bridge = new DeferredScreencastInputBridge({
      onInputReceived: (envelope) => {
        events.push(`received:${envelope.payload?.type}`);
        return () => events.push('settled');
      },
    });
    await bridge.receive(
      JSON.stringify({ type: 'input', payload: { type: 'mouseDown', x: 1, y: 1 } }),
    );
    await bridge.attach({
      handle: async (input) => {
        events.push(`handled:${input.type}`);
      },
    });
    await bridge.receive(
      JSON.stringify({ type: 'input', payload: { type: 'insertText', text: 'a' } }),
    );
    expect(events).toEqual([
      'received:mouseDown',
      'settled',
      'received:insertText',
      'handled:insertText',
      'settled',
    ]);
  });
});

it('checks current observation within the owned dispatch checkpoint, after queue delay', async () => {
  let live = true;
  let queued: (() => Promise<void>) | null = null;
  let effects = 0;
  const bridge = new DeferredScreencastInputBridge({
    beforeDispatch: async () => {
      if (!live) throw new Error('expired');
    },
    runOwnedInput: async (action) => {
      queued = () => action(new AbortController().signal);
    },
  });
  await bridge.attach({
    handle: async () => {
      effects++;
    },
  });
  await bridge.receive(
    JSON.stringify({
      type: 'input',
      payload: { type: 'mouseDown', x: 100, y: 100 },
    }),
  );
  live = false;
  await expect(queued!()).rejects.toThrow('expired');
  expect(effects).toBe(0);
});
