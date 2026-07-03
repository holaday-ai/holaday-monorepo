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
      }),
    );

    expect(parsed.success).toBe(true);
  });
});
