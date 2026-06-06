import { describe, expect, it } from 'vitest';
import {
  notificationChannelTestErrorMessage,
  notificationStatusFallback,
  normalizeNotificationChannels,
  notificationChannelsLoadErrorCopy,
  notificationChannelsLoadErrorMessage,
} from './notification-channel-state';

describe('normalizeNotificationChannels', () => {
  it('normalizes notification channel rows before rendering settings', () => {
    expect(
      normalizeNotificationChannels([
        {
          channelId: ' channel-1 ',
          platform: 'wecom',
          webhookUrl: ' https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abc ',
          customTemplate: { text: '{{title}}' },
          enabled: false,
          createdAt: '2026-05-25T00:00:00.000Z',
        },
      ]),
    ).toEqual([
      {
        channelId: 'channel-1',
        platform: 'wecom',
        webhookUrl: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abc',
        customTemplate: { text: '{{title}}' },
        enabled: false,
        createdAt: '2026-05-25T00:00:00.000Z',
      },
    ]);
  });

  it('drops rows without ids and falls back from malformed fields safely', () => {
    expect(
      normalizeNotificationChannels([
        null,
        { platform: 'wecom', webhookUrl: 'https://example.com/no-id' },
        {
          channelId: 'channel-2',
          platform: 'unknown-platform',
          webhookUrl: { unsafe: true },
          enabled: 'false',
          createdAt: { unsafe: true },
        },
      ]),
    ).toEqual([
      {
        channelId: 'channel-2',
        platform: 'custom',
        webhookUrl: '',
        customTemplate: undefined,
        enabled: true,
        createdAt: '',
      },
    ]);
  });

  it('uses an empty list for non-array payloads', () => {
    expect(normalizeNotificationChannels({ rows: [] })).toEqual([]);
    expect(normalizeNotificationChannels(null)).toEqual([]);
  });
});

describe('notificationChannelsLoadErrorMessage', () => {
  it('normalizes notification channel load errors', () => {
    expect(notificationChannelsLoadErrorMessage(new Error('offline'))).toBe(
      '任务执行出错，请重试。如果反复出现请联系 support@holaday.ai。',
    );
    expect(notificationChannelsLoadErrorMessage('Webhook 不可用')).toBe('Webhook 不可用');
    expect(notificationChannelsLoadErrorMessage({})).toBe(
      '通知渠道暂时无法加载，请稍后重试。',
    );
  });

  it('returns title/body copy for rendered load errors', () => {
    expect(notificationChannelsLoadErrorCopy('请稍后重试')).toEqual({
      title: '通知渠道暂时无法加载',
      body: '请稍后重试',
    });
  });
});

describe('notificationChannelTestErrorMessage', () => {
  it('keeps business webhook errors but hides technical English failures', () => {
    expect(
      notificationChannelTestErrorMessage({
        error: 'Webhook 签名错误',
        status: 400,
      }),
    ).toBe('Webhook 签名错误');
    expect(
      notificationChannelTestErrorMessage({
        error: 'FetchError: socket hang up',
        status: 502,
      }),
    ).toBe('任务执行出错，请重试。如果反复出现请联系 support@holaday.ai。');
  });

  it('falls back to friendly delivery guidance when the server gives no message', () => {
    expect(notificationChannelTestErrorMessage({ status: 503 })).toBe(
      '发送失败，对方服务暂时没有接收，请稍后重试。',
    );
    expect(notificationChannelTestErrorMessage({ status: 'bad' })).toBe(
      '发送失败，请稍后重试。',
    );
  });

  it('groups notification status fallbacks by likely next step', () => {
    expect(notificationStatusFallback(401)).toBe(
      '发送失败，请检查通知地址或签名配置后重试。',
    );
    expect(notificationStatusFallback(500)).toBe(
      '发送失败，对方服务暂时没有接收，请稍后重试。',
    );
    expect(notificationStatusFallback(302)).toBe('发送失败，请稍后重试。');
  });
});
