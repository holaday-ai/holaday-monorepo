import { describe, expect, it } from 'vitest';
import {
  apiKeySettingsActionError,
  apiKeySettingsErrorMessage,
  apiKeySettingsLoadErrorCopy,
  normalizeApiKeyRows,
  normalizeFreshApiKey,
} from './api-key-settings-state';

describe('api key settings state helpers', () => {
  it('normalizes API key rows and trims display fields', () => {
    expect(
      normalizeApiKeyRows([
        {
          apiKeyId: ' key_1 ',
          name: ' Zapier ',
          keyPrefix: ' hd_live_1234 ',
          lastUsedAt: '2026-05-25T00:00:00.000Z',
          expiresAt: null,
          revokedAt: null,
          createdAt: '2026-05-24T00:00:00.000Z',
        },
      ]),
    ).toEqual([
      {
        apiKeyId: 'key_1',
        name: 'Zapier',
        keyPrefix: 'hd_live_1234',
        lastUsedAt: '2026-05-25T00:00:00.000Z',
        expiresAt: null,
        revokedAt: null,
        createdAt: '2026-05-24T00:00:00.000Z',
      },
    ]);
  });

  it('drops rows without a safe id and falls back for optional fields', () => {
    expect(
      normalizeApiKeyRows([
        { apiKeyId: '', name: 'Dropped', keyPrefix: 'hd_live_drop' },
        {
          apiKeyId: 'key_2',
          name: { unsafe: true },
          keyPrefix: { unsafe: true },
          lastUsedAt: { unsafe: true },
          expiresAt: 'not a date',
          revokedAt: new Date('not-a-date'),
          createdAt: '',
        },
      ]),
    ).toEqual([
      {
        apiKeyId: 'key_2',
        name: '未命名 Key',
        keyPrefix: '未知前缀',
        lastUsedAt: null,
        expiresAt: null,
        revokedAt: null,
        createdAt: null,
      },
    ]);
  });

  it('rejects malformed API key list payloads', () => {
    expect(() => normalizeApiKeyRows({ rows: [] })).toThrow(
      'API Key 列表暂时无法读取，请刷新后重试。',
    );
  });

  it('normalizes freshly created one-time API keys', () => {
    expect(
      normalizeFreshApiKey(
        {
          apiKeyId: ' key_3 ',
          plaintext: ' hd_live_secret ',
          name: '',
        },
        'Fallback name',
      ),
    ).toEqual({
      apiKeyId: 'key_3',
      plaintext: 'hd_live_secret',
      name: 'Fallback name',
    });
  });

  it('rejects malformed create results before showing one-time secrets', () => {
    expect(() => normalizeFreshApiKey({ apiKeyId: 'key_4' }, 'Zapier')).toThrow(
      'API Key 已创建，但结果暂时无法确认，请刷新后查看列表。',
    );
    expect(() => normalizeFreshApiKey(null, 'Zapier')).toThrow(
      'API Key 已创建，但结果暂时无法确认，请刷新后查看列表。',
    );
  });

  it('normalizes API key setting errors', () => {
    expect(apiKeySettingsErrorMessage(new Error('offline'))).toBe(
      '任务执行出错，请重试。如果反复出现请联系 support@holaday.ai。',
    );
    expect(apiKeySettingsErrorMessage('Key 已撤销')).toBe('Key 已撤销');
    expect(apiKeySettingsErrorMessage({})).toBe('请稍后重试');
  });

  it('formats API key load errors for user-facing surfaces', () => {
    expect(apiKeySettingsLoadErrorCopy('  offline  ')).toEqual({
      title: 'API Key 暂时无法加载',
      body: 'offline',
    });
    expect(apiKeySettingsLoadErrorCopy(null)).toEqual({
      title: 'API Key 暂时无法加载',
      body: '请稍后重试，或刷新页面后再打开开发者设置。',
    });
  });

  it('keeps API key action context on failures', () => {
    expect(apiKeySettingsActionError('创建失败', {})).toBe('创建失败：请稍后重试');
    expect(apiKeySettingsActionError('撤销失败', 'Key 已撤销')).toBe(
      '撤销失败：Key 已撤销',
    );
  });
});
