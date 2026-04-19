# Migration Plan — Plan-once + Selector → Claude Vision Loop

> 2026-04-19. Architecture pivot. Creator confirmed. This document is
> the authoritative description of what we're keeping, what we're
> throwing away, and the phased cut-over.

---

## 0. Why

**Core insight**: the current architecture is a *script runner*, not an
*agent*.

- Opus produces a full plan up-front containing guessed `ResilientSelector`s
- The driver blindly executes those selectors one by one
- When a selector misses, we patch it via self-heal and retry — but
  we're still guessing at DOM structure we've never actually seen

This is software thinking applied to AI: "one Skill per site, hard-code
the shape of each page". It doesn't scale — every new site needs a new
Skill with new selectors, every site redesign breaks the Skill, and the
agent is blind between screenshots.

**The correct frame**: HOLA DAY should *operate* the browser, not
*orchestrate* a prewritten script. Claude has vision. Let Claude look at
the actual pixels of the actual page and pick one action at a time.

This is what Anthropic built **Computer Use** for. We align with it.

---

## 1. What we're keeping

Nothing in the product shell changes. The following components stay:

- **Chrome extension shell** — MV3 service worker, popup React UI,
  WS client, keepalive alarms, login-state inheritance
- **Orchestrator process** — Express + tRPC + Drizzle/MariaDB + Redis,
  JWT auth, user/task/steps tables, task_events audit log
- **Popup UI** — intent box, history view, task detail, confirm dialogs,
  debug toggle
- **Restart recovery** — rehydrate in-flight tasks, re-emit dispatch
- **llm_calls accounting** — every Claude request still lands a row
- **Smoke plans** — `scripts/e2e-smoke.sh` Baidu plan stays as a
  hard-coded plan-once fixture so we can exercise the extension's
  plumbing without exercising the vision loop

---

## 2. What we're throwing away

The entire **Skill-matching + selector-generation** chain:

- **Skill catalogue routing** (`loadSkillCatalogue`, `pickSkillsUsedByPlan`,
  `unionAllowedOrigins`) — gone. Skills in the DB survive as reference
  material but are no longer the source of allowedOrigins, no longer a
  match target, and no longer constrain the model.
- **OriginGuard** (`packages/browser-driver/src/origin-guard.ts` +
  `isOriginAllowed` consumers) — gone. Claude looks at the URL and
  decides if it's the right site. Any origin restriction comes from
  the user's manual action (choosing which tab to open), not from
  a server-side allowlist.
- **ResilientSelector + selector-plan** (`buildSelectorPlan`,
  `renderLocatorSpec`, role/text/testid/css/xpath strategies) — gone.
  The driver no longer receives selectors at all; it receives
  coordinates and keystrokes.
- **Self-heal** (`planner.healSelector`, `task_steps.heal_attempts`
  telemetry, `maybeSelfHeal` WS hook) — gone. There's no selector to
  heal. If the first click missed, Claude sees the result on the next
  screenshot and tries again natively.
- **AnthropicPlanner.plan** (the plan-once commander) — deprecated.
  Kept behind `HOLADAY_USE_LEGACY_PLANNER=1` env flag as a rollback
  during Phase A. Removed outright in Phase C.

### What this frees up

- Opus's prompt stops including the Skill catalogue (saves ~2-5KB
  system prompt per plan call)
- `tasks.create` stops doing DB joins against the skills table
- `task_steps.input` shrinks from a full ResilientSelector to a
  compact `{kind, x, y, text, key}` payload
- Extension SW stops importing `playwright-crx`'s locator resolution
  — it only uses CDP for `Input.dispatchMouseEvent`, `Input.dispatchKeyEvent`,
  `Page.captureScreenshot`

---

## 3. The new architecture (vision loop)

```
        ┌─────────────────────────────┐
        │  popup: user types intent   │
        └──────────────┬──────────────┘
                       │ tRPC tasks.create
                       ▼
        ┌─────────────────────────────┐
        │  orchestrator               │
        │  VisionLoopRunner starts    │
        │  status='executing', tick=0 │
        └──────────────┬──────────────┘
                       │
                       ▼
  ┌───────────── loop tick ──────────────────────┐
  │                                              │
  │  1. orchestrator → SW: "screenshot"          │
  │  2. SW → CDP Page.captureScreenshot → JPEG   │
  │  3. SW → orchestrator: {base64, w, h,        │
  │                          url, title}         │
  │  4. orchestrator: resize to 1568px long edge │
  │  5. orchestrator → Claude:                   │
  │       system: VISION_SYSTEM_PROMPT           │
  │       user:   [image, intent, url, title]    │
  │       tools:  computer_click / _type / _key  │
  │               / _scroll / _wait / _screenshot│
  │               / task_done / task_give_up     │
  │       tool_choice: any                       │
  │  6. Claude → tool_use:                       │
  │       {name, input} (ONE action)             │
  │  7. orchestrator decodes → VisionAction      │
  │  8. orchestrator → SW: dispatch action       │
  │  9. SW → CDP:                                │
  │       click  → Input.dispatchMouseEvent      │
  │                (mapped model→real coords)    │
  │       type   → Input.insertText              │
  │       key    → Input.dispatchKeyEvent        │
  │       scroll → Input.dispatchScrollEvent     │
  │ 10. SW → orchestrator: {ok, tickIndex+1}     │
  │ 11. orchestrator appends to history          │
  │ 12. goto 1                                   │
  │                                              │
  └──── exit when action.kind ∈                  │
        {done, give_up} OR tick >= 30 ──────────┘
```

### Coordinate translation

- Driver captures at real viewport pixels (e.g. 2560×1440)
- Orchestrator resizes to ≤1568px long edge before sending to Claude
- Claude returns click at **model-space** coordinates (in the resized image)
- Orchestrator computes `realX = modelX / scaleX`, `realY = modelY / scaleY`
- SW dispatches CDP event at real coordinates

Implemented in `vision-loop/image.ts`:
- `resizeForVisionModel(base64, w, h)` → `{base64, scaleX, scaleY, …}`
- `modelCoordToReal(x, y, img)` → `{x, y}`

### Loop exit conditions

- `task_done` tool call → task status `completed`, summary surfaces in popup
- `task_give_up` tool call → task status `failed`, reason surfaces as
  `task.errorMessage`
- Tick counter reaches `DEFAULT_MAX_VISION_STEPS` (30) → auto-pause
  (`paused`, reason `max_steps_reached`); user can `continue` to extend
- Claude API error → caught in `decideNextAction`, converted to `give_up`
- User pauses → standard `server.task.control` pause signal; loop resumes
  on resume

### Skills as optional hints (not routing)

SKILL.md files stay in `skills/*/`. At task creation:
- Popup may show a "Use skill" dropdown populated from `skills` table
- If user selects one, `tasks.create` passes its body as `skillHint`
  on the `VisionLoopContext`
- Commander pastes `skillHint` into the user message as "Context for this
  site:\n<body>"
- No routing logic. No allowlist. The hint is purely informational.

Skills become *prompt snippets the user may opt into*, not a taxonomic
matching system.

---

## 4. Phased roadmap

### Phase A — Skeleton + First Live Loop (3 days)

**Day 1 (today)**: design + code skeleton
- [x] Create `apps/orchestrator/src/agent/vision-loop/` module
- [x] Define `VisionAction`, `VisionObservation`, `VisionLoopContext`,
      `VisionDecision`, `VisionLoopCommander` interface
- [x] Define `VISION_TOOLS` schema (8 tools incl. `task_done`/`task_give_up`)
- [x] Define `resizeForVisionModel` + `modelCoordToReal` signatures
      (passthrough stub for non-resize cases)
- [x] `AnthropicVisionLoopCommander` class shell with stubbed
      `decideNextAction`
- [x] `shouldUseLegacyPlanner()` env flag reader
- [x] test-all.sh green (nothing wired yet, so regression risk ≈ 0)
- [x] Commit + push

**Day 2**: implementation of the commander + runner
- [ ] `decideNextAction` real impl: build messages[], call Anthropic,
      decode the first tool_use via `decodeToolUse`
- [ ] `resizeForVisionModel` real impl (sharp-based) or confirm passthrough
      works for our max-resolution target
- [ ] `VisionLoopRunner`: owns the per-task loop; drives SW round-trips
      via existing WS channel
- [ ] New WS message kinds: `server.vision.observe` (ask for screenshot),
      `client.vision.observation` (SW returns screenshot + metadata),
      `server.vision.act` (dispatch VisionAction), `client.vision.acted`
      (SW confirms)
- [ ] SW handlers: CDP round-trips for the 6 action primitives

**Day 3**: end-to-end dogfood
- [ ] Live Chrome run: "在 bing.com 搜 HOLA DAY" — simplest possible
      intent, just validate the loop shape
- [ ] Live Chrome run: "把抖音创作者中心数据整理到桌面" (blocks on
      terminal execution — deferred to Phase D, but should see Claude
      attempt the flow and give_up cleanly with a reason)
- [ ] Fix whatever first dogfood reveals
- [ ] e2e-smoke still green (Baidu hard-coded plan path unchanged)
- [ ] Default new tasks to the vision loop; `HOLADAY_USE_LEGACY_PLANNER=1`
      as rollback

### Phase B — Production Hardening (1-2 weeks)

- [ ] History compaction: after N turns, replace older turns'
      screenshots with `tool_result` summaries so token spend caps
- [ ] Prompt caching: mark system prompt as `cache_control: ephemeral`,
      confirm cache hits in llm_calls rows
- [ ] Per-user rate limit on vision steps (stop runaway spend)
- [ ] Loop telemetry: `task_events` records `vision.tick` entries with
      action kind + model-space click coords + tokens
- [ ] Popup shows live "agent is doing X" strip driven by `vision.tick`
- [ ] SKILL.md-as-hint UI in popup (optional dropdown)
- [ ] Tests:
  - Unit: `decodeToolUse`, `resizeForVisionModel`, `modelCoordToReal`
    boundaries + edge cases
  - Integration: `StubVisionLoopCommander` drives a scripted
    action sequence against a real DB; assert task_steps, task_events
    shape; assert loop exit conditions
  - e2e: a smoke Chrome flow (Baidu search → click first result → done)

### Phase C — Cut Over + Cleanup (3-5 days)

- [ ] Remove `AnthropicPlanner`, `healSelector`, self-heal WS hook,
      `task_steps.heal_*` columns (drop migration), `pickSkillsUsedByPlan`,
      `unionAllowedOrigins`, OriginGuard
- [ ] Remove `ResilientSelector` / `selectorStrategy` schemas from
      shared-types; extension's `buildSelectorPlan`/adapter locator
      resolution
- [ ] Remove `HOLADAY_USE_LEGACY_PLANNER` flag
- [ ] Update docs: `HOLADAY_ORCHESTRATOR_DESIGN.md`, `W2_BROWSER_DRIVER_GUIDE.md`,
      `SESSION_HANDOFF.md`
- [ ] Archive Skill-centric documents (W1_DEMO, W2_FINAL_REPORT)
      under `docs/archive/` with pointer to this plan

### Phase D — Expand Capability (ongoing)

- [ ] Multi-tab awareness (Claude can ask for tab list, switch tabs)
- [ ] Download handling (Claude asks for a file → orchestrator streams
      bytes; terminal execution if the user granted it)
- [ ] Form autofill from user's saved profile (with explicit consent)
- [ ] Terminal execution (see `docs/TERMINAL_EXECUTION_DESIGN.md`)
- [ ] User-authored SKILL.md hints via a simple UI

---

## 5. Risk + rollback

**Risk**: Claude's vision model makes bad clicks (wrong element, off by
a few pixels, clicks an ad overlay).

**Mitigation**:
- Every action is a single discrete call — on bad click, next
  screenshot shows the wrong state, Claude self-corrects
- `max_steps` cap prevents runaway loops
- Every tick is a `llm_calls` row, so cost is visible in near real-time
- `HOLADAY_USE_LEGACY_PLANNER=1` env flag restores the old plan-once
  path instantly during Phase A

**Risk**: Token cost explodes (every tick ships a screenshot).

**Mitigation**:
- Image is 1568px max long edge, JPEG q75 — ~80-150 KB raw,
  ~120-200 input tokens after Anthropic's preprocessing
- 30-step cap → worst case ~6000 image tokens + ~15000 text tokens per task
- Opus 4.7 at ~$15/MTok input ≈ **$0.30/task upper bound**
- Phase B history compaction + prompt caching drop typical to ~$0.05/task

**Risk**: Real DOM has interactions that click-based operation can't
express (drag-and-drop, keyboard-only modal, iframe isolation).

**Mitigation**:
- Claude calls `task_give_up` with a concrete reason; we read those
  reasons and expand the tool surface as needed
- Phase D can add `computer_drag`, iframe-aware screenshots, etc.

---

## 6. Migration safety

All Phase A changes are **additive**:
- New files under `apps/orchestrator/src/agent/vision-loop/`
- No existing file modified
- test-all.sh 13 checks stay green (commander skeleton is unreferenced)
- Live Chrome flows unchanged until Phase A Day 3 flips the default

Phase B/C cleanup only starts after Phase A has successfully driven
**one real user task end-to-end in a live Chrome session**.
