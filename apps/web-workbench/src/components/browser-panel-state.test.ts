import { describe, expect, it } from 'vitest';
import {
  browserLiveOverlayCopy,
  browserPanelDotLabel,
  browserLiveStatusLabel,
  shouldShowBrowserHeader,
  terminalBrowserTakeoverMessage,
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

  it('labels live browser connection states for icon-only status dots', () => {
    expect(browserLiveStatusLabel('idle')).toBe('等待实时画面');
    expect(browserLiveStatusLabel('connecting')).toBe('实时画面连接中');
    expect(browserLiveStatusLabel('connected')).toBe('实时画面已连接');
    expect(browserLiveStatusLabel('disconnected')).toBe('实时画面已断开');
    expect(browserLiveStatusLabel('error')).toBe('实时画面连接失败');
  });

  it('keeps the browser status dot label neutral for action-needed states', () => {
    expect(browserPanelDotLabel('idle')).toBe('等待实时画面');
    expect(browserPanelDotLabel('live')).toBe('实时画面已连接');
    expect(browserPanelDotLabel('error')).toBe('需要处理');
  });

  it('explains slow browser live-view connections before offering reconnect', () => {
    expect(
      browserLiveOverlayCopy({ status: 'connecting', showReconnect: false }),
    ).toEqual({
      title: '正在连接实时画面',
      detail: '通常几秒内恢复；任务仍会继续执行。',
      reconnectLabel: '重新连接实时画面',
    });
    expect(
      browserLiveOverlayCopy({ status: 'connecting', showReconnect: true }),
    ).toEqual({
      title: '实时画面连接时间较久',
      detail: '浏览器可能还在启动，或连接刚刚断开。可以手动重新连接。',
      reconnectLabel: '重新连接实时画面',
    });
  });

  it('keeps terminal takeover refusal tied to task state', () => {
    expect(terminalBrowserTakeoverMessage('failed')).toBe(
      '任务未完成，实时浏览器已关闭。重新执行任务可打开新浏览器。',
    );
  });
});
