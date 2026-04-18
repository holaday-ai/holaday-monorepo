import { beforeAll, describe, expect, it } from 'vitest';

beforeAll(() => {
  process.env.JWT_SECRET ??= 'test-secret-must-be-at-least-32-characters-long-yes';
  process.env.DATABASE_URL ??= 'mysql://test:test@127.0.0.1:3306/test';
  process.env.REDIS_URL ??= 'redis://127.0.0.1:6379/0';
});

describe('TaskController state machine', () => {
  async function setup() {
    const mod = await import('./task-controller.js');
    return new mod.TaskController();
  }

  it('start() with empty plan completes immediately', async () => {
    const c = await setup();
    const { state, effects } = c.start({ state: null, plan: [] });
    expect(state.status).toBe('completed');
    expect(effects).toHaveLength(1);
    expect(effects[0]).toMatchObject({ kind: 'persist' });
  });

  it('start() with a plan dispatches the first step', async () => {
    const c = await setup();
    const plan = [
      { id: 'stp_1', kind: 'goto', risk: 'low', payload: { url: 'https://example.com' } },
      { id: 'stp_2', kind: 'click', risk: 'low' },
    ] as const;
    const { state, effects } = c.start({ state: null, plan: [...plan] });
    expect(state.status).toBe('executing');
    expect(state.cursor).toBe(0);
    const sendEffect = effects.find((e) => e.kind === 'send');
    expect(sendEffect).toBeDefined();
    if (sendEffect && sendEffect.kind === 'send') {
      expect(sendEffect.message.type).toBe('server.task.dispatch');
      if (sendEffect.message.type === 'server.task.dispatch') {
        expect(sendEffect.message.stepId).toBe('stp_1');
      }
    }
  });

  it('ok step result advances to next step', async () => {
    const c = await setup();
    const { state: s0 } = c.start({
      state: null,
      plan: [
        { id: 'stp_1', kind: 'goto', risk: 'low' },
        { id: 'stp_2', kind: 'click', risk: 'low' },
      ],
    });
    const { state: s1, effects } = c.onStepResult(s0, {
      taskId: s0.taskId,
      stepId: 'stp_1',
      status: 'ok',
    });
    expect(s1.status).toBe('executing');
    expect(s1.cursor).toBe(1);
    const sendEffect = effects.find((e) => e.kind === 'send');
    expect(sendEffect).toBeDefined();
    if (sendEffect?.kind === 'send' && sendEffect.message.type === 'server.task.dispatch') {
      expect(sendEffect.message.stepId).toBe('stp_2');
    }
  });

  it('completes after the last ok step', async () => {
    const c = await setup();
    const { state: s0 } = c.start({
      state: null,
      plan: [{ id: 'stp_1', kind: 'goto', risk: 'low' }],
    });
    const { state: s1 } = c.onStepResult(s0, {
      taskId: s0.taskId,
      stepId: 'stp_1',
      status: 'ok',
    });
    expect(s1.status).toBe('completed');
  });

  it('error step result fails the task without further dispatch', async () => {
    const c = await setup();
    const { state: s0 } = c.start({
      state: null,
      plan: [
        { id: 'stp_1', kind: 'goto', risk: 'low' },
        { id: 'stp_2', kind: 'click', risk: 'low' },
      ],
    });
    const { state: s1, effects } = c.onStepResult(s0, {
      taskId: s0.taskId,
      stepId: 'stp_1',
      status: 'error',
      error: { code: 'NAV_TIMEOUT', message: 'page never loaded' },
    });
    expect(s1.status).toBe('failed');
    expect(s1.error?.code).toBe('NAV_TIMEOUT');
    expect(effects.find((e) => e.kind === 'send')).toBeUndefined();
  });

  it('high-risk step pauses for user confirm even if it returned ok', async () => {
    const c = await setup();
    const { state: s0 } = c.start({
      state: null,
      plan: [
        { id: 'stp_1', kind: 'click', risk: 'high' },
        { id: 'stp_2', kind: 'click', risk: 'low' },
      ],
    });
    const { state: s1, effects } = c.onStepResult(s0, {
      taskId: s0.taskId,
      stepId: 'stp_1',
      status: 'ok',
    });
    expect(s1.status).toBe('awaiting_user');
    expect(s1.pendingConfirm?.stepId).toBe('stp_1');
    const sendEffect = effects.find((e) => e.kind === 'send');
    expect(sendEffect).toBeDefined();
    if (sendEffect?.kind === 'send') {
      expect(sendEffect.message.type).toBe('server.user.confirm');
    }
  });

  it('userConfirm(approve) resumes execution', async () => {
    const c = await setup();
    const { state: s0 } = c.start({
      state: null,
      plan: [
        { id: 'stp_1', kind: 'click', risk: 'high' },
        { id: 'stp_2', kind: 'click', risk: 'low' },
      ],
    });
    const { state: s1 } = c.onStepResult(s0, {
      taskId: s0.taskId,
      stepId: 'stp_1',
      status: 'ok',
    });
    const { state: s2, effects } = c.userConfirm(s1, 'approve');
    expect(s2.status).toBe('executing');
    expect(s2.cursor).toBe(1);
    const sendEffect = effects.find((e) => e.kind === 'send');
    if (sendEffect?.kind === 'send' && sendEffect.message.type === 'server.task.dispatch') {
      expect(sendEffect.message.stepId).toBe('stp_2');
    }
  });

  it('userConfirm(reject) cancels the task', async () => {
    const c = await setup();
    const { state: s0 } = c.start({
      state: null,
      plan: [{ id: 'stp_1', kind: 'click', risk: 'high' }],
    });
    const { state: s1 } = c.onStepResult(s0, {
      taskId: s0.taskId,
      stepId: 'stp_1',
      status: 'ok',
    });
    const { state: s2, effects } = c.userConfirm(s1, 'reject');
    expect(s2.status).toBe('cancelled');
    const sendEffect = effects.find((e) => e.kind === 'send');
    if (sendEffect?.kind === 'send' && sendEffect.message.type === 'server.task.control') {
      expect(sendEffect.message.command).toBe('cancel');
    }
  });

  it('cancel() is a no-op on terminal states', async () => {
    const c = await setup();
    const { state: s0 } = c.start({
      state: null,
      plan: [{ id: 'stp_1', kind: 'goto', risk: 'low' }],
    });
    const { state: s1 } = c.onStepResult(s0, {
      taskId: s0.taskId,
      stepId: 'stp_1',
      status: 'ok',
    });
    expect(s1.status).toBe('completed');
    const { effects } = c.cancel(s1);
    expect(effects).toEqual([{ kind: 'noop' }]);
  });

  it('out-of-order step result is ignored', async () => {
    const c = await setup();
    const { state: s0 } = c.start({
      state: null,
      plan: [
        { id: 'stp_1', kind: 'goto', risk: 'low' },
        { id: 'stp_2', kind: 'click', risk: 'low' },
      ],
    });
    const { state: s1, effects } = c.onStepResult(s0, {
      taskId: s0.taskId,
      stepId: 'stp_2', // we expect stp_1 first
      status: 'ok',
    });
    expect(s1).toBe(s0);
    expect(effects).toEqual([{ kind: 'noop' }]);
  });
});
