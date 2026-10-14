# Search engine wall fallback

Based on PR #277 (`0eac6c87`, `claude/browser-autopilot-1`), incorporating PR #276. This change is confined to task dispatch, a new
search fallback module, and verification. It does not modify the shared browser
loop, completion fields, answer verifier, auto-fix, browser completion, or cloud
observation modules being changed by AUTOPILOT.

A host-observed CAPTCHA on a public search engine, together with a recoverable
search query and a read-only attempt, permits one alternate-engine run in the
same task. Google, Baidu and DuckDuckGo prefer Bing; blocked Bing uses DuckDuckGo.
DuckDuckGo starts with its official HTML endpoint. A small visible site error (not a CAPTCHA) permits one retry on its Lite endpoint within the remaining task budget. The same task, model recorder and monotonically increasing steps are retained. Any write, cancellation or CAPTCHA prevents this retry. A second error pauses; no third engine is tried. Weather requests accept observed weather information, including a labelled weather website link without a temperature, and explicitly state the missing temperature and non-Google source. Generic encyclopedia links alone still do not complete a weather request. Non-search pages, login requirements, missing query evidence, cancelled
tasks and attempts containing write tools do not qualify.

The dispatcher preserves task ID, quota admission, model call recorder, evidence
collection and final quality checks. Attempt two's step numbers are offset rather
than overwriting attempt one's steps. `browser.search_fallback` events record
engine, reason and outcome without query/URL parameters; the Lite retry uses `search_endpoint_unavailable` and adds `search:duckduckgo-lite` to the chain. Result metadata retains
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

## GOOGLE-FALLBACK-2 acceptance

The three real Bing cases were rerun on the PR #277 base with a locally
simulated initial Google wall and a scripted (unpaid) model. The weather case
delivered observed weather links, explicitly stating that no temperature was
read and that this is not a Google weather card. The two five-result cases
remain blocked by the inherited `completionGap` download check: a literal
result title containing “Download” is treated as a claim that a file was saved.
That check still exists in `browser-completion.ts` on #277 and is outside this
PR's allowed file scope. No result titles were hidden or rewritten to get a
passing audit. The 3/3 real-site target is therefore not met. See
`google-fallback-1/report-2.md` in the task report directory for current evidence.
