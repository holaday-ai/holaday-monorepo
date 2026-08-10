import { readFileSync } from 'node:fs';
import postcss from 'postcss';
import { describe, expect, it } from 'vitest';

describe('planned task responsive layout', () => {
  it('inherits the shared mobile header clearance instead of overriding page padding', () => {
    const css = readFileSync(new URL('./planned-tasks.css', import.meta.url), 'utf8');
    const root = postcss.parse(css);
    const mobilePagePadding: string[] = [];

    root.walkAtRules('media', (media) => {
      const maxWidth = Number(media.params.match(/max-width:\s*(\d+)px/)?.[1] ?? NaN);
      if (!Number.isFinite(maxWidth) || maxWidth > 768) return;
      media.walkRules('.planned-page', (rule) => {
        rule.walkDecls('padding', (declaration) => {
          mobilePagePadding.push(declaration.value);
        });
      });
    });

    expect(mobilePagePadding).toEqual([]);
  });
});
