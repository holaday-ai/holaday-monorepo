import type { UiTaskStatus } from '@/types/task';

export type BrowserLiveStatus = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error';
export type BrowserPanelHeaderTone =
  | 'idle'
  | 'live'
  | 'recovering'
  | 'attention'
  | 'takeover'
  | 'error';

export interface BrowserPanelHeaderStatus {
  label: string;
  tooltip: string;
  tone: BrowserPanelHeaderTone;
  dotStatus: 'idle' | 'live' | 'error';
  showLabel: boolean;
}

export function shouldShowBrowserHeader(inputs: {
  taskIsTerminal: boolean;
  hasCurrentFrame: boolean;
  hasFinalEvidence: boolean;
  interactiveActive: boolean;
}): boolean {
  if (!inputs.taskIsTerminal) return true;
  return (
    inputs.hasCurrentFrame ||
    inputs.hasFinalEvidence ||
    inputs.interactiveActive
  );
}

export function terminalEvidenceStatusLabel(
  status: UiTaskStatus | null | undefined,
): string {
  switch (status) {
    case 'completed':
      return '任务已完成';
    case 'partial_success':
      return '任务需复核';
    case 'failed':
      return '任务未完成';
    case 'cancelled':
      return '任务已取消';
    default:
      return '任务已结束';
  }
}

export function isBrowserErrorUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  const normalized = url.trim().toLowerCase();
  return (
    normalized.startsWith('chrome-error://') ||
    normalized.startsWith('edge-error://') ||
    normalized.startsWith('about:neterror')
  );
}

export function terminalEvidenceFrameLabel(inputs: {
  status: UiTaskStatus | null | undefined;
  url?: string | null;
}): string {
  const statusLabel = terminalEvidenceStatusLabel(inputs.status);
  return isBrowserErrorUrl(inputs.url)
    ? '页面无法打开 · 浏览器页面'
    : `${statusLabel} · 浏览器页面`;
}

export function browserLiveStatusLabel(status: BrowserLiveStatus): string {
  switch (status) {
    case 'connected':
      return '浏览器画面已连接';
    case 'connecting':
      return '浏览器画面连接中';
    case 'disconnected':
      return '浏览器画面已断开';
    case 'error':
      return '浏览器画面连接失败';
    case 'idle':
    default:
      return '等待浏览器画面';
  }
}

export function browserPanelDotLabel(status: 'idle' | 'live' | 'error'): string {
  switch (status) {
    case 'live':
      return browserLiveStatusLabel('connected');
    case 'error':
      return '需要处理';
    case 'idle':
    default:
      return browserLiveStatusLabel('idle');
  }
}

export function browserPanelHeaderStatus(inputs: {
  dotStatus: 'idle' | 'live' | 'error';
  liveStatus: BrowserLiveStatus;
  browserAwaiting: boolean;
  interactiveActive: boolean;
  showReconnect: boolean;
}): BrowserPanelHeaderStatus {
  if (inputs.browserAwaiting) {
    return {
      label: '待操作',
      tooltip: '等待你在浏览器里完成登录、验证或授权',
      tone: 'attention',
      dotStatus: 'error',
      showLabel: true,
    };
  }
  if (inputs.interactiveActive) {
    return {
      label: '接管中',
      tooltip: '你正在直接操作浏览器，点接管按钮可交还给 AI',
      tone: 'takeover',
      dotStatus: 'live',
      showLabel: true,
    };
  }
  if (inputs.liveStatus === 'connected') {
    return {
      label: '已连接',
      tooltip: browserLiveStatusLabel('connected'),
      tone: 'live',
      dotStatus: 'live',
      showLabel: false,
    };
  }
  if (inputs.liveStatus === 'connecting') {
    return {
      label: '连接中',
      tooltip: '正在连接浏览器画面',
      tone: 'live',
      dotStatus: 'live',
      showLabel: true,
    };
  }
  if (inputs.liveStatus === 'disconnected') {
    return {
      label: inputs.showReconnect ? '已断开' : '恢复中',
      tooltip: inputs.showReconnect
        ? '浏览器画面已断开，可手动刷新画面'
        : '浏览器画面短暂断开，正在自动恢复',
      tone: 'recovering',
      dotStatus: inputs.showReconnect ? 'error' : 'live',
      showLabel: true,
    };
  }
  if (inputs.liveStatus === 'error') {
    return {
      label: '连接失败',
      tooltip: '浏览器画面连接失败，可刷新画面',
      tone: 'error',
      dotStatus: 'error',
      showLabel: true,
    };
  }
  return {
    label: inputs.dotStatus === 'live' ? '准备中' : '待启动',
    tooltip:
      inputs.dotStatus === 'live'
        ? '浏览器正在启动，画面准备好后会自动出现'
        : browserPanelDotLabel(inputs.dotStatus),
    tone: inputs.dotStatus === 'live' ? 'live' : 'idle',
    dotStatus: inputs.dotStatus,
    showLabel: inputs.dotStatus === 'live',
  };
}

export function browserPanelEvidenceHeaderStatus(
  status: UiTaskStatus | null | undefined,
  finalUrl?: string | null,
): BrowserPanelHeaderStatus {
  const label = '浏览器';
  const statusLabel = terminalEvidenceStatusLabel(status);
  const errorPage = isBrowserErrorUrl(finalUrl);
  return {
    label,
    tooltip: errorPage
      ? `${statusLabel}，任务结束在浏览器错误页`
      : `${statusLabel}，显示任务结束时的浏览器页面`,
    tone: errorPage ? 'attention' : 'idle',
    dotStatus: errorPage ? 'error' : 'idle',
    showLabel: true,
  };
}

export function browserViewportFrameLabel(
  viewport: { width: number; height: number } | null | undefined,
): string {
  if (!viewport || viewport.width <= 0 || viewport.height <= 0) return '视口未知';
  const size = `${viewport.width}×${viewport.height}`;
  const aspect = viewport.width / viewport.height;
  if (viewport.width <= 480 && aspect < 0.75) return `${size} · 竖屏视口`;
  if (viewport.width <= 720 && aspect < 0.9) return `${size} · 窄屏视口`;
  if (viewport.width >= 1200 && aspect > 1.3) return `${size} · 桌面帧`;
  return size;
}

export function browserFrameCanPanInPortraitSheet(inputs: {
  isSheet: boolean;
  viewport: { width: number; height: number } | null | undefined;
  assumeScrollableWhenUnknown?: boolean;
}): boolean {
  if (!inputs.isSheet) return false;
  const { viewport } = inputs;
  if (!viewport || viewport.width <= 0 || viewport.height <= 0) {
    return Boolean(inputs.assumeScrollableWhenUnknown);
  }
  return viewport.width / viewport.height > 1.12;
}

export function browserLiveOverlayCopy(inputs: {
  status: BrowserLiveStatus;
  showReconnect: boolean;
}): { title: string; detail: string; reconnectLabel: string } {
  if (inputs.showReconnect) {
    if (inputs.status === 'disconnected') {
      return {
        title: '浏览器画面已断开',
        detail: '任务可能仍在执行。点击刷新只刷新画面，不会重新提交任务。',
        reconnectLabel: '刷新浏览器画面',
      };
    }
    if (inputs.status === 'error') {
      return {
        title: '浏览器画面连接失败',
        detail: '连接没有建立成功。点击刷新会刷新画面，任务本身会继续处理。',
        reconnectLabel: '刷新浏览器画面',
      };
    }
    return {
      title: '浏览器画面连接时间较久',
      detail: '浏览器可能还在启动。可以继续等待，或手动刷新画面。',
      reconnectLabel: '刷新浏览器画面',
    };
  }
  if (inputs.status === 'idle') {
    return {
      title: '正在准备浏览器画面',
      detail: '任务开始后会自动连接到浏览器。',
      reconnectLabel: '刷新浏览器画面',
    };
  }
  if (inputs.status === 'disconnected') {
    return {
      title: '浏览器画面正在恢复',
      detail: 'HOLA DAY 正在自动重连。你可以继续等待，任务不会重新提交。',
      reconnectLabel: '刷新浏览器画面',
    };
  }
  if (inputs.status === 'error') {
    return {
      title: '浏览器画面暂时不可用',
      detail: '浏览器画面连接失败，任务可能仍在后台继续。',
      reconnectLabel: '刷新浏览器画面',
    };
  }
  return {
    title: '正在连接浏览器画面',
    detail: '浏览器正在启动或恢复连接，任务会继续执行。',
    reconnectLabel: '刷新浏览器画面',
  };
}

export function terminalBrowserTakeoverMessage(status: UiTaskStatus | null | undefined): string {
  return `${terminalEvidenceStatusLabel(status)}，浏览器已关闭。重新执行任务可打开新浏览器。`;
}

export function browserReleasedCardCopy(): {
  title: string;
  detail: string;
  checkLabel: string;
  checkingLabel: string;
} {
  return {
    title: '浏览器已释放',
    detail: '当前没有正在运行的浏览器。新任务会自动打开新的浏览器。',
    checkLabel: '检查状态',
    checkingLabel: '检查中',
  };
}

export function browserWakeFeedback(
  status: string | null | undefined,
): { message: string; tone: 'info' | 'error' } {
  switch (status) {
    case 'ready':
      return { message: '已有任务浏览器可连接，正在刷新画面', tone: 'info' };
    case 'spawning':
      return { message: '浏览器正在启动，画面会自动连接', tone: 'info' };
    case 'unavailable':
      return {
        message: '当前没有正在运行的浏览器。新任务会自动打开浏览器。',
        tone: 'info',
      };
    default:
      return { message: '浏览器状态检查失败，请稍后重试', tone: 'error' };
  }
}

export function terminalBrowserMissingFrameCopy(inputs: {
  status: UiTaskStatus | null | undefined;
  hasFinalUrl: boolean;
  finalUrlIsError: boolean;
}): { title: string; body: string; actionLabel?: string } {
  const statusLabel = terminalEvidenceStatusLabel(inputs.status);
  if (inputs.finalUrlIsError) {
    return {
      title: `${statusLabel}，页面无法打开`,
      body: '任务结束在浏览器错误页。请检查网址是否正确，或换一个能直接访问的页面后重新执行。',
      actionLabel: '重新执行',
    };
  }
  if (inputs.hasFinalUrl) {
    return {
      title: `${statusLabel}，可打开最终页面复核`,
      body: '这次任务没有保存浏览器截图，但保留了最终地址。你可以打开页面核对结果。',
      actionLabel: '打开最终地址',
    };
  }
  return {
    title: '这条任务没有保存浏览器画面',
    body: '可以重新执行同样的意图，HOLA DAY 会打开新的浏览器并保留新的浏览器画面。',
    actionLabel: '重新执行',
  };
}
