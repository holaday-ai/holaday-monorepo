# Today Energy Macaron Visual Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the three new lower-page `/cosmic` sections into a visual, interactive macaron content garden while preserving all existing data, navigation, accessibility, and upper-page behavior.

**Architecture:** Keep `EnergyHome` as composition glue and add one small visual-metadata module shared by the astrology and explore-feed components. `AstrologyWorld` owns the zodiac stage and continuation portals, `AstrologyDimensionGrid` and `LuckyInsights` own information visualization, and `EnergyExploreFeed` owns the two-feature-plus-four-compact batch layout. No API, persistence, recommendation, or event contract changes.

**Tech Stack:** React 18, TypeScript, Vite, Vitest, Testing Library, Lucide React, existing `energy.css`, Browser plugin.

## Global Constraints

- Modify only the lower-page `星座深度补给站`, `继续往下逛`, and `再逛一会` surfaces.
- Do not alter the energy hero, three-play deck, growth panel, or upper astrology summary card.
- Preserve DivineAPI/local fallback behavior, source labels, period loading, ranking completeness checks, sign preview, content de-duplication, event payloads, and experience targets.
- Use only existing `/public/energy` raster assets plus the existing twelve zodiac badge images; add no dependency and no stock-editorial imagery.
- Keep all visible controls and copy code-native; imagery is supporting art, not a screenshot replacement.
- Use cream, peach, lavender, sky, mint, and coral-red accents from the current energy palette; keep coral red reserved for primary action/focus.
- Images must preserve the subject with `object-fit: contain`; no subject-cropping `cover` rule may be added to the new content art.
- All hover and entrance motion must stop under `prefers-reduced-motion: reduce`.
- Maintain 44×44px touch targets and exact accessible names for existing tested controls.
- Merge and deployment remain outside this plan and require separate authorization.

---

## File Map

- Create `apps/web-workbench/src/components/energy/energy-visuals.ts`: pure visual metadata and asset mapping; no React or recommendation logic.
- Create `apps/web-workbench/src/components/energy/energy-visuals.test.ts`: category, zodiac, dimension, and fallback mappings.
- Modify `apps/web-workbench/src/components/energy/AstrologyWorld.tsx`: zodiac visual stage and four continuation portals.
- Modify `apps/web-workbench/src/components/energy/AstrologyDimensionGrid.tsx`: stable icon/tone wrappers for six dimensions.
- Modify `apps/web-workbench/src/components/energy/LuckyInsights.tsx`: color/time/trend presentation hooks without data changes.
- Modify `apps/web-workbench/src/components/energy/EnergyExploreFeed.tsx`: two feature cards plus four compact cards and image fallback.
- Modify `apps/web-workbench/src/components/energy/EnergyHome.tsx`: pass the current zodiac sign to the explore feed.
- Modify `apps/web-workbench/src/components/energy/energy.css`: layout, image treatment, motion, responsive behavior, and reduced-motion shutdown.
- Modify `apps/web-workbench/src/components/energy/AstrologyWorld.test.tsx`: visual-stage and continuation semantics.
- Create `apps/web-workbench/src/components/energy/AstrologyDimensionGrid.test.tsx`: dimension icon/tone and expand behavior.
- Modify `apps/web-workbench/src/components/energy/EnergyExploreFeed.test.tsx`: card anatomy, artwork mapping, opened state, and refresh preservation.
- Modify `apps/web-workbench/src/components/energy/EnergyHome.test.tsx`: integration coverage for the unchanged six-content contract.
- Modify `apps/web-workbench/src/components/energy/energy-css.test.ts`: image-fit, motion, responsive layout, and reduced-motion assertions.

---

### Task 1: Pure Visual Metadata and Asset Mapping

**Files:**
- Create: `apps/web-workbench/src/components/energy/energy-visuals.ts`
- Create: `apps/web-workbench/src/components/energy/energy-visuals.test.ts`
- Reuse: `apps/web-workbench/src/components/energy/zodiac-art.ts`

**Interfaces:**
- Consumes: `EnergyContentCategory`, `ZodiacSign`, and `zodiacBadgeImage(sign)`.
- Produces: `EnergyVisualTone`, `EnergyVisualIcon`, `EnergyVisualDefinition`, `exploreVisualFor(category, sign)`, and `dimensionVisualFor(key)`.

- [ ] **Step 1: Write the failing mapping tests**

```ts
import { describe, expect, it } from 'vitest';
import { dimensionVisualFor, exploreVisualFor } from './energy-visuals';

describe('energy visual metadata', () => {
  it('uses the active zodiac artwork for zodiac knowledge', () => {
    expect(exploreVisualFor('zodiac-knowledge', 'taurus')).toEqual({
      tone: 'sky',
      icon: 'book',
      imageSrc: '/energy/taurus-badge.jpg',
    });
  });

  it('maps playable categories to approved energy art', () => {
    expect(exploreVisualFor('game-recommendation', 'aries').imageSrc).toBe('/energy/mini-game.jpg');
    expect(exploreVisualFor('card-recommendation', 'aries').imageSrc).toBe('/energy/tarot-cards.jpg');
    expect(exploreVisualFor('test-recommendation', 'aries').imageSrc).toBe('/energy/quick-test.jpg');
  });

  it('gives provider dimensions stable visual metadata', () => {
    expect(dimensionVisualFor('profession')).toEqual({ tone: 'peach', icon: 'briefcase' });
    expect(dimensionVisualFor('unknown')).toEqual({ tone: 'lavender', icon: 'sparkles' });
  });
});
```

- [ ] **Step 2: Run the new test and verify the missing-module failure**

```bash
pnpm --filter @holaday/web-workbench test -- src/components/energy/energy-visuals.test.ts
```

Expected: FAIL because `./energy-visuals` does not exist.

- [ ] **Step 3: Implement the pure metadata module**

```ts
import type { ZodiacSign } from '@/lib/astrology';
import type { EnergyContentCategory } from './explore-content';
import { zodiacBadgeImage } from './zodiac-art';

export type EnergyVisualTone = 'peach' | 'lavender' | 'sky' | 'mint' | 'sun';
export type EnergyVisualIcon = 'book' | 'brain' | 'briefcase' | 'clock' | 'gamepad' | 'heart' | 'palette' | 'shuffle' | 'sparkles' | 'user' | 'wind';

export interface EnergyVisualDefinition {
  tone: EnergyVisualTone;
  icon: EnergyVisualIcon;
  imageSrc: string;
}

const EXPLORE_VISUALS: Record<Exclude<EnergyContentCategory, 'zodiac-knowledge'>, EnergyVisualDefinition> = {
  relaxation: { tone: 'sky', icon: 'wind', imageSrc: '/energy/recharge-island.jpg' },
  fortune: { tone: 'peach', icon: 'sparkles', imageSrc: '/energy/energy-capsules.jpg' },
  'relationship-quiz': { tone: 'mint', icon: 'heart', imageSrc: '/energy/quick-test.jpg' },
  poll: { tone: 'lavender', icon: 'shuffle', imageSrc: '/energy/energy-capsules.jpg' },
  'test-recommendation': { tone: 'mint', icon: 'brain', imageSrc: '/energy/quick-test.jpg' },
  'card-recommendation': { tone: 'peach', icon: 'sparkles', imageSrc: '/energy/tarot-cards.jpg' },
  'game-recommendation': { tone: 'sky', icon: 'gamepad', imageSrc: '/energy/mini-game.jpg' },
};

const DIMENSION_VISUALS: Record<string, Omit<EnergyVisualDefinition, 'imageSrc'>> = {
  personal: { tone: 'lavender', icon: 'user' },
  health: { tone: 'mint', icon: 'heart' },
  profession: { tone: 'peach', icon: 'briefcase' },
  emotions: { tone: 'lavender', icon: 'sparkles' },
  travel: { tone: 'sky', icon: 'shuffle' },
  luck: { tone: 'sun', icon: 'sparkles' },
};

export function exploreVisualFor(category: EnergyContentCategory, zodiacSign: ZodiacSign): EnergyVisualDefinition {
  if (category === 'zodiac-knowledge') {
    return { tone: 'sky', icon: 'book', imageSrc: zodiacBadgeImage(zodiacSign) };
  }
  return EXPLORE_VISUALS[category];
}

export function dimensionVisualFor(key: string): Omit<EnergyVisualDefinition, 'imageSrc'> {
  return DIMENSION_VISUALS[key] ?? { tone: 'lavender', icon: 'sparkles' };
}
```

- [ ] **Step 4: Run the Task 1 test and commit**

```bash
pnpm --filter @holaday/web-workbench test -- src/components/energy/energy-visuals.test.ts
git add apps/web-workbench/src/components/energy/energy-visuals.ts apps/web-workbench/src/components/energy/energy-visuals.test.ts
git commit -m "feat(energy): define macaron visual metadata"
```

Expected: PASS.

---

### Task 2: Zodiac Visual Stage and Illustrated Information Grid

**Files:**
- Modify: `apps/web-workbench/src/components/energy/AstrologyWorld.tsx`
- Modify: `apps/web-workbench/src/components/energy/AstrologyDimensionGrid.tsx`
- Modify: `apps/web-workbench/src/components/energy/LuckyInsights.tsx`
- Modify: `apps/web-workbench/src/components/energy/AstrologyWorld.test.tsx`
- Create: `apps/web-workbench/src/components/energy/AstrologyDimensionGrid.test.tsx`

**Interfaces:**
- Consumes: `selectedState.reading.zodiacSign`, `zodiacLabel`, `rangeLabel`, `luckyColors`, `suitableTimes`, `dimensionVisualFor(key)`, and `zodiacBadgeImage(sign)`.
- Produces: `.energy-astrology-world__stage`, `.energy-astrology-world__art`, `.energy-astrology-world__orbit-note`, and `data-tone`/`data-dimension` hooks.

- [ ] **Step 1: Add failing tests for the visual stage and dimensions**

Add to `AstrologyWorld.test.tsx`:

```ts
it('shows the active zodiac artwork and real lucky bubbles', () => {
  render(<AstrologyWorld astrology={state()} onOpenEnergyCard={vi.fn()} onOpenLightTest={vi.fn()} />);
  expect(screen.getByRole('img', { name: '白羊座马卡龙插画' }).getAttribute('src')).toBe('/energy/aries-badge.jpg');
  expect(screen.getByText('幸运色')).toBeTruthy();
  expect(screen.getByText('#ff7d8d')).toBeTruthy();
  expect(screen.getByText('顺手时段')).toBeTruthy();
  expect(screen.getByText('10:00 - 11:00')).toBeTruthy();
});
```

Create `AstrologyDimensionGrid.test.tsx` with a six-dimension reading and assert:

```ts
expect(container.querySelector('[data-dimension="profession"][data-tone="peach"]')).toBeTruthy();
expect(container.querySelector('[data-dimension="health"][data-tone="mint"]')).toBeTruthy();
expect(screen.getAllByRole('article')).toHaveLength(3);
await user.click(screen.getByRole('button', { name: '展开全部六项' }));
expect(screen.getAllByRole('article')).toHaveLength(6);
```

- [ ] **Step 2: Run the focused tests and verify failure**

```bash
pnpm --filter @holaday/web-workbench test -- src/components/energy/AstrologyWorld.test.tsx src/components/energy/AstrologyDimensionGrid.test.tsx
```

Expected: FAIL because the stage and dimension hooks are absent.

- [ ] **Step 3: Implement the zodiac stage**

Import `Clock3`, `Palette`, `zodiacBadgeImage`, then render:

```tsx
<div className="energy-astrology-world__stage">
  <header className="energy-astrology-world__header">
    <div>
      <p className="energy-kicker"><Sparkles aria-hidden="true" />不止两分钟的星座补给</p>
      <h2 id="energy-astrology-world-title">星座深度补给站</h2>
      <p>按今天、本周、本月和本年慢慢看，只展示能确认来源的内容。</p>
    </div>
    <span className="energy-astrology-world__source">{sourceLabel}</span>
  </header>
  <div className="energy-astrology-world__art">
    <Sparkles className="energy-astrology-world__sparkle" aria-hidden="true" />
    <img src={zodiacBadgeImage(selectedState.reading.zodiacSign)} alt={`${selectedState.reading.zodiacLabel}马卡龙插画`} onError={(event) => { event.currentTarget.hidden = true; }} />
    <span className="energy-astrology-world__orbit-note" data-note="color"><Palette aria-hidden="true" /><small>幸运色</small><strong>{selectedState.reading.luckyColors[0] ?? '等待提示'}</strong></span>
    <span className="energy-astrology-world__orbit-note" data-note="time"><Clock3 aria-hidden="true" /><small>顺手时段</small><strong>{selectedState.reading.suitableTimes[0] ?? '等待提示'}</strong></span>
  </div>
</div>
```

Compute `sourceLabel` before JSX with the existing source/freshness rule so behavior is unchanged.

- [ ] **Step 4: Add dimension icons and lucky hooks**

Use a local `ICON_COMPONENTS` map keyed by `EnergyVisualIcon`. For every dimension render:

```tsx
const visual = dimensionVisualFor(dimension.key);
const Icon = ICON_COMPONENTS[visual.icon];

<article key={dimension.key} data-dimension={dimension.key} data-tone={visual.tone}>
  <header>
    <span className="energy-astrology-dimension__icon" data-icon={visual.icon} aria-hidden="true"><Icon /></span>
    <h4>{dimension.label}</h4>
    {dimension.score === null ? null : <span>{dimension.score}%</span>}
  </header>
  <p>{dimension.body}</p>
</article>
```

Keep `LuckyInsights` data flow unchanged. Add `data-group={group.key}` to each lucky group and `energy-lucky-insights__time-track` to the times values container.

- [ ] **Step 5: Run tests and commit**

```bash
pnpm --filter @holaday/web-workbench test -- src/components/energy/AstrologyWorld.test.tsx src/components/energy/AstrologyDimensionGrid.test.tsx
git add apps/web-workbench/src/components/energy/AstrologyWorld.tsx apps/web-workbench/src/components/energy/AstrologyDimensionGrid.tsx apps/web-workbench/src/components/energy/LuckyInsights.tsx apps/web-workbench/src/components/energy/AstrologyWorld.test.tsx apps/web-workbench/src/components/energy/AstrologyDimensionGrid.test.tsx
git commit -m "feat(energy): illustrate astrology world"
```

Expected: PASS, including the existing honest-ranking tests.

---

### Task 3: Four Macaron Continuation Portals

**Files:**
- Modify: `apps/web-workbench/src/components/energy/AstrologyWorld.tsx`
- Modify: `apps/web-workbench/src/components/energy/AstrologyWorld.test.tsx`

**Interfaces:**
- Consumes: existing `loadRanking`, `loadSignPreview`, `onOpenEnergyCard`, and `onOpenLightTest` callbacks.
- Produces: four buttons with unchanged accessible names, `data-tone`, icon orb, subtitle, and `ArrowRight`.

- [ ] **Step 1: Extend the continuation test with portal anatomy**

```ts
const ranking = screen.getByRole('button', { name: '查看十二星座排行' });
const sign = screen.getByRole('button', { name: '换个星座看看' });
const card = screen.getByRole('button', { name: '抽一张相关能量牌' });
const test = screen.getByRole('button', { name: '测个相关主题' });
expect(ranking.getAttribute('data-tone')).toBe('lavender');
expect(sign.getAttribute('data-tone')).toBe('sky');
expect(card.getAttribute('data-tone')).toBe('peach');
expect(test.getAttribute('data-tone')).toBe('mint');
expect(screen.getByText('看看谁更有行动力')).toBeTruthy();
expect(screen.getByText('切换视角，不改资料')).toBeTruthy();
expect(screen.getByText('给当下一个轻提示')).toBeTruthy();
expect(screen.getByText('一分钟看见状态')).toBeTruthy();
```

- [ ] **Step 2: Run `AstrologyWorld.test.tsx` and verify failure**

Expected: FAIL because portal tones and subtitles are absent.

- [ ] **Step 3: Implement the portal pattern without changing handlers**

Give each button an exact `aria-label` matching its current label. Use this shape with the four approved tone/subtitle pairs:

```tsx
<button type="button" aria-label="查看十二星座排行" data-tone="lavender" disabled={astrology.ranking.loading} onClick={() => { setRankingRequested(true); void astrology.loadRanking(); }}>
  <span className="energy-astrology-world__portal-icon" aria-hidden="true"><ListOrdered /></span>
  <span><strong>查看十二星座排行</strong><small>看看谁更有行动力</small></span>
  <ArrowRight aria-hidden="true" />
</button>
```

- [ ] **Step 4: Run the test and commit**

```bash
pnpm --filter @holaday/web-workbench test -- src/components/energy/AstrologyWorld.test.tsx
git add apps/web-workbench/src/components/energy/AstrologyWorld.tsx apps/web-workbench/src/components/energy/AstrologyWorld.test.tsx
git commit -m "feat(energy): add macaron exploration portals"
```

Expected: PASS; callbacks still fire once.

---

### Task 4: Two Feature Cards and Four Compact Explore Cards

**Files:**
- Modify: `apps/web-workbench/src/components/energy/EnergyExploreFeed.tsx`
- Modify: `apps/web-workbench/src/components/energy/EnergyExploreFeed.test.tsx`
- Modify: `apps/web-workbench/src/components/energy/EnergyHome.tsx`
- Modify: `apps/web-workbench/src/components/energy/EnergyHome.test.tsx`

**Interfaces:**
- Consumes: required `zodiacSign: ZodiacSign`, `exploreVisualFor(category, zodiacSign)`, existing six-item batch, `onEvent`, and `onActionTarget`.
- Produces: first two articles with `data-layout="feature"`; remaining four with `data-layout="compact"`; all articles have `data-tone`; feature articles have approved artwork.

- [ ] **Step 1: Write failing feed-anatomy and opened-state tests**

Pass `zodiacSign="aries"` in every direct feed render, then add:

```ts
it('renders two illustrated feature cards and four icon-led compact cards', () => {
  const { container } = render(<EnergyExploreFeed storageScope="usr_a" mood={null} energyNeed="focus" zodiacSign="aries" onEvent={vi.fn()} />);
  expect(container.querySelectorAll('article[data-layout="feature"]')).toHaveLength(2);
  expect(container.querySelectorAll('article[data-layout="compact"]')).toHaveLength(4);
  expect(container.querySelectorAll('article[data-layout="feature"] img')).toHaveLength(2);
  expect(screen.getAllByRole('article')).toHaveLength(6);
});
```

Add to the existing click test:

```ts
expect(firstAction.closest('article')?.getAttribute('data-opened')).toBe('true');
```

- [ ] **Step 2: Run feed/home tests and verify failure**

```bash
pnpm --filter @holaday/web-workbench test -- src/components/energy/EnergyExploreFeed.test.tsx src/components/energy/EnergyHome.test.tsx
```

Expected: FAIL because `zodiacSign` and layout hooks are absent.

- [ ] **Step 3: Add the zodiac-sign contract and article metadata**

```ts
interface EnergyExploreFeedProps {
  storageScope: string | null;
  mood: EnergyMood | null;
  energyNeed: EnergyNeed;
  zodiacSign: ZodiacSign;
  onEvent: (event: EnergyExploreEvent) => void;
  onActionTarget?: (target: string, trigger: HTMLButtonElement) => void;
}
```

Pass `zodiacSign={profile.zodiacSign}` from `EnergyHome`. In the item map compute:

```ts
const visual = exploreVisualFor(item.category, zodiacSign);
const Icon = VISUAL_ICONS[visual.icon];
const layout = index < 2 ? 'feature' : 'compact';
```

Render `data-layout`, `data-tone`, and `data-opened` on every article.

- [ ] **Step 4: Add feature artwork with icon fallback**

```tsx
{layout === 'feature' ? (
  <div className="energy-explore-feed__art" aria-hidden="true">
    <span><Icon /></span>
    <img src={visual.imageSrc} alt="" onError={(event) => { event.currentTarget.hidden = true; }} />
  </div>
) : (
  <span className="energy-explore-feed__compact-icon" aria-hidden="true"><Icon /></span>
)}
```

Keep current category labels, estimated seconds, title, summary, button name, callback payload, and empty state unchanged. Add `ArrowRight` to the visible action while retaining the current `aria-label` and `title`.

- [ ] **Step 5: Run tests and commit**

```bash
pnpm --filter @holaday/web-workbench test -- src/components/energy/EnergyExploreFeed.test.tsx src/components/energy/EnergyHome.test.tsx
git add apps/web-workbench/src/components/energy/EnergyExploreFeed.tsx apps/web-workbench/src/components/energy/EnergyExploreFeed.test.tsx apps/web-workbench/src/components/energy/EnergyHome.tsx apps/web-workbench/src/components/energy/EnergyHome.test.tsx
git commit -m "feat(energy): build illustrated explore garden"
```

Expected: PASS, with exactly six articles before and after refresh and unchanged stable event IDs.

---

### Task 5: Macaron Styling, Responsive Layout, and Motion Safety

**Files:**
- Modify: `apps/web-workbench/src/components/energy/energy.css`
- Modify: `apps/web-workbench/src/components/energy/energy-css.test.ts`

**Interfaces:**
- Consumes: all class and `data-tone`/`data-layout` hooks from Tasks 2–4.
- Produces: the approved desktop/mobile composition and reduced-motion shutdown.

- [ ] **Step 1: Add failing static CSS expectations**

```ts
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
```

- [ ] **Step 2: Run `energy-css.test.ts` and verify failure**

```bash
pnpm --filter @holaday/web-workbench test -- src/components/energy/energy-css.test.ts
```

Expected: FAIL because the new layout and keyframes are missing.

- [ ] **Step 3: Implement zodiac stage and information palette**

```css
.energy-astrology-world__stage { display: grid; grid-template-columns: minmax(0, 1fr) 250px; align-items: center; gap: 28px; }
.energy-astrology-world__art { position: relative; min-height: 220px; }
.energy-astrology-world__art > img { display: block; width: 164px; height: 164px; margin: 28px auto; border-radius: 50%; object-fit: contain; box-shadow: 0 20px 46px rgb(103 76 150 / 18%); animation: energy-zodiac-float 7s ease-in-out infinite; }
.energy-astrology-dimensions__grid article[data-tone="peach"] { background: #fff5ec; }
.energy-astrology-dimensions__grid article[data-tone="lavender"] { background: #f7f1ff; }
.energy-astrology-dimensions__grid article[data-tone="sky"] { background: #eefaff; }
.energy-astrology-dimensions__grid article[data-tone="mint"] { background: #effbf1; }
.energy-astrology-dimensions__grid article[data-tone="sun"] { background: #fff9df; }
```

Position the two orbit notes on opposite corners with a translucent white surface and keep them outside the image subject box.

- [ ] **Step 4: Style portals and content garden**

```css
.energy-astrology-world__continue-actions { grid-template-columns: repeat(4, minmax(0, 1fr)); }
.energy-explore-feed__grid { grid-template-columns: repeat(12, minmax(0, 1fr)); }
.energy-explore-feed__grid article[data-layout="feature"] { grid-column: span 6; }
.energy-explore-feed__grid article[data-layout="compact"] { grid-column: span 3; }
.energy-explore-feed__art { aspect-ratio: 16 / 8; overflow: hidden; border-radius: 18px; }
.energy-explore-feed__art img { width: 100%; height: 100%; object-fit: contain; transition: transform 320ms ease; }
```

Apply five `data-tone` backgrounds to portal and feed cards. Keep compact cards at least 190px high and feature cards at least 250px high. Give arrows a 180ms translate transition and opened cards a visible border plus icon state.

- [ ] **Step 5: Add restrained motion and responsive shutdown**

```css
@keyframes energy-zodiac-float { 0%, 100% { transform: translateY(0) rotate(-1deg); } 50% { transform: translateY(-7px) rotate(1deg); } }
@keyframes energy-orbit-twinkle { 0%, 100% { opacity: 0.55; transform: scale(0.92); } 50% { opacity: 1; transform: scale(1.05); } }
@keyframes energy-content-stagger { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
```

At 900px, portals become two columns and all feed cards become half width. At 640px, the zodiac stage, portals, feature cards, and compact cards become one column. In the reduced-motion block include zodiac image, sparkle, portal icons/arrows, feed images, and feed articles with `animation: none !important`, `transition: none !important`, and `transform: none !important`.

- [ ] **Step 6: Run CSS/component tests and commit**

```bash
pnpm --filter @holaday/web-workbench test -- src/components/energy/energy-css.test.ts src/components/energy/AstrologyWorld.test.tsx src/components/energy/AstrologyDimensionGrid.test.tsx src/components/energy/EnergyExploreFeed.test.tsx src/components/energy/EnergyHome.test.tsx
git add apps/web-workbench/src/components/energy/energy.css apps/web-workbench/src/components/energy/energy-css.test.ts
git commit -m "style(energy): add macaron content garden motion"
```

Expected: PASS.

---

### Task 6: Full Verification and Visual Fidelity Loop

**Files:**
- Verify only; modify touched files only when a concrete test or visual mismatch is found.

**Interfaces:**
- Consumes: completed `/cosmic` implementation.
- Produces: fresh automated and rendered evidence for desktop, interaction, reduced-motion behavior, and one mobile-sized viewport.

- [ ] **Step 1: Run the complete energy-domain test set**

```bash
pnpm --filter @holaday/web-workbench test -- src/components/energy
```

Expected: all energy tests PASS.

- [ ] **Step 2: Run lint, typecheck, build, and diff checks**

```bash
pnpm --filter @holaday/web-workbench lint
pnpm --filter @holaday/web-workbench typecheck
pnpm --filter @holaday/web-workbench build
git diff --check
```

Expected: all commands exit 0. If repository-wide unrelated noise appears, run the exact touched-file command and report the repository limitation without suppressing it.

- [ ] **Step 3: Start the local app on the configured Vite host**

```bash
pnpm --filter @holaday/web-workbench dev -- --host 127.0.0.1
```

Keep the process running and use the emitted port exactly.

- [ ] **Step 4: Run Browser desktop verification**

The flow under test is: `/cosmic` loads -> scroll to `星座深度补给站` -> switch periods and expand six dimensions -> use one continuation portal -> scroll to `再逛一会` -> open one feature card and one compact card -> refresh the six-card batch.

Collect URL/title, meaningful DOM snapshot, no framework overlay, error/warn logs, zodiac-stage screenshot, explore-garden screenshot, and proof that six cards remain after refresh.

- [ ] **Step 5: Verify mobile and reduced motion**

Check 390px width for single-column stage, portals, feature cards, compact cards, no horizontal overflow, 44px controls, and complete image subjects. Emulate reduced motion when supported. If viewport or media emulation is unavailable in Browser, record the exact blocker and use the repository browser path without installing dependencies.

- [ ] **Step 6: Compare implementation with the approved design**

Inspect palette continuity, zodiac framing, dimension hierarchy, four portals, two-plus-four feed rhythm, motion shutdown, and responsive collapse. Fix every material mismatch. Use `view_image` on the current production/reference screenshot and latest local implementation screenshot in the same QA pass.

- [ ] **Step 7: Commit verified fixes only when needed**

```bash
git add apps/web-workbench/src/components/energy
git commit -m "fix(energy): close macaron visual QA gaps"
```

Do not create an empty commit when no fixes were required.
