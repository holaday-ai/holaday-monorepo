import { describe, expect, it } from 'vitest';
import { shouldShowBrowserHeader } from './browser-panel-state';

describe('BrowserPanel state helpers', () => {
  it('does not show browser chrome for a terminal task with no task-owned evidence', () => {
    expect(
      shouldShowBrowserHeader({
        taskIsTerminal: true,
        hasCurrentFrame: false,
        hasFinalEvidence: false,
        interactiveActive: false,
      }),
    ).toBe(false);
  });

  it('shows browser chrome for live tasks and terminal tasks with their own evidence', () => {
    expect(
      shouldShowBrowserHeader({
        taskIsTerminal: false,
        hasCurrentFrame: false,
        hasFinalEvidence: false,
        interactiveActive: false,
      }),
    ).toBe(true);
    expect(
      shouldShowBrowserHeader({
        taskIsTerminal: true,
        hasCurrentFrame: false,
        hasFinalEvidence: true,
        interactiveActive: false,
      }),
    ).toBe(true);
  });
});
