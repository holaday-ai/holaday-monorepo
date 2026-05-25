import { describe, expect, it } from 'vitest';
import {
  apiKeySettingsErrorMessage,
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
          expiresAt: Number.NaN,
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
      'API Key 数据格式异常，请稍后重试。',
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
      'API Key 创建结果格式异常，请稍后重试。',
    );
    expect(() => normalizeFreshApiKey(null, 'Zapier')).toThrow(
      'API Key 创建结果格式异常，请稍后重试。',
    );
  });

  it('normalizes API key setting errors', () => {
    expect(apiKeySettingsErrorMessage(new Error('offline'))).toBe('offline');
    expect(apiKeySettingsErrorMessage('bad gateway')).toBe('bad gateway');
    expect(apiKeySettingsErrorMessage({})).toBe('请稍后重试');
  });
});
