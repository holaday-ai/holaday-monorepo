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
  MULTI_USER_USERS: z.string().default(''),
  /** Hard cap on concurrent browser quartets. Each one uses ~400 MB. */
  MAX_BROWSER_INSTANCES: z.coerce.number().int().positive().max(50).default(5),
  /** Directory that houses per-user browser state (cookies, sessions, cache). */
  BROWSER_POOL_DIR: z.string().default('/var/lib/holaday-browsers'),
  /** Idle kill threshold. Defaults to 30 min; user-data-dir is preserved. */
  BROWSER_IDLE_TIMEOUT_MS: z.coerce.number().int().positive().default(1_800_000),
  /** First port in the contiguous pool used for per-user resources.
   *  Slot i consumes display :(100+i), CDP (cdp+i), RFB (vnc+i), WS (ws+i). */
  BROWSER_CDP_PORT_START: z.coerce.number().int().positive().default(9300),
  BROWSER_VNC_PORT_START: z.coerce.number().int().positive().default(5910),
  BROWSER_WS_PORT_START: z.coerce.number().int().positive().default(6090),
  BROWSER_DISPLAY_START: z.coerce.number().int().nonnegative().default(100),
  /** Xvfb screen geometry — matches the singleton's current default. */
  BROWSER_SCREEN_SIZE: z.string().default('1720x1440x24'),
});

export type Env = z.infer<typeof schema>;

export const env: Env = schema.parse(process.env);
