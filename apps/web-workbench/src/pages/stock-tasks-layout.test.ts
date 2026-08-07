import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('stock tasks layout', () => {
  it('keeps page actions clear of the fixed desktop account dock', () => {
    const source = readFileSync(new URL('./StockTasksPage.tsx', import.meta.url), 'utf8');

    expect(source).toContain('min-[769px]:pr-[12rem]');
    expect(source).toContain('flex flex-wrap items-center justify-end gap-2');
  });

  it('uses verified source covers when available and never turns discovery cards into source placeholders', () => {
    const source = readFileSync(new URL('./StockTasksPage.tsx', import.meta.url), 'utf8');

    expect(source).not.toContain('images.unsplash.com');
    expect(source).toContain('{item.imageUrl ? (');
    expect(source).toContain('src={item.imageUrl}');
    expect(source).not.toContain('<span>来源信息</span>');
    expect(source).not.toContain('原文已记录');
  });

  it('labels the real market-chart fallback instead of presenting it as an article photo', () => {
    const source = readFileSync(new URL('./StockTasksPage.tsx', import.meta.url), 'utf8');

    expect(source).toContain("item.imageKind === 'market-chart'");
    expect(source).toContain('行情图');
  });

  it('uses dedicated stock routing without rewriting the user prompt', () => {
    const source = readFileSync(new URL('./StockTasksPage.tsx', import.meta.url), 'utf8');

    expect(source).toContain('createStockTask(trimmed)');
    expect(source).not.toContain('function toStockIntent');
  });
});
