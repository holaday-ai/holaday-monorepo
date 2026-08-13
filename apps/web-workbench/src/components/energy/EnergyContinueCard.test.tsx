// @vitest-environment happy-dom

import { render, screen } from '@testing-library/react';
import { cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EnergyContinueCard } from './EnergyContinueCard';

const recommendation = {
  target: { type: 'test', testId: 'work-focus' } as const,
  label: '专注入口轻测试',
  reason: '因为你选择了专注，下一步用一分钟找到入口。',
};

afterEach(cleanup);

describe('EnergyContinueCard', () => {
  it('offers one primary continuation and one secondary return action', async () => {
    const user = userEvent.setup();
    const onContinue = vi.fn();
    const onReturn = vi.fn();
    render(
      <EnergyContinueCard
        recommendation={recommendation}
        onContinue={onContinue}
        onReturn={onReturn}
      />,
    );

    expect(screen.getByText(recommendation.reason)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '继续：专注入口轻测试' }));
    await user.click(screen.getByRole('button', { name: '返回今日内容' }));
    expect(onContinue).toHaveBeenCalledOnce();
    expect(onReturn).toHaveBeenCalledOnce();
  });

  it('falls back to today content without rendering an unavailable button', async () => {
    const user = userEvent.setup();
    const onReturn = vi.fn();
    render(<EnergyContinueCard recommendation={null} onContinue={vi.fn()} onReturn={onReturn} />);

    expect(screen.queryByRole('button', { name: /^继续：/ })).toBeNull();
    await user.click(screen.getByRole('button', { name: '继续今日内容' }));
    expect(onReturn).toHaveBeenCalledOnce();
  });
});
