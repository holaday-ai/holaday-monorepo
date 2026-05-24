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
  if (reason === 'no_executor') return '浏览器会话已断开，请唤醒或重新执行任务';
  if (reason === 'nav_failed') return '页面跳转超时或失败，请稍后重试';
  return '浏览器操作失败，请稍后重试';
}
