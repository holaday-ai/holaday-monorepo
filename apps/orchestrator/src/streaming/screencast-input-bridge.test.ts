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

describe('DeferredScreencastInputBridge', () => {
  it('requires the current owner lease before forwarding manual input', async () => {
    const control = new BrowserControl();
    const applied: InputMessage[] = [];
    const bridge = new DeferredScreencastInputBridge({
      runOwnedInput: (lease, action) => control.runHuman(lease ?? '', action),
    });
    await bridge.attach({
      handle: async (input) => {
        applied.push(input);
      },
    });
    const send = (controlLease?: string) =>
      bridge.receive(
        JSON.stringify({
          type: 'input',
          controlLease,
          payload: { type: 'insertText', text: '你好' },
        }),
      );
    await expect(send()).rejects.toThrow('browser_control_not_owned');
    control.requestHuman();
    await expect(send('unconfirmed')).rejects.toThrow('browser_control_not_owned');
    const parked = control.checkpoint(async () => undefined);
    const token = control.snapshot().lease ?? '';
    try {
      await send(token);
      control.returnToAgent(token);
      await expect(send(token)).rejects.toThrow('browser_control_not_owned');
      await parked;
      control.requestHuman();
      const next = control.checkpoint(async () => undefined);
      try {
        await expect(send(token)).rejects.toThrow('browser_control_not_owned');
      } finally {
        control.close();
        await next;
      }
      expect(applied).toEqual([{ type: 'insertText', text: '你好' }]);
    } finally {
      control.close();
      await parked;
    }
  });

  it('defers viewport changes to a settled runner boundary without granting clicks', async () => {
    const control = new BrowserControl();
    const applied: InputMessage[] = [];
    const bridge = new DeferredScreencastInputBridge({
      runOwnedInput: (lease, action) => control.runHuman(lease ?? '', action),
      queueViewport: (action) => control.queueViewport(action),
    });
    await bridge.receive(viewport(800, 600));
    await bridge.attach({
      handle: async (input) => {
        applied.push(input);
      },
    });
    await expect(
      bridge.receive(
        JSON.stringify({
          type: 'input',
          payload: { type: 'mouseDown', x: 5, y: 6 },
        }),
      ),
    ).rejects.toThrow('browser_control_not_owned');
    expect(control.snapshot().phase).toBe('agent');
    expect(applied).toEqual([]);
    await control.checkpoint(async () => undefined);
    expect(applied).toEqual([{ type: 'viewport', width: 800, height: 600 }]);
  });

  it('does not acknowledge a deferred viewport from a disconnected client', async () => {
    const control = new BrowserControl();
    const effects: string[] = [];
    const bridge = new DeferredScreencastInputBridge({
      queueViewport: (action) => control.queueViewport(action),
      onViewportApplied: () => effects.push('ack'),
    });
    await bridge.attach({
      handle: async () => {
        effects.push('resize');
      },
    });
    await bridge.receive(viewport(800, 600));
    bridge.detach();
    await control.checkpoint(async () => undefined);
    expect(effects).toEqual([]);
  });

  it('does not publish or remember invalid viewport dimensions', async () => {
    const effects: string[] = [];
    const bridge = new DeferredScreencastInputBridge({
      onViewportApplied: () => effects.push('ack'),
    });
    await bridge.receive(viewport(0, 600));
    await bridge.attach({
      handle: async () => {
        effects.push('resize');
      },
    });
    await bridge.reapplyViewport();
    expect(effects).toEqual([]);
  });

  it('drops queued old-connection input after detach and waits for active input before return', async () => {
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
      runOwnedInput: (lease, action) => control.runHuman(lease ?? '', action),
    });
    await bridge.attach({
      handle: async () => {
        applied.push('input-started');
        started();
        await pending;
        applied.push('input-ended');
      },
    });
    control.requestHuman();
    const parked = control.checkpoint(async () => {
      applied.push('observe');
    });
    const controlLease = control.snapshot().lease ?? '';
    const input = JSON.stringify({
      type: 'input',
      controlLease,
      payload: { type: 'insertText', text: 'x' },
    });
    const one = bridge.receive(input);
    const two = bridge.receive(input);
    await start;
    bridge.detach();
    control.returnToAgent(controlLease);
    try {
      expect(applied).toEqual(['input-started']);
    } finally {
      finish();
      await Promise.all([one, two, parked]);
    }
    expect(applied).toEqual(['input-started', 'input-ended', 'observe']);
  });

  it('replays the latest viewport received while the CDP streamer is starting', async () => {
    const handle = vi.fn<(message: InputMessage) => Promise<void>>().mockResolvedValue(undefined);
    const onViewportApplied = vi.fn();
    const bridge = new DeferredScreencastInputBridge({ onViewportApplied });

    await bridge.receive(viewport(430, 760));
    await bridge.receive(viewport(612, 844));
    await bridge.attach({ handle });

    expect(handle).toHaveBeenCalledTimes(1);
    expect(handle).toHaveBeenCalledWith(
      {
        type: 'viewport',
        width: 612,
        height: 844,
      },
      undefined,
    );
    expect(onViewportApplied).toHaveBeenCalledWith({ width: 612, height: 844 });
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
    await bridge.receive(viewport(700, 900));

    expect(handle).toHaveBeenCalledTimes(1);
    expect(handle).toHaveBeenCalledWith(
      {
        type: 'viewport',
        width: 700,
        height: 900,
      },
      undefined,
    );
  });

  it('reapplies the latest viewport after a renderer-changing navigation', async () => {
    const handle = vi.fn<(message: InputMessage) => Promise<void>>().mockResolvedValue(undefined);
    const onViewportApplied = vi.fn();
    const bridge = new DeferredScreencastInputBridge({ onViewportApplied });
    await bridge.attach({ handle });

    await bridge.receive(viewport(383, 1020));
    handle.mockClear();
    onViewportApplied.mockClear();

    await bridge.reapplyViewport();

    expect(handle).toHaveBeenCalledOnce();
    expect(handle).toHaveBeenCalledWith(
      {
        type: 'viewport',
        width: 383,
        height: 1020,
      },
      undefined,
    );
    expect(onViewportApplied).toHaveBeenCalledWith({ width: 383, height: 1020 });
  });
});
