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
2. `thinking` is sent on every Qwen request that supports it: `disabled` for a forced tool (as
   before), `enabled` otherwise (the endpoint default). `enabled` is sent without
   `budget_tokens`; verify once against the live endpoint before benchmarking.
3. Empty `thinking` blocks are dropped (the transport already skips them).
4. Usage keeps the Anthropic split (input excludes cache reads; the ledger prices the cache
   separately). `totalInputTokens` sums them; the `qwen.core.call` observation uses the total
   so messages and Responses figures match. No double counting in `llm_calls`.
5. Failures: the transport already maps DashScope `{code,message,request_id}` into
   `MessagesAdapterError.diagnostics`; the wrapper converts a raw body of that shape if one ever
   escapes, and `modelErrorKind()` names it (arrears / access_denied / invalid_parameter / …).

The Responses (streaming, OpenAI-compatible) channel is not normalised.

## Not migrated

- `self-check/self-check.ts`: probes every lane by design (lane-level diagnostic).
- Legacy / dormant: supercar `agent-loop.ts` raw Anthropic fallback, `agent/vision-loop/commander.ts`
  Anthropic path, `agent/planners/anthropic.ts`, `response-layer/openai-verifier-fallback.ts`,
  `agent/model-selector.ts` + `prompt-layers.ts` Claude routing labels, `visual-verifier.ts`,
  the legacy client fallbacks in `video-quality-verifier.ts` and `ota-user-browser-runner.ts`.
- Not chat models: image / video / TTS / voice-clone / lip-sync / Wanxiang media clients,
  Gemini AV sync (`agent/video/video-av-sync-audit.ts`).
- `qwen-shadow-evaluator.ts` and `eval/` runners (synthetic benchmark lanes).
