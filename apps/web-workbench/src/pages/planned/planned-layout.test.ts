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

  it('turns the editor into a focused full-screen sheet on narrow screens', () => {
    const css = readFileSync(new URL('./planned-tasks.css', import.meta.url), 'utf8');
    const root = postcss.parse(css);
    const declarations = new Map<string, Map<string, string>>();

    root.walkAtRules('media', (media) => {
      const maxWidth = Number(media.params.match(/max-width:\s*(\d+)px/)?.[1] ?? NaN);
      if (!Number.isFinite(maxWidth) || maxWidth > 820) return;
      media.walkRules((rule) => {
        const values = declarations.get(rule.selector) ?? new Map<string, string>();
        rule.walkDecls((declaration) => {
          values.set(declaration.prop, declaration.value);
        });
        declarations.set(rule.selector, values);
      });
    });

    expect(declarations.get('.planned-inspector')?.get('position')).toBe('fixed');
    expect(declarations.get('.planned-inspector')?.get('inset')).toBe('0');
    expect(declarations.get('.planned-inspector')?.get('height')).toBe('100dvh');
    expect(declarations.get('.planned-inspector__body')?.get('overflow-y')).toBe('auto');
    expect(declarations.get('.planned-inspector__footer')?.get('position')).toBe('sticky');
    expect(declarations.get('.planned-inspector__footer')?.get('bottom')).toBe('0');
  });
});
