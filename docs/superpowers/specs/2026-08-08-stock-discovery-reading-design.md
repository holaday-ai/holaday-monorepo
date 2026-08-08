# Stock Discovery Reading Experience

## Goal

Turn stock news discovery from a three-card dashboard widget into a source-backed reading flow:

1. The stock dashboard remains a concise, three-card entry surface.
2. `查看更多新闻` opens a dedicated discovery route for long browsing.
3. Each item opens in a large in-product modal, with previous and next navigation.
4. The detail view never implies that Holaday has article text or multiple sources when the upstream record only contains metadata or a source summary.

## Confirmed Product Decisions

- The dashboard action navigates to a full discovery page. It does not open the first article.
- Individual news and announcement items remain in a Holaday modal; they do not navigate away from the product.
- Source cover images are preferred. Reusable editorial artwork may remain a visual cover but is never described as a publisher image or proof.
- Preserve existing category tabs, related symbols, announcement/news distinction, source link, paging, and real-source-only boundary.
- The product must be honest about article content. A source summary is not an article body.

## Information Architecture

### Dashboard

- `发现` retains its current compact three-card carousel and six category chips.
- Its header action becomes `查看更多新闻` and opens `/stocks/discovery`.
- The selected dashboard chip is carried as `?feed=<feed>` when the user chooses a non-default feed before opening the route.

### Discovery Page

`/stocks/discovery` is a normal AppShell route, not a modal.

- Header: `发现` and a concise count/freshness line.
- Tabs: `全部` / `自选股新闻` / `重要公告` / `A股要闻` / `美股要闻` / `港股要闻`.
- Content: responsive editorial card grid. Desktop uses three columns when space permits; tablet uses two; mobile uses one.
- Loading: each market feed keeps its own next page. Reaching the third-to-last displayed page starts prefetching the next server page; a visible `加载更多` remains available.
- Ordering: newest published source record first. Existing title/url deduplication and category mix rules remain in effect.
- Empty and error states identify the unavailable source/feed without offering synthetic replacements.

### Detail Modal

The modal is article-shaped and wide on desktop, full-screen on mobile.

1. Header has category, verified source timestamp, related symbols, previous/next, and close.
2. The title is followed by the original publisher/source card and a single `打开原文` action.
3. A valid source cover can be displayed as media. Editorial artwork may remain as clearly labelled theme art, but is never treated as source evidence.
4. `来源摘要` renders exactly the upstream `新闻内容` field when present.
5. `正文` renders only when a server detail record contains verified extracted source text. It carries its source and extraction time.
6. When full text is unavailable, show `当前来源仅返回摘要，打开原文可查看全文。` Do not invent body paragraphs, source counts, material facts, or an AI interpretation.
7. Facts/metrics shown beside the article are limited to type, source, published time, related symbols, and content availability.

## Data Contract

Introduce a normalized `NewsDetail` response keyed by the article's stable source URL:

```ts
type NewsContentStatus = 'source-body' | 'source-summary' | 'metadata-only';

interface NewsDetail {
  url: string;
  contentStatus: NewsContentStatus;
  sourceName: string;
  publishedAt: string;
  summary?: string;
  body?: string[];
  extractedAt?: string;
}
```

- `source-summary`: existing upstream content field; no inference.
- `source-body`: body returned by a controlled, URL-validated server-side extractor. It must retain the publisher/source URL and extraction time.
- `metadata-only`: title and metadata only.
- An extractor failure is a normal `metadata-only`/`source-summary` response, never a task failure and never a fabricated fallback.
- The first implementation only retrieves `https` content from the existing Eastmoney/CNInfo source-host allowlist, revalidates every redirect, enforces body-size and content-type caps, and caches reads by URL. Source fetching does not block discovery-page loading.

## Non-Goals

- No fake multi-source count, synthesized article, investment recommendation, or decorative image presented as source evidence.
- No paid or login-gated publisher content circumvention.
- No change to the existing daily briefing, stock quote, stock chart, or task-state code paths.
- Perplexity-style multi-source AI deep reads are a later capability. They require explicit multi-source retrieval and per-section citations before being shown as a product feature.

## Acceptance Criteria

1. The dashboard `查看更多新闻` action reaches `/stocks/discovery` and preserves a selected feed.
2. The discovery page can independently continue each market feed and keeps existing card media behavior.
3. Modal detail uses the current item, supports next/previous, and states source/body availability accurately.
4. A no-body record never shows invented paragraphs under `正文`.
5. A verified body is source-attributed and includes extraction time.
6. Desktop, tablet, and mobile layouts do not clip cards, modal actions, tab labels, or body text.
