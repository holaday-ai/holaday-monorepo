import type { UiStep } from '@/types/task';
// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { recentActivitySteps } from './BrowserPanel';

describe('"最近操作" after a terminal state (FIX-D11)', () => {
  const step = (tickIndex: number, actionKind: string) =>
    ({ tickIndex, actionKind, status: 'running' }) as unknown as UiStep;
  const steps = [step(1, 'upload'), step(2, 'upload'), step(3, 'upload'), step(4, 'upload')];
  it('shows the latest three live actions while the task runs', () => {
    expect(recentActivitySteps(steps, false).map((s) => s.tickIndex)).toEqual([2, 3, 4]);
  });
  it('shows nothing once the task has failed / completed / cancelled', () => {
    expect(recentActivitySteps(steps, true)).toEqual([]);
  });
});
