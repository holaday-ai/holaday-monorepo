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
    if (inputs.status === 'disconnected') {
      return {
        title: '实时画面已断开',
        detail: '任务可能仍在执行。重新连接只刷新画面，不会重新提交任务。',
        reconnectLabel: '重新连接实时画面',
      };
    }
    if (inputs.status === 'error') {
      return {
        title: '实时画面连接失败',
        detail: '连接没有建立成功。可以重新连接实时画面，任务本身会继续处理。',
        reconnectLabel: '重新连接实时画面',
      };
    }
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
  if (inputs.status === 'disconnected') {
    return {
      title: '实时画面正在恢复',
      detail: '连接刚刚断开，HOLA DAY 正在自动重连。',
      reconnectLabel: '重新连接实时画面',
    };
  }
  if (inputs.status === 'error') {
    return {
      title: '实时画面暂时不可用',
      detail: '浏览器画面连接失败，任务可能仍在后台继续。',
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
      return { message: '浏览器正在启动，实时画面会自动连接', tone: 'info' };
    case 'unavailable':
      return {
        message: '当前没有正在运行的浏览器。新任务会自动打开浏览器。',
        tone: 'info',
      };
    default:
      return { message: '浏览器状态检查失败，请稍后重试', tone: 'error' };
  }
}
