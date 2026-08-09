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

  it('uses an editorial lead row without stretching it to supporting cards', () => {
    const pageSource = readFileSync(new URL('./StockDiscoveryPage.tsx', import.meta.url), 'utf8');
    const source = readFileSync(new URL('../components/DiscoveryNewsCard.tsx', import.meta.url), 'utf8');

    expect(pageSource).not.toContain('xl:grid-cols-[minmax(0,1.6fr)_minmax(320px,0.8fr)]');
    expect(pageSource).toContain('<div className="space-y-4">');
    expect(pageSource).toContain('<div className="grid grid-cols-1 gap-4 md:grid-cols-3">');
    expect(pageSource).toContain('variant="standard"');
    expect(source).not.toContain('min-h-[468px]');
    expect(source).toContain('lg:min-h-[280px] lg:grid-cols-[minmax(0,1.12fr)_minmax(320px,0.88fr)]');
    expect(source).toContain("isLead ? 'aspect-[3/2] w-full lg:order-2 lg:h-full lg:aspect-auto'");
    expect(source).toContain("isCompact ? 'h-[104px]' : 'aspect-[3/2] w-full'");
  });
});
