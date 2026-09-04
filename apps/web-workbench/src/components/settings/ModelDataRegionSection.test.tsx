// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ModelDataRegionSection } from './ModelDataRegionSection';

afterEach(cleanup);

describe('ModelDataRegionSection', () => {
  it('shows the locked mainland assignment without offering an inline switch', () => {
    render(<ModelDataRegionSection region="cn" onAssign={vi.fn()} />);

    expect(screen.getByText('中国大陆')).toBeTruthy();
    expect(screen.getByText('任务内容由中国大陆区域的千问服务处理。')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /更改/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /选择处理区域/ })).toBeNull();
  });

  it('opens the shared choice dialog when no region has been assigned', async () => {
    const user = userEvent.setup();
    render(<ModelDataRegionSection region={null} onAssign={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: '选择处理区域' }));
    expect(screen.getByRole('dialog', { name: '选择任务处理区域' })).toBeTruthy();
  });
});
