import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('stock discovery layout', () => {
  it('does not present unloaded discovery feeds as zero-result categories', () => {
    const source = readFileSync(new URL('./StockDiscoveryPage.tsx', import.meta.url), 'utf8');

    expect(source).toContain("{loading ? '—' : count}");
  });

  it('uses the active feed collection for modal previous and next navigation', () => {
    const source = readFileSync(new URL('./StockDiscoveryPage.tsx', import.meta.url), 'utf8');

    expect(source).toContain('const filteredRows = React.useMemo');
    expect(source).toContain('news={filteredRows}');
    expect(source).toContain('setActiveIndex(null);');
  });
});
