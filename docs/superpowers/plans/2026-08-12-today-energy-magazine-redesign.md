# Today Energy Magazine Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the text-heavy lower half of `/cosmic` with the approved image-led “能量杂志” layout while preserving astrology truthfulness, six-item feed rotation, existing experience targets, and session de-duplication.

**Architecture:** Keep recommendation and Provider state unchanged, then add a pure presentation allocator that assigns six selected content items to one hero, two portrait, and three landscape slots with unique static artwork. Split the new presentation into focused magazine components, while `EnergyHome` and `AstrologyWorld` remain the state and interaction owners.

**Tech Stack:** React 18, TypeScript, Vitest, Testing Library, Vite, CSS Grid, Lucide React, static WebP assets, OpenAI Image Gen for build-time artwork only.

## Global Constraints

- The upper energy hero, three primary experience cards, growth panel, and compact astrology card must not change.
- DivineAPI and local fallback data flow must remain unchanged; do not invent ranking or trend data.
- Every feed batch contains exactly six content items and preserves existing session de-duplication and analytics events.
- All six visible feed cards must have artwork; there must be no `compact` icon-only card path.
- No two cards in the same batch may share the same `imageSrc`.
- The current zodiac badge appears once as the astrology magazine cover; zodiac knowledge cards use editorial artwork plus a small zodiac badge.
- Static artwork is generated during implementation and bundled with the application; the browser must not call an image generation service.
- New non-hero artwork must be at most 180 KB; hero-capable artwork must be at most 260 KB.
- Mobile validation uses a 390×844 viewport; the page must have no horizontal overflow and actions must be at least 44×44 px.
- `prefers-reduced-motion: reduce` must disable floating, zooming, rotation, and staggered replacement.
- Push, PR creation, Ready, merge, and production deployment remain separately authorized operations.

## File Structure

**Create**

- `apps/web-workbench/public/energy/magazine/*.webp` — sixteen bundled editorial illustrations.
- `apps/web-workbench/src/components/energy/energy-magazine-visuals.ts` — artwork catalog, slot types, stable batch allocator, dimension art, and portal art.
- `apps/web-workbench/src/components/energy/energy-magazine-visuals.test.ts` — catalog, size, determinism, slot, uniqueness, and zodiac overlay tests.
- `apps/web-workbench/src/components/energy/EnergyMagazineCard.tsx` — one semantic image-led content card.
- `apps/web-workbench/src/components/energy/EnergyMagazineCard.test.tsx` — card rendering, failure fallback, opened state, and action tests.
- `apps/web-workbench/src/components/energy/AstrologyMagazineCover.tsx` — the single zodiac cover, lucky bubbles, source line, and artwork fallback.
- `apps/web-workbench/src/components/energy/AstrologyMagazineCover.test.tsx` — cover data and failure fallback tests.
- `apps/web-workbench/src/components/energy/AstrologyPortalRow.tsx` — four image-led continuation portals.
- `apps/web-workbench/src/components/energy/AstrologyPortalRow.test.tsx` — portal semantics and callback tests.

**Modify**

- `apps/web-workbench/src/components/energy/energy-visuals.ts` — remove feed image selection; keep semantic icon/tone mapping as compatibility helpers.
- `apps/web-workbench/src/components/energy/energy-visuals.test.ts` — stop asserting zodiac badges as feed artwork.
- `apps/web-workbench/src/components/energy/EnergyExploreFeed.tsx` — allocate and render the six magazine slots.
- `apps/web-workbench/src/components/energy/EnergyExploreFeed.test.tsx` — replace the 2+4 contract with the 1+2+3 all-image contract.
- `apps/web-workbench/src/components/energy/AstrologyWorld.tsx` — compose the cover and portal row without changing Provider or period state.
- `apps/web-workbench/src/components/energy/AstrologyWorld.test.tsx` — preserve period/ranking tests and assert one zodiac cover plus four image portals.
- `apps/web-workbench/src/components/energy/AstrologyDimensionGrid.tsx` — image-led previews with expandable full text.
- `apps/web-workbench/src/components/energy/AstrologyDimensionGrid.test.tsx` — preview/expand semantics and six unique dimension scenes.
- `apps/web-workbench/src/components/energy/LuckyInsights.tsx` — avoid repeating colors/times already shown on the cover.
- `apps/web-workbench/src/components/energy/energy.css` — magazine layout, image treatment, responsive rules, and motion.
- `apps/web-workbench/src/components/energy/energy-css.test.ts` — enforce the new layout, touch target, image-fit, and reduced-motion rules.

---

### Task 1: Generate and validate the magazine artwork library

**Files:**

- Create: `apps/web-workbench/public/energy/magazine/relax-window.webp`
- Create: `apps/web-workbench/public/energy/magazine/relax-island.webp`
- Create: `apps/web-workbench/public/energy/magazine/fortune-capsule.webp`
- Create: `apps/web-workbench/public/energy/magazine/fortune-window.webp`
- Create: `apps/web-workbench/public/energy/magazine/tarot-single.webp`
- Create: `apps/web-workbench/public/energy/magazine/tarot-spread.webp`
- Create: `apps/web-workbench/public/energy/magazine/test-mood.webp`
- Create: `apps/web-workbench/public/energy/magazine/test-relationship.webp`
- Create: `apps/web-workbench/public/energy/magazine/game-stars.webp`
- Create: `apps/web-workbench/public/energy/magazine/game-console.webp`
- Create: `apps/web-workbench/public/energy/magazine/zodiac-orbit.webp`
- Create: `apps/web-workbench/public/energy/magazine/zodiac-library.webp`
- Create: `apps/web-workbench/public/energy/magazine/poll-cloud.webp`
- Create: `apps/web-workbench/public/energy/magazine/relation-tea.webp`
- Create: `apps/web-workbench/public/energy/magazine/editorial-breath.webp`
- Create: `apps/web-workbench/public/energy/magazine/editorial-spark.webp`
- Create: `apps/web-workbench/src/components/energy/energy-magazine-visuals.ts`
- Create: `apps/web-workbench/src/components/energy/energy-magazine-visuals.test.ts`

**Interfaces:**

- Consumes: `EnergyContentCategory` from `explore-content.ts`, `ZodiacSign` from `@/lib/astrology`.
- Produces: `MAGAZINE_ART`, `DIMENSION_MAGAZINE_ART`, `ASTROLOGY_PORTAL_ART`, and the types used by Tasks 2–5.

- [ ] **Step 1: Write the failing catalog and file-size test**

```ts
import { statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MAGAZINE_ART } from './energy-magazine-visuals';

describe('magazine artwork catalog', () => {
  it('declares sixteen unique bundled WebP assets within their byte budgets', () => {
    expect(MAGAZINE_ART).toHaveLength(16);
    expect(new Set(MAGAZINE_ART.map((asset) => asset.imageSrc)).size).toBe(16);
    for (const asset of MAGAZINE_ART) {
      expect(asset.imageSrc).toMatch(/^\/energy\/magazine\/[a-z-]+\.webp$/);
      const file = new URL(`../../../public${asset.imageSrc}`, import.meta.url);
      expect(statSync(file).size).toBeLessThanOrEqual(asset.maxBytes);
    }
  });
});
```

- [ ] **Step 2: Run the test and confirm the catalog is missing**

Run:

```bash
pnpm --filter @holaday/web-workbench test -- src/components/energy/energy-magazine-visuals.test.ts
```

Expected: FAIL because `energy-magazine-visuals.ts` does not exist.

- [ ] **Step 3: Create the typed catalog before adding binary files**

```ts
import type { ZodiacSign } from '@/lib/astrology';
import type { EnergyContentCategory } from './explore-content';

export type EnergyMagazineSlot = 'hero' | 'portrait' | 'landscape';

export interface MagazineArtAsset {
  id: string;
  imageSrc: `/energy/magazine/${string}.webp`;
  categories: readonly EnergyContentCategory[];
  objectPosition: string;
  maxBytes: 180_000 | 260_000;
}

export const MAGAZINE_ART: readonly MagazineArtAsset[] = [
  { id: 'relax-window', imageSrc: '/energy/magazine/relax-window.webp', categories: ['relaxation'], objectPosition: '50% 48%', maxBytes: 260_000 },
  { id: 'relax-island', imageSrc: '/energy/magazine/relax-island.webp', categories: ['relaxation', 'fortune'], objectPosition: '50% 52%', maxBytes: 260_000 },
  { id: 'fortune-capsule', imageSrc: '/energy/magazine/fortune-capsule.webp', categories: ['fortune', 'poll'], objectPosition: '50% 50%', maxBytes: 180_000 },
  { id: 'fortune-window', imageSrc: '/energy/magazine/fortune-window.webp', categories: ['fortune', 'relaxation'], objectPosition: '50% 46%', maxBytes: 180_000 },
  { id: 'tarot-single', imageSrc: '/energy/magazine/tarot-single.webp', categories: ['card-recommendation', 'fortune'], objectPosition: '50% 48%', maxBytes: 180_000 },
  { id: 'tarot-spread', imageSrc: '/energy/magazine/tarot-spread.webp', categories: ['card-recommendation'], objectPosition: '50% 54%', maxBytes: 260_000 },
  { id: 'test-mood', imageSrc: '/energy/magazine/test-mood.webp', categories: ['test-recommendation', 'poll'], objectPosition: '50% 50%', maxBytes: 180_000 },
  { id: 'test-relationship', imageSrc: '/energy/magazine/test-relationship.webp', categories: ['test-recommendation', 'relationship-quiz'], objectPosition: '50% 50%', maxBytes: 180_000 },
  { id: 'game-stars', imageSrc: '/energy/magazine/game-stars.webp', categories: ['game-recommendation', 'relaxation'], objectPosition: '50% 50%', maxBytes: 260_000 },
  { id: 'game-console', imageSrc: '/energy/magazine/game-console.webp', categories: ['game-recommendation'], objectPosition: '50% 50%', maxBytes: 180_000 },
  { id: 'zodiac-orbit', imageSrc: '/energy/magazine/zodiac-orbit.webp', categories: ['zodiac-knowledge', 'fortune'], objectPosition: '50% 50%', maxBytes: 260_000 },
  { id: 'zodiac-library', imageSrc: '/energy/magazine/zodiac-library.webp', categories: ['zodiac-knowledge'], objectPosition: '50% 46%', maxBytes: 180_000 },
  { id: 'poll-cloud', imageSrc: '/energy/magazine/poll-cloud.webp', categories: ['poll', 'relationship-quiz'], objectPosition: '50% 50%', maxBytes: 180_000 },
  { id: 'relation-tea', imageSrc: '/energy/magazine/relation-tea.webp', categories: ['relationship-quiz', 'relaxation'], objectPosition: '50% 52%', maxBytes: 180_000 },
  { id: 'editorial-breath', imageSrc: '/energy/magazine/editorial-breath.webp', categories: ['relaxation', 'test-recommendation'], objectPosition: '50% 50%', maxBytes: 180_000 },
  { id: 'editorial-spark', imageSrc: '/energy/magazine/editorial-spark.webp', categories: ['fortune', 'poll', 'card-recommendation'], objectPosition: '50% 50%', maxBytes: 180_000 },
] as const;

export const DIMENSION_MAGAZINE_ART: Readonly<Record<string, `/energy/magazine/${string}.webp`>> = {
  personal: '/energy/magazine/editorial-spark.webp',
  health: '/energy/magazine/editorial-breath.webp',
  profession: '/energy/magazine/fortune-window.webp',
  emotions: '/energy/magazine/test-mood.webp',
  travel: '/energy/magazine/relax-island.webp',
  luck: '/energy/magazine/fortune-capsule.webp',
} as const;

export const ASTROLOGY_PORTAL_ART = {
  ranking: '/energy/magazine/zodiac-orbit.webp',
  sign: '/energy/magazine/zodiac-library.webp',
  tarot: '/energy/magazine/tarot-spread.webp',
  test: '/energy/magazine/test-relationship.webp',
} as const;
```

- [ ] **Step 4: Generate the first four relaxation/fortune illustrations with the `imagegen` skill**

Use this shared art direction for every prompt:

> Bright macaron 3D editorial illustration for HOLA DAY, cream background, peach pink, lavender, sky blue and mint palette, rounded toy-like objects, soft studio light, gentle joyful mood, no text, no letters, no logos, no people, a single clear focal subject, safe negative space for a magazine title, consistent with a premium casual wellness app.

Append one scene per output: a sunlit breathing window; a floating recharge island; translucent lucky capsules; a hopeful open window with light particles. Save the source outputs under `/private/tmp/holaday-energy-magazine/` using the four catalog basenames with `.png` extensions.

- [ ] **Step 5: Generate the four tarot/test illustrations with the same art direction**

Append one scene per output: one glowing tarot card; a three-card spread; a mood meter experiment; two friendly relationship tokens and a question orb. Save them using the catalog basenames.

- [ ] **Step 6: Generate the four game/zodiac illustrations with the same art direction**

Append one scene per output: catching twelve energy stars; a playful handheld console; twelve zodiac symbols orbiting a soft planet; a magical zodiac library. Save them using the catalog basenames.

- [ ] **Step 7: Generate the four poll/relationship/editorial illustrations with the same art direction**

Append one scene per output: pastel voting clouds; a calm tea-table conversation; a guided breathing orb; a sparkling action path. Save them using the catalog basenames.

- [ ] **Step 8: Convert and compress every approved source image to WebP**

Use the bundled `sharp` runtime without adding a repository dependency:

```bash
mkdir -p apps/web-workbench/public/energy/magazine
CODEX_IMAGE_SHARP=/Users/yaleiqi/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp \
/Users/yaleiqi/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
-e 'const fs=require("fs"),path=require("path"),sharp=require(process.env.CODEX_IMAGE_SHARP); const src="/private/tmp/holaday-energy-magazine"; const dst="apps/web-workbench/public/energy/magazine"; Promise.all(fs.readdirSync(src).filter(f=>f.endsWith(".png")).map(async f=>{await sharp(path.join(src,f)).resize(1280,960,{fit:"cover"}).webp({quality:82,effort:6}).toFile(path.join(dst,f.replace(/\.png$/,".webp")))})).catch(e=>{console.error(e);process.exit(1)})'
```

- [ ] **Step 9: Run the catalog test and inspect file sizes**

Run:

```bash
pnpm --filter @holaday/web-workbench test -- src/components/energy/energy-magazine-visuals.test.ts
find apps/web-workbench/public/energy/magazine -type f -exec stat -f '%N %z' {} \; | sort
```

Expected: 1 test file passes; sixteen files exist; each byte count respects its catalog budget.

- [ ] **Step 10: Commit the validated asset library**

```bash
git add apps/web-workbench/public/energy/magazine apps/web-workbench/src/components/energy/energy-magazine-visuals.ts apps/web-workbench/src/components/energy/energy-magazine-visuals.test.ts
git commit -m "feat(energy): add magazine artwork library"
```

---

### Task 2: Allocate deterministic, unique magazine visuals

**Files:**

- Modify: `apps/web-workbench/src/components/energy/energy-magazine-visuals.ts`
- Modify: `apps/web-workbench/src/components/energy/energy-magazine-visuals.test.ts`
- Modify: `apps/web-workbench/src/components/energy/energy-visuals.ts:19-59`
- Modify: `apps/web-workbench/src/components/energy/energy-visuals.test.ts:4-23`

**Interfaces:**

- Consumes: `MAGAZINE_ART`, `EnergyContentItem[]`, and `zodiacBadgeImage(zodiacSign)`.
- Produces:

```ts
export interface AllocatedMagazineItem {
  item: EnergyContentItem;
  slot: EnergyMagazineSlot;
  visual: MagazineArtAsset;
  zodiacBadgeSrc: string | null;
}

export function allocateMagazineVisuals(
  items: readonly EnergyContentItem[],
  zodiacSign: ZodiacSign,
): AllocatedMagazineItem[];
```

- [ ] **Step 1: Add failing determinism, slot, uniqueness, and zodiac tests**

```ts
it('allocates one hero, two portraits and three landscapes without repeated art', () => {
  const items = [
    content('zodiac-fire-recharge'),
    content('zodiac-earth-rhythm'),
    content('relax-breath-window'),
    content('fortune-small-luck'),
    content('relationship-reply-speed'),
    content('game-recommend-catch'),
  ];
  const first = allocateMagazineVisuals(items, 'leo');
  const second = allocateMagazineVisuals(items, 'leo');

  expect(first.map((entry) => entry.slot)).toEqual([
    'hero', 'portrait', 'portrait', 'landscape', 'landscape', 'landscape',
  ]);
  expect(new Set(first.map((entry) => entry.visual.imageSrc)).size).toBe(6);
  expect(second).toEqual(first);
  expect(first[0]?.visual.imageSrc).not.toBe('/energy/leo-badge.jpg');
  expect(first[0]?.zodiacBadgeSrc).toBe('/energy/leo-badge.jpg');
  expect(first[1]?.zodiacBadgeSrc).toBe('/energy/leo-badge.jpg');
});
```

Add this helper in the test file:

```ts
function content(id: string): EnergyContentItem {
  const item = ENERGY_EXPLORE_CONTENT.find((candidate) => candidate.id === id);
  if (!item) throw new Error(`missing fixture ${id}`);
  return item;
}
```

- [ ] **Step 2: Run the allocator tests and confirm the export is missing**

Run:

```bash
pnpm --filter @holaday/web-workbench test -- src/components/energy/energy-magazine-visuals.test.ts src/components/energy/energy-visuals.test.ts
```

Expected: FAIL because `allocateMagazineVisuals` is not exported and the old zodiac feed assertion is now invalid.

- [ ] **Step 3: Implement the pure allocator**

```ts
const SLOT_BY_INDEX: readonly EnergyMagazineSlot[] = [
  'hero', 'portrait', 'portrait', 'landscape', 'landscape', 'landscape',
];

function stableHash(value: string): number {
  let hash = 2166136261;
  for (const char of value) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function orderedCandidates(item: EnergyContentItem): MagazineArtAsset[] {
  const preferred = MAGAZINE_ART.filter((asset) => asset.categories.includes(item.category));
  const fallback = MAGAZINE_ART.filter((asset) => !asset.categories.includes(item.category));
  const rotate = <T,>(values: readonly T[], offset: number): T[] =>
    values.length === 0
      ? []
      : [...values.slice(offset % values.length), ...values.slice(0, offset % values.length)];
  return [
    ...rotate(preferred, stableHash(item.id)),
    ...rotate(fallback, stableHash(`${item.id}:fallback`)),
  ];
}

export function allocateMagazineVisuals(
  items: readonly EnergyContentItem[],
  zodiacSign: ZodiacSign,
): AllocatedMagazineItem[] {
  const used = new Set<string>();
  return items.slice(0, 6).map((item, index) => {
    const visual = orderedCandidates(item).find((candidate) => !used.has(candidate.imageSrc));
    if (!visual) throw new Error('magazine artwork catalog cannot allocate a unique batch');
    used.add(visual.imageSrc);
    return {
      item,
      slot: SLOT_BY_INDEX[index] ?? 'landscape',
      visual,
      zodiacBadgeSrc: item.category === 'zodiac-knowledge' ? zodiacBadgeImage(zodiacSign) : null,
    };
  });
}
```

- [ ] **Step 4: Remove feed artwork selection from `energy-visuals.ts`**

Delete `EXPLORE_VISUALS` and `exploreVisualFor`. Keep `EnergyVisualTone`, `EnergyVisualIcon`, and `dimensionVisualFor` until Task 4 consumes their compatibility mapping. Update `energy-visuals.test.ts` to test only dimension tone/icon behavior.

- [ ] **Step 5: Run focused tests**

Run:

```bash
pnpm --filter @holaday/web-workbench test -- src/components/energy/energy-magazine-visuals.test.ts src/components/energy/energy-visuals.test.ts
```

Expected: both test files pass; the realistic batch has six unique image paths and two zodiac overlays.

- [ ] **Step 6: Commit the allocator**

```bash
git add apps/web-workbench/src/components/energy/energy-magazine-visuals.ts apps/web-workbench/src/components/energy/energy-magazine-visuals.test.ts apps/web-workbench/src/components/energy/energy-visuals.ts apps/web-workbench/src/components/energy/energy-visuals.test.ts
git commit -m "feat(energy): allocate unique magazine visuals"
```

---

### Task 3: Replace the feed with six image-led magazine cards

**Files:**

- Create: `apps/web-workbench/src/components/energy/EnergyMagazineCard.tsx`
- Create: `apps/web-workbench/src/components/energy/EnergyMagazineCard.test.tsx`
- Modify: `apps/web-workbench/src/components/energy/EnergyExploreFeed.tsx:1-178`
- Modify: `apps/web-workbench/src/components/energy/EnergyExploreFeed.test.tsx:24-125`

**Interfaces:**

- Consumes: `AllocatedMagazineItem` from Task 2.
- Produces:

```ts
interface EnergyMagazineCardProps {
  entry: AllocatedMagazineItem;
  opened: boolean;
  onOpen: (item: EnergyContentItem, trigger: HTMLButtonElement) => void;
}
```

- [ ] **Step 1: Write the failing semantic card test**

```tsx
it('renders artwork, the zodiac overlay, and a real action button', async () => {
  const user = userEvent.setup();
  const onOpen = vi.fn();
  const entry = allocateMagazineVisuals([content('zodiac-fire-recharge')], 'leo')[0]!;
  const { container } = render(
    <EnergyMagazineCard entry={entry} opened={false} onOpen={onOpen} />,
  );

  expect(container.querySelector('article[data-layout="hero"] img[data-artwork]')).toBeTruthy();
  expect(container.querySelector('img[data-zodiac-badge][src="/energy/leo-badge.jpg"]')).toBeTruthy();
  await user.click(screen.getByRole('button', { name: '打开火象星座怎样充电' }));
  expect(onOpen).toHaveBeenCalledWith(entry.item, expect.any(HTMLButtonElement));
});

it('keeps the card actionable when artwork fails', () => {
  const entry = allocateMagazineVisuals([content('relax-breath-window')], 'leo')[0]!;
  const { container } = render(
    <EnergyMagazineCard entry={entry} opened={false} onOpen={vi.fn()} />,
  );
  const image = container.querySelector<HTMLImageElement>('img[data-artwork]')!;
  fireEvent.error(image);
  expect(image.hidden).toBe(true);
  expect(container.querySelector('[data-artwork-fallback]')).toBeTruthy();
  expect(screen.getByRole('button', { name: '打开窗边八次慢呼吸' })).toBeTruthy();
});
```

- [ ] **Step 2: Run the card test and confirm the component is missing**

Run:

```bash
pnpm --filter @holaday/web-workbench test -- src/components/energy/EnergyMagazineCard.test.tsx
```

Expected: FAIL because `EnergyMagazineCard.tsx` does not exist.

- [ ] **Step 3: Implement the card with explicit image failure state**

```tsx
export function EnergyMagazineCard({ entry, opened, onOpen }: EnergyMagazineCardProps): JSX.Element {
  const [artFailed, setArtFailed] = React.useState(false);
  const MetaIcon = CATEGORY_ICONS[entry.item.category];
  return (
    <article
      className="energy-magazine-card"
      data-category={entry.item.category}
      data-layout={entry.slot}
      data-opened={opened ? 'true' : 'false'}
    >
      <div className="energy-magazine-card__art">
        <span data-artwork-fallback aria-hidden="true"><MetaIcon /></span>
        <img
          data-artwork
          src={entry.visual.imageSrc}
          alt=""
          loading={entry.slot === 'hero' ? 'eager' : 'lazy'}
          style={{ objectPosition: entry.visual.objectPosition }}
          hidden={artFailed}
          onError={() => setArtFailed(true)}
        />
        {entry.zodiacBadgeSrc ? (
          <img data-zodiac-badge src={entry.zodiacBadgeSrc} alt="" loading="lazy" />
        ) : null}
      </div>
      <div className="energy-explore-feed__meta">
        <span><MetaIcon aria-hidden="true" />{CATEGORY_LABELS[entry.item.category]}</span>
        <small>约 {entry.item.estimatedSeconds} 秒</small>
      </div>
      <h3>{entry.item.title}</h3>
      <p>{entry.item.summary}</p>
      <button
        type="button"
        aria-label={`打开${entry.item.title}`}
        title={`打开${entry.item.title}`}
        onClick={(event) => onOpen(entry.item, event.currentTarget)}
      >
        {opened ? '已打开，可以继续逛' : '打开这个内容'}
        <ArrowRight aria-hidden="true" />
      </button>
    </article>
  );
}
```

Move `CATEGORY_LABELS` and `CATEGORY_ICONS` into the new file and export neither; they are presentation details owned by the card.

- [ ] **Step 4: Replace the old 2+4 feed contract with a failing 1+2+3 integration test**

```tsx
it('renders one hero, two portraits and three landscapes with unique artwork', () => {
  const { container } = renderFeed();
  expect(container.querySelectorAll('article[data-layout="hero"]')).toHaveLength(1);
  expect(container.querySelectorAll('article[data-layout="portrait"]')).toHaveLength(2);
  expect(container.querySelectorAll('article[data-layout="landscape"]')).toHaveLength(3);
  const artwork = [...container.querySelectorAll<HTMLImageElement>('img[data-artwork]')];
  expect(artwork).toHaveLength(6);
  expect(new Set(artwork.map((image) => image.src)).size).toBe(6);
  expect(container.querySelector('[data-layout="compact"]')).toBeNull();
});
```

Keep the existing refresh, progress, action event, and guest storage tests.

- [ ] **Step 5: Integrate the allocator and card in `EnergyExploreFeed`**

Add:

```tsx
const entries = React.useMemo(
  () => allocateMagazineVisuals(items, zodiacSign),
  [items, zodiacSign],
);
```

Replace the mapping body with:

```tsx
{entries.map((entry) => (
  <EnergyMagazineCard
    key={entry.item.id}
    entry={entry}
    opened={openedId === entry.item.id}
    onOpen={(item, trigger) => {
      setOpenedId(item.id);
      onEvent({ type: 'energy_content_opened', contentId: item.id });
      onActionTarget(item.actionTarget, trigger);
    }}
  />
))}
```

- [ ] **Step 6: Run the card and feed tests**

Run:

```bash
pnpm --filter @holaday/web-workbench test -- src/components/energy/EnergyMagazineCard.test.tsx src/components/energy/EnergyExploreFeed.test.tsx
```

Expected: both files pass; refresh still records twelve seen IDs and the DOM contains six distinct artwork sources.

- [ ] **Step 7: Commit the feed structure**

```bash
git add apps/web-workbench/src/components/energy/EnergyMagazineCard.tsx apps/web-workbench/src/components/energy/EnergyMagazineCard.test.tsx apps/web-workbench/src/components/energy/EnergyExploreFeed.tsx apps/web-workbench/src/components/energy/EnergyExploreFeed.test.tsx
git commit -m "feat(energy): render image-led magazine feed"
```

---

### Task 4: Convert astrology details and continuation paths into magazine sections

**Files:**

- Create: `apps/web-workbench/src/components/energy/AstrologyMagazineCover.tsx`
- Create: `apps/web-workbench/src/components/energy/AstrologyMagazineCover.test.tsx`
- Create: `apps/web-workbench/src/components/energy/AstrologyPortalRow.tsx`
- Create: `apps/web-workbench/src/components/energy/AstrologyPortalRow.test.tsx`
- Modify: `apps/web-workbench/src/components/energy/AstrologyWorld.tsx:1-343`
- Modify: `apps/web-workbench/src/components/energy/AstrologyWorld.test.tsx:106-213`
- Modify: `apps/web-workbench/src/components/energy/AstrologyDimensionGrid.tsx:1-68`
- Modify: `apps/web-workbench/src/components/energy/AstrologyDimensionGrid.test.tsx:39-52`
- Modify: `apps/web-workbench/src/components/energy/LuckyInsights.tsx:1-83`

**Interfaces:**

- `AstrologyMagazineCover` consumes `EnergyPeriodReading` and `sourceLabel: string`.
- `AstrologyPortalRow` consumes the four existing callbacks and `rankingLoading: boolean`; it does not own ranking or sign-picker state.
- `AstrologyDimensionGrid` continues to consume `reading: EnergyPeriodReading` and owns only local expansion state.

- [ ] **Step 1: Write failing cover tests**

```tsx
it('renders one zodiac cover with color, time, period and source facts', () => {
  render(<AstrologyMagazineCover reading={reading} sourceLabel="DivineAPI 内容" />);
  expect(screen.getAllByRole('img', { name: '白羊座马卡龙专刊封面' })).toHaveLength(1);
  expect(screen.getByText('#ff7d8d')).toBeTruthy();
  expect(screen.getByText('10:00 - 11:00')).toBeTruthy();
  expect(screen.getByText('2026-08-12')).toBeTruthy();
  expect(screen.getByText('DivineAPI 内容')).toBeTruthy();
});

it('uses a visible cover fallback after image failure', () => {
  render(<AstrologyMagazineCover reading={reading} sourceLabel="DivineAPI 内容" />);
  fireEvent.error(screen.getByRole('img', { name: '白羊座马卡龙专刊封面' }));
  expect(screen.getByTestId('zodiac-cover-fallback')).toBeTruthy();
});
```

- [ ] **Step 2: Write failing portal tests**

```tsx
it('renders four image covers and preserves every callback', async () => {
  const user = userEvent.setup();
  const callbacks = {
    onOpenRanking: vi.fn(), onToggleSignPicker: vi.fn(),
    onOpenEnergyCard: vi.fn(), onOpenLightTest: vi.fn(),
  };
  const { container } = render(<AstrologyPortalRow rankingLoading={false} {...callbacks} />);
  expect(container.querySelectorAll('img[data-portal-art]')).toHaveLength(4);
  await user.click(screen.getByRole('button', { name: '查看十二星座排行' }));
  await user.click(screen.getByRole('button', { name: '换个星座看看' }));
  await user.click(screen.getByRole('button', { name: '抽一张相关能量牌' }));
  await user.click(screen.getByRole('button', { name: '测个相关主题' }));
  Object.values(callbacks).forEach((callback) => expect(callback).toHaveBeenCalledOnce());
});
```

- [ ] **Step 3: Run the new tests and confirm both components are missing**

Run:

```bash
pnpm --filter @holaday/web-workbench test -- src/components/energy/AstrologyMagazineCover.test.tsx src/components/energy/AstrologyPortalRow.test.tsx
```

Expected: FAIL because both components do not exist.

- [ ] **Step 4: Implement the cover as the only owner of zodiac image failure state**

The cover must call `zodiacBadgeImage(reading.zodiacSign)`, render `reading.summary`, `reading.rangeLabel`, the first lucky color and suitable time, and a source line. Use local `failedSrc` state keyed by the current image path so changing sign or period can show a new image after a prior failure.

```tsx
const artSrc = zodiacBadgeImage(reading.zodiacSign);
const failed = failedSrc === artSrc;
return (
  <header className="energy-astrology-magazine-cover">
    <div className="energy-astrology-magazine-cover__copy">
      <p className="energy-kicker"><Sparkles aria-hidden="true" />星座专刊</p>
      <h2 id="energy-astrology-world-title">{reading.zodiacLabel}能量专刊</h2>
      <p>{reading.summary}</p>
      <span className="energy-astrology-magazine-cover__source">{sourceLabel}</span>
    </div>
    <div className="energy-astrology-magazine-cover__art">
      {failed ? (
        <span data-testid="zodiac-cover-fallback"><Sparkles aria-hidden="true" /><strong>{reading.zodiacLabel}</strong></span>
      ) : (
        <img src={artSrc} alt={`${reading.zodiacLabel}马卡龙专刊封面`} onError={() => setFailedSrc(artSrc)} />
      )}
      <dl>
        <div><dt>幸运色</dt><dd>{reading.luckyColors[0] ?? '等待提示'}</dd></div>
        <div><dt>顺手时段</dt><dd>{reading.suitableTimes[0] ?? '等待提示'}</dd></div>
        <div><dt>阅读范围</dt><dd>{reading.rangeLabel}</dd></div>
      </dl>
    </div>
  </header>
);
```

- [ ] **Step 5: Implement the four image-led portal buttons**

Define a local `PORTALS` array backed by `ASTROLOGY_PORTAL_ART`; render an image with `data-portal-art`, label, short hint, and arrow in each native button. Use the exact existing labels, `aria-label`, `title`, disabled ranking state, and callbacks so `AstrologyWorld` behavior remains unchanged.

- [ ] **Step 6: Write the failing dimension-preview test**

```tsx
it('shows three image previews, expands one body, then reveals six unique scenes', async () => {
  const user = userEvent.setup();
  const { container } = render(<AstrologyDimensionGrid reading={reading} />);
  expect(container.querySelectorAll('img[data-dimension-art]')).toHaveLength(3);
  expect(container.querySelector('[data-dimension-body]')).toBeNull();
  await user.click(screen.getByRole('button', { name: '展开个人完整提示' }));
  expect(container.querySelector('[data-dimension-body]')?.textContent).toContain('个人提示');
  await user.click(screen.getByRole('button', { name: '展开全部六项' }));
  const images = [...container.querySelectorAll<HTMLImageElement>('img[data-dimension-art]')];
  expect(images).toHaveLength(6);
  expect(new Set(images.map((image) => image.src)).size).toBe(6);
});
```

- [ ] **Step 7: Implement image-led dimension previews**

For every visible dimension, render its `DIMENSION_MAGAZINE_ART[dimension.key]` image, label, score, a maximum 22-character preview from `dimension.body`, and a native toggle button. Keep `openDimensionKey: string | null`; only render `<p data-dimension-body>{dimension.body}</p>` when that key is open. Reset remains automatic because `AstrologyWorld` already keys the grid by period.

- [ ] **Step 8: Remove duplicated lucky color and time groups from `LuckyInsights`**

Change:

```ts
const groups = luckyInsightGroups(reading);
```

to:

```ts
const groups = luckyInsightGroups(reading).filter(
  (group) => group.key === 'numbers' || group.key === 'letters',
);
```

Keep tips, verified seven-day trend, and the honest no-trend empty state unchanged.

- [ ] **Step 9: Compose the new components in `AstrologyWorld`**

Replace the old stage with:

```tsx
<AstrologyMagazineCover reading={selectedState.reading} sourceLabel={sourceLabel} />
```

Replace only the four-button markup with:

```tsx
<AstrologyPortalRow
  rankingLoading={astrology.ranking.loading}
  onOpenRanking={() => { setRankingRequested(true); void astrology.loadRanking(); }}
  onToggleSignPicker={() => setSignPickerOpen((value) => !value)}
  onOpenEnergyCard={onOpenEnergyCard}
  onOpenLightTest={onOpenLightTest}
/>
```

Move the selected reading summary into the cover and remove the duplicate summary `<h3>` from `energy-astrology-world__period-header`; that header keeps only the selected range and refresh button. Do not alter tab, month, refresh, ranking, sign preview, or Provider loading logic.

- [ ] **Step 10: Run all astrology component tests**

Run:

```bash
pnpm --filter @holaday/web-workbench test -- src/components/energy/AstrologyMagazineCover.test.tsx src/components/energy/AstrologyPortalRow.test.tsx src/components/energy/AstrologyDimensionGrid.test.tsx src/components/energy/AstrologyWorld.test.tsx
```

Expected: all four files pass; one zodiac cover, four image portals, three-to-six dimensions, ranking truthfulness, month loading, and existing experience callbacks remain covered.

- [ ] **Step 11: Commit the astrology structure**

```bash
git add apps/web-workbench/src/components/energy/AstrologyMagazineCover.tsx apps/web-workbench/src/components/energy/AstrologyMagazineCover.test.tsx apps/web-workbench/src/components/energy/AstrologyPortalRow.tsx apps/web-workbench/src/components/energy/AstrologyPortalRow.test.tsx apps/web-workbench/src/components/energy/AstrologyWorld.tsx apps/web-workbench/src/components/energy/AstrologyWorld.test.tsx apps/web-workbench/src/components/energy/AstrologyDimensionGrid.tsx apps/web-workbench/src/components/energy/AstrologyDimensionGrid.test.tsx apps/web-workbench/src/components/energy/LuckyInsights.tsx
git commit -m "feat(energy): build astrology magazine sections"
```

---

### Task 5: Apply the magazine layout, responsive behavior, and motion contract

**Files:**

- Modify: `apps/web-workbench/src/components/energy/energy.css:1597-2696`
- Modify: `apps/web-workbench/src/components/energy/energy.css:2980-3324`
- Modify: `apps/web-workbench/src/components/energy/energy-css.test.ts:37-81`

**Interfaces:**

- Consumes: the `data-layout`, `data-opened`, `data-artwork`, `data-zodiac-badge`, `data-portal-art`, and `data-dimension-art` hooks from Tasks 3–4.
- Produces: desktop four-column magazine rhythm, tablet two-column layout, mobile single-column feed and horizontal portal rail, and reduced-motion shutdown.

- [ ] **Step 1: Replace the old CSS contract test with failing magazine assertions**

```ts
it('builds the one plus two plus three magazine rhythm with all-image cards', () => {
  expect(css).toMatch(/\.energy-explore-feed__grid\s*\{[^}]*grid-template-columns:\s*repeat\(12,/s);
  expect(css).toMatch(/article\[data-layout="hero"\]\s*\{[^}]*grid-column:\s*span\s*6/s);
  expect(css).toMatch(/article\[data-layout="portrait"\]\s*\{[^}]*grid-column:\s*span\s*3/s);
  expect(css).toMatch(/article\[data-layout="landscape"\]\s*\{[^}]*grid-column:\s*span\s*4/s);
  expect(css).not.toContain('.energy-explore-feed__compact-icon');
});

it('keeps mobile portals horizontal and all actions touch friendly', () => {
  expect(css).toMatch(/@media\s*\(max-width:\s*640px\)[\s\S]*\.energy-astrology-portals\s*\{[^}]*overflow-x:\s*auto/);
  expect(css).toMatch(/@media\s*\(max-width:\s*640px\)[\s\S]*\.energy-magazine-card\s+button\s*\{[^}]*min-height:\s*44px/);
});
```

- [ ] **Step 2: Run the CSS test and confirm the old selectors fail the new contract**

Run:

```bash
pnpm --filter @holaday/web-workbench test -- src/components/energy/energy-css.test.ts
```

Expected: FAIL because the stylesheet still contains `compact` and the old 2+4 sizing.

- [ ] **Step 3: Implement the desktop feed grid**

Use this layout contract:

```css
.energy-explore-feed__grid {
  display: grid;
  grid-template-columns: repeat(12, minmax(0, 1fr));
  gap: 14px;
}
.energy-explore-feed__grid article[data-layout="hero"] { grid-column: span 6; }
.energy-explore-feed__grid article[data-layout="portrait"] { grid-column: span 3; }
.energy-explore-feed__grid article[data-layout="landscape"] { grid-column: span 4; }
.energy-magazine-card__art { position: relative; overflow: hidden; border-radius: 18px; }
article[data-layout="hero"] .energy-magazine-card__art { aspect-ratio: 16 / 9; }
article[data-layout="portrait"] .energy-magazine-card__art { aspect-ratio: 4 / 5; }
article[data-layout="landscape"] .energy-magazine-card__art { aspect-ratio: 4 / 3; }
.energy-magazine-card__art img[data-artwork] { width: 100%; height: 100%; object-fit: cover; }
```

Make the first-row hero and portraits visually dominant. Clamp summaries to one line on landscape cards and two lines on hero/portrait cards. Keep the real button visible without depending on hover.

- [ ] **Step 4: Implement the astrology cover, dimension, and portal styling**

Use a two-column cover with the copy at left and one circular zodiac image at right. Render the three fact bubbles as a compact `dl`. Dimension previews use a stable image region above their short label. Portals use circular images and text below, with a desktop four-column row.

- [ ] **Step 5: Implement tablet and mobile rules**

At `max-width: 900px`, use two feed columns and let the hero span both. At `max-width: 640px`, use one feed column, stack cover copy above the full zodiac art, and set `.energy-astrology-portals` to `display:flex; overflow-x:auto; scroll-snap-type:x proximity`. Give each portal `flex:0 0 132px`; do not collapse the four portals into tall text rows.

- [ ] **Step 6: Implement motion and complete reduced-motion shutdown**

Keep content replacement between 220–300ms, card lift at 3px or less, and artwork zoom at 1.025 or less. Extend the existing reduced-motion block to include `.energy-magazine-card__art img`, `.energy-astrology-magazine-cover__art img`, `.energy-astrology-portals img`, and dimension art.

- [ ] **Step 7: Run CSS and component tests**

Run:

```bash
pnpm --filter @holaday/web-workbench test -- src/components/energy/energy-css.test.ts src/components/energy/EnergyMagazineCard.test.tsx src/components/energy/EnergyExploreFeed.test.tsx src/components/energy/AstrologyMagazineCover.test.tsx src/components/energy/AstrologyPortalRow.test.tsx src/components/energy/AstrologyDimensionGrid.test.tsx src/components/energy/AstrologyWorld.test.tsx
```

Expected: all listed tests pass.

- [ ] **Step 8: Commit the complete magazine styling**

```bash
git add apps/web-workbench/src/components/energy/energy.css apps/web-workbench/src/components/energy/energy-css.test.ts
git commit -m "style(energy): apply responsive magazine layout"
```

---

### Task 6: Verify the complete story in tests and a real browser

**Files:**

- Verify: all files listed above.
- Do not create or modify unrelated QA artifacts, `.claude/`, or `skills/*` drafts.

**Interfaces:**

- Consumes: the completed branch from Tasks 1–5.
- Produces: release evidence only; fixes discovered here must be separate focused commits.

- [ ] **Step 1: Run focused energy tests**

```bash
pnpm --filter @holaday/web-workbench test -- src/components/energy
```

Expected: all energy test files pass with zero failures.

- [ ] **Step 2: Run the full Web Workbench suite**

```bash
pnpm --filter @holaday/web-workbench test
```

Expected baseline: at least 163 files and 1261 tests pass; new tests increase these counts and there are zero failures.

- [ ] **Step 3: Run lint, typecheck, build, and diff checks**

```bash
pnpm --filter @holaday/web-workbench lint
pnpm --filter @holaday/web-workbench typecheck
pnpm --filter @holaday/web-workbench build
git diff --check origin/claude/musing-keller-ae1d05...HEAD
git status --short --branch
```

Expected: all commands exit 0; the branch contains only the approved design, plan, energy components, tests, CSS, and magazine assets.

- [ ] **Step 4: Start the local app for browser verification**

```bash
pnpm --filter @holaday/web-workbench dev -- --host 127.0.0.1 --port 5173
```

Open `http://127.0.0.1:5173/cosmic` with the in-app Browser using the existing authenticated test account state.

- [ ] **Step 5: Verify desktop visual and interaction requirements**

Check all of the following in the rendered page:

1. exactly one zodiac cover image exists in the astrology magazine;
2. four continuation portals display four different cover images;
3. the feed has one hero, two portrait, and three landscape cards;
4. six `img[data-artwork]` sources are unique;
5. clicking “再来一组” changes the six content titles and preserves six unique artwork sources;
6. open one hero, one portrait, and one landscape item and confirm existing target behavior;
7. open ranking, sign preview, tarot, and test portals and confirm focus returns correctly;
8. no framework error overlay and no console error or warning related to the energy page.

- [ ] **Step 6: Verify the 390×844 mobile viewport**

Set the Browser viewport capability to `{ width: 390, height: 844 }`, wait for the “今日能量” heading, and evaluate:

```js
({
  innerWidth: window.innerWidth,
  documentScrollWidth: document.documentElement.scrollWidth,
  bodyScrollWidth: document.body.scrollWidth,
  horizontalOverflow:
    Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) > window.innerWidth + 1,
})
```

Expected: `innerWidth` is 390 and `horizontalOverflow` is `false`. Capture the zodiac cover, horizontal portal rail, and feed after a refresh. Reset the viewport before finalizing the tab.

- [ ] **Step 7: Audit assets and changed-file scope**

```bash
find apps/web-workbench/public/energy/magazine -type f -exec stat -f '%N %z' {} \; | sort
git diff --stat origin/claude/musing-keller-ae1d05...HEAD
git diff --name-only origin/claude/musing-keller-ae1d05...HEAD
```

Expected: sixteen WebP assets meet the declared budgets and no backend, database, payment, browser-extension, or deployment file is changed.

- [ ] **Step 8: Review the branch before requesting push or PR authorization**

Run a final self-review of the diff against every acceptance requirement in the design spec. If a defect is found, add one failing regression test, implement the smallest fix, rerun the affected checks, and create a focused commit. Stop with a clean local branch and report the exact tests, asset sizes, browser evidence, changed files, and remaining risks; do not push or create a PR without authorization.
