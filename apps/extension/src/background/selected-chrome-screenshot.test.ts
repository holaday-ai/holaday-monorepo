import { USER_BROWSER_PROTOCOL } from '@holaday/shared-types';
import { describe, expect, it, vi } from 'vitest';
import { type SelectedChromeDriver, SelectedChromeSession } from './selected-chrome-session.js';

const activity = {
  tabId: 42,
  stamp: 'a'.repeat(64),
  keys: 0,
  pointers: 0,
  composing: false,
  interrupted: false,
};
function harness() {
  let owner = 'a';
  const capture = vi.fn(async (captureId: string, observationRevision: number) => ({
    status: 'ok' as const,
    data: {
      captureId,
      observationRevision,
      tabId: 42,
      origin: 'https://work.example',
      mediaType: 'image/jpeg',
      sizeBytes: 6,
      sha256: 'b'.repeat(64),
      data: '/9j/Af/Z',
      capturedAt: Date.now(),
    },
  }));
  const driver: SelectedChromeDriver = {
    attachExistingTab: async () => ({ status: 'ok', data: { tabId: 42 } }),
    observeCurrentPage: async () => ({
      status: 'ok',
      data: { tabId: 42, origin: 'https://work.example', activity, observationRevision: 1 },
    }),
    execute: async () => ({ status: 'ok' }),
    describeTarget: async () => ({ status: 'error' }),
    executeBound: async () => ({ status: 'error' }),
    readActivity: async () => ({ status: 'ok', data: activity }),
    captureTaskScreenshot: capture,
    dispose: async () => {},
  };
  const session = new SelectedChromeSession({ makeDriver: () => driver, owner: () => owner });
  return {
    session,
    capture,
    changeOwner: () => {
      owner = 'b';
    },
    open: () =>
      session.open({
        taskId: 'task-a',
        tabId: 42,
        validate: async () => {},
        grantedOrigins: ['https://work.example'],
        protocol: {
          ...USER_BROWSER_PROTOCOL,
          capabilities: [
            ...USER_BROWSER_PROTOCOL.capabilities,
            'human_activity_v1',
            'task_screenshot_v1',
          ],
        },
      }),
  };
}
describe('task screenshot extension admission', () => {
  it('negotiates only the optional capability and rejects a different task', async () => {
    const h = harness();
    const opened = await h.open();
    if (!opened.ok) throw new Error('open failed');
    expect(opened.protocol?.capabilities).toContain('task_screenshot_v1');
    expect(
      await h.session.screenshot('task-b', {
        sessionId: opened.sessionId,
        captureId: crypto.randomUUID(),
        observationRevision: 1,
      }),
    ).toMatchObject({ ok: false });
    expect(h.capture).not.toHaveBeenCalled();
    expect(
      await h.session.screenshot('task-a', {
        sessionId: opened.sessionId,
        captureId: crypto.randomUUID(),
        observationRevision: 1,
      }),
    ).toMatchObject({ ok: true, screenshot: { tabId: 42 } });
  });
  it('discards a late capture after execution owner changes', async () => {
    const h = harness();
    const opened = await h.open();
    if (!opened.ok) throw new Error('open failed');
    const original = h.capture.getMockImplementation()!;
    h.capture.mockImplementationOnce(async (...args) => {
      const result = await original(...args);
      h.changeOwner();
      return result;
    });
    expect(
      await h.session.screenshot('task-a', {
        sessionId: opened.sessionId,
        captureId: crypto.randomUUID(),
        observationRevision: 1,
      }),
    ).toMatchObject({ ok: false });
  });
  it('rejects human input or closed tabs before capture', async () => {
    const h = harness();
    const opened = await h.open();
    if (!opened.ok) throw new Error('open failed');
    h.session.markTabClosed(42);
    expect(
      await h.session.screenshot('task-a', {
        sessionId: opened.sessionId,
        captureId: crypto.randomUUID(),
        observationRevision: 1,
      }),
    ).toMatchObject({ ok: false });
    expect(h.capture).not.toHaveBeenCalled();
  });
});
