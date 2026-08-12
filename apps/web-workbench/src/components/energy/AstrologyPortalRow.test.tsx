// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AstrologyPortalRow } from './AstrologyPortalRow';

afterEach(cleanup);

describe('AstrologyPortalRow', () => {
  it('renders four image covers and preserves every callback', async () => {
    const user = userEvent.setup();
    const callbacks = {
      onOpenRanking: vi.fn(),
      onToggleSignPicker: vi.fn(),
      onOpenEnergyCard: vi.fn(),
      onOpenLightTest: vi.fn(),
    };
    const { container } = render(
      <AstrologyPortalRow rankingLoading={false} {...callbacks} />,
    );
    expect(container.querySelectorAll('img[data-portal-art]')).toHaveLength(4);
    expect(
      new Set(
        [...container.querySelectorAll<HTMLImageElement>('img[data-portal-art]')].map(
          (image) => image.src,
        ),
      ).size,
    ).toBe(4);
    await user.click(screen.getByRole('button', { name: '查看十二星座排行' }));
    await user.click(screen.getByRole('button', { name: '换个星座看看' }));
    await user.click(screen.getByRole('button', { name: '抽一张相关能量牌' }));
    await user.click(screen.getByRole('button', { name: '测个相关主题' }));
    Object.values(callbacks).forEach((callback) => expect(callback).toHaveBeenCalledOnce());
  });
});
