import { describe, expect, it } from 'vitest';
import {
  CUSTOM_WEBHOOK_DISABLED_MESSAGE,
  checkNotificationWebhookUrl,
  describeWebhookForLog,
} from './webhook-url-policy.js';

const WECOM = 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=693a91f6-7xxx-4bc4-97a0-0ec2sifa5aaa';
const FEISHU = 'https://open.feishu.cn/open-apis/bot/v2/hook/0f6f3c1e-1234-4abc-9def-0123456789ab';
const LARK = 'https://open.larksuite.com/open-apis/bot/v2/hook/0f6f3c1e-1234-4abc-9def-0123456789ab';
const DINGTALK =
  'https://oapi.dingtalk.com/robot/send?access_token=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

describe('checkNotificationWebhookUrl — accepts official bot webhooks', () => {
  it.each([
    ['wecom', WECOM],
    ['feishu', FEISHU],
    ['feishu', LARK],
    ['dingtalk', DINGTALK],
    // Explicit :443 is normalised away by the URL parser and is allowed.
    ['wecom', WECOM.replace('qq.com/', 'qq.com:443/')],
    // Hostname comparison happens after URL parsing + lower-casing.
    ['dingtalk', DINGTALK.replace('oapi.dingtalk.com', 'OAPI.DingTalk.com')],
  ])('%s %s', (platform, url) => {
    const result = checkNotificationWebhookUrl(url, platform);
    expect(result.ok).toBe(true);
  });
});

describe('checkNotificationWebhookUrl — rejects everything else', () => {
  it.each([
    ['third-party domain', 'wecom', 'https://hooks.example.com/cgi-bin/webhook/send?key=abcdefgh-1234'],
    ['spoofed suffix domain', 'wecom', 'https://qyapi.weixin.qq.com.evil.com/cgi-bin/webhook/send?key=abcdefgh-1234'],
    ['spoofed prefix domain', 'wecom', 'https://evilqyapi.weixin.qq.com/cgi-bin/webhook/send?key=abcdefgh-1234'],
    ['subdomain of allowed host', 'feishu', 'https://x.open.feishu.cn/open-apis/bot/v2/hook/abcdefgh-1234'],
    ['trailing-dot host', 'dingtalk', 'https://oapi.dingtalk.com./robot/send?access_token=0123456789abcdef'],
    ['userinfo smuggling', 'wecom', 'https://qyapi.weixin.qq.com@evil.com/cgi-bin/webhook/send?key=abcdefgh-1234'],
    ['credentials on allowed host', 'wecom', 'https://u:p@qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abcdefgh-1234'],
    ['plain http', 'wecom', 'http://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abcdefgh-1234'],
    ['non-443 port', 'feishu', 'https://open.feishu.cn:8443/open-apis/bot/v2/hook/abcdefgh-1234'],
    ['port 80 on https', 'dingtalk', 'https://oapi.dingtalk.com:80/robot/send?access_token=0123456789abcdef'],
    ['private IPv4', 'wecom', 'https://10.0.0.1/cgi-bin/webhook/send?key=abcdefgh-1234'],
    ['loopback', 'wecom', 'https://127.0.0.1/cgi-bin/webhook/send?key=abcdefgh-1234'],
    ['metadata IP', 'feishu', 'https://169.254.169.254/open-apis/bot/v2/hook/abcdefgh-1234'],
    ['IPv6 loopback', 'dingtalk', 'https://[::1]/robot/send?access_token=0123456789abcdef'],
    ['localhost', 'wecom', 'https://localhost/cgi-bin/webhook/send?key=abcdefgh-1234'],
    ['host of another platform', 'wecom', FEISHU],
    ['wrong path on allowed host', 'wecom', 'https://qyapi.weixin.qq.com/cgi-bin/gettoken?key=abcdefgh-1234'],
    ['extra query param', 'wecom', `${WECOM}&debug=1`],
    ['duplicated key param', 'wecom', `${WECOM}&key=abcdefgh-9999`],
    ['missing key', 'wecom', 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send'],
    ['feishu with query', 'feishu', `${FEISHU}?x=1`],
    ['feishu traversal', 'feishu', 'https://open.feishu.cn/open-apis/bot/v2/hook/../../admin'],
    ['dingtalk wrong param', 'dingtalk', 'https://oapi.dingtalk.com/robot/send?token=0123456789abcdef'],
    ['fragment', 'feishu', `${FEISHU}#frag`],
    ['not a url', 'wecom', 'qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abcdefgh-1234'],
    ['leading whitespace', 'wecom', ` ${WECOM}`],
  ])('%s', (_label, platform, url) => {
    const result = checkNotificationWebhookUrl(url, platform);
    expect(result.ok).toBe(false);
  });

  it('rejects the legacy custom platform regardless of URL', () => {
    const result = checkNotificationWebhookUrl(WECOM, 'custom');
    expect(result).toEqual({ ok: false, reason: CUSTOM_WEBHOOK_DISABLED_MESSAGE });
  });

  it('never echoes the URL (token) in the rejection reason', () => {
    const secret = 'https://qyapi.weixin.qq.com.evil.com/cgi-bin/webhook/send?key=SECRET-TOKEN-123';
    const result = checkNotificationWebhookUrl(secret, 'wecom');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).not.toContain('SECRET-TOKEN-123');
  });
});

describe('describeWebhookForLog', () => {
  it('keeps only platform + host', () => {
    expect(describeWebhookForLog(WECOM, 'wecom')).toEqual({
      platform: 'wecom',
      host: 'qyapi.weixin.qq.com',
    });
    expect(JSON.stringify(describeWebhookForLog(WECOM, 'wecom'))).not.toContain('key=');
  });

  it('returns null host for garbage', () => {
    expect(describeWebhookForLog('::nope::', 'feishu')).toEqual({ platform: 'feishu', host: null });
  });
});
