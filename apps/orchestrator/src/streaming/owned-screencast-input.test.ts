import { describe, expect, it } from 'vitest';
import { browserControlSessions } from '../agent/supercar/browser-control-sessions.js';
import type { BrowserInstance } from '../browser-pool/types.js';
import { createOwnedScreencastInputBridge } from './owned-screencast-input.js';

const text = (value: string) =>
  JSON.stringify({ type: 'input', payload: { type: 'insertText', text: value } });

describe('owned screencast input assembly (REBUILD-4 共同操作)', () => {
  it('routes input through the running control with no lease, rejecting a replaced pool instance', async () => {
    const instance = {
      taskId: 'tsk_input',
      userId: 'usr_owner',
      status: 'ready',
    } as BrowserInstance;
    let current = instance;
    const binding = browserControlSessions.start(instance);
    const effects: string[] = [];
    const bridge = createOwnedScreencastInputBridge({ instance, peek: () => current });
    await bridge.attach({
      handle: async () => {
        effects.push('input');
      },
    });
    try {
      await bridge.receive(text('x'));
      expect(effects).toEqual(['input']);
      // The person's input is recorded on the running control: the assistant yields to it.
      expect(binding.control.humanInputLog().count).toBe(1);
      expect(binding.control.humanBusy()).toBe(true);
      expect(binding.control.snapshot()).toEqual({ phase: 'agent', lease: null, error: null });
      current = { ...instance };
      await expect(bridge.receive(text('y'))).rejects.toThrow('browser_session_changed');
      expect(effects).toEqual(['input']);
    } finally {
      binding.finish();
    }
  });

  it('after the run finished, input goes through a fresh open review control', async () => {
    const instance = {
      taskId: 'tsk_review',
      userId: 'usr_owner',
      status: 'ready',
    } as BrowserInstance;
    const binding = browserControlSessions.start(instance);
    binding.finish();
    const effects: string[] = [];
    const bridge = createOwnedScreencastInputBridge({ instance, peek: () => instance });
    await bridge.attach({
      handle: async () => {
        effects.push('input');
      },
    });
    await bridge.receive(text('x'));
    expect(effects).toEqual(['input']);
    const review = browserControlSessions.openForViewer(instance);
    expect(review?.control).not.toBe(binding.control);
    expect(review?.control.humanInputLog().count).toBe(1);
    review?.control.close();
  });

  it('refuses input when no run bound the browser, or the browser is not ready', async () => {
    const instance = {
      taskId: 'tsk_unbound',
      userId: 'usr_owner',
      status: 'ready',
    } as BrowserInstance;
    const effects: string[] = [];
    const bridge = createOwnedScreencastInputBridge({ instance, peek: () => instance });
    await bridge.attach({
      handle: async () => {
        effects.push('input');
      },
    });
    await expect(bridge.receive(text('x'))).rejects.toThrow('browser_control_unavailable');
    const binding = browserControlSessions.start(instance);
    (instance as { status: string }).status = 'stopping';
    await expect(bridge.receive(text('x'))).rejects.toThrow('browser_session_changed');
    expect(effects).toEqual([]);
    binding.finish();
  });

  it('ignores a viewport message: nothing is resized and nothing is recorded', async () => {
    const instance = {
      taskId: 'tsk_resize',
      userId: 'usr_owner',
      status: 'ready',
    } as BrowserInstance;
    const binding = browserControlSessions.start(instance);
    const effects: string[] = [];
    const bridge = createOwnedScreencastInputBridge({ instance, peek: () => instance });
    await bridge.attach({
      handle: async (message) => {
        effects.push(message.type);
      },
    });
    await bridge.receive(
      JSON.stringify({ type: 'input', payload: { type: 'viewport', width: 800, height: 600 } }),
    );
    expect(effects).toEqual([]);
    expect(binding.control.humanBusy()).toBe(false);
    binding.finish();
  });
});
