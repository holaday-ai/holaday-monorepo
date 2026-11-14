import { chromium } from 'playwright';
import { expect, it } from 'vitest';
import { browserControlSessions } from '../agent/supercar/browser-control-sessions.js';
import { captchaHandoffs } from '../agent/supercar/captcha-handoff.js';
import type { BrowserInstance } from '../browser-pool/types.js';
import {
  authorizeCaptchaViewportInput,
  authorizeHumanViewportInput,
} from './captcha-viewport-action.js';

const observation = { frameId: 'frame', tabId: 'tab', viewportRevision: 1 };

it('REBUILD-4: allowed with no lease on the open control during a CAPTCHA, never returning private input', async () => {
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
    observation,
    payload: { type: 'insertText' as const, text: 'PRIVATE_FIXTURE_INPUT' },
  };
  const waiting = captchaHandoffs.wait({
    taskId: instance.taskId,
    userId: instance.userId,
    control: binding.control,
    hasWall: async () => true,
    onWaiting: async () => {},
    onResumed: async () => true,
  });
  try {
    // No observation, or no payload: refused.
    await expect(
      authorizeCaptchaViewportInput(instance, { ...input, observation: undefined }),
    ).rejects.toThrow('browser_control_not_owned');
    await expect(
      authorizeCaptchaViewportInput(instance, { ...input, payload: undefined }),
    ).rejects.toThrow('browser_control_not_owned');
    const allowed = await authorizeCaptchaViewportInput(instance, input);
    expect(allowed.decision).toEqual({ kind: 'allow', sensitive: false });
    expect(allowed.request.actor).toBe('human');
    expect(allowed.request.actionDigest).toHaveLength(64);
    expect(allowed.request.runId).toBe(`captcha:${instance.taskId}`);
    expect(JSON.stringify(allowed)).not.toContain(input.payload.text);
    expect(await page.locator('input').inputValue()).toBe('');
    // Cancelling the CAPTCHA closes the task's control: input is refused from then on.
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

it('REBUILD-4: the person may type and click any time (no CAPTCHA, no lease); a closed control cannot', async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setContent('<input autofocus aria-label="搜索"><button>Search</button>');
  const instance = {
    taskId: 'tsk_takeover',
    userId: 'usr_takeover',
    status: 'ready',
    executor: { getPage: async () => page },
  } as unknown as BrowserInstance;
  // A finished task's retained browser: its open review control.
  const review = browserControlSessions.review(instance);
  try {
    const input = {
      type: 'input',
      observation: { ...observation, viewportRevision: 3 },
      payload: { type: 'insertText' as const, text: 'holaday' },
    };
    const typed = await authorizeHumanViewportInput(instance, input);
    expect(typed.decision).toEqual({ kind: 'allow', sensitive: false });
    expect(typed.request).toMatchObject({
      actor: 'human',
      lane: 'cdp',
      runId: 'takeover:tsk_takeover',
      tabId: 'tab',
      observationRevision: 3,
    });
    expect(JSON.stringify(typed)).not.toContain('holaday');
    const click = await authorizeHumanViewportInput(instance, {
      ...input,
      payload: { type: 'mouseDown' as const, x: 20, y: 10, button: 'left' as const, clickCount: 1 },
    });
    expect(click.decision.kind).toBe('allow');
    expect(click.request.actionDigest).not.toBe(typed.request.actionDigest);
    // A browser that is not ready is refused.
    (instance as { status: string }).status = 'stopping';
    await expect(authorizeHumanViewportInput(instance, input)).rejects.toThrow(
      'browser_control_not_owned',
    );
    (instance as { status: string }).status = 'ready';
    review.control.close();
    await expect(authorizeHumanViewportInput(instance, input)).rejects.toThrow(
      'browser_control_not_owned',
    );
  } finally {
    review.control.close();
    await browser.close();
  }
});

it('refuses a browser no run ever bound', async () => {
  const instance = {
    taskId: 'tsk_unbound',
    userId: 'usr_unbound',
    status: 'ready',
    executor: {
      getPage: async () => {
        throw new Error('must not read the page');
      },
    },
  } as unknown as BrowserInstance;
  await expect(
    authorizeHumanViewportInput(instance, {
      type: 'input',
      observation,
      payload: { type: 'insertText', text: 'x' },
    }),
  ).rejects.toThrow('browser_control_not_owned');
});

it('an aborted signal refuses before touching the page', async () => {
  const instance = {
    taskId: 'tsk_abort',
    userId: 'usr_abort',
    status: 'ready',
    executor: {
      getPage: async () => {
        throw new Error('must not read the page');
      },
    },
  } as unknown as BrowserInstance;
  const binding = browserControlSessions.start(instance);
  const abort = new AbortController();
  abort.abort(new Error('viewer gone'));
  try {
    await expect(
      authorizeHumanViewportInput(
        instance,
        { type: 'input', observation, payload: { type: 'insertText', text: 'x' } },
        abort.signal,
      ),
    ).rejects.toThrow('viewer gone');
  } finally {
    binding.finish();
  }
});
