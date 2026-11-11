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
     `named-site-search.ts`, or a word ending in 网站/官网/站/商城/App. Negated clauses do not count.
   - Otherwise one model turn, gateway role `judge` (small model), forced tool `choose_route`
     with an enum of `answer_directly` + enabled interface ids + `browser`, and a search `query`.
   - Model unavailable / failing / invalid choice → browser (never answered from memory).
   - A `pricesAreCandidates` tool never answers: decision is browser (`candidateToolId` kept).
3. Decision → execution mode: `generate`, `browser`, or interface → `scrape` lane with
   `interfaceSearchLane` as its source instead of Firecrawl. Each row given to the answer step
   ends with 「来源：<interface> · <Beijing time>」, and the delivered answer gets the same line.
4. **Hard rule 1** — in the scrape lane, an interface route that fails for any reason (error,
   empty, wall, answer that does not hold) hands the task to the browser (`handOverToBrowser`);
   if that cannot start the task fails — it is never answered in generate. `matchLiveFact` is not
   consulted for interface routes.

Router decisions are stored like before in `metadata.executionModeReason`
(`source: tool-router:explicit-site | tool-router:model | tool-router:price-candidates |
tool-router:model-unavailable`); an interface run adds `metadata.toolRoute` (tool, query, source or
failure) instead of Firecrawl usage. A forced browser (scrape retry, local Chrome) skips routing.

## Registry and config

`registry.ts` — one entry per interface. `TOOL_ROUTER_TOOLS` (default `bailian_web_search`) lists
the enabled ids; unknown ids and entries without a call shape are ignored with a warning.
Interfaces are offered only to `cn` model-data-region users and only when `DASHSCOPE_CN_API_KEY`
is set (the Bailian MCP services are on the China site).

| id | kind | service code | state |
|---|---|---|---|
| `bailian_web_search` | search | `WebSearch` / `bailian_web_search(query,count)` | usable (default) |
| `bailian_search_pro` | search | `EnhancedSearch` / `search_pro(query)` | usable, off by default |
| `amap_maps` | map | `amap-maps` | BOSS must enable; tool names TBD |
| `kuaidi100` | express | `kuaidi100-mcp` | BOSS must enable (maybe own key) |
| `zhidemai` | price, candidates | `zhidemai` | BOSS must enable |
| `manmanbuy` | price, candidates | unknown | service code not found |
| `web_parser` | page | `WebParser` | BOSS must enable |

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
