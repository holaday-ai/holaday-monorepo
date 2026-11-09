import { chromium } from 'playwright';
import { expect, it, vi } from 'vitest';
import { browserControlSessions } from '../agent/supercar/browser-control-sessions.js';
import { captchaHandoffs } from '../agent/supercar/captcha-handoff.js';
import type { BrowserInstance } from '../browser-pool/types.js';
import {
  authorizeCaptchaViewportInput,
  authorizeHumanViewportInput,
} from './captcha-viewport-action.js';
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
    'browser_control_not_owned',
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
      'browser_control_not_owned',
    );
    input.controlLease = binding.control.snapshot().lease!;
    const allowed = await authorizeCaptchaViewportInput(instance, input);
    expect(allowed.decision).toEqual({ kind: 'allow', sensitive: false });
    expect(allowed.request.actor).toBe('human');
    expect(allowed.request.actionDigest).toHaveLength(64);
    expect(allowed.request.runId).toBe(`captcha:${instance.taskId}`);
    expect(JSON.stringify(allowed)).not.toContain(input.payload.text);
    expect(await page.locator('input').inputValue()).toBe('');
    captchaHandoffs.cancel(instance.taskId, instance.userId, binding.control);
    await waiting;
    await expect(authorizeCaptchaViewportInput(instance, input)).rejects.toThrow(
      'browser_control_not_owned',
    );
  } finally {
    binding.control.close();
    await waiting;
    binding.finish();
    await browser.close();
  }
});

it('FIX-61: the user who took over (no CAPTCHA) can type and click; a returned lease cannot', async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setContent('<input autofocus aria-label="搜索"><button>Search</button>');
  const instance = {
    taskId: 'tsk_takeover',
    userId: 'usr_takeover',
    status: 'ready',
    executor: { getPage: async () => page },
  } as unknown as BrowserInstance;
  // A finished task's retained browser: the review session the user takes over.
  const review = browserControlSessions.review(instance);
  try {
    const input = {
      type: 'input',
      controlLease: 'wrong-lease',
      observation: { frameId: 'frame', tabId: 'tab', viewportRevision: 3 },
      payload: { type: 'insertText' as const, text: 'holaday' },
    };
    await expect(authorizeHumanViewportInput(instance, input)).rejects.toThrow(
      'browser_control_not_owned',
    );
    await vi.waitFor(() => expect(review.control.snapshot().phase).toBe('human'));
    const lease = review.control.snapshot().lease!;
    input.controlLease = lease;
    const typed = await authorizeHumanViewportInput(instance, input);
    expect(typed.decision).toEqual({ kind: 'allow', sensitive: false });
    expect(typed.request).toMatchObject({ actor: 'human', lane: 'cdp', lease, runId: 'takeover:tsk_takeover' });
    expect(JSON.stringify(typed)).not.toContain('holaday');
    const click = await authorizeHumanViewportInput(instance, {
      ...input,
      payload: { type: 'mouseDown' as const, x: 20, y: 10, button: 'left' as const, clickCount: 1 },
    });
    expect(click.decision.kind).toBe('allow');
    review.control.returnToAgent(lease);
    await expect(authorizeHumanViewportInput(instance, input)).rejects.toThrow(
      'browser_control_not_owned',
    );
  } finally {
    review.control.close();
    await browser.close();
  }
});
