# Stock Discovery Reading Experience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dedicated stock discovery page and an honest, source-backed article detail modal without changing stock quotes, daily briefing, or task execution state.

**Architecture:** Keep the existing dashboard snapshot as the compact entry source. Add focused pure helpers for discovery route state and article detail state, a tRPC detail endpoint that caches validated source extraction, and a dedicated React page that reuses the existing card/detail primitives. The detail modal renders source summary immediately and conditionally appends verified source body only after the detail query resolves.

**Tech Stack:** TypeScript, React, React Router, tRPC, Express/Node fetch, Vitest, existing AppShell and AkShare discovery router.

## Global Constraints

- `查看更多新闻` navigates to `/stocks/discovery`; it never opens the first article.
- Individual items continue to open in a Holaday modal.
- Preserve `source-cover`/`editorial-art` behavior. Editorial art is not source evidence.
- Source summary and source body are distinct states. No model-generated article text.
- Source extraction is URL-validated, public-web only, redirect-bounded, size-bounded, cached, and non-blocking for the feed.
- Do not modify stock charts, daily briefing, browser, extension, task state-machine, or untracked user drafts.

---

## File Structure

- Create `apps/orchestrator/src/stock-news/article-detail.ts`
  - URL validation, extraction normalization, cache, `NewsDetail` state mapping.
- Create `apps/orchestrator/src/stock-news/article-detail.test.ts`
  - URL safety and content-state behavior.
- Modify `apps/orchestrator/src/trpc/routers/stocks.ts`
  - Export public list/detail types, mount `newsDetail` tRPC query.
- Modify `apps/orchestrator/src/trpc/routers/stocks.test.ts`
  - Assert public endpoint source-boundary behavior.
- Create `apps/web-workbench/src/lib/stock-discovery-route.ts`
  - Parse/serialize selected discovery feed query state.
- Create `apps/web-workbench/src/lib/stock-discovery-route.test.ts`
  - Route state unit coverage.
- Create `apps/web-workbench/src/lib/stock-news-detail.ts`
  - Pure copy/state helpers for source summary/body rendering.
- Create `apps/web-workbench/src/lib/stock-news-detail.test.ts`
  - Detail state regression coverage.
- Create `apps/web-workbench/src/pages/StockDiscoveryPage.tsx`
  - Dedicated discovery surface and independent pagination state.
- Modify `apps/web-workbench/src/pages/StockTasksPage.tsx`
  - Dashboard action link, reuse/extract news card and detail modal with real detail query.
- Modify `apps/web-workbench/src/App.tsx`
  - Add lazy `/stocks/discovery` route.
- Modify/add web page tests under `apps/web-workbench/src/pages/`
  - Route, accessibility, and source-boundary checks.

## Task 1: Route State

**Files:**
- Create: `apps/web-workbench/src/lib/stock-discovery-route.ts`
- Test: `apps/web-workbench/src/lib/stock-discovery-route.test.ts`

**Interfaces:**
- Produces `parseDiscoveryFeed(search: string): DiscoveryFeed | '全部'`.
- Produces `discoveryFeedSearch(feed: DiscoveryFeed | '全部'): string`.

- [ ] **Step 1: Write the failing tests**

```ts
it('defaults malformed and absent feed values to 全部', () => {
  expect(parseDiscoveryFeed('')).toBe('全部');
  expect(parseDiscoveryFeed('?feed=unknown')).toBe('全部');
});

it('serializes a selected feed without an all-feed query parameter', () => {
  expect(discoveryFeedSearch('A股要闻')).toBe('?feed=A%E8%82%A1%E8%A6%81%E9%97%BB');
  expect(discoveryFeedSearch('全部')).toBe('');
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `pnpm --filter @holaday/web-workbench exec vitest run src/lib/stock-discovery-route.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the minimum parser and serializer**

```ts
const DISCOVERY_FEEDS = ['自选股新闻', '重要公告', 'A股要闻', '美股要闻', '港股要闻'] as const;

export function parseDiscoveryFeed(search: string): DiscoveryFeed | '全部' {
  const feed = new URLSearchParams(search).get('feed');
  return DISCOVERY_FEEDS.includes(feed as DiscoveryFeed) ? feed as DiscoveryFeed : '全部';
}
```

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `pnpm --filter @holaday/web-workbench exec vitest run src/lib/stock-discovery-route.test.ts`

Expected: PASS.

## Task 2: Source Content Detail Contract

**Files:**
- Create: `apps/orchestrator/src/stock-news/article-detail.ts`
- Test: `apps/orchestrator/src/stock-news/article-detail.test.ts`
- Modify: `apps/orchestrator/src/trpc/routers/stocks.ts`

**Interfaces:**
- Produces `NewsContentStatus = 'source-body' | 'source-summary' | 'metadata-only'`.
- Produces `resolveNewsDetail(input): Promise<NewsDetail>`.
- `stocks.newsDetail` accepts `{ url, source, publishedAt, summary? }` and returns `NewsDetail`.

- [ ] **Step 1: Write failing safety and fallback tests**

```ts
it('returns source-summary without fetching when summary exists and body extraction is unavailable', async () => {
  await expect(resolveNewsDetail({ url: 'https://example.com/article', summary: '公开摘要' }, failingFetcher))
    .resolves.toMatchObject({ contentStatus: 'source-summary', summary: '公开摘要' });
});

it('rejects private-network and non-http source URLs', () => {
  expect(() => validatePublicArticleUrl('http://127.0.0.1/private')).toThrow();
  expect(() => validatePublicArticleUrl('file:///tmp/article')).toThrow();
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `pnpm --filter @holaday/orchestrator exec vitest run src/stock-news/article-detail.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement bounded resolver**

Implement only:

```ts
type NewsDetail = {
  url: string;
  contentStatus: 'source-body' | 'source-summary' | 'metadata-only';
  sourceName: string;
  publishedAt: string;
  summary?: string;
  body?: string[];
  extractedAt?: string;
};
```

Validate `https:` URLs against the existing Eastmoney/CNInfo source-host allowlist, reject every other host and URLs with credentials, revalidate every redirect, cap redirects and response bytes, accept only HTML or PDF content-types, normalize extracted paragraphs, and cache successful/negative fetch attempts by URL. A failed/unsupported extraction returns source summary or metadata only.

- [ ] **Step 4: Add `stocks.newsDetail` and test router boundary**

Call `resolveNewsDetail` from a protected tRPC query. The router must pass through source name, published time, and upstream summary, and never call an LLM.

- [ ] **Step 5: Run focused backend tests and verify GREEN**

Run: `pnpm --filter @holaday/orchestrator exec vitest run src/stock-news/article-detail.test.ts src/trpc/routers/stocks.test.ts`

Expected: PASS.

## Task 3: Detail View State

**Files:**
- Create: `apps/web-workbench/src/lib/stock-news-detail.ts`
- Test: `apps/web-workbench/src/lib/stock-news-detail.test.ts`

**Interfaces:**
- Produces `articleContentBlocks(detail): ArticleContentBlock[]`.
- Produces `articleAvailabilityCopy(status): string`.

- [ ] **Step 1: Write failing behavior tests**

```ts
it('does not create body blocks for a source summary', () => {
  expect(articleContentBlocks({ contentStatus: 'source-summary', summary: '来源摘要' }))
    .toEqual([{ heading: '来源摘要', paragraphs: ['来源摘要'] }]);
});

it('labels metadata-only records without fabricating a body', () => {
  expect(articleAvailabilityCopy('metadata-only')).toBe('当前来源仅返回标题与基础信息，打开原文可查看全文。');
});
```

- [ ] **Step 2: Run focused test and verify RED**

Run: `pnpm --filter @holaday/web-workbench exec vitest run src/lib/stock-news-detail.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement pure content-state helpers**

Return source summary unchanged. Append `正文` only when `contentStatus === 'source-body'` and normalized body paragraphs exist. Return no inferred prose.

- [ ] **Step 4: Run focused test and verify GREEN**

Run: `pnpm --filter @holaday/web-workbench exec vitest run src/lib/stock-news-detail.test.ts`

Expected: PASS.

## Task 4: Dedicated Discovery Page

**Files:**
- Create: `apps/web-workbench/src/pages/StockDiscoveryPage.tsx`
- Modify: `apps/web-workbench/src/App.tsx`
- Modify: `apps/web-workbench/src/pages/StockTasksPage.tsx`
- Test: `apps/web-workbench/src/pages/stock-discovery-layout.test.ts`

**Interfaces:**
- Consumes `parseDiscoveryFeed`, `discoveryFeedSearch`, `trpc.stocks.dashboardSnapshot`, `trpc.stocks.discoveryFeed`.
- Produces route `/stocks/discovery`.

- [ ] **Step 1: Write failing route/layout tests**

```ts
it('registers a lazy /stocks/discovery route inside AppShell', () => {
  expect(appSource).toContain('path="/stocks/discovery"');
});

it('keeps the dashboard action as navigation rather than opening a news item', () => {
  expect(stockPageSource).toContain('查看更多新闻');
  expect(stockPageSource).toContain("navigate({ pathname: '/stocks/discovery'");
});
```

- [ ] **Step 2: Run tests and verify RED**

Run: `pnpm --filter @holaday/web-workbench exec vitest run src/pages/stock-discovery-layout.test.ts`

Expected: FAIL because the route/page does not exist.

- [ ] **Step 3: Implement page and route**

Build the AppShell route with header, source freshness, category tabs, responsive cards, `加载更多`, and URL-driven active feed. Keep dashboard cards at three per page; replace its header action with navigation to the discovery page. Reuse shared card rendering instead of duplicating source/media rules.

- [ ] **Step 4: Run focused web tests and verify GREEN**

Run: `pnpm --filter @holaday/web-workbench exec vitest run src/lib/stock-discovery-route.test.ts src/pages/stock-discovery-layout.test.ts src/lib/stock-discovery.test.ts`

Expected: PASS.

## Task 5: Modal Integration and Responsive Review

**Files:**
- Modify: `apps/web-workbench/src/pages/StockTasksPage.tsx`
- Modify: `apps/web-workbench/src/pages/StockDiscoveryPage.tsx`
- Test: `apps/web-workbench/src/pages/stock-discovery-layout.test.ts`

**Interfaces:**
- Consumes `trpc.stocks.newsDetail` and `articleContentBlocks`.
- Produces a source-aware modal with next/previous control.

- [ ] **Step 1: Write failing modal boundary tests**

```ts
it('renders full-text extraction time only for source-body detail', () => {
  expect(detailSource).toContain("detail.contentStatus === 'source-body'");
  expect(detailSource).toContain('提取于');
});

it('keeps an explicit source-only fallback message', () => {
  expect(detailSource).toContain('当前来源仅返回摘要，打开原文可查看全文。');
});
```

- [ ] **Step 2: Run test and verify RED**

Run: `pnpm --filter @holaday/web-workbench exec vitest run src/pages/stock-discovery-layout.test.ts`

Expected: FAIL because the source-aware rendering does not exist.

- [ ] **Step 3: Implement source-aware modal**

The modal fetches article detail only after opening, displays a non-blocking detail loading state, leaves the original source link usable, and keeps keyboard/visible previous/next controls. On compact screens it becomes a full-height sheet with readable type and a fixed action footer.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `pnpm --filter @holaday/web-workbench exec vitest run src/lib/stock-news-detail.test.ts src/pages/stock-discovery-layout.test.ts`

Expected: PASS.

## Task 6: Full Verification and Visual Acceptance

**Files:**
- Modify only implementation/test files from Tasks 1-5 if verification exposes a defect.

- [ ] **Step 1: Run frontend gates**

Run:

```bash
pnpm --filter @holaday/web-workbench typecheck
pnpm --filter @holaday/web-workbench test
pnpm --filter @holaday/web-workbench build
```

- [ ] **Step 2: Run orchestrator gates**

Run:

```bash
pnpm --filter @holaday/orchestrator typecheck
pnpm --filter @holaday/orchestrator test
pnpm --filter @holaday/orchestrator db:verify
```

- [ ] **Step 3: Run hygiene and manual browser review**

Run `git diff --check`, then review `/stocks` and `/stocks/discovery` at desktop, tablet, and mobile widths. Verify: dashboard navigation, per-feed pagination, source-only modal fallback, verified-body modal state, original-link action, next/previous, and no text clipping.

- [ ] **Step 4: Commit the scoped feature**

```bash
git add apps/orchestrator/src/stock-news apps/orchestrator/src/trpc/routers/stocks.ts apps/orchestrator/src/trpc/routers/stocks.test.ts apps/web-workbench/src/App.tsx apps/web-workbench/src/lib/stock-discovery-route.ts apps/web-workbench/src/lib/stock-discovery-route.test.ts apps/web-workbench/src/lib/stock-news-detail.ts apps/web-workbench/src/lib/stock-news-detail.test.ts apps/web-workbench/src/pages/StockDiscoveryPage.tsx apps/web-workbench/src/pages/StockTasksPage.tsx apps/web-workbench/src/pages/stock-discovery-layout.test.ts docs/superpowers/specs/2026-08-08-stock-discovery-reading-design.md docs/superpowers/plans/2026-08-08-stock-discovery-reading-experience.md
git commit -m "feat(stocks): add source-backed discovery reading"
```

## Plan Self-Review

- Spec coverage: Tasks 1 and 4 cover the dedicated navigation/page. Tasks 2, 3, and 5 cover verifiable detail content and modal behavior. Task 6 covers all required gates and responsive inspection.
- Source boundary: Tasks 2 and 3 explicitly forbid inferred article prose and scope extraction to validated public URLs.
- Type consistency: `NewsContentStatus` and `NewsDetail` originate in Task 2 and are consumed by Task 3 and Task 5.
- Non-goals: The plan does not alter charts, daily briefing, task state, extension, or browser flows.
