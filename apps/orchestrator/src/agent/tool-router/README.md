# Tool router (REBUILD-2 part 2)

Interfaces that passed REBUILD-1 G become tools the model may choose next to the browser.
Behind `TOOL_ROUTER_V2` (default `false`); with the flag off nothing here runs.

## Flag off (default)

`tasks.create` calls `decideExecutionRoute({ enabled: false, legacy, route })`, which only calls
`legacy` = `explainExecutionMode` (intent-classifier: explicit-browser / interaction / site-search /
search-verb / live-info / live-fact keyword rules) and returns its decision unchanged. The scrape
lane keeps Firecrawl and its `matchLiveFact` hand-over. Nothing is deleted.

## Flag on

1. `explainExecutionMode` still claims the dedicated lanes `image`, `video_creation`,
   `template_fill` (they are not a search / browser / generate choice).
2. Everything else is `routeTask`:
   - **Hard rule 2** — `explicit-site.ts`: 「打开/访问/进入/登录 X」, 「在 X 上/里 …」 or 「在 X站 搜…」,
     「去/到/上 <known site> 搜/看…」, English `open/visit/go to X`, `on <domain|known site>`,
     `on/at … website/site/store` → browser. X is a domain/URL, a brand from
     `named-site-search.ts`, a general search engine (百度/必应/Bing/搜狗/360搜索/夸克/…), or a word
     ending in 网站/官网/站/商城/App. Review #1 item 4: 「上百度搜一下」「去百度上查」「去 Bing 上查」
     and 「去 <any short name> 上/里 查/搜/看…」 (「去什么值得买上查」) count too; 「去网上查」「上网查」
     「到家里查」 do not. Negated clauses do not count.
   - **Sites with an enabled interface** (review #1 item 3; today only 高德, `siteAliases` in the
     registry): an info query naming the site — 「在高德地图上查…路线」「用高德查路线」「上高德查一下」
     「打开高德地图查…」「check the route on Amap」 — goes to the model with only `[that tool, browser]`
     offered. Only 「打开高德地图网页/网站/官网」, `amap.com`, `Amap website`, or an operation on the
     page (登录/点击/收藏/截图/下载/上传/评论/发布/下单…) is hard rule 2 → browser. With the tool not
     enabled, naming 高德 is an ordinary explicit site → browser.
   - Otherwise one model turn, gateway role `judge` (small model), forced tool `choose_route`
     with an enum of `answer_directly` + enabled interface ids + `browser`, and a search `query`.
     A tool with `routerArguments` (高德: `amap: {action, origin, destination, mode, city, keywords}`)
     adds its property to the schema; picking it without usable arguments → browser.
   - Model unavailable / failing / invalid choice → browser (never answered from memory).
   - A `pricesAreCandidates` tool never answers: decision is browser (`candidateToolId` kept).
3. Decision → execution mode: `generate`, `browser`, or interface → `scrape` lane with
   `interfaceSearchLane` as its source instead of Firecrawl. Each row given to the answer step
   ends with 「来源：<interface> · <Beijing time>」, and the delivered answer gets the same line. The
   line follows the task's language (review #1 item 5, `replyLanguage(intent, region)`): English
   tasks get 「Source: <titleEn> · 2026-11-11 10:30 (Beijing time)」.
4. **Hard rule 1** — in the scrape lane, an interface route that fails for any reason (error,
   empty, wall, answer that does not hold) hands the task to the browser (`handOverToBrowser`);
   if that cannot start the task fails — it is never answered in generate. `matchLiveFact` is not
   consulted for interface routes.

Router decisions are stored like before in `metadata.executionModeReason`
(`source: tool-router:explicit-site | tool-router:model | tool-router:price-candidates |
tool-router:model-unavailable`); an interface run adds `metadata.toolRoute` (tool, query, source or
failure) instead of Firecrawl usage. A forced browser (scrape retry, local Chrome) skips routing.

## Registry and config

`registry.ts` — one entry per interface. `TOOL_ROUTER_TOOLS` (default
`bailian_web_search,amap_maps` since review #1) lists the enabled ids; unknown ids and entries
without a call shape are ignored with a warning. An entry is a single `tools/call`
(`mcpTool` + `buildArguments` + `readResults`) or a multi-step `run` over one MCP session.
Interfaces are offered only to `cn` model-data-region users and only when `DASHSCOPE_CN_API_KEY`
is set (the Bailian MCP services are on the China site).

| id | kind | service code | state |
|---|---|---|---|
| `bailian_web_search` | search | `WebSearch` / `bailian_web_search(query,count)` | usable (default) |
| `bailian_search_pro` | search | `EnhancedSearch` / `search_pro(query)` | usable, off by default |
| `amap_maps` | map | `amap-maps` | usable (default); plan in `amap.ts` |
| `kuaidi100` | express | `kuaidi100-mcp` | BOSS must enable (maybe own key) |
| `zhidemai` | price, candidates | `zhidemai` | BOSS must enable |
| `manmanbuy` | price, candidates | unknown | service code not found |
| `web_parser` | page | `WebParser` | BOSS must enable |

### 高德 (`amap.ts`)

BOSS enabled `amap-maps` (platform trial key) after REBUILD-1 G had reported it 「未开通」. Probed
2026-11-11: initialize 200, `tools/list` = 15 tools (`maps_geo`, `maps_direction_{driving,walking,
bicycling,transit_integrated}`, `maps_text_search`, `maps_around_search`, `maps_search_detail`,
`maps_weather`, …), all taking coordinates rather than free text. So the router model fills
`amap.{action, origin, destination, mode, city, keywords}` and `runAmap` runs a fixed plan:

| action | calls |
|---|---|
| `route` | `maps_geo` × 2 → `maps_direction_<mode>` (default `transit`; `city`/`cityd` from the geocode) |
| `place` | `maps_text_search` |
| `around` | `maps_geo` → `maps_around_search` (radius 1000 m) |
| `weather` | `maps_weather` |

A geocode coarser than a POI (区县 / 市 / 省 …: 「西湖断桥」 came back as 西湖区) is never used as a
route end; the plan looks the name up as a POI (`maps_text_search` → `maps_search_detail`) and
fails as `imprecise` when that gives no point. The trial key's `maps_text_search` already returned
`USER_DAILY_QUERY_OVER_LIMIT` on the probe day; that is `quota`. **Every failure (quota,
imprecise, invalid arguments, tool error, empty) hands the task to the browser** (hard rule 1).
Rows: one route row (summary of up to 3 plans, link `uri.amap.com/navigation`), POI rows (link
`amap.com/place/<id>`), or a weather row.

Enabling one of the pending entries: enable it in the Bailian console, run `tools/list` once,
fill `mcpTool` / `buildArguments` / `readResults`, then add its id to `TOOL_ROUTER_TOOLS`.

## Client

`bailian-mcp-client.ts`: `POST https://dashscope.aliyuncs.com/api/v1/mcps/{code}/mcp`,
`initialize` → `notifications/initialized` → `tools/call`, JSON or event-stream replies, 10 s
timeout, key only in the Authorization header. Returns `{ ok: true, results, source: {name, at} }`
or `{ ok: false, reason }` (`not_configured | not_enabled | http_error | rpc_error | tool_error |
malformed | empty | timeout | network`).

## Not changed / open

- Inside the chosen lane, lane-local keyword helpers stay (generate's `requiresFreshResearch`
  web_search tool, the browser loop's `classifyAsSimpleSearch`); the router only owns the lane choice.
- Skill hints (`SKILL_HINTS`) no longer override generate/scrape/browser while the flag is on.
- Firecrawl is not offered as a router tool (the scrape lane is reached only through interfaces).
- Price-candidate rows are not yet passed into the browser prompt (no price tool is enabled).
- The routing turn and the interface call add latency to `tasks.create` (router ≤ 8 s timeout;
  one real WebSearch call took 3.5 s end to end).

## Public sources after a wall (协调方决定 2026-11-12, 复审 #2 / 协调方判定 2026-11-13; `wall-fallback.ts`, `wall-checks.ts`)

With the flag on, a **read-only** browser task that ended on a wall — paused at a login /
verification page, failed with a block / login reason, or a partial answer whose data is masked or
login-only (「¥7??9」「登录后可查看」) — gets one more try from public sources:

1. `wallFallbackAllowed(intent)` / `wallEnd(outcome, intent)` decide it may. Never for writes
   (`isReadOnlyIntent`, plus an English 「Open X and tell me …」 read rule), payment pages, data only
   the signed-in user has (我的/订单/购物车/物流/快递/白条/发票/会员/收藏/wishlist/内网/私有…), or a request
   about the user's own things (「我在京东买的」「我京东的」「my …」「I bought」; 「告诉我/帮我」 only
   address the assistant). A login wall on a site that is neither a known public site nor an address
   the request gave (site 「原网站」) stays the user's. Nothing is solved, retried or disguised.
2. Such a task's **verification page is not handed over** (`wallFallback` on the run options turns
   `captchaHandoffWanted` off): the run ends at the wall at once instead of a 10-minute wait. If the
   public sources then have nothing, it fails saying so and how to retry with the verification. A
   login wall still pauses for the user as before when nothing is found. A cancelled task is never
   routed.
3. The first enabled `search` interface for the user's region runs `fallbackQuery`; the scrape lane
   answers from those rows with `fallbackIntent` (no addresses; every figure written as
   「我在 XX 查到的是 ¥X（日期、链接）」, 「日期不明」 without one; never 「京东价」 for another site's).
4. `composeFallback` checks the answer in code before delivery:
   - every price line's amounts must occur in this call's rows, else the line is removed (and the
     count said); a line naming the walled site's price (「京东售价 ¥X」) whose row is another site is
     rewritten as that site's finding unless it already names it; the walled site's own row is
     labelled a search snippet; each price line gets its row's link and 「日期不明」 when undated;
   - a time-sensitive or live-fact question runs `freshnessProblem` (forced): results without
     today's date are delivered only behind 「…仅供参考，不是实时数据」; an answer stating a time the
     results do not have is not delivered at all;
   - the closing line is 「检索于：<interface> · <time>（检索时间，不是数据时间）」.
5. Delivered as `completed` (a partial browser answer stays partial): the wall line
   (「京东要登录才能看价格，没能直接读到页面；以下是我在公开来源查到的（不是京东页面上的数据）：」) or, for a
   partial answer, what the browser did read followed by 「另外从公开来源补查…」; the checked answer;
   the takeover line (「需要京东页面上的准确价格，可以登录后让我再读一次。」); the retrieval line. Result
   URLs are recorded as evidence for the browser lane's verifier.
6. The task's `result.metadata.wall_fallback` = `{ from, kind, site, tool, removedPrices,
   rewrittenSites, freshness }`, so a bench counts 含墙成功 apart from a real success. Logged as
   `WALL_PUBLIC_FALLBACK` (wall, tool, query, status, delivered, checks).
