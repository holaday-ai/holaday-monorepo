import { describe, expect, it } from 'vitest';
import { BrowserControlSessions } from './browser-control-sessions.js';

describe('task browser control sessions', () => {
  it('waits for an already accepted legacy input before binding a controlled runner', () => {
    const sessions = new BrowserControlSessions();
    const executor = {};
    const instance = { taskId: 'legacy', userId: 'owner', executor };
    const release = sessions.beginLegacyInput(executor);
    expect(() => sessions.start(instance)).toThrow('browser_legacy_input_active');
    release();
    release();
    const binding = sessions.start(instance);
    expect(() => sessions.beginLegacyInput(executor)).toThrow('browser_control_requires_cdp');
    binding.finish();
  });
  it('does not allow a raw VNC connection and a controlled runner to share an instance', () => {
    const sessions = new BrowserControlSessions();
    const raw = { taskId: 'raw', userId: 'owner' };
    sessions.claimLegacyVnc(raw);
    expect(() => sessions.start(raw)).toThrow('browser_legacy_transport');
    const controlled = { taskId: 'controlled', userId: 'owner' };
    const binding = sessions.start(controlled);
    expect(() => sessions.claimLegacyVnc(controlled)).toThrow('browser_control_requires_cdp');
    binding.finish();
  });
  it('binds one running owner to the exact pool instance and rejects duplicate runners', () => {
    const sessions = new BrowserControlSessions();
    const instance = { taskId: 'task', userId: 'owner' };
    const binding = sessions.start(instance);
    expect(sessions.get(instance, 'other', 'task')).toBeNull();
    expect(sessions.get(instance, 'owner', 'other')).toBeNull();
    expect(sessions.get({ ...instance }, 'owner', 'task')).toBeNull();
    expect(sessions.get(instance, 'owner', 'task')?.control).toBe(binding.control);
    expect(() => sessions.start(instance)).toThrow('browser_runner_active');
    binding.finish();
  });

  it('does not convert a running task into terminal review or reuse its old lease', async () => {
    const sessions = new BrowserControlSessions();
    const instance = { taskId: 'task', userId: 'owner' };
    const first = sessions.start(instance);
    expect(() => sessions.review(instance)).toThrow('browser_runner_active');
    first.control.requestHuman();
    const parked = first.control.checkpoint(async () => undefined);
    const old = first.control.snapshot().lease ?? '';
    first.control.close();
    await parked;
    first.finish();
    const review = sessions.review(instance);
    expect(review.control.snapshot().phase).toBe('human');
    await expect(review.control.runHuman(old, async () => undefined)).rejects.toThrow();
    review.control.close();
  });

  it('only a positive physical stop receipt releases an unresolved input', async () => {
    const sessions = new BrowserControlSessions();
    const instance = { taskId: 'task', userId: 'owner' };
    const binding = sessions.start(instance);
    binding.control.requestHuman();
    const parked = binding.control.checkpoint(async () => undefined);
    const input = binding.control.runHuman(
      binding.control.snapshot().lease ?? '',
      async () => new Promise<void>(() => {}),
    );
    const rejected = expect(input).rejects.toThrow('browser_input_outcome_unknown');
    await Promise.resolve();
    await sessions.quarantine(instance, async () => false);
    let settled = false;
    void parked.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(() => sessions.review(instance)).toThrow();
    await sessions.quarantine(instance, async () => true);
    await rejected;
    expect(await parked).toMatchObject({ resumed: false });
    binding.finish();
    expect(() => sessions.review(instance)).toThrow('browser_input_outcome_unknown');
  });
});
