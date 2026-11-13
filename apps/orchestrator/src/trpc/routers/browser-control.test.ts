import { pino } from 'pino';
import { afterEach, describe, expect, it, vi } from 'vitest';
const { createMessage } = vi.hoisted(() => ({ createMessage: vi.fn() }));
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    beta = { messages: { create: createMessage } };
  },
}));
import { browserControlSessions } from '../../agent/supercar/browser-control-sessions.js';
import { captchaHandoffs } from '../../agent/supercar/captcha-handoff.js';
import { localChromeTaskSessions } from '../../agent/supercar/local-chrome-task-session.js';
import { TaskRepository } from '../../agent/task-repository.js';
import type { Context } from '../context.js';
import { tasksRouter } from './tasks.js';

function fixture() {
  const effects: string[] = [];
  const instance = {
    taskId: 'tsk_control',
    userId: 'usr_owner',
    status: 'ready',
    executor: {
      getPage: async () => ({
        reload: async () => {
          effects.push('reload');
        },
      }),
    },
  };
  const row = { status: 'executing', userExternalId: 'usr_owner', userId: 42 };
  const query = {
    from: () => query,
    innerJoin: () => query,
    where: () => query,
    limit: async () => [row],
  };
  const ctx = {
    userId: 'usr_owner',
    db: { select: () => query },
    logger: pino({ level: 'silent' }),
    browserPool: { peek: () => instance, release: async () => true },
  } as unknown as Context;
  return { effects, instance, row, ctx, caller: tasksRouter.createCaller(ctx) };
}
afterEach(() => {
  vi.restoreAllMocks();
  createMessage.mockReset();
});

describe('browser control route integration (REBUILD-4 共同操作)', () => {
  it('abort checks database ownership first, then closes a local Chrome session', async () => {
    const f = fixture();
    const taskId = f.instance.taskId;
    const local = localChromeTaskSessions.start(
      'usr_owner',
      taskId,
      {
        extensionClientId: 'local-connection',
        tabId: 42,
        expectedUrl: 'https://work.example',
        selectionId: 'e2215e8d-7b6c-4711-ab15-460f51e558a4',
      },
      async () => ({ ok: false }),
    );
    try {
      f.row.userExternalId = 'other';
      await expect(f.caller.browserNav({ taskId, direction: 'reload' })).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      expect(local.control.snapshot().phase).toBe('agent');
      f.row.userExternalId = 'usr_owner';
      expect(f.effects).toEqual([]);
      const recordStop = vi
        .spyOn(TaskRepository.prototype, 'recordCancelRequested')
        .mockResolvedValue({ persisted: true });
      expect(await f.caller.abort({ taskId })).toMatchObject({ ok: true, state: 'aborting' });
      expect(local.cancellation.signal.aborted).toBe(true);
      expect(local.control.snapshot().phase).toBe('closed');
      expect(recordStop).toHaveBeenCalledWith(taskId, 'executing');
    } finally {
      await localChromeTaskSessions.finish('usr_owner', taskId);
    }
  });

  it('navigates a running task’s browser with no lease and records it as the person acting', async () => {
    const f = fixture();
    const binding = browserControlSessions.start(f.instance);
    try {
      expect(await f.caller.browserNav({ taskId: f.instance.taskId, direction: 'reload' })).toEqual(
        { ok: true },
      );
      // An old client's lease is ignored, never required.
      expect(
        await f.caller.browserNav({
          taskId: f.instance.taskId,
          direction: 'reload',
          controlLease: 'stale-lease',
        }),
      ).toEqual({ ok: true });
      expect(f.effects).toEqual(['reload', 'reload']);
      expect(binding.control.humanInputLog().count).toBe(2);
      // The assistant now waits for the person (2 s idle) before its next action.
      expect(binding.control.humanBusy()).toBe(true);
      expect(binding.control.snapshot()).toEqual({ phase: 'agent', lease: null, error: null });
      binding.control.close();
      expect(
        await f.caller.browserNav({ taskId: f.instance.taskId, direction: 'reload' }),
      ).toMatchObject({ ok: false, reason: 'browser_control_closed' });
      expect(f.effects).toEqual(['reload', 'reload']);
    } finally {
      binding.finish();
    }
  });

  it('after the run finished, navigation goes through a fresh review control', async () => {
    const f = fixture();
    const binding = browserControlSessions.start(f.instance);
    binding.finish();
    expect(await f.caller.browserNav({ taskId: f.instance.taskId, direction: 'reload' })).toEqual({
      ok: true,
    });
    const review = browserControlSessions.openForViewer(f.instance);
    expect(review?.control).not.toBe(binding.control);
    expect(review?.control.humanInputLog().count).toBe(1);
    review?.control.close();
  });

  it('does not change a browser for a non-owner DB task', async () => {
    const f = fixture();
    f.row.userExternalId = 'someone-else';
    await expect(
      f.caller.browserNav({ taskId: f.instance.taskId, direction: 'reload' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(f.effects).toEqual([]);
  });

  it('never treats a missing runner as a running task’s control but permits verified terminal review', async () => {
    const f = fixture();
    expect(
      await f.caller.browserNav({ taskId: f.instance.taskId, direction: 'reload' }),
    ).toMatchObject({ ok: false, reason: 'browser_control_not_owned' });
    expect(f.effects).toEqual([]);
    f.row.status = 'completed';
    expect(await f.caller.browserNav({ taskId: f.instance.taskId, direction: 'reload' })).toEqual({
      ok: true,
    });
    expect(f.effects).toEqual(['reload']);
    browserControlSessions.openForViewer(f.instance)?.control.close();
  });

  it('refuses a goto that is not http(s) without touching the page', async () => {
    const f = fixture();
    const binding = browserControlSessions.start(f.instance);
    try {
      expect(
        await f.caller.browserNav({
          taskId: f.instance.taskId,
          direction: 'goto',
          url: 'javascript:alert(1)',
        }),
      ).toMatchObject({ ok: false, reason: 'bad_scheme' });
      expect(
        await f.caller.browserNav({ taskId: f.instance.taskId, direction: 'goto' }),
      ).toMatchObject({ ok: false, reason: 'missing_url' });
      expect(f.effects).toEqual([]);
    } finally {
      binding.finish();
    }
  });
});

describe('FIX-61 复审 #2 #2: every ended status is a terminal review', () => {
  for (const status of ['completed', 'partial_success', 'failed', 'cancelled']) {
    it(`${status}: the person may use the browser with no runner and no lease`, async () => {
      const f = fixture();
      f.row.status = status;
      expect(await f.caller.browserNav({ taskId: f.instance.taskId, direction: 'reload' })).toEqual(
        { ok: true },
      );
      expect(f.effects).toEqual(['reload']);
      browserControlSessions.openForViewer(f.instance)?.control.close();
    });
  }

  it('awaiting_user is still a run: no review control without its runner', async () => {
    const f = fixture();
    f.row.status = 'awaiting_user';
    expect(
      await f.caller.browserNav({ taskId: f.instance.taskId, direction: 'reload' }),
    ).toMatchObject({ ok: false, reason: 'browser_control_not_owned' });
    expect(f.effects).toEqual([]);
  });
});

it('one cancellation durably cancels awaiting_user even while a runtime handle remains', async () => {
  const f = fixture();
  f.row.status = 'awaiting_user';
  const id = f.instance.taskId;
  const local = localChromeTaskSessions.start(
    'usr_owner',
    id,
    {
      extensionClientId: 'residual-connection',
      tabId: 42,
      expectedUrl: 'https://work.example',
      selectionId: 'e2215e8d-7b6c-4711-ab15-460f51e558a4',
    },
    async () => ({ ok: false }),
  );
  vi.spyOn(TaskRepository.prototype, 'recordCancelRequested').mockResolvedValue({
    persisted: true,
  });
  vi.spyOn(TaskRepository.prototype, 'applyControlTransition').mockImplementation(
    async (prev, next) => {
      if (f.row.status !== prev.status) return { persisted: false };
      f.row.status = next.status;
      return { persisted: true };
    },
  );
  try {
    expect(await f.caller.abort({ taskId: id })).toMatchObject({ ok: true, state: 'cancelled' });
    expect(f.row.status).toBe('cancelled');
    expect(local.cancellation.signal.aborted).toBe(true);
  } finally {
    await localChromeTaskSessions.finish('usr_owner', id);
  }
});

it('CAPTCHA actions enforce ownership; continue cannot bypass a wall', async () => {
  const f = fixture();
  const binding = browserControlSessions.start(f.instance);
  let wall = true;
  const result = captchaHandoffs.wait({
    taskId: f.instance.taskId,
    userId: 'usr_owner',
    control: binding.control,
    hasWall: async () => wall,
    onWaiting: async () => {},
    onResumed: async () => true,
    pollMs: 60000,
  });
  try {
    await vi.waitFor(() =>
      expect(captchaHandoffs.active(f.instance.taskId, 'usr_owner', binding.control)).toBe(true),
    );
    expect(
      await f.caller.browserCaptcha({ taskId: f.instance.taskId, action: 'continue' }),
    ).toMatchObject({ ok: false, state: 'waiting', failedRounds: 1, alternateAvailable: false });
    // REBUILD-4: no lease — the control stays open while the person works the wall.
    expect(binding.control.snapshot()).toEqual({ phase: 'agent', lease: null, error: null });
    f.row.userExternalId = 'other';
    await expect(
      f.caller.browserCaptcha({ taskId: f.instance.taskId, action: 'cancel' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    f.row.userExternalId = 'usr_owner';
    wall = false;
    expect(
      await f.caller.browserCaptcha({ taskId: f.instance.taskId, action: 'continue' }),
    ).toMatchObject({ ok: true, state: 'resuming' });
    expect(await result).toBe('resumed');
    expect(f.effects).toEqual([]);
  } finally {
    binding.control.close();
    await result;
    binding.finish();
  }
});
it('after two failed rounds the user may continue another way; not before (CAPTCHA-REDUCE-1)', async () => {
  const f = fixture();
  const binding = browserControlSessions.start(f.instance);
  const result = captchaHandoffs.wait({
    taskId: f.instance.taskId,
    userId: 'usr_owner',
    control: binding.control,
    hasWall: async () => true,
    onWaiting: async () => {},
    onResumed: async () => true,
    challenge: async () => ({ kind: 'recaptcha_image', hint: '把所有符合题目的格子点掉' }),
    pollMs: 60000,
  });
  const captcha = (action: 'continue' | 'status' | 'alternate') =>
    f.caller.browserCaptcha({ taskId: f.instance.taskId, action });
  try {
    await vi.waitFor(() =>
      expect(captchaHandoffs.active(f.instance.taskId, 'usr_owner', binding.control)).toBe(true),
    );
    expect(await captcha('status')).toMatchObject({
      failedRounds: 0,
      alternateAvailable: false,
      challenge: { kind: 'recaptcha_image' },
    });
    expect(await captcha('alternate')).toMatchObject({ ok: false, state: 'waiting' });
    await captcha('continue');
    await captcha('continue');
    expect(await captcha('status')).toMatchObject({ failedRounds: 2, alternateAvailable: true });
    expect(await captcha('alternate')).toMatchObject({ ok: true, state: 'alternate' });
    expect(await result).toBe('alternate');
    expect(binding.control.canAgentAct()).toBe(true);
    expect(f.effects).toEqual([]);
  } finally {
    binding.control.close();
    await result;
    binding.finish();
  }
});
it('the CAPTCHA cancel action closes the original task control without submitting input', async () => {
  const f = fixture();
  const binding = browserControlSessions.start(f.instance);
  const result = captchaHandoffs.wait({
    taskId: f.instance.taskId,
    userId: 'usr_owner',
    control: binding.control,
    hasWall: async () => true,
    onWaiting: async () => {},
    onResumed: async () => true,
  });
  try {
    await vi.waitFor(() =>
      expect(captchaHandoffs.active(f.instance.taskId, 'usr_owner', binding.control)).toBe(true),
    );
    expect(await f.caller.browserCaptcha({ taskId: f.instance.taskId, action: 'cancel' })).toEqual({
      ok: true,
      state: 'cancelled',
    });
    expect(await result).toBe('cancelled');
    expect(binding.control.snapshot().phase).toBe('closed');
    expect(f.effects).toEqual([]);
  } finally {
    binding.control.close();
    await result;
    binding.finish();
  }
});
