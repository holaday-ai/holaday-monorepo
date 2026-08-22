import { describe, expect, it } from 'vitest';
import {
  formatMemoryDate,
  memoryCategoryLabel,
  memoryLoadErrorCopy,
  memoryLoadErrorMessage,
  normalizeMemoryRows,
} from './memory-settings-state';

describe('memory settings state helpers', () => {
  it('normalizes valid memory rows and trims display fields', () => {
    expect(
      normalizeMemoryRows({
        memories: [
          {
            externalId: ' mem_1 ',
            category: ' preference ',
            keyName: ' Theme ',
            value: ' Prefers concise answers ',
            expiresAt: null,
            updatedAt: '2026-05-25T00:00:00.000Z',
          },
        ],
      }),
    ).toEqual([
      {
        externalId: 'mem_1',
        category: 'preference',
        keyName: 'Theme',
        value: 'Prefers concise answers',
        expiresAt: null,
        updatedAt: '2026-05-25T00:00:00.000Z',
      },
    ]);
  });

  it('drops rows that cannot be deleted safely and falls back for display fields', () => {
    expect(
      normalizeMemoryRows({
        memories: [
          {
            externalId: '',
            category: 'preference',
            keyName: 'Dropped',
            value: 'No external id',
          },
          {
            externalId: 'mem_2',
            category: { unsafe: true },
            keyName: { unsafe: true },
            value: { unsafe: true },
            expiresAt: { unsafe: true },
            updatedAt: { unsafe: true },
          },
        ],
      }),
    ).toEqual([
      {
        externalId: 'mem_2',
        category: 'task_history',
        keyName: '记忆 2',
        value: '暂无内容。',
        expiresAt: null,
        updatedAt: '',
      },
    ]);
  });

  it('rejects malformed memory payload roots', () => {
    expect(() => normalizeMemoryRows(null)).toThrow('AI 记忆暂时无法读取，请刷新后重试。');
    expect(() => normalizeMemoryRows({ memories: { bad: true } })).toThrow(
      'AI 记忆暂时无法读取，请刷新后重试。',
    );
  });

  it('labels known categories and sanitizes unknown values', () => {
    expect(memoryCategoryLabel('preference')).toBe('偏好');
    expect(memoryCategoryLabel(' custom ')).toBe('custom');
    expect(memoryCategoryLabel({ unsafe: true })).toBe('记忆');
  });

  it('normalizes memory load errors', () => {
    expect(memoryLoadErrorMessage(new Error('offline'))).toBe(
      '任务执行出错，请重试。如果反复出现请联系 support@holaday.ai。',
    );
    expect(memoryLoadErrorMessage('记忆不存在')).toBe('记忆不存在');
    expect(memoryLoadErrorMessage({})).toBe('AI 记忆暂时无法加载，请稍后重试。');
  });

  it('formats memory load errors for user-facing surfaces', () => {
    expect(memoryLoadErrorCopy('  offline  ')).toEqual({
      title: 'AI 记忆暂时无法加载',
      body: 'offline',
    });
    expect(memoryLoadErrorCopy(null)).toEqual({
      title: 'AI 记忆暂时无法加载',
      body: '请稍后重试，或刷新页面后再打开设置。',
    });
  });

  it('formats memory dates in the product timezone and rejects invalid values', () => {
    expect(formatMemoryDate('2026-08-22T15:30:00.000Z')).toBe('8月22日');
    expect(formatMemoryDate('not-a-date')).toBeNull();
  });
});
