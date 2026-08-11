# Today Energy Visual Assets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give all twelve zodiac signs a matching illustration and stop the Today Energy experience-card images from being aggressively cropped.

**Architecture:** Add a typed, exhaustive asset registry consumed by the astrology panel. Keep image presentation in the existing Energy CSS and store all generated raster assets under the current `/public/energy` asset namespace.

**Tech Stack:** React 18, TypeScript, Vitest, CSS, Vite, built-in ImageGen.

## Global Constraints

- Preserve the existing bright soft-3D art direction and component hierarchy.
- Generate one independent square raster asset per missing zodiac sign; do not use a sprite sheet or generic fallback.
- Do not change astrology API behavior, card actions, copy, routes, or persistence.
- Execute serially without subagents.

---

### Task 1: Add the exhaustive zodiac art registry

**Files:**
- Create: `apps/web-workbench/src/components/energy/zodiac-art.ts`
- Create: `apps/web-workbench/src/components/energy/zodiac-art.test.ts`
- Modify: `apps/web-workbench/src/components/energy/EnergyAstrologyPanel.tsx`

**Interfaces:**
- Consumes: `ZodiacSign` from `@/lib/astrology`.
- Produces: `zodiacBadgeImage(sign: ZodiacSign): string`.

- [ ] **Step 1: Write the failing registry test**

Assert that all twelve signs resolve to `/energy/<sign>-badge.jpg`, and that the twelve returned paths are unique.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `pnpm --filter @holaday/web-workbench test -- src/components/energy/zodiac-art.test.ts`

Expected: FAIL because `zodiac-art.ts` does not exist.

- [ ] **Step 3: Implement the typed registry and component consumption**

Create an exhaustive `Record<ZodiacSign, string>`, export `zodiacBadgeImage`, remove the Aries-only condition, and always render the resolved image.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `pnpm --filter @holaday/web-workbench test -- src/components/energy/zodiac-art.test.ts`

Expected: PASS.

### Task 2: Generate and normalize the eleven missing zodiac assets

**Files:**
- Create: `apps/web-workbench/public/energy/taurus-badge.jpg`
- Create: `apps/web-workbench/public/energy/gemini-badge.jpg`
- Create: `apps/web-workbench/public/energy/cancer-badge.jpg`
- Create: `apps/web-workbench/public/energy/leo-badge.jpg`
- Create: `apps/web-workbench/public/energy/virgo-badge.jpg`
- Create: `apps/web-workbench/public/energy/libra-badge.jpg`
- Create: `apps/web-workbench/public/energy/scorpio-badge.jpg`
- Create: `apps/web-workbench/public/energy/sagittarius-badge.jpg`
- Create: `apps/web-workbench/public/energy/capricorn-badge.jpg`
- Create: `apps/web-workbench/public/energy/aquarius-badge.jpg`
- Create: `apps/web-workbench/public/energy/pisces-badge.jpg`

**Interfaces:**
- Consumes: the existing `aries-badge.jpg` as the visual style reference.
- Produces: eleven independent 420×420 JPEG assets at the registry paths.

- [ ] **Step 1: Generate one square illustration per sign**

Use the built-in ImageGen tool serially, repeat the same composition and material constraints, and change only the zodiac subject and restrained accent palette.

- [ ] **Step 2: Inspect every result**

Verify the correct sign symbol, centered full subject, circular frame, generous edge padding, no text, no watermark, and style consistency with Aries.

- [ ] **Step 3: Normalize project assets**

Convert selected results to 420×420 JPEG files and save them at the exact registry paths without overwriting `aries-badge.jpg`.

- [ ] **Step 4: Verify dimensions and file presence**

Run: `sips -g pixelWidth -g pixelHeight apps/web-workbench/public/energy/*-badge.jpg`

Expected: twelve images, each 420×420.

### Task 3: Fix the image presentation rules

**Files:**
- Modify: `apps/web-workbench/src/components/energy/energy-css.test.ts`
- Modify: `apps/web-workbench/src/components/energy/energy.css`

**Interfaces:**
- Consumes: existing `.energy-experience-card__image` and `.energy-astrology-panel__badge` selectors.
- Produces: uncropped 4:3 card art and a non-stretched circular zodiac badge.

- [ ] **Step 1: Write failing CSS regression assertions**

Assert that the experience image selector uses `aspect-ratio: 4 / 3` and `object-fit: contain`, and that the astrology badge uses `aspect-ratio: 1` with `align-self: start`.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `pnpm --filter @holaday/web-workbench test -- src/components/energy/energy-css.test.ts`

Expected: FAIL against the current 92px `cover` image window and stretchable badge.

- [ ] **Step 3: Apply the minimal CSS fix**

Use a 4:3 aspect-ratio window with `contain`, a matching pale background, and responsive sizes that retain the full subject. Fix the zodiac badge at 1:1 without removing its animation.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `pnpm --filter @holaday/web-workbench test -- src/components/energy/energy-css.test.ts`

Expected: PASS.

### Task 4: Verify implementation and visual fidelity

**Files:**
- Modify: `design-qa.md`

**Interfaces:**
- Consumes: the completed code and assets.
- Produces: fresh automated and browser evidence with `final result: passed` or a precise blocker.

- [ ] **Step 1: Run automated gates**

Run the full web test suite, typecheck, lint, build, targeted Biome check, and `git diff --check`.

- [ ] **Step 2: Run local browser QA**

Open `/cosmic` in the in-app browser at desktop and mobile widths. Switch zodiac profiles to confirm multiple generated images render, inspect all three card illustrations, click a primary interaction, check horizontal overflow, broken images, and console errors.

- [ ] **Step 3: Complete design QA**

Compare the user screenshots with the local captures at matching widths and record findings in `design-qa.md`. Fix P0/P1/P2 findings and repeat until `final result: passed`.

- [ ] **Step 4: Review the final diff**

Confirm that only the scoped code, tests, assets, plan/spec, and QA report changed.
