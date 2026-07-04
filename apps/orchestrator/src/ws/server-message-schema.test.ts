import { describe, expect, it } from 'vitest';
import { parseServerMessage } from '@holaday/shared-types';

describe('server message schema', () => {
  it('accepts max_steps_reached as a task control pause reason', () => {
    const parsed = parseServerMessage(
      JSON.stringify({
        type: 'server.task.control',
        taskId: 'tsk_max_steps',
        command: 'pause',
        reason: 'max_steps_reached',
        detail: { message: 'max_steps_reached (25)' },
      }),
    );

    expect(parsed.success).toBe(true);
  });

  it('does not classify paused as a terminal websocket outcome', () => {
    const parsed = parseServerMessage(
      JSON.stringify({
        type: 'server.task.terminal',
        taskId: 'tsk_paused',
        status: 'paused',
        reason: 'max_steps_reached (25)',
      }),
    );

    expect(parsed.success).toBe(false);
  });

  it('accepts partial_success as a batch item progress status', () => {
    const parsed = parseServerMessage(
      JSON.stringify({
        type: 'server.batch.progress',
        batchId: 'btc_review',
        status: 'partial',
        itemsTotal: 1,
        itemsDone: 0,
        itemsFailed: 1,
        item: {
          batchItemId: 'bti_review',
          seq: 0,
          status: 'partial_success',
          taskId: 'tsk_review',
          errorMessage: 'task ended with status=partial_success',
        },
      }),
    );

    expect(parsed.success).toBe(true);
  });
});
