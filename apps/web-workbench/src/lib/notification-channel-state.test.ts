import { describe, expect, it } from 'vitest';
import {
  normalizeNotificationChannels,
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
    expect(notificationChannelsLoadErrorMessage(new Error('offline'))).toBe('offline');
    expect(notificationChannelsLoadErrorMessage('bad gateway')).toBe('bad gateway');
    expect(notificationChannelsLoadErrorMessage({})).toBe(
      '通知渠道暂时无法加载，请稍后重试。',
    );
  });
});
