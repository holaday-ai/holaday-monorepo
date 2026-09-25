// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { UiStep } from '@/types/task';
import { StepCard } from './StepCard';

afterEach(cleanup);

function step(
  actionKind: string,
  status: UiStep['status'] = 'done',
  tickIndex = 0,
): UiStep {
  return {
    actionKind,
    actionSummary: `${actionKind} 摘要`,
    startedAt: 1,
    status,
    tickIndex,
  };
}

describe('StepCard execution record truthfulness', () => {
  it('renders an acknowledged selected Chrome action as an applied operation', () => {
    render(<StepCard step={step('selected_chrome_action', 'done', 1)} />);

    expect(screen.getByText('浏览器操作结果')).toBeTruthy();
    const status = screen.getByText('操作已应用');
    expect(status).toBeTruthy();
    expect(status.className).not.toMatch(/border|bg-/);
    expect(screen.getByLabelText('步骤 1 · 操作已应用')).toBeTruthy();
  });

  it('renders an unknown selected Chrome action outcome as unconfirmed', () => {
    render(<StepCard step={step('selected_chrome_action', 'failed', 1)} />);

    expect(screen.getByText('未确认完成')).toBeTruthy();
    expect(screen.queryByText('操作失败')).toBeNull();
    expect(screen.getByLabelText('步骤 1 · 未确认完成')).toBeTruthy();
  });

  it('does not render discarded plans or human handbacks as completed AI actions', () => {
    const { rerender } = render(
      <StepCard step={step('selected_chrome_plan_discarded', 'done', 1)} />,
    );

    expect(screen.getByText('未执行计划')).toBeTruthy();
    expect(screen.getByText('未执行')).toBeTruthy();
    expect(screen.getByLabelText('步骤 1 · 未执行').className).not.toContain(
      'bg-[#42C0EF]',
    );

    rerender(<StepCard step={step('selected_chrome_handoff', 'done', 2)} />);
    expect(screen.getByText('人工交还记录')).toBeTruthy();
    expect(screen.getByText('人工已交还')).toBeTruthy();
    expect(screen.getByLabelText('步骤 2 · 人工已交还').className).not.toContain(
      'bg-[#42C0EF]',
    );
  });

  it('labels historical browser model-round ticks as unverified', () => {
    render(<StepCard step={step('browser_act')} />);

    expect(screen.getByText('历史浏览器轮次（未验证）')).toBeTruthy();
    expect(screen.getByText('历史记录 · 未验证')).toBeTruthy();
    expect(screen.getByLabelText('步骤 1 · 历史记录 · 未验证')).toBeTruthy();
  });
});
