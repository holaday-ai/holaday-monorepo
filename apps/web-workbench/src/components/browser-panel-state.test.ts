import { describe, expect, it } from 'vitest';
import {
  browserFrameCanPanInPortraitSheet,
  browserLiveOverlayCopy,
  browserPanelHeaderStatus,
  browserPanelEvidenceHeaderStatus,
  browserReleasedCardCopy,
  browserViewportFrameLabel,
  browserWakeFeedback,
  isBrowserErrorUrl,
  browserPanelDotLabel,
  browserLiveStatusLabel,
  shouldShowBrowserHeader,
  terminalBrowserMissingFrameCopy,
  terminalBrowserTakeoverMessage,
  terminalEvidenceFrameLabel,
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
    expect(
      terminalEvidenceFrameLabel({ status: 'completed', url: 'https://example.com/' }),
    ).toBe('任务已完成 · 浏览器页面');
  });

  it('labels live browser connection states for icon-only status dots', () => {
    expect(browserLiveStatusLabel('idle')).toBe('等待浏览器画面');
    expect(browserLiveStatusLabel('connecting')).toBe('浏览器画面连接中');
    expect(browserLiveStatusLabel('connected')).toBe('浏览器画面已连接');
    expect(browserLiveStatusLabel('disconnected')).toBe('浏览器画面已断开');
    expect(browserLiveStatusLabel('error')).toBe('浏览器画面连接失败');
  });

  it('keeps the browser status dot label neutral for action-needed states', () => {
    expect(browserPanelDotLabel('idle')).toBe('等待浏览器画面');
    expect(browserPanelDotLabel('live')).toBe('浏览器画面已连接');
    expect(browserPanelDotLabel('error')).toBe('需要处理');
  });

  it('derives compact header labels from the browser live state', () => {
    expect(
      browserPanelHeaderStatus({
        dotStatus: 'live',
        liveStatus: 'connecting',
        browserAwaiting: false,
        interactiveActive: false,
        showReconnect: false,
      }),
    ).toMatchObject({
      label: '连接中',
      tone: 'live',
      dotStatus: 'live',
      showLabel: true,
    });
    expect(
      browserPanelHeaderStatus({
        dotStatus: 'live',
        liveStatus: 'disconnected',
        browserAwaiting: false,
        interactiveActive: false,
        showReconnect: false,
      }),
    ).toMatchObject({
      label: '恢复中',
      tone: 'recovering',
      dotStatus: 'live',
      showLabel: true,
    });
    expect(
      browserPanelHeaderStatus({
        dotStatus: 'live',
        liveStatus: 'disconnected',
        browserAwaiting: false,
        interactiveActive: false,
        showReconnect: true,
      }),
    ).toMatchObject({
      label: '已断开',
      tone: 'recovering',
      dotStatus: 'error',
      showLabel: true,
    });
  });

  it('labels terminal evidence headers without implying a live browser', () => {
    expect(browserPanelEvidenceHeaderStatus('completed')).toEqual({
      label: '浏览器',
      tooltip: '任务已完成，显示任务结束时的浏览器页面',
      tone: 'idle',
      dotStatus: 'idle',
      showLabel: true,
    });
  });

  it('marks browser error pages as unsuccessful final browser evidence', () => {
    expect(isBrowserErrorUrl('chrome-error://chromewebdata/')).toBe(true);
    expect(isBrowserErrorUrl('edge-error://edgewebdata/')).toBe(true);
    expect(isBrowserErrorUrl('about:neterror?e=dnsNotFound')).toBe(true);
    expect(isBrowserErrorUrl('https://example.com/')).toBe(false);
    expect(
      terminalEvidenceFrameLabel({
        status: 'completed',
        url: 'chrome-error://chromewebdata/',
      }),
    ).toBe('页面无法打开 · 浏览器页面');
    expect(
      browserPanelEvidenceHeaderStatus(
        'completed',
        'chrome-error://chromewebdata/',
      ),
    ).toEqual({
      label: '浏览器',
      tooltip: '任务已完成，任务结束在浏览器错误页',
      tone: 'attention',
      dotStatus: 'error',
      showLabel: true,
    });
  });

  it('labels screencast frame geometry so narrow panels are easy to verify', () => {
    expect(browserViewportFrameLabel(null)).toBe('视口未知');
    expect(browserViewportFrameLabel({ width: 430, height: 760 })).toBe(
      '430×760 · 竖屏视口',
    );
    expect(browserViewportFrameLabel({ width: 560, height: 720 })).toBe(
      '560×720 · 窄屏视口',
    );
    expect(browserViewportFrameLabel({ width: 1280, height: 800 })).toBe(
      '1280×800 · 桌面帧',
    );
  });

  it('only hints horizontal panning for wide browser frames in portrait sheets', () => {
    expect(
      browserFrameCanPanInPortraitSheet({
        isSheet: true,
        viewport: { width: 1280, height: 800 },
      }),
    ).toBe(true);
    expect(
      browserFrameCanPanInPortraitSheet({
        isSheet: true,
        viewport: { width: 430, height: 760 },
      }),
    ).toBe(false);
    expect(
      browserFrameCanPanInPortraitSheet({
        isSheet: false,
        viewport: { width: 1280, height: 800 },
      }),
    ).toBe(false);
    expect(
      browserFrameCanPanInPortraitSheet({
        isSheet: true,
        viewport: null,
        assumeScrollableWhenUnknown: true,
      }),
    ).toBe(true);
  });

  it('prioritises awaiting-user and takeover states over transport labels', () => {
    expect(
      browserPanelHeaderStatus({
        dotStatus: 'live',
        liveStatus: 'connected',
        browserAwaiting: true,
        interactiveActive: true,
        showReconnect: false,
      }),
    ).toMatchObject({
      label: '待操作',
      tone: 'attention',
      dotStatus: 'error',
    });
    expect(
      browserPanelHeaderStatus({
        dotStatus: 'live',
        liveStatus: 'connected',
        browserAwaiting: false,
        interactiveActive: true,
        showReconnect: false,
      }),
    ).toMatchObject({
      label: '接管中',
      tone: 'takeover',
      dotStatus: 'live',
    });
  });

  it('explains slow browser live-view connections before offering reconnect', () => {
    expect(
      browserLiveOverlayCopy({ status: 'connecting', showReconnect: false }),
    ).toEqual({
      title: '正在连接浏览器画面',
      detail: '浏览器正在启动或恢复连接，任务会继续执行。',
      reconnectLabel: '刷新浏览器画面',
    });
    expect(
      browserLiveOverlayCopy({ status: 'connecting', showReconnect: true }),
    ).toEqual({
      title: '浏览器画面连接时间较久',
      detail: '浏览器可能还在启动。可以继续等待，或手动刷新画面。',
      reconnectLabel: '刷新浏览器画面',
    });
  });

  it('keeps persistent disconnected live views recoverable without implying a rerun', () => {
    expect(
      browserLiveOverlayCopy({ status: 'disconnected', showReconnect: false }),
    ).toEqual({
      title: '浏览器画面正在恢复',
      detail: 'HOLA DAY 正在自动重连。你可以继续等待，任务不会重新提交。',
      reconnectLabel: '刷新浏览器画面',
    });
    expect(
      browserLiveOverlayCopy({ status: 'disconnected', showReconnect: true }),
    ).toEqual({
      title: '浏览器画面已断开',
      detail: '任务可能仍在执行。点击刷新只刷新画面，不会重新提交任务。',
      reconnectLabel: '刷新浏览器画面',
    });
  });

  it('explains persistent live-view errors as view-only recovery', () => {
    expect(
      browserLiveOverlayCopy({ status: 'error', showReconnect: true }),
    ).toEqual({
      title: '浏览器画面连接失败',
      detail: '连接没有建立成功。点击刷新会刷新画面，任务本身会继续处理。',
      reconnectLabel: '刷新浏览器画面',
    });
  });

  it('keeps terminal takeover refusal tied to task state', () => {
    expect(terminalBrowserTakeoverMessage('failed')).toBe(
      '任务未完成，浏览器已关闭。重新执行任务可打开新浏览器。',
    );
  });

  it('frames missing terminal browser frames as a next action, not lost evidence', () => {
    expect(
      terminalBrowserMissingFrameCopy({
        status: 'completed',
        hasFinalUrl: true,
        finalUrlIsError: false,
      }),
    ).toEqual({
      title: '任务已完成，可打开最终页面复核',
      body: '这次任务没有保存浏览器截图，但保留了最终地址。你可以打开页面核对结果。',
      actionLabel: '打开最终地址',
    });
    expect(
      terminalBrowserMissingFrameCopy({
        status: 'failed',
        hasFinalUrl: false,
        finalUrlIsError: true,
      }),
    ).toEqual({
      title: '任务未完成，页面无法打开',
      body: '任务结束在浏览器错误页。请检查网址是否正确，或换一个能直接访问的页面后重新执行。',
      actionLabel: '重新执行',
    });
    expect(
      terminalBrowserMissingFrameCopy({
        status: 'cancelled',
        hasFinalUrl: false,
        finalUrlIsError: false,
      }),
    ).toEqual({
      title: '这条任务没有保存浏览器画面',
      body: '可以重新执行同样的意图，HOLA DAY 会打开新的浏览器并保留新的浏览器画面。',
      actionLabel: '重新执行',
    });
  });

  it('keeps the released-browser card about the browser, not task outcome', () => {
    expect(browserReleasedCardCopy()).toEqual({
      title: '浏览器已释放',
      detail: '当前没有正在运行的浏览器。新任务会自动打开新的浏览器。',
      checkLabel: '检查状态',
      checkingLabel: '检查中',
    });
  });

  it('explains wake-browser results without promising a stale browser', () => {
    expect(browserWakeFeedback('ready')).toEqual({
      message: '已有任务浏览器可连接，正在刷新画面',
      tone: 'info',
    });
    expect(browserWakeFeedback('spawning')).toEqual({
      message: '浏览器正在启动，画面会自动连接',
      tone: 'info',
    });
    expect(browserWakeFeedback('unavailable')).toEqual({
      message: '当前没有正在运行的浏览器。新任务会自动打开浏览器。',
      tone: 'info',
    });
    expect(browserWakeFeedback('weird')).toEqual({
      message: '浏览器状态检查失败，请稍后重试',
      tone: 'error',
    });
  });
});
