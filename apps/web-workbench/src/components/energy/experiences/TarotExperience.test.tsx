// @vitest-environment happy-dom

import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import type { ExperiencePhase } from '../energy-types';
import { TarotExperience } from './TarotExperience';

afterEach(cleanup);

const tarot = {
  title: 'The Sun',
  subtitle: '把光带回来',
  body: '先完成一件让自己有力量的小事。',
};

function Harness(): JSX.Element {
  const [phase, setPhase] = React.useState<ExperiencePhase>('active');
  return (
    <>
      {phase === 'result' ? (
        <button type="button" onClick={() => setPhase('active')}>
          再来一次
        </button>
      ) : null}
      <TarotExperience tarot={tarot} phase={phase} onPhaseChange={setPhase} />
    </>
  );
}

describe('TarotExperience', () => {
  it('keeps the card hidden until the user deliberately reveals it', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const themeGroup = screen.getByRole('group', { name: '抽卡主题' });
    expect(within(themeGroup).getAllByRole('button', { pressed: false })).toHaveLength(3);
    const work = within(themeGroup).getByRole('button', { name: /工作推进/ });
    await user.click(work);
    expect(work.getAttribute('aria-pressed')).toBe('true');

    await user.click(screen.getByRole('button', { name: '开始抽卡' }));
    expect(screen.queryByText('The Sun')).toBeNull();
    expect(screen.getByRole('button', { name: '翻开这张卡' })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: '翻开这张卡' }));
    expect(screen.getByRole('heading', { name: 'The Sun' })).toBeTruthy();
    expect(screen.getByText('先完成一件让自己有力量的小事。')).toBeTruthy();
    expect(screen.getByText(/只推进一件最重要的小事/)).toBeTruthy();
  });

  it('returns to a clean theme choice on replay', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole('button', { name: /关系回应/ }));
    await user.click(screen.getByRole('button', { name: '开始抽卡' }));
    await user.click(screen.getByRole('button', { name: '翻开这张卡' }));
    await user.click(screen.getByRole('button', { name: '再来一次' }));

    expect(screen.queryByText('The Sun')).toBeNull();
    expect(screen.getByRole('heading', { name: '这张卡想回应什么？' })).toBeTruthy();
    expect(
      within(screen.getByRole('group', { name: '抽卡主题' })).getAllByRole('button', {
        pressed: false,
      }),
    ).toHaveLength(3);
  });
});
