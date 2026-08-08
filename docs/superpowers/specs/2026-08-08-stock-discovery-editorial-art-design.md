# Stock Discovery Editorial Art

## Goal

Give coverless stock discovery articles a useful visual without misrepresenting it as an original publisher image, without generating an image on every dashboard refresh, and without creating a recurring per-view generation cost.

## User-facing behavior

1. A verified publisher cover remains the first choice.
2. A coverless news or announcement item uses a prepared editorial image from a small finance-themed library.
3. The interface does not display an `AI` label or claim the image is a source photograph.
4. Image selection is stable for an article and varied among adjacent cards.
5. No generated image contains article text, company logos, price claims, people presented as real executives, or fabricated charts.

## Data and selection

The server exposes an `imageKind` of `source-cover` or `editorial-art` with the public asset URL. A deterministic hash of the article's stable URL (falling back to title, symbol, and time) selects a themed asset. A lightweight title classifier assigns themes such as corporate disclosure, results, industrial production, technology, consumer market, transport, and market context. A neighboring-card pass shifts an asset index when the previous card selected the same asset.

This is static asset reuse, not a dashboard-triggered image-generation call. New publisher covers require no work. New coverless articles always receive an existing compatible illustration immediately.

## Assets

A curated set of twelve 16:9 editorial illustrations is stored in the web public assets folder. They are deliberately text-free and logo-free so they remain useful across multiple articles and do not falsely depict the event in the headline.

## Failure behavior

If an asset URL is unavailable, the card remains title-and-summary first; it does not fall back to decorative source labels, title-as-image, or a generated claim. The dashboard never waits for image generation.

## Verification

- Router tests: publisher cover wins; coverless items get deterministic editorial art; adjacent rows do not repeat when alternatives exist.
- Page layout tests: editorial art uses the normal media card frame without any source-image claim or `AI` label.
- Build, typecheck, relevant test suites, and a production asset check after deployment.
