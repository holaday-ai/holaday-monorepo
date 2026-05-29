import type { UiTaskStatus } from '@/types/task';

export type BrowserLiveStatus = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error';

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
      return '部分完成';
    case 'failed':
      return '任务未完成';
    case 'cancelled':
      return '任务已取消';
    default:
      return '任务已结束';
  }
}

export function browserLiveStatusLabel(status: BrowserLiveStatus): string {
  switch (status) {
    case 'connected':
      return '实时画面已连接';
    case 'connecting':
      return '实时画面连接中';
    case 'disconnected':
      return '实时画面已断开';
    case 'error':
      return '实时画面连接失败';
    case 'idle':
    default:
      return '等待实时画面';
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

export function browserLiveOverlayCopy(inputs: {
  status: BrowserLiveStatus;
  showReconnect: boolean;
}): { title: string; detail: string; reconnectLabel: string } {
  if (inputs.showReconnect) {
    return {
      title: '实时画面连接时间较久',
      detail: '浏览器可能还在启动，或连接刚刚断开。可以手动重新连接。',
      reconnectLabel: '重新连接实时画面',
    };
  }
  if (inputs.status === 'idle') {
    return {
      title: '正在准备实时画面',
      detail: '任务开始后会自动连接到浏览器。',
      reconnectLabel: '重新连接实时画面',
    };
  }
  return {
    title: '正在连接实时画面',
    detail: '通常几秒内恢复；任务仍会继续执行。',
    reconnectLabel: '重新连接实时画面',
  };
}

export function terminalBrowserTakeoverMessage(status: UiTaskStatus | null | undefined): string {
  return `${terminalEvidenceStatusLabel(status)}，实时浏览器已关闭。重新执行任务可打开新浏览器。`;
}
