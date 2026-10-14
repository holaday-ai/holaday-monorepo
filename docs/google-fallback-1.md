# Search engine wall fallback

Based on PR #276 (`02871903`). This change is confined to task dispatch, a new
search fallback module, and verification. It does not modify the shared browser
loop, completion fields, answer verifier, auto-fix, browser completion, or cloud
observation modules being changed by AUTOPILOT.

A host-observed CAPTCHA on a public search engine, together with a recoverable
search query and a read-only attempt, permits one alternate-engine run in the
same task. Google, Baidu and DuckDuckGo prefer Bing; blocked Bing uses DuckDuckGo.
DuckDuckGo uses its official HTML search endpoint. A blocked or visibly unavailable alternate keeps the existing human handoff instead of trying a third
engine. Weather-card requests require an observed temperature; generic encyclopedia links are not accepted as a completed weather card. Non-search pages, login requirements, missing query evidence, cancelled
tasks and attempts containing write tools do not qualify.

The dispatcher preserves task ID, quota admission, model call recorder, evidence
collection and final quality checks. Attempt two's step numbers are offset rather
than overwriting attempt one's steps. `browser.search_fallback` events record
engine, reason and outcome without query/URL parameters. Result metadata retains
`fallbackChain`. The result explicitly names the alternate engine; requested
Google-only cards are described as different-source equivalents, never as
Google's own card. Actual model usage across both attempts remains chargeable
usage, but task quota is admitted only once.

The offline and live audit use a scripted model and the production task wrapper,
runner, browser, evidence ledger and final verifier. Google /sorry is a local
intercept fixture because residential local connectivity is not the deployed
Google blockage. Bing and DuckDuckGo results in `--live` remain real sites.

```sh
pnpm --filter @holaday/orchestrator exec tsx scripts/search-fallback-audit.ts --out /absolute/output
pnpm --filter @holaday/orchestrator exec tsx scripts/search-fallback-audit.ts --live --out /absolute/output
```

No production configuration, proxy subscription, SSH, merge or deployment is part
of this change. Proxy evaluation and evidence live in the task report directory.
