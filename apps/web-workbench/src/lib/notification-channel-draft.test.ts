import { describe, expect, it } from 'vitest';
import { buildNotificationChannelDraft } from './notification-channel-draft';

describe('buildNotificationChannelDraft', () => {
  it('trims and returns preset platform drafts without a custom template', () => {
    expect(
      buildNotificationChannelDraft({
        platform: 'wecom',
        webhookUrl: '  https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abc  ',
        templateJson: 'null',
      }),
    ).toEqual({
      platform: 'wecom',
      webhookUrl: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abc',
    });
  });

  it('requires a valid webhook URL', () => {
    expect(
      buildNotificationChannelDraft({
        platform: 'feishu',
        webhookUrl: '',
        templateJson: '{}',
      }),
    ).toEqual({ error: '请填写通知地址' });

    expect(
      buildNotificationChannelDraft({
        platform: 'feishu',
        webhookUrl: 'not-a-url',
        templateJson: '{}',
      }),
    ).toEqual({
      error: '通知地址格式不正确，请以 http:// 或 https:// 开头',
    });
  });

  it('rejects non-HTTPS webhook URLs before save or test', () => {
    expect(
      buildNotificationChannelDraft({
        platform: 'custom',
        webhookUrl: 'http://hooks.example.com/notify',
        templateJson: '{"text":"{{message}}"}',
      }),
    ).toEqual({
      error: '通知地址必须使用 https://，以免通知内容或凭据被窃取',
    });

    expect(
      buildNotificationChannelDraft({
        platform: 'custom',
        webhookUrl: 'javascript:alert(1)',
        templateJson: '{"text":"{{message}}"}',
      }),
    ).toEqual({
      error: '通知地址必须使用 https://，以免通知内容或凭据被窃取',
    });
  });

  it('parses custom JSON templates before saving or testing', () => {
    expect(
      buildNotificationChannelDraft({
        platform: 'custom',
        webhookUrl: 'https://example.com/webhook',
        templateJson: '{"text":"{{title}} - {{message}}"}',
      }),
    ).toEqual({
      platform: 'custom',
      webhookUrl: 'https://example.com/webhook',
      customTemplate: { text: '{{title}} - {{message}}' },
    });
  });

  it('rejects invalid custom JSON with a friendly repair hint', () => {
    const result = buildNotificationChannelDraft({
      platform: 'custom',
      webhookUrl: 'https://example.com/webhook',
      templateJson: '{"text":',
    });

    expect('error' in result ? result.error : '').toBe(
      '自定义模板不是合法 JSON：请检查括号、逗号和引号是否完整',
    );
  });

  it('rejects null custom templates before the server does', () => {
    expect(
      buildNotificationChannelDraft({
        platform: 'custom',
        webhookUrl: 'https://example.com/webhook',
        templateJson: 'null',
      }),
    ).toEqual({
      error: '自定义模板不能为空，请填写可发送的 JSON 内容',
    });
  });

  it('rejects oversized custom templates before save or test', () => {
    expect(
      buildNotificationChannelDraft({
        platform: 'custom',
        webhookUrl: 'https://example.com/webhook',
        templateJson: JSON.stringify({ text: 'x'.repeat(32_769) }),
      }),
    ).toEqual({
      error: '自定义模板不能超过 32 KiB',
    });
  });
});
