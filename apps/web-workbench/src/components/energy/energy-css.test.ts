import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('./energy.css', import.meta.url), 'utf8');

describe('energy motion system', () => {
  it('includes the approved playful motion hooks and reduced-motion shutdown', () => {
    expect(css).toContain('@keyframes energy-island-float');
    expect(css).toContain('@keyframes energy-cta-pulse');
    expect(css).toContain('@keyframes energy-selected-pop');
    expect(css).toContain('@keyframes energy-reward-light');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).toMatch(/prefers-reduced-motion:[\s\S]*animation:\s*none\s*!important/);
    expect(css).toMatch(/prefers-reduced-motion:[\s\S]*transition:\s*none\s*!important/);
  });

  it('contains the selected bright palette instead of a dark page surface', () => {
    expect(css).toMatch(/#fffaf[0-9a-f]/i);
    expect(css).toMatch(/#dff4ff/i);
    expect(css).toMatch(/#ffe1cc/i);
    expect(css).toMatch(/#daf5df/i);
    expect(css).toMatch(/#ff315f/i);
    expect(css).toMatch(/\.energy-insight-grid\s*\{/);
  });
});
