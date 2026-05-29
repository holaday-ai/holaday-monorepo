import { classifyBrowserErrorKind } from './browser-error-kind';

export type BrowserNavDirection = 'back' | 'forward' | 'reload' | 'goto';

export type BrowserNavFailureReason =
  | 'bad_scheme'
  | 'missing_url'
  | 'nav_failed'
  | 'no_executor'
  | 'no_history'
  | string;

export function browserNavFailureMessage(
  reason: BrowserNavFailureReason | null | undefined,
  direction: BrowserNavDirection,
): string | null {
  if (reason === 'no_history') {
    return direction === 'back'
      ? '没有可后退的页面'
      : direction === 'forward'
        ? '没有可前进的页面'
        : null;
  }
  if (reason === 'bad_scheme') return '只支持打开 http(s) 链接';
  if (reason === 'missing_url') return '请输入要打开的网址';
  if (reason === 'no_executor') {
    return direction === 'goto'
      ? '当前没有可操作的浏览器，重新执行任务后再打开链接'
      : '当前没有可操作的浏览器，请重新连接或重新执行任务';
  }
  if (reason === 'nav_failed') {
    return direction === 'goto'
      ? '页面跳转超时，可能仍在加载。请稍后重试或换一个网址'
      : `${browserNavActionLabel(direction)}超时，页面可能仍在加载。请稍后重试`;
  }
  return '浏览器操作失败，请稍后重试';
}

export function browserNavExceptionMessage(
  error: unknown,
  direction: BrowserNavDirection,
): string {
  const raw = error instanceof Error ? error.message : String(error ?? '');
  const text = raw.toLowerCase();
  switch (classifyBrowserErrorKind(text)) {
    case 'dns':
      return '无法访问该网址，请检查是否拼写正确';
    case 'ssl':
      return '该网站证书有问题，无法安全连接';
    case 'connection':
      return '无法连接到该站点，请稍后重试或换一个站点';
    case 'page_switch':
      return '页面正在切换，请稍后再试';
    case 'timeout':
    case 'extension_timeout':
      return browserNavFailureMessage('nav_failed', direction) ?? '浏览器操作超时，请稍后重试';
    case 'transport_closed':
      return '浏览器连接中断，请重新连接或重新执行任务';
    default:
      break;
  }
  return `${browserNavActionLabel(direction)}失败，请稍后重试`;
}

function browserNavActionLabel(direction: BrowserNavDirection): string {
  switch (direction) {
    case 'back':
      return '后退';
    case 'forward':
      return '前进';
    case 'reload':
      return '刷新';
    case 'goto':
      return '跳转';
  }
}
