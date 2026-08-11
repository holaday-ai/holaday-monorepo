// @vitest-environment happy-dom

import { buildAstroReading, createProfileFromBirthday } from '@/lib/astrology';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import type { ExperiencePhase } from '../energy-types';
import { TestExperience } from './TestExperience';

afterEach(cleanup);

const profile = createProfileFromBirthday({ birthday: '1996-03-21' });
const reading = buildAstroReading(profile, new Date('2026-08-11T12:00:00+09:00'));

function Harness(): JSX.Element {
  const [phase, setPhase] = React.useState<ExperiencePhase>('active');
  return (
    <>
      {phase === 'result' ? (
        <button type="button" onClick={() => setPhase('active')}>
          再来一次
        </button>
      ) : null}
      <TestExperience profile={profile} reading={reading} phase={phase} onPhaseChange={setPhase} />
    </>
  );
}

describe('TestExperience', () => {
  it('does not show a psychology result before an answer and exposes selection state', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole('button', { name: /心理状态/ }));
    expect(screen.queryByText('今日心理画像')).toBeNull();

    const answer = screen.getByRole('button', { name: /先冲再调/ });
    expect(answer.getAttribute('aria-pressed')).toBe('false');
    await user.click(answer);

    expect(answer.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('今日心理画像')).toBeTruthy();
    expect(screen.getByRole('heading', { name: '行动型节奏' })).toBeTruthy();
  });

  it('clears answers and result on replay, then can return to the test directory', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole('button', { name: /心理状态/ }));
    await user.click(screen.getByRole('button', { name: /先稳住节奏/ }));
    expect(screen.getByText('今日心理画像')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: '再来一次' }));

    expect(screen.queryByText('今日心理画像')).toBeNull();
    expect(screen.getByRole('button', { name: /先稳住节奏/ }).getAttribute('aria-pressed')).toBe(
      'false',
    );

    await user.click(screen.getByRole('button', { name: '返回测试目录' }));
    expect(screen.getByRole('button', { name: /关系合拍/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /今日数字/ })).toBeTruthy();
  });
});
