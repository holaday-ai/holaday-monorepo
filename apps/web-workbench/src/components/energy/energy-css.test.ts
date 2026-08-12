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

  it('keeps the experience illustrations complete and the zodiac badge circular', () => {
    const experienceImageFrame = css.match(/\.energy-experience-card__image\s*\{[^}]+\}/)?.[0];
    const experienceImage = css.match(/\.energy-experience-card__image img\s*\{[^}]+\}/)?.[0];
    const zodiacBadge = css.match(/\.energy-astrology-panel__badge\s*\{[^}]+\}/)?.[0];

    expect(experienceImageFrame).toMatch(/aspect-ratio:\s*4\s*\/\s*3/);
    expect(experienceImage).toMatch(/object-fit:\s*contain/);
    expect(zodiacBadge).toMatch(/aspect-ratio:\s*1/);
    expect(zodiacBadge).toMatch(/align-self:\s*start/);
  });

  it('contains content-hub layout and reduced-motion overrides', () => {
    expect(css).toContain('.energy-astrology-world');
    expect(css).toContain('.energy-astrology-dimensions__grid');
    expect(css).toContain('.energy-explore-feed');
    expect(css).toContain('.energy-running-task-dock');
    expect(css).toMatch(/@media\s*\(max-width:\s*900px\)/);
    expect(css).toMatch(/@media\s*\(max-width:\s*640px\)/);
    expect(css).toMatch(/prefers-reduced-motion:[\s\S]*\.energy-explore-feed/);
    expect(css).toMatch(/prefers-reduced-motion:[\s\S]*animation-duration:\s*0\.01ms\s*!important/);
  });

  it('keeps new illustrations complete and builds the 2 plus 4 explore rhythm', () => {
    const artImage = css.match(/\.energy-explore-feed__art img\s*\{[^}]+\}/)?.[0];

    expect(artImage).toMatch(/object-fit:\s*contain/);
    expect(css).toMatch(/article\[data-layout="feature"\]/);
    expect(css).toMatch(/grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)/);
  });

  it('defines lower-page motion and shuts it down for reduced motion', () => {
    expect(css).toContain('@keyframes energy-zodiac-float');
    expect(css).toContain('@keyframes energy-orbit-twinkle');
    expect(css).toContain('@keyframes energy-content-stagger');
    expect(css).toMatch(/prefers-reduced-motion:[\s\S]*\.energy-astrology-world__art img/);
    expect(css).toMatch(/prefers-reduced-motion:[\s\S]*\.energy-explore-feed__grid article/);
  });
});
