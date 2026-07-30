import type { NotificationPlatform } from './notification-channel-copy';

const MAX_CUSTOM_TEMPLATE_BYTES = 32 * 1024;

export interface NotificationChannelDraft {
  platform: NotificationPlatform;
  webhookUrl: string;
  customTemplate?: unknown;
}

export function buildNotificationChannelDraft({
  platform,
  webhookUrl,
  templateJson,
}: {
  platform: NotificationPlatform;
  webhookUrl: string;
  templateJson: string;
}): NotificationChannelDraft | { error: string } {
  const trimmedUrl = webhookUrl.trim();
  if (!trimmedUrl) return { error: '请填写通知地址' };

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(trimmedUrl);
  } catch {
    return { error: '通知地址格式不正确，请以 http:// 或 https:// 开头' };
  }
  if (parsedUrl.protocol !== 'https:') {
    return {
      error: '通知地址必须使用 https://，以免通知内容或凭据被窃取',
    };
  }

  if (platform !== 'custom') {
    return { platform, webhookUrl: trimmedUrl };
  }

  try {
    const parsed = JSON.parse(templateJson) as unknown;
    if (parsed === null) {
      return { error: '自定义模板不能为空，请填写可发送的 JSON 内容' };
    }
    if (
      new TextEncoder().encode(JSON.stringify(parsed)).byteLength >
      MAX_CUSTOM_TEMPLATE_BYTES
    ) {
      return { error: '自定义模板不能超过 32 KiB' };
    }
    return {
      platform,
      webhookUrl: trimmedUrl,
      customTemplate: parsed,
    };
  } catch (err) {
    return {
      error: `自定义模板不是合法 JSON：${jsonErrorMessage(err)}`,
    };
  }
}

function jsonErrorMessage(_err: unknown): string {
  return '请检查括号、逗号和引号是否完整';
}
