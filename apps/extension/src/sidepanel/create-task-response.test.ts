import { describe, expect, it } from 'vitest';
import { extractCreatedTaskId } from './create-task-response.js';

describe('extractCreatedTaskId', () => {
  it('returns a trimmed created task id', () => {
    expect(
      extractCreatedTaskId({
        result: { data: { taskId: ' tsk_123 ' } },
      }),
    ).toBe('tsk_123');
  });

  it('rejects missing or blank task ids', () => {
    expect(extractCreatedTaskId(null)).toBeNull();
    expect(extractCreatedTaskId({ result: { data: { taskId: '' } } })).toBeNull();
    expect(extractCreatedTaskId({ result: { data: { taskId: 123 } } })).toBeNull();
  });

  it('bounds oversized task ids before rendering them in the panel', () => {
    expect(
      extractCreatedTaskId({
        result: { data: { taskId: `tsk_${'x'.repeat(300)}` } },
      }),
    ).toHaveLength(128);
  });
});
