import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('stock tasks layout', () => {
  it('keeps page actions clear of the fixed desktop account dock', () => {
    const source = readFileSync(new URL('./StockTasksPage.tsx', import.meta.url), 'utf8');

    expect(source).toContain('min-[769px]:pr-[12rem]');
    expect(source).toContain('flex flex-wrap items-center justify-end gap-2');
  });
});
