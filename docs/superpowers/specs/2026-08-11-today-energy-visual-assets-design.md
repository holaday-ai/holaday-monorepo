# Today Energy Visual Assets Design

## Goal

Complete the visual system for Today Energy by giving every zodiac sign its own illustration and by showing the three experience-card illustrations without aggressive cropping.

## Selected direction

- Keep the existing bright, soft 3D illustration language already used by the Aries, Tarot, mini-game, and quick-test assets.
- Reuse the current Aries illustration as the style reference and create one square raster asset for each of the other eleven zodiac signs.
- Map all twelve `ZodiacSign` values to explicit project-local assets. Do not use a generic icon fallback.
- Keep the astrology art circular by giving the badge a fixed 1:1 aspect ratio and preventing grid stretching.
- Increase the experience-card image window and use `object-fit: contain` so the full subject remains visible. Preserve the existing hover motion, card copy, actions, and responsive stacking.

## Asset specification

Each zodiac asset is a 420×420 JPEG with the animal or symbolic subject centered inside a luminous circular constellation frame. The palette stays airy and optimistic: pearly white, pastel cyan, lavender, peach, mint, and restrained gold accents. Assets contain no text, labels, logos, watermarks, or dark backgrounds.

## Component changes

- `zodiac-art.ts` owns the exhaustive zodiac-to-image mapping.
- `EnergyAstrologyPanel.tsx` always renders the mapped image for the selected profile.
- `energy.css` owns presentation: circular astrology art, taller 4:3 experience image windows, full-subject fitting, and responsive adjustments.

## Verification

- Unit tests prove every supported zodiac sign resolves to its own expected asset path.
- CSS regression tests prove the image window uses `contain` and the zodiac badge stays square.
- The full web test suite, typecheck, lint, build, and `git diff --check` run before handoff.
- Browser QA covers desktop and mobile Today Energy layouts, checks image completeness, overflow, broken images, interactions, and console output.

## Non-goals

- No astrology API or content changes.
- No new routes, modes, or gameplay.
- No changes to unrelated worktree drafts or production deployment.
