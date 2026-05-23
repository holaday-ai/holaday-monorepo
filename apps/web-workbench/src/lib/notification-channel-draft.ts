import type { NotificationPlatform } from './notification-channel-copy';

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
  if (!trimmedUrl) return { error: '请填写 Webhook URL' };

  try {
    new URL(trimmedUrl);
  } catch {
    return { error: 'Webhook URL 格式不正确，请以 http:// 或 https:// 开头' };
  }

  if (platform !== 'custom') {
    return { platform, webhookUrl: trimmedUrl };
  }

  try {
    const parsed = JSON.parse(templateJson) as unknown;
    if (parsed === null) {
      return { error: '自定义模板不能是 null，请填写可发送的 JSON 内容' };
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

function jsonErrorMessage(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  return err.message.replace(/^JSON Parse error:\s*/i, '');
}
