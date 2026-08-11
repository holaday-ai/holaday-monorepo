// @vitest-environment happy-dom

import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ExperiencePhase } from '../energy-types';
import { TarotExperience } from './TarotExperience';

afterEach(cleanup);

const tarot = {
  title: 'The Sun',
  subtitle: '把光带回来',
  body: '先完成一件让自己有力量的小事。',
};

function Harness({ onDrawYesNo = vi.fn() }: { onDrawYesNo?: () => Promise<void> }): JSX.Element {
  const [phase, setPhase] = React.useState<ExperiencePhase>('active');
  return (
    <>
      {phase === 'result' ? (
        <button type="button" onClick={() => setPhase('active')}>
          再来一次
        </button>
      ) : null}
      <TarotExperience
        tarot={tarot}
        yesNoTarot={{
          answer: 'yes',
          card: 'The Sun',
          category: 'Major Arcana',
          result: '可以，从一个清楚的小步骤开始。',
        }}
        yesNoLoading={false}
        onDrawYesNo={onDrawYesNo}
        phase={phase}
        onPhaseChange={setPhase}
      />
    </>
  );
}

describe('TarotExperience', () => {
  it('keeps the card hidden until the user deliberately reveals it', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole('button', { name: '今日卡' }));

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

    await user.click(screen.getByRole('button', { name: '今日卡' }));

    await user.click(screen.getByRole('button', { name: /关系回应/ }));
    await user.click(screen.getByRole('button', { name: '开始抽卡' }));
    await user.click(screen.getByRole('button', { name: '翻开这张卡' }));
    await user.click(screen.getByRole('button', { name: '再来一次' }));

    expect(screen.queryByText('The Sun')).toBeNull();
    expect(screen.getByRole('heading', { name: '今天想听哪一种回应？' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '今日卡' }));
    expect(screen.getByRole('heading', { name: '这张卡想回应什么？' })).toBeTruthy();
    expect(
      within(screen.getByRole('group', { name: '抽卡主题' })).getAllByRole('button', {
        pressed: false,
      }),
    ).toHaveLength(3);
  });

  it('draws a yes/no card on demand without collecting the question', async () => {
    const user = userEvent.setup();
    const onDrawYesNo = vi.fn().mockResolvedValue(undefined);
    render(<Harness onDrawYesNo={onDrawYesNo} />);

    await user.click(screen.getByRole('button', { name: '是 / 否卡' }));
    expect(screen.getByText(/只需要在心里默念/)).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
    await user.click(screen.getByRole('button', { name: '抽取回答卡' }));

    expect(onDrawYesNo).toHaveBeenCalledOnce();
    expect(screen.getByText('YES')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'The Sun' })).toBeTruthy();
    expect(screen.getByText('可以，从一个清楚的小步骤开始。')).toBeTruthy();
  });
});
