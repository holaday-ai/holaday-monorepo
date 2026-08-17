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
    expect(cardSource).toContain('{showImage ? (');
    expect(cardSource).toContain('src={item.imageUrl}');
    expect(cardSource).not.toContain('<span>来源信息</span>');
    expect(cardSource).not.toContain('原文已记录');
  });

  it('notifies the discovery reader when a declared cover cannot load', () => {
    const cardSource = readFileSync(new URL('../components/DiscoveryNewsCard.tsx', import.meta.url), 'utf8');

    expect(cardSource).toContain('const [failedImageUrl, setFailedImageUrl] = useState<string | null>(null);');
    expect(cardSource).toContain('const showImage = Boolean(item.imageUrl && failedImageUrl !== item.imageUrl);');
    expect(cardSource).toContain('onImageError?: (imageUrl: string) => void;');
    expect(cardSource).toContain('onImageError(item.imageUrl);');
    expect(cardSource).toContain('{showImage ? (');
  });

  it('keeps automatic quote refreshes visually silent', () => {
    const source = readFileSync(new URL('./StockTasksPage.tsx', import.meta.url), 'utf8');

    expect(source).not.toContain('正在后台刷新行情');
    expect(source).not.toContain('refreshingDashboard && dashboard');
    expect(source).toContain("void loadPageData('background')");
    expect(source).not.toContain("else setRefreshingDashboard(true);");
    expect(source).not.toContain('trustMessage={dashboardTrust.message}');
    expect(source).not.toContain('title={dashboardTrust.message ?? undefined}');
    expect(source).not.toContain("|| refreshingDashboard || dashboardFreshness?.status === 'partial'");
  });

  it('remounts the detail cover for each article and keeps source reading inside the modal', () => {
    const modalSource = readFileSync(new URL('../components/NewsDetailModal.tsx', import.meta.url), 'utf8');

    expect(modalSource).toContain('const readerItemKey = item.url');
    expect(modalSource).toContain('key={readerItemKey}');
    expect(modalSource).toContain('查看来源链接');
    expect(modalSource).toContain('正文在当前弹窗内阅读');
    expect(modalSource).not.toContain('target="_blank"');
    expect(modalSource).not.toContain('打开原文');
  });

  it('gives discovery a clear priority story and a chronological source stream', () => {
    const pageSource = readFileSync(new URL('./StockDiscoveryPage.tsx', import.meta.url), 'utf8');
    const cardSource = readFileSync(new URL('../components/DiscoveryNewsCard.tsx', import.meta.url), 'utf8');

    expect(pageSource).toContain('优先阅读');
    expect(pageSource).toContain('更多来源');
    expect(pageSource).toContain('variant="lead"');
    expect(pageSource).toContain('variant="standard"');
    expect(pageSource).toContain('md:grid-cols-3');
    expect(pageSource).toContain('function discoveryReadingPriority');
    expect(pageSource).toContain('const prioritizedNews');
    expect(cardSource).toContain("variant?: 'standard' | 'lead' | 'compact'");
  });

  it('renders reusable editorial art as normal card media without exposing its provenance', () => {
    const pageSource = readFileSync(new URL('./StockTasksPage.tsx', import.meta.url), 'utf8');
    const cardSource = readFileSync(new URL('../components/DiscoveryNewsCard.tsx', import.meta.url), 'utf8');

    expect(pageSource).toContain("imageKind?: 'source-cover' | 'editorial-art'");
    expect(cardSource).toContain("item.imageKind === 'source-cover'");
    expect(cardSource).not.toContain('主题配图');
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

    expect(source).toContain('createStockTask(trimmed, stockTaskContext)');
    expect(source).toContain('snapshotId: trust.snapshotId');
    expect(source).toContain('evidenceIds: trust.evidenceIds.slice(0, 50)');
    expect(source).not.toContain('function toStockIntent');
  });

  it('keeps the stale-data boundary in stable header metadata instead of a duplicate alert', () => {
    const source = readFileSync(new URL('./StockTasksPage.tsx', import.meta.url), 'utf8');

    expect(source).toContain('dashboardTrust.dataDateLabel');
    expect(source).toContain('dashboardTrust.refreshLabel');
    expect(source).not.toContain('trustMessage: string | null');
  });

  it('threads server-authored temporal semantics through every numeric market panel', () => {
    const source = readFileSync(new URL('./StockTasksPage.tsx', import.meta.url), 'utf8');

    expect(source).toContain('stockDashboardTrustState({ trust: dashboard?.trust })');
    expect(source).toContain('stockTemporalCopy(dashboardTrust.tone, dashboard?.trust?.dataAsOf ?? null)');
    expect(source).toContain('{dashboardTrust.statusLabel}');
    expect(source).toContain('temporalCopy={temporalCopy}');
    expect(source).toContain('title={temporalCopy.briefingTitle}');
    expect(source).toContain('title={temporalCopy.opportunityTitle}');
    expect(source).toContain('{temporalCopy.priceLabel}');
    expect(source).toContain('title={temporalCopy.starTitle}');
    expect(source).toContain('meta={temporalCopy.starMeta}');
    expect(source).toContain("temporalMode === 'historical' ? '当时动态：' : '最新动态：'");
    expect(source).toContain("temporalMode === 'historical' ? '当时公告：' : '最新公告：'");
  });

  it('blocks prompt submission only when no trustworthy snapshot can support a stock-data task', () => {
    const source = readFileSync(new URL('./StockTasksPage.tsx', import.meta.url), 'utf8');

    expect(source).toContain("dashboardTrust.tone === 'unavailable' || dashboardTrust.tone === 'unverified'");
    expect(source).toContain('disabled={submitting || !prompt.trim() || stockPromptUnavailable}');
    expect(source).toContain('placeholder={temporalCopy.promptPlaceholder}');
  });

  it('places the transparent screening workbench after highlights with current trust and watchlist action', () => {
    const source = readFileSync(new URL('./StockTasksPage.tsx', import.meta.url), 'utf8');
    const component = readFileSync(
      new URL('../components/stocks/StockScreeningWorkbench.tsx', import.meta.url),
      'utf8',
    );

    expect(source).toContain("import { StockScreeningWorkbench } from '@/components/stocks/StockScreeningWorkbench';");
    expect(source.indexOf('<MarketHighlights')).toBeLessThan(source.indexOf('<StockScreeningWorkbench'));
    expect(source.indexOf('<StockScreeningWorkbench')).toBeLessThan(source.indexOf('<DailyBriefing'));
    expect(source).toContain('snapshotId={dashboard?.trust?.snapshotId ?? null}');
    expect(source).toContain('dataAsOf={dashboard?.trust?.dataAsOf ?? null}');
    expect(source).toContain('trustMode={dashboard?.trust?.mode ?? \'unverified\'}');
    expect(source).toContain('onAddToWatchlist={addScreeningCandidate}');
    expect(source).not.toContain('toast.show(message, \'error\');\n      throw err;');
    expect(component).toContain('trpc.stocks.previewScreening.query');
    expect(component).toContain('trpc.stocks.runScreening.mutate');
    expect(component).toContain('条件匹配不等于投资建议');
    expect(component).toContain('aria-label=');
    expect(component).toContain('title=');
  });
});
