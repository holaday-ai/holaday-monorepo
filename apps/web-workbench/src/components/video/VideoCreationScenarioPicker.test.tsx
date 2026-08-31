// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VideoCreationScenarioPicker } from './VideoCreationScenarioPicker';

afterEach(cleanup);

describe('VideoCreationScenarioPicker', () => {
  it('presents the four outcomes as one accessible choice set', () => {
    render(<VideoCreationScenarioPicker value="product_highlight" onChange={() => undefined} />);

    expect(screen.getByRole('heading', { name: '这次想完成哪种视频？' })).toBeTruthy();
    expect(screen.getAllByRole('button')).toHaveLength(4);
    expect(screen.getByRole('button', { name: /产品高光短片/ }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(screen.getByRole('button', { name: /生活方式 Vlog/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /复刻一段动作/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /IP 人物口播/ })).toBeTruthy();
  });

  it('switches only after the user chooses a different goal', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<VideoCreationScenarioPicker value="product_highlight" onChange={onChange} />);

    await user.click(screen.getByRole('button', { name: /生活方式 Vlog/ }));

    expect(onChange).toHaveBeenCalledWith('lifestyle_vlog');
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
