import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('stock tasks layout', () => {
  it('keeps page actions clear of the fixed desktop account dock', () => {
    const source = readFileSync(new URL('./StockTasksPage.tsx', import.meta.url), 'utf8');

    expect(source).toContain('min-[769px]:pr-[12rem]');
    expect(source).toContain('flex flex-wrap items-center justify-end gap-2');
  });

  it('uses verified source covers when available and never turns discovery cards into source placeholders', () => {
    const pageSource = readFileSync(new URL('./StockTasksPage.tsx', import.meta.url), 'utf8');
    const cardSource = readFileSync(new URL('../components/DiscoveryNewsCard.tsx', import.meta.url), 'utf8');

    expect(pageSource).toContain('<DiscoveryNewsCard');
    expect(cardSource).not.toContain('images.unsplash.com');
    expect(cardSource).toContain('{item.imageUrl ? (');
    expect(cardSource).toContain('src={item.imageUrl}');
    expect(cardSource).not.toContain('<span>来源信息</span>');
    expect(cardSource).not.toContain('原文已记录');
  });

  it('renders reusable editorial art as the normal card media without a source-image claim', () => {
    const pageSource = readFileSync(new URL('./StockTasksPage.tsx', import.meta.url), 'utf8');
    const cardSource = readFileSync(new URL('../components/DiscoveryNewsCard.tsx', import.meta.url), 'utf8');

    expect(pageSource).toContain("imageKind?: 'source-cover' | 'editorial-art'");
    expect(cardSource).toContain("item.imageKind === 'source-cover'");
    expect(cardSource).toContain('主题配图');
    expect(cardSource).not.toContain('行情图');
    expect(cardSource).not.toContain('AI 配图');
  });

  it('does not invent a related-symbol count for a source that has none', () => {
    const cardSource = readFileSync(new URL('../components/DiscoveryNewsCard.tsx', import.meta.url), 'utf8');

    expect(cardSource).toContain("item.symbols.length > 0 ? ` · ${item.symbols.length} 个关联` : ''");
    expect(cardSource).not.toContain('Math.max(1, item.symbols.length)');
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
