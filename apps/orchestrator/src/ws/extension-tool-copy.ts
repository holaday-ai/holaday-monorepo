export function extensionNoClientMessage(): string {
  return '浏览器扩展未连接，请打开 HOLA DAY 扩展后重试';
}

export function extensionSocketClosedMessage(): string {
  return '浏览器扩展连接已断开，请重新打开 HOLA DAY 扩展后重试';
}

export function extensionToolTimeoutMessage(timeoutMs: number): string {
  const seconds = Math.max(1, Math.round(timeoutMs / 1000));
  return `浏览器扩展响应超时（已等待 ${seconds} 秒）。页面可能仍在加载，请稍后重试`;
}
