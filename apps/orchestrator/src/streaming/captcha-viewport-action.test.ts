import { chromium } from 'playwright';
import { expect, it, vi } from 'vitest';
import { browserControlSessions } from '../agent/supercar/browser-control-sessions.js';
import { captchaHandoffs } from '../agent/supercar/captcha-handoff.js';
import type { BrowserInstance } from '../browser-pool/types.js';
import { authorizeCaptchaViewportInput } from './captcha-viewport-action.js';
it('grants only the current human CAPTCHA lease and never returns private input content', async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setContent('<input autofocus><button>Verify fixture</button>');
  const instance = {
    taskId: 'tsk_adapter',
    userId: 'usr_adapter',
    status: 'ready',
    executor: { getPage: async () => page },
  } as unknown as BrowserInstance;
  const binding = browserControlSessions.start(instance);
  const input = {
    type: 'input',
    controlLease: 'wrong',
    observation: { frameId: 'frame', tabId: 'tab', viewportRevision: 1 },
    payload: { type: 'insertText' as const, text: 'PRIVATE_FIXTURE_INPUT' },
  };
  await expect(authorizeCaptchaViewportInput(instance, input)).rejects.toThrow(
    'captcha_control_not_owned',
  );
  const waiting = captchaHandoffs.wait({
    taskId: instance.taskId,
    userId: instance.userId,
    control: binding.control,
    hasWall: async () => true,
    onWaiting: async () => {},
    onResumed: async () => true,
  });
  try {
    await vi.waitFor(() => expect(binding.control.snapshot().phase).toBe('human'));
    await expect(authorizeCaptchaViewportInput(instance, input)).rejects.toThrow(
      'captcha_control_not_owned',
    );
    input.controlLease = binding.control.snapshot().lease!;
    const allowed = await authorizeCaptchaViewportInput(instance, input);
    expect(allowed.decision).toEqual({ kind: 'allow', sensitive: false });
    expect(allowed.request.actor).toBe('human');
    expect(allowed.request.actionDigest).toHaveLength(64);
    expect(JSON.stringify(allowed)).not.toContain(input.payload.text);
    expect(await page.locator('input').inputValue()).toBe('');
    captchaHandoffs.cancel(instance.taskId, instance.userId, binding.control);
    await waiting;
    await expect(authorizeCaptchaViewportInput(instance, input)).rejects.toThrow(
      'captcha_control_not_owned',
    );
  } finally {
    binding.control.close();
    await waiting;
    binding.finish();
    await browser.close();
  }
});
