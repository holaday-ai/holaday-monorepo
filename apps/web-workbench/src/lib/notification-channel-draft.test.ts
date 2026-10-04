import { describe, expect, it } from 'vitest';
import {
  CUSTOM_CHANNEL_DISABLED_ERROR,
  buildNotificationChannelDraft,
} from './notification-channel-draft';

const WECOM = 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=693a91f6-7aaa-4bc4-97a0';
const FEISHU = 'https://open.feishu.cn/open-apis/bot/v2/hook/0f6f3c1e-1234-4abc';
const LARK = 'https://open.larksuite.com/open-apis/bot/v2/hook/0f6f3c1e-1234-4abc';
const DINGTALK = 'https://oapi.dingtalk.com/robot/send?access_token=0123456789abcdef0123';

describe('buildNotificationChannelDraft', () => {
  it('trims and returns official bot webhook drafts', () => {
    expect(
      buildNotificationChannelDraft({ platform: 'wecom', webhookUrl: `  ${WECOM}  ` }),
    ).toEqual({ platform: 'wecom', webhookUrl: WECOM });
    expect(buildNotificationChannelDraft({ platform: 'feishu', webhookUrl: FEISHU })).toEqual({
      platform: 'feishu',
      webhookUrl: FEISHU,
    });
    expect(buildNotificationChannelDraft({ platform: 'feishu', webhookUrl: LARK })).toEqual({
      platform: 'feishu',
      webhookUrl: LARK,
    });
    expect(buildNotificationChannelDraft({ platform: 'dingtalk', webhookUrl: DINGTALK })).toEqual({
      platform: 'dingtalk',
      webhookUrl: DINGTALK,
    });
  });

  it('requires a valid webhook URL', () => {
    expect(buildNotificationChannelDraft({ platform: 'feishu', webhookUrl: '' })).toEqual({
      error: '请填写通知地址',
    });
    expect(buildNotificationChannelDraft({ platform: 'feishu', webhookUrl: 'not-a-url' })).toEqual({
      error: '通知地址格式不正确，请以 https:// 开头',
    });
  });

  it('rejects non-HTTPS webhook URLs before save or test', () => {
    expect(
      buildNotificationChannelDraft({ platform: 'wecom', webhookUrl: WECOM.replace('https', 'http') }),
    ).toEqual({ error: '通知地址必须使用 https://，以免通知内容或凭据被窃取' });
    expect(
      buildNotificationChannelDraft({ platform: 'wecom', webhookUrl: 'javascript:alert(1)' }),
    ).toEqual({ error: '通知地址必须使用 https://，以免通知内容或凭据被窃取' });
  });

  it.each([
    ['third-party domain', 'wecom', 'https://hooks.example.com/cgi-bin/webhook/send?key=abcdefgh'],
    ['spoofed domain', 'wecom', WECOM.replace('qq.com', 'qq.com.evil.com')],
    ['non-443 port', 'feishu', FEISHU.replace('feishu.cn', 'feishu.cn:8443')],
    ['internal IP', 'dingtalk', DINGTALK.replace('oapi.dingtalk.com', '10.0.0.1')],
    ['other platform host', 'wecom', FEISHU],
    ['wrong path', 'dingtalk', 'https://oapi.dingtalk.com/robot/other?access_token=0123456789abcdef'],
  ])('rejects %s', (_label, platform, webhookUrl) => {
    const result = buildNotificationChannelDraft({
      platform: platform as 'wecom' | 'feishu' | 'dingtalk',
      webhookUrl,
    });
    expect('error' in result).toBe(true);
  });

  it('refuses the removed custom platform', () => {
    expect(
      buildNotificationChannelDraft({
        platform: 'custom',
        webhookUrl: 'https://example.com/webhook',
        templateJson: '{"text":"{{message}}"}',
      }),
    ).toEqual({ error: CUSTOM_CHANNEL_DISABLED_ERROR });
  });
});
