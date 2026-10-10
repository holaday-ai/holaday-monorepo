import type { NotificationPlatform } from './notification-channel-copy';

export interface NotificationChannelDraft {
  platform: NotificationPlatform;
  webhookUrl: string;
  customTemplate?: unknown;
}

/**
 * Batch 10.3 — mirror of the server's `webhook-url-policy.ts` so users get
 * instant feedback. The server re-validates (and resolves DNS) on save, test
 * and every send; this copy is UX only.
 */
const PLATFORM_HOSTS: Record<Exclude<NotificationPlatform, 'custom'>, readonly string[]> = {
  wecom: ['qyapi.weixin.qq.com'],
  feishu: ['open.feishu.cn', 'open.larksuite.com'],
  dingtalk: ['oapi.dingtalk.com'],
};

const PLATFORM_EXAMPLE: Record<Exclude<NotificationPlatform, 'custom'>, string> = {
  wecom: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=…',
  feishu: 'https://open.feishu.cn/open-apis/bot/v2/hook/…',
  dingtalk: 'https://oapi.dingtalk.com/robot/send?access_token=…',
};

export const CUSTOM_CHANNEL_DISABLED_ERROR =
  '自定义 Webhook 已停用，仅支持企业微信、飞书、钉钉官方机器人地址';

function singleParam(url: URL, name: string, pattern: RegExp): boolean {
  const keys = [...url.searchParams.keys()];
  if (keys.length !== 1 || keys[0] !== name) return false;
  return pattern.test(url.searchParams.get(name) ?? '');
}

function matchesBotPath(platform: Exclude<NotificationPlatform, 'custom'>, url: URL): boolean {
  if (platform === 'wecom') {
    return url.pathname === '/cgi-bin/webhook/send' && singleParam(url, 'key', /^[A-Za-z0-9-]{8,128}$/);
  }
  if (platform === 'feishu') {
    return /^\/open-apis\/bot\/v2\/hook\/[A-Za-z0-9-]{8,128}$/.test(url.pathname) && url.search === '';
  }
  return url.pathname === '/robot/send' && singleParam(url, 'access_token', /^[A-Za-z0-9]{16,128}$/);
}

export function buildNotificationChannelDraft({
  platform,
  webhookUrl,
}: {
  platform: NotificationPlatform;
  webhookUrl: string;
  /** Legacy field from the removed custom-template editor; ignored. */
  templateJson?: string;
}): NotificationChannelDraft | { error: string } {
  if (platform === 'custom') return { error: CUSTOM_CHANNEL_DISABLED_ERROR };

  const trimmedUrl = webhookUrl.trim();
  if (!trimmedUrl) return { error: '请填写通知地址' };

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(trimmedUrl);
  } catch {
    return { error: '通知地址格式不正确，请以 https:// 开头' };
  }
  if (parsedUrl.protocol !== 'https:') {
    return {
      error: '通知地址必须使用 https://，以免通知内容或凭据被窃取',
    };
  }
  if (parsedUrl.username || parsedUrl.password || parsedUrl.hash) {
    return { error: '通知地址不能包含账号、密码或 # 片段' };
  }
  if (parsedUrl.port !== '' && parsedUrl.port !== '443') {
    return { error: '通知地址只能使用默认的 443 端口' };
  }
  const hosts = PLATFORM_HOSTS[platform];
  if (!hosts.includes(parsedUrl.hostname.toLowerCase())) {
    return { error: `该平台只接受官方机器人域名：${hosts.join('、')}` };
  }
  if (!matchesBotPath(platform, parsedUrl)) {
    return {
      error: `地址不是机器人 Webhook 格式，应类似 ${PLATFORM_EXAMPLE[platform]}`,
    };
  }
  return { platform, webhookUrl: trimmedUrl };
}
