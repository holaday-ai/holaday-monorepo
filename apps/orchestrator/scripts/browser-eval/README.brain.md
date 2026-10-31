# Browser brain bakeoff (offline preparation)

`production-suite.json` contains the 12 core task specifications and 40 extended cases. Public pages and deterministic loopback fixtures are reported separately. Core sites remain those of BROWSER-BENCH-1; local fixtures are not substitutes for their release gate. Original `tasks.json` is a legacy suite with different permissions and must not be used for this read-only bakeoff.

Start fixtures (one process, no model access):

```sh
node apps/orchestrator/scripts/browser-eval/production-fixture.mjs
```

The server binds only `127.0.0.1:8876` and rejects non-GET/HEAD requests. For another machine, explicitly provide an isolated test-host mapping; never point localhost at production. `ex-29` tests file selection, **not completed upload**; `ex-30` checks that nothing was sent. Login/CAPTCHA/payment fixtures test recognition and handoff, not real site resistance.

Run each task using the chosen browser with a 5-minute limit, serially, at most two attempts. Save each attempt, key screenshots, observed DOM/text, actions, elapsed time, and final answer. Record actual control values for `expectedFields`, and for downloads save the actual bytes and their SHA-256. Leave a failed case failed. Do not echo expected answers into evidence. Return `awaiting_user` for an observed access wall. The runner must stop before submission/login/purchase/send/CAPTCHA solving. A future production driver requires separate deployment-session approval.

Offline check (from `apps/orchestrator`):

```sh
pnpm exec tsx scripts/browser-eval/production-report.ts scripts/browser-eval/production-suite.json /absolute/results.json /absolute/summary.json extended
```

Use `core` for the core set. Missing cases stay in the denominator; duplicate/unknown IDs, invalid screenshot bytes and mismatched download receipts fail validation. All screenshot/receipt paths must remain inside the result directory. Per-case check results, blocking counts, false completion counts and source/asset hashes are saved. Case/text checks are necessary evidence checks, not an independent semantic truth oracle: review source content and full step trace as well. Text normalization only folds case, Unicode compatibility forms and apostrophe variants. Do not claim production release acceptance from this offline command.

## Configuration (examples only; no secrets)

Leave all role variables empty for the existing single-model behavior. Explicit role configuration enables a planning call and an evidence-verification call, in addition to executor calls. A missing role inherits the current browser/vision model. Planner/verifier cannot execute tools; existing completion/action gates still run first.

```text
BROWSER_BRAIN_CANARY=usr_test_account
BROWSER_BRAIN_PLANNING=alibaba-model-studio:qwen3.8-max
BROWSER_BRAIN_EXECUTION=alibaba-model-studio:qwen3.8-flash
BROWSER_BRAIN_VERIFICATION=alibaba-model-studio:qwen3.8-max
BROWSER_BRAIN_CLAUDE_ENABLED=false
BROWSER_BRAIN_OPENAI_ENABLED=false
```

Global role values are administrator settings. A member of the exact comma-separated canary list can additionally send `tasks.create.browserBrain`, for example `{"execution":{"provider":"alibaba-model-studio","model":"qwen3.8-flash"}}`. A nonmember's nonempty override is rejected before task creation. Existing region/ownership checks still apply. Only Qwen, Anthropic and OpenAI are valid browser providers; the latter two require explicit future administrative enablement and configured official access. This task makes no provider requests.

`task_model_selections.lane_models.browserRoles` records requested role choices beside the normal selected brain. Actual calls are recorded in `llm_calls` with provider, model, task, latency, token/cache counters, cost/coverage and `request_meta.role`. Purposes are `browser.planning`, `supercar.turn` (execution) and `browser.verification`. Group all pages of `llmCalls.list(taskExternalId)` by purpose/provider/model to derive per-role counts and totals; the normal totals cover the whole task. A missing token or price is null/unknown, never zero. Failed calls remain recorded without fabricated usage. Existing pricing catalog/overrides supply estimates, not provider invoices. Task cancellation or an early blocker may legitimately have zero verifier calls.

Browser overrides stay with the active task context, including its parked in-process continuation. Restart handling retains the existing fail/recovery semantics; this change does not add resumable role state or a new queue. Role configuration never authorizes an irreversible operation.
