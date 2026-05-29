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
    ).toEqual({ error: '请填写 Webhook URL' });

    expect(
      buildNotificationChannelDraft({
        platform: 'feishu',
        webhookUrl: 'not-a-url',
        templateJson: '{}',
      }),
    ).toEqual({
      error: 'Webhook URL 格式不正确，请以 http:// 或 https:// 开头',
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
      error: '自定义模板不能是 null，请填写可发送的 JSON 内容',
    });
  });
});
