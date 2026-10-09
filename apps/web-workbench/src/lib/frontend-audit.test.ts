import { describe, expect, it, vi } from 'vitest';
import { needsExternalLinkConfirmation, openExternalLink } from './external-link-copy';
import { hasBrowserRecordForWorkbench } from './workbench-state';
import { shouldShowTrustSummary } from './trust-summary';
import { formatSourceAttribution } from './source-attribution';
import { groupNotifications } from './notification-bell-state';
import type { UiTask } from '@/types/task';

describe('frontend audit regressions', () => {
  it('requires browser evidence rather than research verbs or a source URL', () => {
    for (const intent of ['搜索茅台财报并分析', '写一篇介绍，参考 https://example.com']) {
      expect(hasBrowserRecordForWorkbench({ intent } as UiTask)).toBe(false);
    }
    expect(hasBrowserRecordForWorkbench({ intent: '打开 https://example.com' } as UiTask)).toBe(true);
    expect(hasBrowserRecordForWorkbench({ executionMode: 'browser' } as UiTask)).toBe(true);
  });
  it('keeps real verification failures visible without alarming successful unaudited results', () => {
    const result = { status: 'completed' as const, resultText: '[来源](https://eastmoney.com)' };
    expect(shouldShowTrustSummary(result)).toBe(false);
    expect(shouldShowTrustSummary({ ...result, verificationPassed: false })).toBe(true);
  });
  it('only skips confirmation for explicit trusted HTTPS hosts and no credentials', () => {
    expect(needsExternalLinkConfirmation('https://www.eastmoney.com/news/1')).toBe(false);
    for (const url of ['https://eastmoney.com.evil.test', 'https://evil-eastmoney.com', 'http://eastmoney.com', 'https://u:p@eastmoney.com', 'https://unknown.example.org', 'https://eastmoney.com/?redirect=https://evil.test']) {
      expect(needsExternalLinkConfirmation(url)).toBe(true);
    }
    const opener = vi.fn();
    openExternalLink('https://www.eastmoney.com/news/1', opener);
    expect(opener).toHaveBeenCalledWith('https://www.eastmoney.com/news/1', '_blank', 'noopener,noreferrer');
    openExternalLink('javascript:alert(1)', opener);
    expect(opener).toHaveBeenCalledTimes(1);
  });
  it('formats source metadata without rewriting links or quoted identifiers', () => {
    expect(formatSourceAttribution('来源 eastmoney:stock-news-search · 抓取 21:06')).toBe('东方财富 · 抓取于 21:06');
    expect(formatSourceAttribution('[原文](https://example.com/eastmoney:stock-news-search)')).toContain('https://example.com/eastmoney:stock-news-search');
  });
  it('groups exact same-day duplicates without losing ids or merging unrelated records', () => {
    const base = {type:'task_complete',title:'完成',message:'报告',isRead:false,createdAt:'2026-10-09T12:00:00Z',scheduledTaskInternalId:1,plannedTaskId:null};
    const groups=groupNotifications([{...base,notificationId:'a'}, {...base,notificationId:'b'}, {...base,notificationId:'c',scheduledTaskInternalId:2}]);
    expect(groups).toHaveLength(2);
    expect(groups[0].members.map(row=>row.notificationId)).toEqual(['a','b']);
  });
});
