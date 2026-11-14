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

  it('does not convert a running task into terminal review; a finished run gets a fresh open control', async () => {
    const sessions = new BrowserControlSessions();
    const instance = { taskId: 'task', userId: 'owner' };
    const first = sessions.start(instance);
    expect(() => sessions.review(instance)).toThrow('browser_runner_active');
    first.finish();
    expect(first.control.snapshot().phase).toBe('closed');
    const review = sessions.review(instance);
    expect(review.control).not.toBe(first.control);
    expect(review.control.snapshot()).toEqual({ phase: 'agent', lease: null, error: null });
    // REBUILD-4: no lease — the person just uses the finished task's browser.
    expect(await review.control.runHuman(async () => 'typed', 'insertText')).toBe('typed');
    // The open review control is reused while it is open.
    expect(sessions.review(instance)).toBe(review);
    review.control.close();
    expect(sessions.review(instance).control).not.toBe(review.control);
  });

  it('openForViewer: the running control, then a fresh review control, null when never bound', async () => {
    const sessions = new BrowserControlSessions();
    const instance = { taskId: 'task', userId: 'owner' };
    expect(sessions.openForViewer(instance)).toBeNull();
    const run = sessions.start(instance);
    const running = sessions.openForViewer(instance);
    expect(running?.control).toBe(run.control);
    expect(running?.active).toBe(true);
    run.finish();
    const review = sessions.openForViewer(instance);
    expect(review).not.toBeNull();
    expect(review?.control).not.toBe(run.control);
    expect(review?.active).toBe(false);
    expect(review?.control.snapshot().phase).toBe('agent');
    expect(sessions.openForViewer(instance)).toBe(review);
    // A new run replaces the review control.
    const next = sessions.start(instance);
    expect(review?.control.snapshot().phase).toBe('closed');
    expect(sessions.openForViewer(instance)?.control).toBe(next.control);
    next.finish();
  });

  it('openForViewer refuses a browser whose input outcome is unknown', async () => {
    const sessions = new BrowserControlSessions();
    const instance = { taskId: 'task', userId: 'owner' };
    const run = sessions.start(instance);
    run.finish();
    await sessions.quarantine(instance, async () => true);
    expect(sessions.openForViewer(instance)).toBeNull();
    expect(() => sessions.review(instance)).toThrow('browser_input_outcome_unknown');
  });

  it('only a positive physical stop receipt releases an unresolved input', async () => {
    const sessions = new BrowserControlSessions();
    const instance = { taskId: 'task', userId: 'owner' };
    const binding = sessions.start(instance);
    const input = binding.control.runHuman(async () => new Promise<void>(() => {}), 'mouseDown');
    let settled = false;
    const rejected = input.catch((error: unknown) => {
      settled = true;
      throw error;
    });
    const assertion = expect(rejected).rejects.toThrow('browser_input_outcome_unknown');
    await Promise.resolve();
    await sessions.quarantine(instance, async () => false);
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(binding.control.isSettled()).toBe(false);
    expect(() => sessions.review(instance)).toThrow();
    expect(sessions.openForViewer(instance)).toBe(sessions.get(instance, 'owner', 'task'));
    expect(() => binding.finish()).toThrow('browser_input_unsettled');
    await sessions.quarantine(instance, async () => true);
    await assertion;
    expect(binding.control.isSettled()).toBe(true);
    binding.finish();
    expect(() => sessions.review(instance)).toThrow('browser_input_outcome_unknown');
    expect(sessions.openForViewer(instance)).toBeNull();
  });
  it('复审 #1: a viewer holding an input makes the running assistant yield; never opens a control', () => {
    const sessions = new BrowserControlSessions();
    const instance = { taskId: 'task', userId: 'owner' };
    sessions.noteViewerBusy(instance);
    expect(sessions.openForViewer(instance)).toBeNull();
    const run = sessions.start(instance);
    expect(run.control.humanBusy()).toBe(false);
    sessions.noteViewerBusy(instance);
    expect(run.control.humanBusy()).toBe(true);
    expect(run.control.humanInputLog().count).toBe(0);
    run.finish();
    // After the run, nothing to yield: no review control is opened by it.
    sessions.noteViewerBusy(instance);
    expect(sessions.get(instance, 'owner', 'task')?.control).toBe(run.control);
  });

  it('复审 #1 (建议修 #2/#3): while a stop winds down the closed control refuses; review only after finish', async () => {
    const sessions = new BrowserControlSessions();
    const instance = { taskId: 'task', userId: 'owner' };
    const run = sessions.start(instance);
    run.control.close();
    // The runner has not finished: the viewer gets the closed control, which refuses the input.
    const winding = sessions.openForViewer(instance);
    expect(winding?.control).toBe(run.control);
    await expect(winding?.control.runHuman(async () => {}, 'mouseDown')).rejects.toThrow(
      'browser_control_closed',
    );
    expect(() => sessions.review(instance)).toThrow('browser_runner_active');
    run.finish();
    const review = sessions.openForViewer(instance);
    expect(review?.control).not.toBe(run.control);
    expect(review?.control.canAgentAct()).toBe(true);
  });
});
