export interface WsConnectionStatus {
  connected: boolean;
  readyState: number | null;
  reconnectAttempt: number;
  reconnectCapped: boolean;
  lastOpenAt: number | null;
  lastCloseAt: number | null;
  lastCloseCode: number | null;
  lastCloseReason: string | null;
  lastErrorAt: number | null;
  nextRetryAt: number | null;
}

export interface ExtensionStatusResponse {
  lastWelcomeAt: number | null;
  ws?: WsConnectionStatus;
}

export interface ConnectionStatusCopy {
  title: string;
  detail: string;
}

const WS_CONNECTING = 0;
const MAX_NETWORK_RECONNECTS = 3;
const MAX_CLOSE_REASON_CHARS = 40;

export function mergeConnectionStatusPoll(
  previous: ExtensionStatusResponse | null,
  next: ExtensionStatusResponse | null,
): ExtensionStatusResponse | null {
  return next ?? previous;
}

export function getConnectionStatusCopy(
  status: ExtensionStatusResponse | null,
): ConnectionStatusCopy {
  if (!status?.ws) {
    return { title: '浏览器代理状态同步中', detail: '正在读取扩展后台连接状态' };
  }
  if (status.ws.connected) {
    const currentSocketConfirmed =
      typeof status.lastWelcomeAt === 'number' &&
      (!status.ws.lastOpenAt || status.lastWelcomeAt >= status.ws.lastOpenAt);
    return {
      title: currentSocketConfirmed ? '浏览器代理已连接' : '浏览器代理正在确认连接',
      detail: currentSocketConfirmed && status.lastWelcomeAt
        ? `最近确认：${formatRelativeTime(status.lastWelcomeAt)}`
        : '连接已建立，正在等待服务确认',
    };
  }

  const reason = formatWsCloseReason(status.ws.lastCloseReason);
  if (status.ws.readyState === WS_CONNECTING) {
    const retryCopy = status.ws.nextRetryAt ? `下次尝试：${formatRelativeTime(status.ws.nextRetryAt)}` : null;
    return {
      title: '浏览器代理正在连接',
      detail: [
        reason ? `最近错误：${reason}` : '正在检查服务并建立安全连接',
        retryCopy,
      ]
        .filter(Boolean)
        .join('；'),
    };
  }
  if (status.ws.reconnectCapped) {
    return {
      title: '浏览器代理连接已暂停',
      detail: reason
        ? `多次重连失败：${reason}。点击底部“重试连接”后会重新尝试`
        : '多次重连失败，点击底部“重试连接”后会重新尝试',
    };
  }
  if (status.ws.reconnectAttempt > 0) {
    return {
      title: `浏览器代理正在重连（${status.ws.reconnectAttempt}/${MAX_NETWORK_RECONNECTS}）`,
      detail: [
        reason ? `最近错误：${reason}` : null,
        status.ws.nextRetryAt ? `下次尝试：${formatRelativeTime(status.ws.nextRetryAt)}` : '等待下一次重连',
      ]
        .filter(Boolean)
        .join('；'),
    };
  }
  if (reason) {
    return {
      title: '浏览器代理等待恢复',
      detail: `最近错误：${reason}。打开 HOLA DAY 网页后会自动同步登录态`,
    };
  }
  return { title: '浏览器代理等待连接', detail: '打开 HOLA DAY 网页后会自动同步登录态' };
}

export function formatWsCloseReason(reason: string | null | undefined): string | null {
  if (!reason) return null;
  const lower = reason.toLowerCase();
  if (lower.includes('502') || lower.includes('bad gateway') || lower.includes('unexpected response code')) {
    return '代理服务暂时不可用';
  }
  if (lower.includes('err_connection_closed') || lower.includes('connection_closed')) {
    return '网络连接被关闭';
  }
  if (lower.includes('err_connection_reset') || lower.includes('connection_reset')) {
    return '网络连接已重置';
  }
  if (lower.includes('websocket') && lower.includes('handshake')) return '连接握手失败';
  if (lower.includes('ws route check failed')) return '代理服务暂时不可用';
  if (lower.includes('health check failed')) return '服务暂时不可用';
  if (lower.includes('network error')) return '网络连接被关闭';
  if (lower.includes('open timeout')) return '连接握手超时';
  if (lower.includes('send failed')) return '消息发送失败';
  if (lower.includes('client requested disconnect')) return '后台刚重载，正在恢复';
  if (lower.includes('token swap')) return '登录态已切换，正在确认';
  if (lower.includes('policy violation')) return '服务拒绝了当前连接';
  if (lower.includes('constructor') || lower.includes('open failed')) return '连接初始化失败';
  if (containsSensitiveKeyValue(reason)) return '连接异常，正在恢复';
  if (lower.includes('websocket') || looksLikeEnglishTech(reason)) return '连接异常，正在恢复';
  return reason.length > MAX_CLOSE_REASON_CHARS
    ? `${reason.slice(0, MAX_CLOSE_REASON_CHARS)}...`
    : reason;
}

function containsSensitiveKeyValue(text: string): boolean {
  return /(^|[?&#\s])(?:access[_-]?token|auth[_-]?token|session[_-]?id|session|token|secret|password)=/i.test(
    text,
  );
}

function looksLikeEnglishTech(text: string): boolean {
  let ascii = 0;
  for (const ch of text) {
    if (ch.codePointAt(0)! < 128) ascii += 1;
  }
  return ascii / text.length > 0.85;
}

export function formatRelativeTime(at: number): string {
  const deltaMs = at - Date.now();
  const absSeconds = Math.max(0, Math.round(Math.abs(deltaMs) / 1000));
  if (absSeconds < 5) return deltaMs >= 0 ? '几秒后' : '刚刚';
  if (absSeconds < 60) return deltaMs >= 0 ? `${absSeconds} 秒后` : `${absSeconds} 秒前`;
  const minutes = Math.round(absSeconds / 60);
  return deltaMs >= 0 ? `${minutes} 分钟后` : `${minutes} 分钟前`;
}
