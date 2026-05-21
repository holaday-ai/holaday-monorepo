import { describe, expect, it } from 'vitest';
import {
  shouldShowBrowserHeader,
  terminalEvidenceStatusLabel,
} from './browser-panel-state';

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

  it('labels terminal browser evidence by the actual task status', () => {
    expect(terminalEvidenceStatusLabel('completed')).toBe('任务已完成');
    expect(terminalEvidenceStatusLabel('partial_success')).toBe('部分完成');
    expect(terminalEvidenceStatusLabel('failed')).toBe('任务未完成');
    expect(terminalEvidenceStatusLabel('cancelled')).toBe('任务已取消');
    expect(terminalEvidenceStatusLabel('executing')).toBe('任务已结束');
    expect(terminalEvidenceStatusLabel(null)).toBe('任务已结束');
  });
});
