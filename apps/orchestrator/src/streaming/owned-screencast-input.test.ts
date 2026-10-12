import { describe, expect, it, vi } from 'vitest';
import { browserControlSessions } from '../agent/supercar/browser-control-sessions.js';
import type { BrowserInstance } from '../browser-pool/types.js';
import { createOwnedScreencastInputBridge } from './owned-screencast-input.js';

describe('owned screencast input assembly', () => {
  it('shares the running control, rejecting unconfirmed input and a replaced pool instance', async () => {
    const instance = {
      taskId: 'tsk_input',
      userId: 'usr_owner',
      status: 'ready',
    } as BrowserInstance;
    let current = instance;
    const binding = browserControlSessions.start(instance);
    const effects: string[] = [];
    const bridge = createOwnedScreencastInputBridge({
      instance,
      peek: () => current,
      releasePressed: async () => {
        effects.push('release');
      },
    });
    await bridge.attach({
      handle: async () => {
        effects.push('input');
      },
    });
    const send = (controlLease?: string) =>
      bridge.receive(
        JSON.stringify({ type: 'input', controlLease, payload: { type: 'insertText', text: 'x' } }),
      );
    await expect(send()).rejects.toThrow();
    binding.control.requestHuman();
    const parked = binding.control.checkpoint(async () => undefined);
    const token = binding.control.snapshot().lease ?? '';
    await send(token);
    binding.control.returnToAgent(token);
    await parked;
    expect(effects).toEqual(['input', 'release']);
    current = { ...instance };
    await expect(send(token)).rejects.toThrow('browser_session_changed');
    expect(effects).toEqual(['input', 'release']);
    binding.control.close();
    await parked;
    binding.finish();
  });

  it('does not apply layout changes outside the actual runner checkpoint', async () => {
    const instance = {
      taskId: 'tsk_resize',
      userId: 'usr_owner',
      status: 'ready',
    } as BrowserInstance;
    const binding = browserControlSessions.start(instance);
    const effects: string[] = [];
    const bridge = createOwnedScreencastInputBridge({
      instance,
      peek: () => instance,
      onViewportApplied: () => effects.push('ack'),
    });
    await bridge.attach({
      handle: async () => {
        effects.push('resize');
      },
    });
    await bridge.receive(
      JSON.stringify({ type: 'input', payload: { type: 'viewport', width: 800, height: 600 } }),
    );
    expect(effects).toEqual([]);
    await binding.control.checkpoint(async () => {
      effects.push('observe');
    });
    expect(effects).toEqual(['resize', 'ack', 'observe']);
    binding.finish();
  });
  it('floors a canary panel resize to the real execution viewport', async () => {
    const instance = {
      taskId: 'tsk_small_canary',
      userId: 'usr_canary',
      status: 'ready',
      capabilities: { viewportV2: true, observationV2: true, replayV1: true, routingV2: true },
    } as BrowserInstance;
    vi.stubEnv('BROWSER_V2_CANARY_USER_IDS', 'usr_canary');
    const binding = browserControlSessions.start(instance);
    const sizes: unknown[] = [];
    const bridge = createOwnedScreencastInputBridge({ instance, peek: () => instance });
    await bridge.attach({
      handle: async (envelope) => {
        sizes.push(envelope);
      },
    });
    try {
      await bridge.receive(
        JSON.stringify({ type: 'input', payload: { type: 'viewport', width: 500, height: 679 } }),
      );
      await binding.control.checkpoint(async () => undefined);
      expect(JSON.stringify(sizes)).toContain('1280');
      expect(JSON.stringify(sizes)).toContain('800');
    } finally {
      binding.finish();
      vi.unstubAllEnvs();
    }
  });
});
