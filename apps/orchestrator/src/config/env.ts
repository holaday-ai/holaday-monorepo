import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

// Load order (later overrides earlier — we explicitly do NOT override
// already-set process.env values so CI / docker-compose env vars win):
//   1. .env                          (committed defaults — may be empty)
//   2. .env.local                    (developer secrets, gitignored)
//   3. apps/orchestrator/.env.local  (per-app override, gitignored)
//
// Empty-string values in process.env are treated as unset. Some parent
// processes (e.g. Claude Code) scrub secrets by exporting them as '' to
// child processes; without this, dotenv's `override: false` would keep
// the empty string and mask the .env.local value.
function loadDotenvAllowingEmpty(path: string) {
  const result = loadDotenv({ path, override: false });
  if (result.parsed) {
    for (const [key, value] of Object.entries(result.parsed)) {
      if (process.env[key] === '') process.env[key] = value;
    }
  }
}
const repoRoot = resolve(process.cwd(), '../..');
loadDotenvAllowingEmpty(resolve(repoRoot, '.env'));
loadDotenvAllowingEmpty(resolve(repoRoot, '.env.local'));
loadDotenvAllowingEmpty(resolve(process.cwd(), '.env.local'));

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  HTTP_PORT: z.coerce.number().int().positive().default(3001),
  WS_PORT: z.coerce.number().int().positive().default(3002),

  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 chars'),

  ANTHROPIC_API_KEY: z.string().optional().default(''),

  /**
   * Phase 24 RC follow-up — Firecrawl API key. When set, the
   * orchestrator boots the firecrawl-lane adapter so:
   *   - tasks.create's 'scrape' execution mode can fetch pages /
   *     search results via Firecrawl instead of spinning a Brave;
   *   - supercar's `scrape_website` tool delegates to Firecrawl
   *     instead of Apify.
   * Empty string = adapter not constructed; scrape-mode tasks fail
   * with a clear "FIRECRAWL_API_KEY not configured" reason instead
   * of silently degrading to browser. Set on Vultr / Aliyun .env;
   * keep in sync with the secret.
   */
  FIRECRAWL_API_KEY: z.string().optional().default(''),
  /** Override the Firecrawl base URL — defaults to api.firecrawl.dev. */
  FIRECRAWL_BASE_URL: z.string().url().default('https://api.firecrawl.dev'),

  /**
   * Sprint #5 — Gemini image generation ("nano banana"). When set, the
   * 'image' execution lane can call Google's generateContent image API
   * to satisfy 文生图 / 图生图 tasks. Empty string = the image lane
   * fails with a clear "GEMINI_API_KEY not configured" reason instead
   * of silently degrading. The orchestrator runs on Vultr (Singapore
   * egress) so it reaches generativelanguage.googleapis.com directly;
   * GEMINI_BASE_URL is overridable for a future gateway/proxy. Set on
   * Vultr .env; keep in sync with the secret.
   */
  GEMINI_API_KEY: z.string().optional().default(''),
  GEMINI_BASE_URL: z.string().url().default('https://generativelanguage.googleapis.com'),
  /**
   * Image model ids. Defaults from the BOSS sprint plan (2026-06):
   * NB2 = gemini-3.1-flash-image (fast default), NB Pro =
   * gemini-3-pro-image (best text rendering for posters / 带字图). A
   * wrong id is a one-env-var fix because the adapter never hard-codes.
   */
  GEMINI_IMAGE_MODEL: z.string().default('gemini-3.1-flash-image'),
  GEMINI_IMAGE_MODEL_PRO: z.string().default('gemini-3-pro-image'),

  /**
   * Phase 1 #1 — template fill. When true, the 'template_fill' lane
   * fills a user-uploaded Office template (.docx/.xlsx) deterministically
   * and returns the filled file. When false (default), template_fill
   * intents fall through to the generate lane (the model honestly says
   * it cannot fill the file), so deploying before the feature is vetted
   * is a no-op for users — same gating shape as GEMINI_API_KEY for #5.
   * Kill switch: set false → restart → full fall-back to generate.
   */
  TEMPLATE_FILL_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  /** Model for the one constrained fill-mapping call. Default Sonnet. */
  TEMPLATE_FILL_MODEL: z.string().default('claude-sonnet-4-6'),

  /**
   * Phase D Step 3 rollout switch.
   *   playwright → boot connects PlaywrightExecutor to Chrome's
   *                CDP (needs Chrome launched with
   *                --remote-debugging-port=<CDP_PORT>). On success,
   *                VisionLoopRunner drives the page directly via
   *                Playwright, bypassing the WS → SW → CDP path.
   *   legacy     → skip Playwright; task-runner keeps using the WS
   *                round-trip to the extension's cdp-actions.ts.
   *   auto       → try playwright; on connect failure, fall back
   *                to legacy silently (operator sees a warn in the
   *                orchestrator log).
   * Default: 'auto' (best-effort upgrade, never breaks existing
   * flow).
   */
  EXECUTOR_MODE: z.enum(['playwright', 'legacy', 'auto']).default('auto'),
  /**
   * CDP endpoint for `chromium.connectOverCDP` when EXECUTOR_MODE is
   * playwright or auto. Must be a full http URL to the devtools
   * endpoint Chrome exposes with `--remote-debugging-port=<n>`.
   * Default: http://127.0.0.1:9222.
   */
  CDP_ENDPOINT: z.string().url().default('http://127.0.0.1:9222'),

  /**
   * Commander mode preference, read by vision-mode.ts's
   * `readVisionModeEnv`. Kept here so `env.VISION_MODE` is a typed
   * field instead of a stringly-typed lookup. `auto` (default) lets
   * the per-tick selector decide.
   */
  VISION_MODE: z.enum(['screenshot', 'accessibility', 'auto']).default('auto'),

  /**
   * Agent-loop implementation selector.
   *   supercar → Anthropic official computer_20251124 + web_search_20260209
   *              + adaptive thinking via @anthropic-ai/sdk. New default.
   *   legacy   → the hand-rolled vision-loop commander
   *              (apps/orchestrator/src/agent/vision-loop/*).
   * Default: 'supercar'. Flip to 'legacy' without redeploy to A/B the
   * two stacks on the same Chromium.
   */
  AGENT_MODE: z.enum(['supercar', 'legacy']).default('supercar'),

  /**
   * Model ID the supercar loop drives. Computer use requires a model
   * that supports `computer_20251124`: Opus 4.7, Opus 4.6, Sonnet 4.6,
   * or Opus 4.5. Default matches the project spec (sonnet-4-6 balances
   * cost + quality for long agentic runs).
   */
  SUPERCAR_MODEL: z.string().default('claude-sonnet-4-6'),

  /**
   * Per-task iteration cap in the supercar loop. Each iteration is one
   * Claude API round-trip (may include computer + web_search tool uses).
   * 50 matches the project spec; raise when dogfooding long research
   * tasks, lower to contain runaway costs.
   */
  SUPERCAR_MAX_ITERATIONS: z.coerce.number().int().positive().default(50),

  /**
   * Whole-task wall clock in ms. The loop exits with status=`timeout`
   * and hands whatever partial summary it has to the user.
   */
  SUPERCAR_TIMEOUT_MS: z.coerce.number().int().positive().default(600_000),

  /**
   * Phase 3 R3 — public origin for download URLs. Returned to the
   * agent / SPA as part of DownloadManager.save's result so emitted
   * links are clickable outside the SPA (e.g. when the user shares
   * the link in chat). Empty default → DownloadManager emits root-
   * relative paths (`/files/<id>/download`); the SPA already
   * resolves those against its API base. Set to the customer-facing
   * https origin on prod (e.g. https://holaday.ai).
   */
  HOLADAY_PUBLIC_BASE_URL: z.string().default(''),

  S3_ENDPOINT: z.string().url().optional(),
  S3_ACCESS_KEY: z.string().optional(),
  S3_SECRET_KEY: z.string().optional(),
  S3_BUCKET: z.string().optional(),

  /**
   * Phase 8 — per-user browser isolation. When `true` the orchestrator
   * spins up a dedicated Xvfb + Brave + x11vnc + websockify quartet
   * for each active user and routes their task traffic + VNC stream
   * to those ports. When `false` (default) every user shares the
   * legacy holaday-chromium-headed singleton — same behaviour as
   * before Phase 8 so a bad rollout is reversible in one env flip.
   */
  MULTI_USER: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  /**
   * Canary allow-list. Comma-separated external user IDs that opt in
   * to per-user isolation when MULTI_USER=true. Empty string means
   * "all users" (once MULTI_USER is on) — standard flag + whitelist
   * pattern. Use a single userId during canary, then clear the var
   * to graduate everyone.
   */
  /**
   * Phase 14 audit follow-up — kept for backward compat with existing
   * .env files but no longer consulted by tasks.ts (the allowlist
   * gate was retired so every authenticated user gets a pool slot).
   * Will be deleted in a follow-up cleanup once we're sure no
   * external tooling reads it.
   */
  MULTI_USER_USERS: z.string().default(''),
  /**
   * Hard cap on concurrent browser quartets. Each one uses ~400-600 MB
   * RAM. Phase 24 default dropped from 20 to 10 because per-task
   * isolation means each task spawns its own quartet (was: shared
   * per-user). 10 fits the current 8 GB Vultr VPS comfortably with
   * ~2-3 GB headroom for orchestrator + system; multi-VPS scaling
   * lifts this via env override.
   */
  MAX_BROWSER_INSTANCES: z.coerce.number().int().positive().max(100).default(10),
  /** Directory that houses per-user browser state (cookies, sessions, cache). */
  BROWSER_POOL_DIR: z.string().default('/var/lib/holaday-browsers'),
  /**
   * Idle kill threshold. Default 5 min — gives users a usable window
   * to switch between the workbench tabs / use the panel as a remote
   * desktop after a task ends without losing their Brave instance.
   * Cookies survive in BROWSER_POOL_DIR regardless; the GC just
   * cycles the live process so a single 20-slot box still serves
   * dozens of distinct users per hour.
   *
   * `pool.touch(userId)` keeps the GC away from active sessions:
   *   - agent-loop touches every turn (in-flight task)
   *   - vnc-proxy touches every relayed frame (user actively
   *     watching / driving the panel)
   * 5 min is the post-disconnect grace window — gives the user time
   * to close + reopen the panel (sleep / hibernate, switch tabs)
   * without paying a 3-5s cold-start spawn on every return.
   */
  BROWSER_IDLE_TIMEOUT_MS: z.coerce.number().int().positive().default(300_000),
  /** First port in the contiguous pool used for per-user resources.
   *  Slot i consumes display :(100+i), CDP (cdp+i), RFB (vnc+i), WS (ws+i). */
  BROWSER_CDP_PORT_START: z.coerce.number().int().positive().default(9300),
  BROWSER_VNC_PORT_START: z.coerce.number().int().positive().default(5910),
  BROWSER_WS_PORT_START: z.coerce.number().int().positive().default(6090),
  BROWSER_DISPLAY_START: z.coerce.number().int().nonnegative().default(100),
  /**
   * Xvfb screen geometry. Default 1280×800×24 (16:10) — sized so the
   * non-fullscreen side panel (~600 px wide) renders Brave at
   * roughly half scale, where text remains readable. Previously
   * 1920×1080 forced noVNC's scaleViewport to compress 1920 px of
   * remote width into ~600 px of local width = 0.31× scale, making
   * 14 px Chinese text render at ~4 px (illegible). 1280 width
   * scales to ~0.47× in the panel which keeps 12 px+ readable.
   *
   * Fullscreen panel users see a slightly upscaled canvas (good
   * enough for "remote desktop" feel; sharper than 1920 letterboxed
   * on 16:9). For users who genuinely need 1920×1080 (large
   * external displays), override the env var.
   */
  BROWSER_SCREEN_SIZE: z.string().default('1280x800x24'),

  /**
   * Phase 10 Tier 1 — Agent intelligence upgrade master switch. When
   * `true`, supercar enables five coordinated changes:
   *   1. Three-layer system prompt (Base + Role + Style) instead of
   *      monolithic core prompt
   *   2. Top-level prompt caching `cache_control: ephemeral` on every
   *      messages.create — the entire prefix caches across turns
   *   3. Server-side context compaction via the
   *      `compact-2026-01-12` beta when the conversation approaches
   *      the 1M context window
   *   4. Per-task token budgets (`output_config.task_budget`) — the
   *      model sees a running countdown and self-moderates
   *   5. Intelligent model routing: simple-search → Sonnet 4.6, complex
   *      research → Opus 4.7 with `effort: xhigh`
   *
   * Default `false` so a bad rollout is reversible in one env flip.
   * The five sub-features all gate on this flag — flipping it false
   * restores the pre-Phase-10 behaviour exactly.
   */
  PHASE10_TIER1: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
});

export type Env = z.infer<typeof schema>;

export const env: Env = schema.parse(process.env);
