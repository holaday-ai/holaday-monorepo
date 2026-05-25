import { describe, expect, it } from 'vitest';
import { shouldKeepProjectFilterForPickedTask } from './task-selection-url-state';

describe('task selection URL state', () => {
  it('keeps unrelated query state when there is no active project filter', () => {
    expect(
      shouldKeepProjectFilterForPickedTask({
        currentProjectId: null,
        taskProjectId: 'proj_a',
      }),
    ).toBe(true);
  });

  it('keeps the active project filter for tasks in that project', () => {
    expect(
      shouldKeepProjectFilterForPickedTask({
        currentProjectId: 'proj_a',
        taskProjectId: 'proj_a',
      }),
    ).toBe(true);
  });

  it('clears the active project filter for cross-project or unknown picks', () => {
    expect(
      shouldKeepProjectFilterForPickedTask({
        currentProjectId: 'proj_a',
        taskProjectId: 'proj_b',
      }),
    ).toBe(false);
    expect(
      shouldKeepProjectFilterForPickedTask({
        currentProjectId: 'proj_a',
        taskProjectId: undefined,
      }),
    ).toBe(false);
  });
});

