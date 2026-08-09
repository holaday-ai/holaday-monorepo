import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('stock discovery layout', () => {
  it('does not present unloaded discovery feeds as zero-result categories', () => {
    const source = readFileSync(new URL('./StockDiscoveryPage.tsx', import.meta.url), 'utf8');

    expect(source).toContain("{loading ? '—' : count}");
  });

  it('waits for the initial source snapshot before prefetching another discovery page', () => {
    const source = readFileSync(new URL('./StockDiscoveryPage.tsx', import.meta.url), 'utf8');

    expect(source).toContain('!loading && prioritizedNews.length > 0 && displayedNews.length >= prioritizedNews.length');
  });

  it('uses the active feed collection for modal previous and next navigation', () => {
    const source = readFileSync(new URL('./StockDiscoveryPage.tsx', import.meta.url), 'utf8');

    expect(source).toContain('const filteredRows = React.useMemo');
    expect(source).toContain('news={filteredRows}');
    expect(source).toContain('setActiveIndex(null);');
  });

  it('keeps the priority grid compact and uses a stable cover ratio for source cards', () => {
    const pageSource = readFileSync(new URL('./StockDiscoveryPage.tsx', import.meta.url), 'utf8');
    const source = readFileSync(new URL('../components/DiscoveryNewsCard.tsx', import.meta.url), 'utf8');

    expect(pageSource).not.toContain('xl:items-start');
    expect(pageSource).toContain('xl:grid-cols-[minmax(0,1.6fr)_minmax(320px,0.8fr)]');
    expect(source).toContain("isLead ? (showImage ? 'flex min-h-[468px] flex-col sm:grid sm:grid-cols");
    expect(source).toContain("isCompact ? 'h-[104px]' : 'aspect-video w-full'");
  });
});
