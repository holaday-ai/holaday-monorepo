export type NotificationPlatform = 'wecom' | 'feishu' | 'dingtalk' | 'custom';

export const NOTIFICATION_PLATFORM_LABEL: Record<NotificationPlatform, string> = {
  wecom: '企业微信',
  feishu: '飞书',
  dingtalk: '钉钉',
  custom: '自定义',
};

export function maskWebhookUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return '未填写 URL';

  try {
    const parsed = new URL(trimmed);
    const secretBearingPart =
      `${parsed.pathname}${parsed.search}${parsed.hash}` || trimmed;
    const tail = secretBearingPart.slice(-6);
    return tail ? `${parsed.host}/...${tail}` : `${parsed.host}/...`;
  } catch {
    return maskOpaqueSecret(trimmed);
  }
}

export function notificationChannelDeleteDescription({
  platform,
  webhookUrl,
}: {
  platform: NotificationPlatform;
  webhookUrl: string;
}): string {
  return `${NOTIFICATION_PLATFORM_LABEL[platform]} · ${maskWebhookUrl(webhookUrl)}
删除后该渠道将不再收到任何通知。已发出的通知不受影响。`;
}

function maskOpaqueSecret(value: string): string {
  if (value.length <= 4) return '••••';
  if (value.length <= 8) return `${value.slice(0, 2)}...${value.slice(-2)}`;
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}
