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

  it('first step error retries the same step (does not advance, does not fail)', async () => {
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
    expect(s1.status).toBe('executing');
    expect(s1.cursor).toBe(0);
    expect(s1.retryCount?.stp_1).toBe(1);
    const sendEffect = effects.find((e) => e.kind === 'send');
    expect(sendEffect).toBeDefined();
    if (sendEffect?.kind === 'send' && sendEffect.message.type === 'server.task.dispatch') {
      expect(sendEffect.message.stepId).toBe('stp_1');
    }
  });

  it('second consecutive error pauses task with reason=retries_exhausted', async () => {
    const c = await setup();
    const { state: s0 } = c.start({
      state: null,
      plan: [
        { id: 'stp_1', kind: 'goto', risk: 'low' },
        { id: 'stp_2', kind: 'click', risk: 'low' },
      ],
    });
    const { state: s1 } = c.onStepResult(s0, {
      taskId: s0.taskId,
      stepId: 'stp_1',
      status: 'error',
      error: { code: 'NAV_TIMEOUT', message: 'first fail' },
    });
    const { state: s2, effects } = c.onStepResult(s1, {
      taskId: s1.taskId,
      stepId: 'stp_1',
      status: 'error',
      error: { code: 'NAV_TIMEOUT', message: 'second fail' },
    });
    expect(s2.status).toBe('paused');
    expect(s2.pauseReason).toBe('retries_exhausted');
    expect(s2.error?.message).toBe('second fail');
    const sendEffect = effects.find((e) => e.kind === 'send');
    expect(sendEffect).toBeDefined();
    if (sendEffect?.kind === 'send' && sendEffect.message.type === 'server.task.control') {
      expect(sendEffect.message.command).toBe('pause');
      expect(sendEffect.message.reason).toBe('retries_exhausted');
    }
  });

  it('pause("user") transitions executing -> paused and emits server.task.control', async () => {
    const c = await setup();
    const { state: s0 } = c.start({
      state: null,
      plan: [{ id: 'stp_1', kind: 'goto', risk: 'low' }],
    });
    const { state: s1, effects } = c.pause(s0, 'user');
    expect(s1.status).toBe('paused');
    expect(s1.pauseReason).toBe('user');
    const sendEffect = effects.find((e) => e.kind === 'send');
    if (sendEffect?.kind === 'send' && sendEffect.message.type === 'server.task.control') {
      expect(sendEffect.message.command).toBe('pause');
      expect(sendEffect.message.reason).toBe('user');
    }
  });

  it('pause("quota_exceeded") behaves the same with reason set', async () => {
    const c = await setup();
    const { state: s0 } = c.start({
      state: null,
      plan: [{ id: 'stp_1', kind: 'goto', risk: 'low' }],
    });
    const { state: s1, effects } = c.pause(s0, 'quota_exceeded');
    expect(s1.pauseReason).toBe('quota_exceeded');
    const sendEffect = effects.find((e) => e.kind === 'send');
    if (sendEffect?.kind === 'send' && sendEffect.message.type === 'server.task.control') {
      expect(sendEffect.message.reason).toBe('quota_exceeded');
    }
  });

  it('pause is a no-op on terminal statuses and on already-paused', async () => {
    const c = await setup();
    const { state: s0 } = c.start({
      state: null,
      plan: [{ id: 'stp_1', kind: 'goto', risk: 'low' }],
    });
    const { state: completed } = c.onStepResult(s0, {
      taskId: s0.taskId,
      stepId: 'stp_1',
      status: 'ok',
    });
    for (const status of ['completed', 'partial_success', 'failed', 'cancelled'] as const) {
      const terminal = { ...completed, status };
      const { state: stillTerminal, effects } = c.pause(terminal, 'user');
      expect(stillTerminal).toBe(terminal);
      expect(effects).toEqual([{ kind: 'noop' }]);
    }
    const { state: paused } = c.pause(s0, 'user');
    const { state: pausedAgain, effects } = c.pause(paused, 'user');
    expect(pausedAgain).toBe(paused);
    expect(effects).toEqual([{ kind: 'noop' }]);
  });

  it('pause is a no-op while awaiting user input', async () => {
    const c = await setup();
    const { state: s0 } = c.start({
      state: null,
      plan: [
        { id: 'stp_1', kind: 'click', risk: 'high' },
        { id: 'stp_2', kind: 'wait', risk: 'low' },
      ],
    });
    const { state: awaiting } = c.onStepResult(s0, {
      taskId: s0.taskId,
      stepId: 'stp_1',
      status: 'ok',
    });

    const { state: stillAwaiting, effects } = c.pause(awaiting, 'user');

    expect(stillAwaiting).toBe(awaiting);
    expect(stillAwaiting.status).toBe('awaiting_user');
    expect(stillAwaiting.pendingConfirm?.stepId).toBe('stp_1');
    expect(effects).toEqual([{ kind: 'noop' }]);
  });

  it('resume re-dispatches the current step and clears pauseReason', async () => {
    const c = await setup();
    const { state: s0 } = c.start({
      state: null,
      plan: [
        { id: 'stp_1', kind: 'goto', risk: 'low' },
        { id: 'stp_2', kind: 'click', risk: 'low' },
      ],
    });
    const { state: paused } = c.pause(s0, 'user');
    const { state: resumed, effects } = c.resume(paused);
    expect(resumed.status).toBe('executing');
    expect(resumed.pauseReason).toBeNull();
    const dispatch = effects.find(
      (e) => e.kind === 'send' && e.message.type === 'server.task.dispatch',
    );
    expect(dispatch).toBeDefined();
    if (dispatch?.kind === 'send' && dispatch.message.type === 'server.task.dispatch') {
      expect(dispatch.message.stepId).toBe('stp_1');
    }
    const control = effects.find(
      (e) => e.kind === 'send' && e.message.type === 'server.task.control',
    );
    if (control?.kind === 'send' && control.message.type === 'server.task.control') {
      expect(control.message.command).toBe('resume');
    }
  });

  it('resume from non-paused state is a noop', async () => {
    const c = await setup();
    const { state: s0 } = c.start({
      state: null,
      plan: [{ id: 'stp_1', kind: 'goto', risk: 'low' }],
    });
    const { effects } = c.resume(s0);
    expect(effects).toEqual([{ kind: 'noop' }]);
  });

  it('cancel works from paused', async () => {
    const c = await setup();
    const { state: s0 } = c.start({
      state: null,
      plan: [{ id: 'stp_1', kind: 'goto', risk: 'low' }],
    });
    const { state: paused } = c.pause(s0, 'user');
    const { state: cancelled, effects } = c.cancel(paused);
    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.pauseReason).toBeNull();
    const sendEffect = effects.find((e) => e.kind === 'send');
    if (sendEffect?.kind === 'send' && sendEffect.message.type === 'server.task.control') {
      expect(sendEffect.message.command).toBe('cancel');
    }
  });

  it('high-risk step opens a review gate after reaching the boundary', async () => {
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
      if (sendEffect.message.type === 'server.user.confirm') {
        expect(sendEffect.message.prompt).toContain('HOLA DAY 会停在最终确认页');
        expect(sendEffect.message.prompt).toContain('最终动作需要你手动完成');
      }
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
    const { state: completed } = c.onStepResult(s0, {
      taskId: s0.taskId,
      stepId: 'stp_1',
      status: 'ok',
    });
    expect(completed.status).toBe('completed');
    for (const status of ['completed', 'partial_success', 'failed', 'cancelled'] as const) {
      const terminal = { ...completed, status };
      const { state: stillTerminal, effects } = c.cancel(terminal);
      expect(stillTerminal).toBe(terminal);
      expect(effects).toEqual([{ kind: 'noop' }]);
    }
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

  // ---------- Batch confirm ----------

  it('awaiting_user with data.batch builds a batch pendingConfirm + emits server.batch_confirm_required', async () => {
    const c = await setup();
    const { state: s0 } = c.start({
      state: null,
      plan: [
        { id: 'stp_batch', kind: 'click', risk: 'low' },
        { id: 'stp_next', kind: 'wait', risk: 'low' },
      ],
    });
    const { state: s1, effects } = c.onStepResult(s0, {
      taskId: s0.taskId,
      stepId: 'stp_batch',
      status: 'awaiting_user',
      data: {
        batch: {
          batchIndex: 1,
          batchTotal: 3,
          summary: 'Reply to 5 negative reviews',
          items: [
            { label: '评论 #1 · ★1', preview: '您好，感谢反馈……' },
            { label: '评论 #2 · ★2', preview: '抱歉体验不佳……' },
          ],
        },
      },
    });
    expect(s1.status).toBe('awaiting_user');
    expect(s1.pendingConfirm?.kind).toBe('batch');
    if (s1.pendingConfirm?.kind === 'batch') {
      expect(s1.pendingConfirm.batchIndex).toBe(1);
      expect(s1.pendingConfirm.batchTotal).toBe(3);
      expect(s1.pendingConfirm.items).toHaveLength(2);
      expect(s1.pendingConfirm.summary).toBe('Reply to 5 negative reviews');
    }
    const sendEffect = effects.find((e) => e.kind === 'send');
    expect(sendEffect).toBeDefined();
    if (sendEffect?.kind === 'send') {
      expect(sendEffect.message.type).toBe('server.batch_confirm_required');
      if (sendEffect.message.type === 'server.batch_confirm_required') {
        expect(sendEffect.message.batchIndex).toBe(1);
        expect(sendEffect.message.batchTotal).toBe(3);
        expect(sendEffect.message.items).toHaveLength(2);
      }
    }
  });

  it('userConfirm("approve") on a batch pins cursor + re-dispatches the same step', async () => {
    const c = await setup();
    const { state: s0 } = c.start({
      state: null,
      plan: [
        { id: 'stp_batch', kind: 'click', risk: 'low' },
        { id: 'stp_next', kind: 'wait', risk: 'low' },
      ],
    });
    const { state: awaiting } = c.onStepResult(s0, {
      taskId: s0.taskId,
      stepId: 'stp_batch',
      status: 'awaiting_user',
      data: {
        batch: {
          batchIndex: 0,
          batchTotal: 2,
          items: [{ label: 'a', preview: 'b' }],
        },
      },
    });
    const { state: resumed, effects } = c.userConfirm(awaiting, 'approve');
    expect(resumed.status).toBe('executing');
    expect(resumed.cursor).toBe(0); // same step
    expect(resumed.pendingConfirm).toBeNull();
    const dispatch = effects.find(
      (e) => e.kind === 'send' && e.message.type === 'server.task.dispatch',
    );
    expect(dispatch).toBeDefined();
    if (dispatch?.kind === 'send' && dispatch.message.type === 'server.task.dispatch') {
      expect(dispatch.message.stepId).toBe('stp_batch');
    }
  });

  it('userConfirm("skip") on a batch advances cursor past the step', async () => {
    const c = await setup();
    const { state: s0 } = c.start({
      state: null,
      plan: [
        { id: 'stp_batch', kind: 'click', risk: 'low' },
        { id: 'stp_next', kind: 'wait', risk: 'low' },
      ],
    });
    const { state: awaiting } = c.onStepResult(s0, {
      taskId: s0.taskId,
      stepId: 'stp_batch',
      status: 'awaiting_user',
      data: {
        batch: { batchIndex: 0, batchTotal: 2, items: [{ label: 'a', preview: 'b' }] },
      },
    });
    const { state: after, effects } = c.userConfirm(awaiting, 'skip');
    expect(after.status).toBe('executing');
    expect(after.cursor).toBe(1); // advanced
    const dispatch = effects.find(
      (e) => e.kind === 'send' && e.message.type === 'server.task.dispatch',
    );
    if (dispatch?.kind === 'send' && dispatch.message.type === 'server.task.dispatch') {
      expect(dispatch.message.stepId).toBe('stp_next');
    }
  });

  it('userConfirm("reject") on a batch cancels the task', async () => {
    const c = await setup();
    const { state: s0 } = c.start({
      state: null,
      plan: [{ id: 'stp_batch', kind: 'click', risk: 'low' }],
    });
    const { state: awaiting } = c.onStepResult(s0, {
      taskId: s0.taskId,
      stepId: 'stp_batch',
      status: 'awaiting_user',
      data: {
        batch: { batchIndex: 0, batchTotal: 1, items: [{ label: 'a', preview: 'b' }] },
      },
    });
    const { state: after, effects } = c.userConfirm(awaiting, 'reject');
    expect(after.status).toBe('cancelled');
    const control = effects.find(
      (e) => e.kind === 'send' && e.message.type === 'server.task.control',
    );
    if (control?.kind === 'send' && control.message.type === 'server.task.control') {
      expect(control.message.command).toBe('cancel');
    }
  });

  it('malformed batch payload falls back to single confirm', async () => {
    const c = await setup();
    const { state: s0 } = c.start({
      state: null,
      plan: [{ id: 'stp_1', kind: 'click', risk: 'high' }],
    });
    const { state: s1 } = c.onStepResult(s0, {
      taskId: s0.taskId,
      stepId: 'stp_1',
      status: 'ok',
      data: { batch: { batchTotal: 3 } }, // missing items + batchIndex
    });
    expect(s1.pendingConfirm?.kind).toBe('single');
    if (s1.pendingConfirm?.kind === 'single') {
      expect(s1.pendingConfirm.prompt).toContain('提交、支付、发送、分享、改权限、删除或退订');
    }
  });

  // ---------------- allowedOrigins propagation ----------------

  it('start() seeds state.allowedOrigins from ControllerInput and emits it on first dispatch', async () => {
    const c = await setup();
    const { state, effects } = c.start({
      state: null,
      plan: [{ id: 'stp_1', kind: 'goto', risk: 'low', payload: { url: 'https://x.test/' } }],
      allowedOrigins: ['*.jinritemai.com', 'xueqiu.com'],
    });
    expect(state.allowedOrigins).toEqual(['*.jinritemai.com', 'xueqiu.com']);
    const send = effects.find((e) => e.kind === 'send');
    if (send?.kind === 'send' && send.message.type === 'server.task.dispatch') {
      expect(send.message.allowedOrigins).toEqual(['*.jinritemai.com', 'xueqiu.com']);
    } else {
      throw new Error('no dispatch emitted');
    }
  });

  it('dispatch omits allowedOrigins when the list is empty (unrestricted = no key)', async () => {
    const c = await setup();
    const { effects } = c.start({
      state: null,
      plan: [{ id: 'stp_1', kind: 'goto', risk: 'low', payload: { url: 'https://x.test/' } }],
      allowedOrigins: [],
    });
    const send = effects.find((e) => e.kind === 'send');
    if (send?.kind === 'send' && send.message.type === 'server.task.dispatch') {
      // Empty list is treated as "no restriction" on the driver side;
      // we don't emit the key at all so downstream zod schemas see
      // consistent shape with the pre-allowedOrigins world.
      expect('allowedOrigins' in send.message).toBe(false);
    } else {
      throw new Error('no dispatch emitted');
    }
  });

  it('allowedOrigins survives through step advance — every dispatch carries it', async () => {
    const c = await setup();
    const { state: s0 } = c.start({
      state: null,
      plan: [
        { id: 'stp_1', kind: 'goto', risk: 'low', payload: { url: 'https://x.test/' } },
        { id: 'stp_2', kind: 'click', risk: 'low' },
      ],
      allowedOrigins: ['*.example.com'],
    });
    const { effects } = c.onStepResult(s0, {
      taskId: s0.taskId,
      stepId: 'stp_1',
      status: 'ok',
    });
    const send = effects.find((e) => e.kind === 'send');
    if (send?.kind === 'send' && send.message.type === 'server.task.dispatch') {
      expect(send.message.stepId).toBe('stp_2');
      expect(send.message.allowedOrigins).toEqual(['*.example.com']);
    } else {
      throw new Error('no dispatch emitted for step 2');
    }
  });

  it('retry dispatch also carries allowedOrigins (no regression on error path)', async () => {
    const c = await setup();
    const { state: s0 } = c.start({
      state: null,
      plan: [{ id: 'stp_1', kind: 'click', risk: 'low' }],
      allowedOrigins: ['*.example.com'],
    });
    const { effects } = c.onStepResult(s0, {
      taskId: s0.taskId,
      stepId: 'stp_1',
      status: 'error',
      error: { code: 'FAKE', message: 'boom' },
    });
    const send = effects.find((e) => e.kind === 'send');
    if (send?.kind === 'send' && send.message.type === 'server.task.dispatch') {
      expect(send.message.allowedOrigins).toEqual(['*.example.com']);
    } else {
      throw new Error('no dispatch on retry');
    }
  });
});
