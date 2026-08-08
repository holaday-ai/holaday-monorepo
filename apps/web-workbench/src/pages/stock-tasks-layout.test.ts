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

  it('renders reusable editorial art as the normal card media without a source-image claim', () => {
    const source = readFileSync(new URL('./StockTasksPage.tsx', import.meta.url), 'utf8');

    expect(source).toContain("imageKind?: 'source-cover' | 'editorial-art'");
    expect(source).not.toContain('行情图');
    expect(source).not.toContain('AI 配图');
  });

  it('shows a real chart point on pointer entry and labels both snapshot and minute coverage time', () => {
    const source = readFileSync(new URL('./StockTasksPage.tsx', import.meta.url), 'utf8');

    expect(source).toContain('onPointerEnter={handlePointerEnter}');
    expect(source).toContain('onMouseEnter={handleMouseEnter}');
    expect(source).toContain('StockRailMetric label="数据更新"');
    expect(source).toContain('分时截至');
    expect(source).not.toContain('interpolatedChartPoint');
  });

  it('uses dedicated stock routing without rewriting the user prompt', () => {
    const source = readFileSync(new URL('./StockTasksPage.tsx', import.meta.url), 'utf8');

    expect(source).toContain('createStockTask(trimmed)');
    expect(source).not.toContain('function toStockIntent');
  });
});
