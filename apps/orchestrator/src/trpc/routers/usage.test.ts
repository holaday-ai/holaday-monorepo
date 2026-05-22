import { describe, expect, it } from 'vitest';
import { __usageInternals } from './usage.js';

const { summarizeMonthlyStatusRows } = __usageInternals;

describe('summarizeMonthlyStatusRows', () => {
  it('keeps partial_success visible instead of losing it between total and outcomes', () => {
    expect(
      summarizeMonthlyStatusRows([
        { status: 'completed', count: 4 },
        { status: 'partial_success', count: 2 },
        { status: 'failed', count: 1 },
        { status: 'cancelled', count: 3 },
        { status: 'executing', count: 5 },
      ]),
    ).toEqual({
      monthTasksTotal: 15,
      monthCompleted: 4,
      monthPartialSuccess: 2,
      monthFailed: 1,
      monthCancelled: 3,
      monthExecuting: 5,
    });
  });
});
