import { describe, expect, it } from 'vitest';
import {
  maskWebhookUrl,
  notificationChannelDeleteDescription,
} from './notification-channel-copy';

describe('maskWebhookUrl', () => {
  it('masks a webhook URL without exposing the full URL', () => {
    const url =
      'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=super-secret-token';

    const masked = maskWebhookUrl(url);

    expect(masked).toBe('qyapi.weixin.qq.com/...-token');
    expect(masked).not.toContain('super-secret-token');
    expect(masked).not.toBe(url);
  });

  it('falls back to showing only the head and tail for invalid URLs', () => {
    const secret = 'not-a-url-with-secret-token';

    const masked = maskWebhookUrl(secret);

    expect(masked).toBe('not-...oken');
    expect(masked).not.toContain('url-with-secret');
    expect(masked).not.toBe(secret);
  });

  it('does not echo very short opaque values', () => {
    expect(maskWebhookUrl('abc')).toBe('••••');
    expect(maskWebhookUrl('abcdef')).toBe('ab...ef');
  });
});

describe('notificationChannelDeleteDescription', () => {
  it('uses the platform label and masked webhook URL', () => {
    const description = notificationChannelDeleteDescription({
      platform: 'wecom',
      webhookUrl:
        'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=super-secret-token',
    });

    expect(description).toContain('企业微信 · qyapi.weixin.qq.com/...-token');
    expect(description).toContain('删除后该渠道将不再收到任何通知。');
    expect(description).not.toContain('super-secret-token');
  });
});
