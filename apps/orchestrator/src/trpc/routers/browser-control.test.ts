import { pino } from 'pino';
import { afterEach, describe, expect, it, vi } from 'vitest';
const { createMessage } = vi.hoisted(() => ({ createMessage: vi.fn() }));
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    beta = { messages: { create: createMessage } };
  },
}));
import { runSupercarTask, supercarAbort } from '../../agent/supercar/agent-loop.js';
import { browserControlSessions } from '../../agent/supercar/browser-control-sessions.js';
import { localChromeTaskSessions } from '../../agent/supercar/local-chrome-task-session.js';
import { TaskRepository } from '../../agent/task-repository.js';
import type { PlaywrightExecutor } from '../../agent/vision-loop/playwright-executor.js';
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

describe('browser control route integration', () => {
  it('hands a local session back only with its lease and checks database ownership first', async () => {
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
      await expect(f.caller.browserControl({ taskId, action: 'takeover' })).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      expect(local.control.snapshot().phase).toBe('agent');
      f.row.userExternalId = 'usr_owner';
      expect((await f.caller.browserControl({ taskId, action: 'takeover' })).phase).toBe(
        'requested',
      );
      const parked = local.control.checkpoint(async () => undefined);
      const state = await f.caller.browserControlState({ taskId });
      expect(state.phase).toBe('human');
      await expect(
        f.caller.browserControl({ taskId, action: 'return', controlLease: 'wrong' }),
      ).rejects.toThrow('browser_control_not_owned');
      await f.caller.browserControl({ taskId, action: 'return', controlLease: state.lease ?? '' });
      await parked;
      expect(local.control.snapshot().phase).toBe('agent');
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
  it('persists a parked task resume before handback wakes the actual runner', async () => {
    const f = fixture();
    const page = {
      url: () => 'https://93.184.216.34/',
      title: async () => 'Test',
      evaluate: async () => ({ bodyTextLen: 100, images: 0, inputs: 0, buttons: 0 }),
    };
    const executor = {
      getPage: async () => page,
      resetPageForTask: async () => undefined,
      screenshot: async () => ({ base64: 'dGVzdA==', viewportWidth: 1280, viewportHeight: 720 }),
    } as unknown as PlaywrightExecutor;
    let awaiting!: () => void;
    const parked = new Promise<void>((resolve) => {
      awaiting = resolve;
    });
    const reply = (text: string) => ({
      id: 'test',
      type: 'message',
      role: 'assistant',
      model: 'test',
      content: [{ type: 'text', text }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 10, output_tokens: 10 },
    });
    createMessage
      .mockResolvedValueOnce(reply('需要补充资料。[AWAITING_USER_INPUT]'))
      .mockResolvedValue(reply('完成。'));
    const persisted = vi
      .spyOn(TaskRepository.prototype, 'markAwaitingReplyResumed')
      .mockResolvedValue({ persisted: false });
    const run = runSupercarTask({
      taskId: f.instance.taskId,
      intent: '读取资料',
      apiKey: 'test',
      executor,
      browserControlFactory: () => browserControlSessions.start(f.instance),
      onAwaitingUser: async () => {
        awaiting();
      },
    });
    try {
      await parked;
      await f.caller.browserControl({ taskId: f.instance.taskId, action: 'takeover' });
      let controlLease = '';
      await vi.waitFor(async () => {
        const state = await f.caller.browserControlState({ taskId: f.instance.taskId });
        expect(state.phase).toBe('human');
        controlLease = state.lease ?? '';
      });
      await expect(
        f.caller.browserControl({ taskId: f.instance.taskId, action: 'return', controlLease }),
      ).rejects.toThrow('browser_resume_not_persisted');
      expect(createMessage).toHaveBeenCalledTimes(1);
      expect((await f.caller.browserControlState({ taskId: f.instance.taskId })).phase).toBe(
        'human',
      );
      persisted.mockResolvedValue({ persisted: true });
      await f.caller.browserControl({ taskId: f.instance.taskId, action: 'return', controlLease });
      await run;
      expect(persisted).toHaveBeenLastCalledWith(f.instance.taskId, 42);
      expect(createMessage).toHaveBeenCalledTimes(2);
      expect(JSON.stringify(createMessage.mock.calls[1]?.[0])).toContain('93.184.216.34');
    } finally {
      supercarAbort(f.instance.taskId);
      await run;
    }
  });
  it('requires a settled lease for the real navigation route and rejects it after return', async () => {
    const f = fixture();
    const binding = browserControlSessions.start(f.instance);
    expect(
      await f.caller.browserNav({ taskId: f.instance.taskId, direction: 'reload' }),
    ).toMatchObject({ ok: false });
    expect(f.effects).toEqual([]);
    const requested = await f.caller.browserControl({
      taskId: f.instance.taskId,
      action: 'takeover',
    });
    expect(requested.phase).toBe('requested');
    const parked = binding.control.checkpoint(async () => undefined);
    const state = await f.caller.browserControlState({ taskId: f.instance.taskId });
    expect(state.phase).toBe('human');
    const controlLease = state.lease ?? '';
    expect(
      await f.caller.browserNav({ taskId: f.instance.taskId, direction: 'reload', controlLease }),
    ).toEqual({ ok: true });
    await f.caller.browserControl({ taskId: f.instance.taskId, action: 'return', controlLease });
    await parked;
    expect(
      await f.caller.browserNav({ taskId: f.instance.taskId, direction: 'reload', controlLease }),
    ).toMatchObject({ ok: false });
    expect(f.effects).toEqual(['reload']);
    binding.finish();
  });

  it('does not reveal control or change a browser for a non-owner DB task', async () => {
    const f = fixture();
    f.row.userExternalId = 'someone-else';
    await expect(f.caller.browserControlState({ taskId: f.instance.taskId })).rejects.toMatchObject(
      { code: 'NOT_FOUND' },
    );
    await expect(
      f.caller.browserControl({ taskId: f.instance.taskId, action: 'takeover' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(f.effects).toEqual([]);
  });

  it('never treats a missing active runner as a pause receipt but permits verified terminal review', async () => {
    const f = fixture();
    expect(await f.caller.browserControlState({ taskId: f.instance.taskId })).toMatchObject({
      supported: false,
    });
    await expect(
      f.caller.browserControl({ taskId: f.instance.taskId, action: 'takeover' }),
    ).rejects.toThrow();
    f.row.status = 'completed';
    const state = await f.caller.browserControl({ taskId: f.instance.taskId, action: 'takeover' });
    expect(state).toMatchObject({ supported: true, phase: 'human' });
    await f.caller.browserControl({
      taskId: f.instance.taskId,
      action: 'return',
      controlLease: state.lease ?? '',
    });
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
