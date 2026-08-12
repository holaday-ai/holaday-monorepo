// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ENERGY_SECTION_LINKS, EnergySectionNav } from './EnergySectionNav';

const scrollIntoView = vi.fn();

beforeEach(() => {
  scrollIntoView.mockClear();
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: scrollIntoView,
  });
  document.body.innerHTML = ENERGY_SECTION_LINKS.map(
    (section) => `<section id="${section.id}"></section>`,
  ).join('');
});

afterEach(cleanup);

describe('EnergySectionNav', () => {
  it('navigates to all four stable sections and reports the selected section', async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    render(<EnergySectionNav sections={ENERGY_SECTION_LINKS} onNavigate={onNavigate} />);

    expect(screen.getAllByRole('button')).toHaveLength(4);
    await user.click(screen.getByRole('button', { name: '星座' }));
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
    expect(onNavigate).toHaveBeenCalledWith('energy-astrology-world');
  });

  it('uses instant positioning when reduced motion is enabled', async () => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: () => ({ matches: true }),
    });
    const user = userEvent.setup();
    render(<EnergySectionNav sections={ENERGY_SECTION_LINKS} />);

    await user.click(screen.getByRole('button', { name: '今日内容' }));
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'auto', block: 'start' });
  });
});
