// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StockRiskMonitorSheet } from './StockRiskMonitorSheet';

afterEach(cleanup);

describe('StockRiskMonitorSheet', () => {
  it('shows the fixed rules, schedule, reminder boundary and non-advice disclosure', async () => {
    const onConfirm = vi.fn(async () => undefined);
    const user = userEvent.setup();
    render(
      <StockRiskMonitorSheet
        open
        stock={{ symbol: '600001', name: '测试股份' }}
        dataAsOf="2026-08-19"
        pending={false}
        error={null}
        onOpenChange={vi.fn()}
        onConfirm={onConfirm}
      />,
    );

    expect(screen.getByRole('dialog', { name: '持续监控测试股份风险' })).toBeTruthy();
    expect(screen.getByText('每天 16:30 · Asia/Shanghai')).toBeTruthy();
    expect(screen.getByText('质押、商誉、业绩预告、董监高变动、公告风险')).toBeTruthy();
    expect(screen.getByText(/仅在风险新增、升级、解除或无法判断时提醒/)).toBeTruthy();
    expect(screen.getByText(/不构成投资建议/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '确认开始监控' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
