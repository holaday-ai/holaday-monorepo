import { describe, expect, it, vi } from 'vitest';
import type { InputMessage } from './cdp-input.js';
import { DeferredScreencastInputBridge } from './screencast-input-bridge.js';

function viewport(width: number, height: number): string {
  return JSON.stringify({
    type: 'input',
    payload: { type: 'viewport', width, height },
  });
}

describe('DeferredScreencastInputBridge', () => {
  it('replays the latest viewport received while the CDP streamer is starting', async () => {
    const handle = vi.fn<(message: InputMessage) => Promise<void>>()
      .mockResolvedValue(undefined);
    const onViewportApplied = vi.fn();
    const bridge = new DeferredScreencastInputBridge({ onViewportApplied });

    await bridge.receive(viewport(430, 760));
    await bridge.receive(viewport(612, 844));
    await bridge.attach({ handle });

    expect(handle).toHaveBeenCalledTimes(1);
    expect(handle).toHaveBeenCalledWith({
      type: 'viewport',
      width: 612,
      height: 844,
    });
    expect(onViewportApplied).toHaveBeenCalledWith({ width: 612, height: 844 });
  });

  it('drops stale pointer input before attach and forwards live input afterward', async () => {
    const handle = vi.fn<(message: InputMessage) => Promise<void>>()
      .mockResolvedValue(undefined);
    const bridge = new DeferredScreencastInputBridge();

    await bridge.receive(JSON.stringify({
      type: 'input',
      payload: { type: 'mouseDown', x: 24, y: 18, button: 'left' },
    }));
    await bridge.attach({ handle });
    await bridge.receive(JSON.stringify({
      type: 'input',
      payload: { type: 'mouseMove', x: 32, y: 40 },
    }));

    expect(handle).toHaveBeenCalledTimes(1);
    expect(handle).toHaveBeenCalledWith({ type: 'mouseMove', x: 32, y: 40 });
  });

  it('ignores malformed envelopes without breaking the next valid message', async () => {
    const handle = vi.fn<(message: InputMessage) => Promise<void>>()
      .mockResolvedValue(undefined);
    const bridge = new DeferredScreencastInputBridge();
    await bridge.attach({ handle });

    await bridge.receive('{broken');
    await bridge.receive(JSON.stringify({ type: 'not-input' }));
    await bridge.receive(viewport(700, 900));

    expect(handle).toHaveBeenCalledTimes(1);
    expect(handle).toHaveBeenCalledWith({
      type: 'viewport',
      width: 700,
      height: 900,
    });
  });

  it('reapplies the latest viewport after a renderer-changing navigation', async () => {
    const handle = vi.fn<(message: InputMessage) => Promise<void>>()
      .mockResolvedValue(undefined);
    const onViewportApplied = vi.fn();
    const bridge = new DeferredScreencastInputBridge({ onViewportApplied });
    await bridge.attach({ handle });

    await bridge.receive(viewport(383, 1020));
    handle.mockClear();
    onViewportApplied.mockClear();

    await bridge.reapplyViewport();

    expect(handle).toHaveBeenCalledOnce();
    expect(handle).toHaveBeenCalledWith({
      type: 'viewport',
      width: 383,
      height: 1020,
    });
    expect(onViewportApplied).toHaveBeenCalledWith({ width: 383, height: 1020 });
  });
});
