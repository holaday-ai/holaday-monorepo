import { describe, expect, it } from 'vitest';
import { taskTickReceipt } from './task-tick-receipt.js';

describe('task tick receipt projection', () => {
  const tick = {
    iteration: 1,
    toolsInTurn: ['browser_act'],
    textPreamble: 'I saved it',
    apiLatencyMs: 5,
  };
  it('uses failed execution receipt for both history and live UI, not optimistic model prose', () => {
    expect(
      taskTickReceipt(
        {
          ...tick,
          execution: {
            actionKind: 'selected_chrome_action',
            actionSummary: '结果未知',
            ok: false,
            message: 'unknown',
          },
        },
        'I saved it',
      ),
    ).toEqual({
      actionKind: 'selected_chrome_action',
      actionSummary: '结果未知',
      ok: false,
      status: 'failed',
      message: 'unknown',
    });
  });
  it('preserves other runners without execution metadata', () => {
    expect(taskTickReceipt(tick, 'normalized summary')).toEqual({
      actionKind: 'browser_act',
      actionSummary: 'normalized summary',
      ok: true,
      status: 'done',
    });
  });
  it('preserves the non-action kind on a processed discarded plan', () => {
    expect(
      taskTickReceipt(
        {
          ...tick,
          execution: {
            actionKind: 'selected_chrome_plan_discarded',
            actionSummary: '未执行',
            ok: true,
          },
        },
        'I saved it',
      ),
    ).toMatchObject({ actionKind: 'selected_chrome_plan_discarded', ok: true, status: 'done' });
  });
});
