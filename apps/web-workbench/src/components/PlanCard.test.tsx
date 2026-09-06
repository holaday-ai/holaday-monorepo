// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { PlanCard } from './PlanCard';

afterEach(cleanup);
describe('PlanCard advisory versus tracked execution', () => {
  it.each([[], undefined])(
    'does not invent progress for an advisory plan, including hydrated empty statuses: %j',
    (planStatus) => {
      render(
        <PlanCard planText={'1. 整理材料\n2. 归纳结论'} {...(planStatus ? { planStatus } : {})} />,
      );
      expect(screen.queryAllByLabelText('pending')).toHaveLength(0);
      expect(screen.queryByLabelText('done')).toBeNull();
      expect(screen.getByText('处理思路')).toBeTruthy();
      expect(screen.queryByText('等待计划步骤')).toBeNull();
    },
  );
  it('keeps actual tracked step statuses aligned with zero-based server indices', () => {
    render(
      <PlanCard
        planText={'1. 已完成阶段\n2. 待执行阶段'}
        planStatus={[
          { idx: 0, status: 'done' },
          { idx: 1, status: 'running' },
        ]}
      />,
    );
    expect(
      screen.getByText('已完成阶段').closest('li')?.querySelector('[aria-label="done"]'),
    ).toBeTruthy();
    expect(
      screen.getByText('待执行阶段').closest('li')?.querySelector('[aria-label="running"]'),
    ).toBeTruthy();
  });
});
