# 今日能量补给站 Design QA

## 对照目标

- Source visual truth: `/Users/yaleiqi/.codex/generated_images/019fea2f-b33b-7560-9d5a-5a381b4cfd37/exec-873d6350-b5d6-459c-ae73-fb272ee579d9.png`
- Browser-rendered implementation: `http://127.0.0.1:5174/cosmic-preview`
- Final desktop screenshot: `/private/tmp/today-energy-recharge-hub-qa/implementation-desktop-final.png`
- Final full-view comparison: `/private/tmp/today-energy-recharge-hub-qa/comparison-desktop-final.png`
- Focused hero comparison: `/private/tmp/today-energy-recharge-hub-qa/comparison-hero-final.png`
- Focused experience-deck comparison: `/private/tmp/today-energy-recharge-hub-qa/comparison-deck-final.png`
- State: guest preview using the same production components, generated assets, interactive experiences, and local astrology fallback. The unchanged authenticated AppShell is outside the changed surface and is excluded from the content-region judgment.

## Viewport and normalization

- Source: 1507 x 1044 px.
- Implementation: 1507 x 1044 CSS px and screenshot pixels, deviceScaleFactor 1.
- Full comparison places both equal-density captures side by side without rescaling.
- Focused hero regions were cropped from the visible hero in each artifact and normalized to 1120 x 410 px before the side-by-side comparison.
- Focused experience-deck regions were cropped from each artifact and normalized to 1120 x 285 px before comparison.
- Responsive evidence: 1024 x 768 tablet, 390 x 844 mobile first viewport, mobile middle content, and mobile bottom content.

## Full-view comparison evidence

- Layout: final implementation follows the selected three-part hero hierarchy: copy and primary action on the left, recharge island in the center, and four energy choices on the right.
- Vertical rhythm: the three-choice deck starts at the same visual band as the reference and the growth plus astrology panels begin within the first desktop viewport.
- Typography: the berry display heading, compact section heading, readable body scale, and small metadata hierarchy remain clear at desktop, tablet, and mobile sizes.
- Colors: cream, sky, peach, mint, violet, berry, and bright pink tokens preserve the light reference mood without introducing a dark page surface.
- Image quality: all main visual slots use generated JPG assets with correct crop and object-fit behavior. No emoji, handmade SVG, CSS illustration, or placeholder art replaces the source imagery.
- Copy: the implementation keeps the reference's direct recharge framing while adding privacy-safe, standalone explanations for real product behavior.

## Focused comparison evidence

- Hero: the selected need has a bright pink outline, the CTA uses a brighter pink gradient, and the four need labels retain their distinct semantic colors. The generated island remains crisp and balanced at all tested widths.
- Experience deck: three equal playable cards preserve the reference order and pastel differentiation. The implementation intentionally uses accessible full-card buttons and descriptive action text instead of decorative numbered badges.
- Growth and astrology: both panels sit side by side on desktop, stack without overlap on smaller widths, and expose completed-node feedback, daily guidance, weekly guidance, profile editing, and refresh actions.

## Interaction and browser QA

- Page identity: URL and title resolved to `/cosmic-preview` and `HOLA DAY`.
- Blank page / framework overlay: meaningful content rendered; no Vite or React error overlay appeared.
- Need selection: selecting `放松` changed `aria-pressed` to true and updated the live response copy.
- Recharge: opened, started, immediately completed, and changed growth from 0 to 1.
- Mini game: all 12 targets were activated and the result reached `能量收集完成`.
- Tarot: opened the `是 / 否卡` path, preserved the question in the user's head, and returned a card result without uploading question text.
- Light test: completed the `心理状态` path and displayed the `秩序型节奏` result.
- Astrology: switched from daily to weekly content, showed six weekly sections, collected the guidance, and raised growth to 5 of 5.
- Profile drawer: opened with birthday, optional-detail expansion, save, clear, and close controls present.
- Console: zero error-level entries. Ten `energy event report failed` warnings were expected because the isolated preview intentionally had no local orchestrator at port 3001; all UI flows remained functional through the offline-safe registry and local fallback.

## Comparison history

### Pass 1

- P1: hero used a two-column composition, placing the energy choices under the copy instead of beside the island.
- P1: the primary CTA was a dark purple and did not carry the selected bright reference energy.
- Fix: rebuilt the desktop hero as copy / island / need-selector columns and introduced the bright `#ff315f` action token.

### Pass 2

- P2: the experience deck was too tall, which pushed growth and astrology below the first viewport.
- Fix: compacted the deck header and card media/content rhythm, then moved growth and astrology into a balanced two-column insight row.

### Pass 3

- P2: a redundant page description added roughly one line of vertical drift compared with the reference.
- Fix: removed the duplicated description, retained the title and date, and recaptured at the same viewport.

### Final pass

- No actionable P0, P1, or P2 visual, interaction, responsive, or accessibility findings remain on the changed surface.
- P3 intentional deviations: the concept-only notification badge, `NEW` marker, and shell navigation are not reproduced inside the preview component. Existing AppShell navigation was not changed by this branch.

## Automated gates

- Full Web suite: 152 files, 1202 tests passed.
- Full orchestrator suite: 13 Node contract tests plus 252 Vitest files and 4149 Vitest tests passed after the port-listening cases were rerun outside the restricted sandbox.
- Web energy and page tests: 17 files, 48 tests passed.
- Orchestrator astrology and energy tests: 4 files, 17 tests passed.
- Web and orchestrator typechecks passed.
- Web ESLint and production build passed.
- Orchestrator production build passed.
- Targeted Biome formatting and `git diff --check` passed.

final result: passed

---

# 今日能量星座插画与功能卡裁切 Design QA（2026-08-11）

## 对照目标

- 用户截图 1：`/var/folders/mg/xmy8dhk57jdfc5xc_cfm063r0000gn/T/TemporaryItems/NSIRD_screencaptureui_ypeFDW/截屏2026-08-11 22.27.13.png`
- 用户截图 2：`/var/folders/mg/xmy8dhk57jdfc5xc_cfm063r0000gn/T/TemporaryItems/NSIRD_screencaptureui_8ZGvMO/截屏2026-08-11 22.27.52.png`
- Browser-rendered implementation: `http://127.0.0.1:5181/cosmic`
- Desktop viewport: 1280 × 720.
- Mobile viewport: 390 × 844.
- State: authenticated test account with production API data proxied through the local Vite preview.

## Mismatch ledger

| Reference evidence | Rendered evidence | Resolution |
| --- | --- | --- |
| Only Aries had a raster illustration; other signs fell back to a generic sparkle icon. | The typed registry resolves all twelve `ZodiacSign` values to independent `/energy/<sign>-badge.jpg` files. The component regression test renders all twelve states. | Fixed. Eleven matching soft-3D zodiac assets were generated and saved as 420 × 420 JPEGs. |
| The astrology image stretched into a tall oval because the grid item filled the panel height. | Desktop badge measured 120.01 × 120.01 px; mobile measured 97.57 × 97.57 px. | Fixed with a 1:1 aspect ratio and start alignment. |
| The three 640 × 442 illustrations were cropped into a 92 px `cover` strip. | Desktop frames measured about 282.66 × 212 px and mobile 322 × 241.5 px, all with computed `object-fit: contain`. | Fixed with a responsive 4:3 image window. |

## Browser QA

- Page identity: `/cosmic`, title `HOLA DAY`.
- Meaningful content rendered after authentication; no blank shell or framework overlay appeared.
- Desktop horizontal overflow: viewport width 1280, document width 1280.
- Mobile horizontal overflow: viewport width 390, document width 390.
- Broken images: 0 at desktop and mobile widths.
- Console warnings/errors: 0 after the page and assets stabilized.
- Interaction proof: selecting `放松` set `aria-pressed="true"` and changed the live hero copy to `先把肩膀放松，再给大脑留一点空白。`.
- The automated profile test verifies every zodiac-to-image UI mapping. The Browser automation could not drive the native date field reliably enough to switch the live profile without bypassing normal component input behavior, so no hidden-state shortcut was used.

## Automated gates

- Full Web suite: 153 files, 1215 tests passed.
- Web typecheck passed.
- Web ESLint passed.
- Production Vite build passed.
- Targeted Biome check passed.
- `git diff --check` passed after the QA report update.

## Remaining findings

- No P0, P1, or P2 finding remains in the changed surface.
- P3 existing shell behavior: the fixed mobile menu button can temporarily cover section eyebrow text while the page is scrolled. It does not cover the main page title at the top and is outside the requested image work.

final result: passed
