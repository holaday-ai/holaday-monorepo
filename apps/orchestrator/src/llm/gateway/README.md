# Model gateway (REBUILD-2 part 1)

One entry for every chat-model call: business code asks for a **role**, the gateway decides
which model serves it. Pure refactor: with the flag off nothing observable changes.

```ts
const gateway = modelGateway({ wiring });            // catalog wiring (most call sites)
const runtime = gateway.resolve('judge', { actorExternalId, ownership });
if (runtime.kind === 'ready') createAskedFieldJudge(runtime.messages(), …);

modelGateway({ core: { environment } }).resolve('video_edit_planner', ctx); // direct core path
```

`resolve` returns a runtime whose `messages()` / `responses()` serve the resolved role; a role
on the same lane can be named explicitly (`brainRuntime.responses('search')`), which is how
call sites that shared one resolution keep doing so. `messages(role, ctx)` / `responses(role, ctx)`
are one-shot shorthands.

## Roles

| Role | Legacy lane / purpose | Call sites |
|---|---|---|
| `brain` | browser / vision | unified browser loop, browser preflight, browser-brain planning/verification roles |
| `brain.text` (variant) | browser / standard | OTA user-browser readonly runner |
| `search` | browser / fast (Responses) | `createResponsesWebSearch` |
| `vision` | verifier / vision | media video-quality + subject-consistency verifiers |
| `verifier` | verifier / verify_strict | llm-verifier / core-task semantic adapter |
| `plan` | plan / standard | core-task-plan, supercar plan-provider / plan-runner |
| `judge` | plan / fast | scrape asked-field judge |
| `generate` | generate / standard | generate-runner, template fill, A-share interpret + intent judge, video script, playbook generalize |
| `generate.fast` (variant) | generate / fast | playbook model-assist, memory extraction |
| `scrape` | scrape / standard (Responses) | scrape-runner |
| `suggestions` | suggestions / fast | core-task-suggestions, suggestions-provider |
| `video_edit_planner` | video_edit_planner / fast | video-editing planner |

Variants exist only so the legacy path stays byte-identical; with the gateway on they use their
role's model. The A-share intent judge stays on `generate` (it shares the interpret adapter;
moving it to `judge` would change its model).

## Config

- `LLM_GATEWAY_V2` (`config/env.ts`, default `false`).
- `LLM_GATEWAY_ROLE_MODELS`: JSON overrides per region, e.g. `{"cn":{"judge":"qwen3.8-flash"}}`.
  Unknown regions/roles, non-Qwen names and malformed JSON are ignored with a warning.
- Defaults (`role-models.ts`) are derived from the built-in Qwen brain in `model-catalog.ts`: a
  role gets its lane's model, a vision purpose gets the vision model. `cn` and `intl` are the same
  Qwen table today; region still only picks credentials/endpoint (`qwen-route.ts`).
- Model names live only in config, the catalog and price tables; `model-name-scan.test.ts`
  checks the migrated business files.

## Flag behaviour

- **Off**: the role's legacy lane/purpose is resolved through exactly the path the call site
  used (`wiring.resolveCore` with the same arguments, or `resolveCoreModelRuntime` directly for
  plan-provider / suggestions-provider / video-editing). Adapters are returned unwrapped;
  `llm_calls.purpose` stays `supercar.turn`.
- **On**: a `CoreModelGatewayHook` is passed to the core runtime, which applies the role model for
  the resolved region and records `llm_calls.purpose = role:<role>` (`requestMeta.lane` kept).
  Non-Qwen catalog brains and explicit browser-brain selections (env / canary, plan-runner
  `BROWSER_BRAIN_PLANNING`) keep their models. Messages adapters are wrapped with
  `normalizeMessagesAdapter`. Note: a Qwen lane model edited in the DB catalog is superseded by
  the role table while the flag is on.

## What is normalised (`normalize.ts`, flag on only)

1. Forced tool + `end_turn` with a `tool_use` block → `tool_use` (the adapter already did this
   for our transport; the wrapper keeps it true for every adapter).
2. `thinking` is stated on every Qwen request, per role (`thinking.ts`, review #1). DashScope
   thinks by default and counts thinking inside `max_tokens` (REBUILD-1 D §3.1/§3.4):
   - small-budget roles (`judge`, `suggestions`, `plan`, `video_edit_planner`, `vision`) send
     `thinking: disabled`;
   - thinking roles (`brain`, `generate`, `verifier`) send `enabled` + `budget_tokens: 2048`, and
     the wire `max_tokens` = the caller's `maxTokens` (answer room) + the budget, so thinking can
     no longer eat the answer;
   - a call with < 1024 tokens of answer room, a forced tool (`any` / `tool`) or an explicit
     caller `disabled` sends `disabled`; an explicit caller `enabled` gets the role budget;
   - wire `max_tokens` is capped at 32768: the budget shrinks first, below 1024 thinking is off.

   In practice the browser loop always forces a tool (`toolChoice: any`), so `brain` does not
   think; the budget applies to `generate` (generate-runner, video script, template fill, expert
   workflows) and a `verifier` call that does not disable it. Probed 2026-11-11 against the live
   endpoint (qwen3.8-max, qwen3.7-plus, one call each, `budget_tokens: 2048`, `max_tokens: 3072`):
   both 200 with a non-empty answer; qwen3.7-plus used 1071 output tokens on a 1024-token answer
   room, i.e. the old sizing would have left it no room.
3. Empty `thinking` blocks are dropped (the transport already skips them).
4. Usage keeps the Anthropic split (input excludes cache reads; the ledger prices the cache
   separately). `totalInputTokens` sums them; the `qwen.core.call` observation uses the total
   so messages and Responses figures match. No double counting in `llm_calls`.
5. Failures: the transport already maps DashScope `{code,message,request_id}` into
   `MessagesAdapterError.diagnostics`; the wrapper converts a raw body of that shape if one ever
   escapes, and `modelErrorKind()` names it (arrears / access_denied / invalid_parameter / …).

The Responses (streaming, OpenAI-compatible) channel is not normalised.

## Not migrated (未迁移清单)

`model-name-scan.test.ts` now scans **every non-test .ts file in `src`** (review #1). Model
literals may only live in `config/env.ts`, `llm/model-catalog.ts`, `llm/model-price-catalog.ts`
and the legacy price table `agent/llm-call-recorder.ts`; everything else must be on the list
below (the test's `NOT_MIGRATED`) or it fails.

**Migrated this week: none beyond this PR.** Every Qwen chat call on the production path already
goes through a role. What is left is not a chat role on the Qwen table:

| What | Literals | Migrate this week? | Why |
|---|---|---|---|
| Search fallback `search-provider.ts` | `qwen-flash` | No | DashScope native `enable_search` call used only to get search sources (`max_tokens: 16`, text discarded); already overridable by env; the router's interface search lane (REBUILD-2 part 2) is its successor. |
| Video / image / voice clients (`wanxiang-client`, `wan-animate-mix-client`, `veo-client`, `video-lane-simple`, `video-pet-i2v`, `video-confirm`, `fal-lipsync-client`, `gemini-tts-client`, `qwen-voice-clone-client`, `image/model-router`, `tasks.ts` TTS / i2v defaults) | `wan*`, `veo-*`, `fal-ai/*`, `gemini-*-image`, `gemini-*-tts`, `qwen3-tts-*`, `qwen-voice-enrollment` | No | Not chat models: media generation with their own env overrides and price rows; a media-model config is a separate item. |
| Gemini AV-sync verifier `video-av-sync-verifier.ts` | `gemini-3.6-flash` | No | Gemini, not Qwen; the role table is Qwen-only; env `GEMINI_VIDEO_REVIEW_MODEL` already names it. |
| Dormant Claude paths: supercar `agent-loop.ts` raw Anthropic fallback, `vision-loop/commander.ts`, `planners/anthropic.ts`, `model-selector.ts` + `prompt-layers.ts` routing labels, `visual-verifier.ts`, legacy client fallbacks in `video-quality-verifier.ts`, `image-subject-verifier.ts`, `ota-user-browser-runner.ts`, the Opus quota label in `tasks.ts` | `claude-*` | No | Never run on the Qwen-only runtime (no Anthropic key; we do not call Claude). Removing them is deletion work, not migration; touching them now risks the legacy path the flag-off promise covers. |
| OpenAI verifier fallback `response-layer/openai-verifier-fallback.ts` | `gpt-4o-mini` | No | Dormant (`OPENAI_RESPONSE_LAYER_ENABLED` off). |
| `self-check/self-check.ts`, `qwen-shadow-evaluator.ts`, `eval/` | (no literals; read env) | No | Lane-level diagnostics and synthetic benchmark lanes probe lanes by design. |

Not a model (allowed): `qwen.core.call` (log event), `qwen-av-sync-pending` (status),
`qwen-cn` (search provider id).
