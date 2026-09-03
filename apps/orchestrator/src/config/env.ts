import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';
import { type ModelDataRegion, normalizeQwenAnthropicBaseUrl } from '../llm/qwen-route.js';

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

type NodeEnvironment = 'development' | 'test' | 'production';

/** Canonical origin used for public, bearer-token invitation URLs. */
export function parseHoladayPublicBaseUrl(value: string, nodeEnv: NodeEnvironment): string {
  if (value === '') return '';
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('HOLADAY_PUBLIC_BASE_URL must be an absolute HTTP(S) origin');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('HOLADAY_PUBLIC_BASE_URL must use HTTP(S)');
  }
  if (url.username || url.password) {
    throw new Error('HOLADAY_PUBLIC_BASE_URL must not include credentials');
  }
  if (url.pathname !== '/' || url.search || url.hash) {
    throw new Error('HOLADAY_PUBLIC_BASE_URL must be an origin without path, query, or hash');
  }
  if (nodeEnv === 'production' && url.protocol !== 'https:') {
    throw new Error('HOLADAY_PUBLIC_BASE_URL must use HTTPS in production');
  }
  return url.origin;
}
const baseEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  HTTP_PORT: z.coerce.number().int().positive().default(3001),
  WS_PORT: z.coerce.number().int().positive().default(3002),

  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 chars'),
  MFA_MASTER_KEY: z
    .string()
    .refine(
      (value) => value === '' || Buffer.from(value, 'base64').length === 32,
      'MFA_MASTER_KEY must be empty or decode to 32 bytes',
    )
    .default(''),

  ENERGY_ANALYTICS_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  ENERGY_ANALYTICS_HMAC_SECRET: z
    .string()
    .refine(
      (value) => value === '' || value.length >= 32,
      'ENERGY_ANALYTICS_HMAC_SECRET must be empty or at least 32 chars',
    )
    .default(''),
  ENERGY_ANALYTICS_VISITOR_RETENTION_DAYS: z.coerce.number().int().min(1).max(30).default(30),
  ENERGY_ANALYTICS_METRIC_RETENTION_DAYS: z.coerce.number().int().min(1).max(400).default(400),
  ENERGY_ANALYTICS_RECEIPT_RETENTION_HOURS: z.coerce.number().int().min(1).max(48).default(48),

  /**
   * Self-service account closure ships dark. New applications require both
   * the master flag and an exact external-user-id allowlist entry. The worker
   * has a separate flag so schema/API rollout never starts destructive work.
   */
  ACCOUNT_CLOSURE_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  ACCOUNT_CLOSURE_WORKER_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  ACCOUNT_CLOSURE_ALLOWLIST: z.string().default(''),
  /**
   * One-time operational prerequisites. These are flipped only after the
   * legacy Resend inbox/PM2 surfaces have been sanitized or placed under a
   * reviewed restricted-retention control. They never authorize reading or
   * printing legacy content.
   */
  ACCOUNT_CLOSURE_LEGACY_FEEDBACK_SANITIZED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  ACCOUNT_CLOSURE_LEGACY_ANALYTICS_LOGS_SANITIZED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  ACCOUNT_CLOSURE_HMAC_SECRET: z
    .string()
    .refine(
      (value) => value === '' || value.length >= 32,
      'ACCOUNT_CLOSURE_HMAC_SECRET must be empty or at least 32 chars',
    )
    .default(''),

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
  /** Independent multimodal review for final lip-synced video artifacts. */
  GEMINI_VIDEO_REVIEW_MODEL: z.string().default('gemini-3.6-flash'),

  /**
   * Phase 1 #4 — video creation pipeline (script → Qwen3-TTS-VC voice
   * clone → Wanxiang B-roll → fal lip-sync → subtitles → FFmpeg vertical
   * compose). DASHSCOPE_API_KEY = Alibaba Cloud INTERNATIONAL (Singapore)
   * key, shared by Wanxiang (B-roll) AND Qwen3-TTS-VC (voice clone). FAL_KEY
   * = fal.ai (lip-sync). All optional/default '' so deploying before
   * provisioning is a no-op — the video lane stays dark behind the flag.
   * Keys are NEVER logged. Orchestrator runs on Vultr (Singapore egress)
   * → reaches dashscope-intl (~48ms) + queue.fal.run directly.
   */
  DASHSCOPE_API_KEY: z.string().optional().default(''),
  /** DashScope INTERNATIONAL (Singapore) host — a Beijing key will NOT work here. */
  DASHSCOPE_BASE_URL: z.string().url().default('https://dashscope-intl.aliyuncs.com'),
  /**
   * Optional DashScope business-space id. When set, requests carry the
   * `X-DashScope-WorkSpace` header so calls are scoped to that workspace.
   * Empty → the default workspace (the bare Bearer key works there, as the
   * 2026-06-13 real-call verification confirmed).
   */
  DASHSCOPE_WORKSPACE_ID: z.string().optional().default(''),
  /**
   * Text-model migration foundation. Beijing and Singapore use distinct
   * credentials and Anthropic-compatible endpoints. These fields are not
   * wired to production call sites yet; they establish a fail-closed regional
   * contract for the later shadow-evaluation and canary phases.
   *
   * `DASHSCOPE_API_KEY` remains the compatibility fallback for `intl` only.
   * The China route never reads the legacy or international credentials.
   */
  DASHSCOPE_INTL_API_KEY: z.string().optional().default(''),
  DASHSCOPE_INTL_ANTHROPIC_BASE_URL: z
    .string()
    .url()
    .default('https://dashscope-intl.aliyuncs.com/apps/anthropic'),
  DASHSCOPE_INTL_WORKSPACE_ID: z.string().optional().default(''),
  DASHSCOPE_CN_API_KEY: z.string().optional().default(''),
  DASHSCOPE_CN_ANTHROPIC_BASE_URL: z
    .string()
    .url()
    .default('https://dashscope.aliyuncs.com/apps/anthropic'),
  DASHSCOPE_CN_WORKSPACE_ID: z.string().optional().default(''),
  QWEN_REASONING_MODEL: z.string().min(1).default('qwen3.8-max'),
  QWEN_STANDARD_MODEL: z.string().min(1).default('qwen3.7-plus'),
  QWEN_FAST_MODEL: z.string().min(1).default('qwen3.8-flash'),
  QWEN_CODING_MODEL: z.string().min(1).default('qwen3-coder-plus'),
  QWEN_VERIFIER_MODEL: z.string().min(1).default('qwen3.8-flash'),
  /** Synthetic benchmark lane only. It is not wired to production task execution. */
  QWEN_SHADOW_EVAL_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  /**
   * Provider-neutral Messages/Tools adapter construction gate. The adapter is
   * intentionally not wired to production task callsites yet; default false
   * prevents any Qwen client construction until a later scoped canary.
   */
  QWEN_MESSAGES_ADAPTER_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  /**
   * First real-call canary: post-task suggestions only. Both Qwen flags and
   * an exact synthetic-user allowlist match are required. An empty allowlist
   * means zero users, never all users.
   */
  QWEN_SUGGESTIONS_CANARY_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  QWEN_SUGGESTIONS_SYNTHETIC_ALLOWLIST: z.string().default(''),
  FAL_KEY: z.string().optional().default(''),
  FAL_BASE_URL: z.string().url().default('https://queue.fal.run'),
  /**
   * Pinned model ids (from the reachability matrix). A wrong id is a
   * one-env-var fix, never a redeploy — the adapters never hard-code them.
   */
  WANXIANG_T2I_MODEL: z.string().default('wan2.2-t2i-flash'),
  WANXIANG_T2V_MODEL: z.string().default('wan2.7-t2v-2026-06-12'),
  /** HappyHorse-1.1 文生视频(同 DashScope intl 端点/同 key,仅改 model). */
  HAPPYHORSE_T2V_MODEL: z.string().default('happyhorse-1.1-t2v'),
  /**
   * 图生视频 i2v (Phase 2 第二期 宠物视频). 同 DashScope video-synthesis 端点,
   * input.img_url 走单图. 默认 wan2.2-i2v-flash(更省 + 已证同 intl 端点/key);
   * happyhorse-1.0-i2v 作高质量可选(⚠️ intl 区可达性未核,examples 用 CN host,
   * 灰度前需 console 核 region). 价表见 video-confirm.ts。
   */
  WANXIANG_I2V_MODEL: z.string().default('wan2.2-i2v-flash'),
  HAPPYHORSE_I2V_MODEL: z.string().default('happyhorse-1.0-i2v'),
  FAL_LIPSYNC_MODEL: z.literal('fal-ai/sync-lipsync/v3').default('fal-ai/sync-lipsync/v3'),
  /**
   * Clone-video-only lip-sync model. Kept separate from the IP-person lane
   * because the two workflows have different duration and identity needs.
   */
  FAL_CLONE_LIPSYNC_MODEL: z
    .enum(['fal-ai/sync-lipsync/v2', 'fal-ai/sync-lipsync/v3'])
    .default('fal-ai/sync-lipsync/v3'),
  QWEN_TTS_VC_MODEL: z.string().default('qwen3-tts-vc-2026-01-22'),
  /**
   * Video-creation lane gate. Default OFF — video_creation intents fall
   * through to the generate lane (the model honestly says it can't produce
   * a video) until vetted. Wire + unit-test behind off; flip on only for
   * the end-to-end run. Same gating shape as GEMINI_API_KEY / TEMPLATE_FILL.
   */
  VIDEO_CREATION_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  /** Gradual rollout: allowed user externalIds (CSV). Empty = all (when ENABLED). */
  VIDEO_CREATION_ALLOWLIST: z.string().default(''),

  /** Team project workspace gradual-rollout gate. Default OFF until vetted. */
  TEAM_PROJECTS_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  /** Allowed user externalIds for team project workspaces (CSV). Empty = all when enabled. */
  TEAM_PROJECTS_ALLOWLIST: z.string().default(''),

  /** Team task lifecycle rollout, nested under the team-project gate. */
  TEAM_TASK_LIFECYCLE_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  /** Allowed user externalIds for the Phase 2 task lifecycle. Empty = all when enabled. */
  TEAM_TASK_LIFECYCLE_ALLOWLIST: z.string().default(''),

  /**
   * Embedded “继续剪辑” gate. Default OFF until the CE.SDK commercial
   * license, hostname scope, and browser/codec release matrix pass the
   * production preflight. Only an allowlisted editor session may receive
   * the browser-visible CE.SDK license material approved by IMG.LY.
   */
  VIDEO_EDITING_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  /** Initial production enablement is canary-only; an empty value fails closed. */
  VIDEO_EDITING_ALLOWLIST: z.string().default(''),
  /** Vendor choice stays explicit so an unreviewed SDK cannot become a fallback. */
  VIDEO_EDITING_PROVIDER: z.literal('cesdk').default('cesdk'),
  /** Browser-visible CE.SDK license material; never log it or expose it outside the gated editor. */
  CESDK_LICENSE: z.string().default(''),
  /** Written CE.SDK hostname scope, validated again by the runtime gate. */
  CESDK_LICENSED_HOSTNAMES: z.string().default(''),
  /** Explicit staging hostname covered by the commercial license. */
  VIDEO_EDITING_STAGING_HOSTNAME: z.string().default(''),
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
   * Phase 1 #2 ④ — A股即时问答闸门。默认 OFF（灰度先只开 BOSS 账号，见
   * ASHARE_QA_ALLOWLIST）。off → 关时 a-share 问句落通用 generate 路径，无副作用。
   */
  ASHARE_QA_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  /** 灰度白名单：允许走 a-share 问答的用户 externalId（逗号分隔）。 */
  ASHARE_QA_ALLOWLIST: z.string().default(''),
  /** ③ 解读 LLM 模型。Haiku 快/省（gate 兜底合规）。 */
  ASHARE_QA_MODEL: z.string().default('claude-haiku-4-5-20251001'),
  /**
   * Phase 2 ⑦ — 意图判官（regex complianceGate 之后的第二层防御）。默认 OFF。
   * on → 每个全景⑦多一次温度0 LLM judge：救回 regex 误杀的合规⑦(过去式/状态描述被当预测)
   * + 补 regex 漏网的语义暗示。regex HARD 红线(advice/technical/ungrounded)不受 judge 影响。
   */
  ASHARE_INTENT_JUDGE_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  /**
   * Phase 2「看懂层」P1 — 逐指标确定性注解（腿A 查表，零 LLM）。默认 OFF。
   * on → ④⑤/解禁挂「衡量什么·客观位置·该警惕什么」注解（全景全量、轻量带 ★ 核心子集）；
   * off → 完全回退现状输出（字节一致）。零新增数据源、零新增 LLM；仅 +2 取数/股（走 TTL 缓存）。
   */
  ASHARE_SEETHROUGH_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  /**
   * ④ 风险信号雷达 P1 — 腿A 确定性检测 + 风险注解（质押/商誉/预告/减持/问询函）。默认 OFF。
   * on → 全景挂 ⑥ 风险信号组、轻量带 ★ 风险提示（命中才显）；off → 完全回退现状（字节一致）。
   * 零新增 LLM；akshare 风险源走东财 datacenter（Vultr 可达）+ 公告 keyword（问询/减持）。
   */
  ASHARE_RISK_RADAR_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  /**
   * P3 F 走势组 P1 — 腿A K线波动「人话总结」（F1区间涨跌幅/F2最大回撤/F3区间位置/F4量能）。默认 OFF。
   * on → 全景挂 F 走势段、轻量带 ★ 走势（F1+F3）；off → 完全回退现状（字节一致）。零新增 LLM，
   * 仅放宽 get_kline 取近1年 daily 本地纯算（同源不新增数据源）。F5 阶段状态小结(腿B)不在本开关内。
   */
  ASHARE_PERF_TREND_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),

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
  /**
   * Short, hard-bounded review lease after a browser task finishes.
   * The retained browser remains interactive in the workbench, but the pool
   * may reclaim it immediately when a new task needs capacity.
   */
  BROWSER_TERMINAL_RETENTION_MS: z.coerce
    .number()
    .int()
    .nonnegative()
    .max(3_600_000)
    .default(600_000),
  /** First port in the contiguous pool used for per-user resources.
   *  Slot i consumes display :(100+i), CDP (cdp+i), RFB (vnc+i), WS (ws+i). */
  BROWSER_CDP_PORT_START: z.coerce.number().int().positive().default(9300),
  BROWSER_VNC_PORT_START: z.coerce.number().int().positive().default(5910),
  BROWSER_WS_PORT_START: z.coerce.number().int().positive().default(6090),
  BROWSER_DISPLAY_START: z.coerce.number().int().nonnegative().default(100),
  /**
   * Emergency-only noVNC transport. Disabled by default because a desktop
   * stream exposes browser chrome and file pickers outside the CDP action
   * policy. Production should use the authenticated CDP screencast path.
   */
  BROWSER_VNC_WS_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
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

export const envSchema = baseEnvSchema
  .superRefine((environment, ctx) => {
    const closureEnabled =
      environment.ACCOUNT_CLOSURE_ENABLED || environment.ACCOUNT_CLOSURE_WORKER_ENABLED;
    if (closureEnabled && environment.ACCOUNT_CLOSURE_HMAC_SECRET.trim().length < 32) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ACCOUNT_CLOSURE_HMAC_SECRET'],
        message: 'ACCOUNT_CLOSURE_HMAC_SECRET must be at least 32 chars when closure is enabled',
      });
    }
    for (const prerequisite of [
      'ACCOUNT_CLOSURE_LEGACY_FEEDBACK_SANITIZED',
      'ACCOUNT_CLOSURE_LEGACY_ANALYTICS_LOGS_SANITIZED',
    ] as const) {
      if (closureEnabled && !environment[prerequisite]) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [prerequisite],
          message: `${prerequisite} must be true when account closure is enabled`,
        });
      }
    }

    try {
      parseHoladayPublicBaseUrl(environment.HOLADAY_PUBLIC_BASE_URL, environment.NODE_ENV);
    } catch (error) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['HOLADAY_PUBLIC_BASE_URL'],
        message: error instanceof Error ? error.message : 'invalid HOLADAY_PUBLIC_BASE_URL',
      });
    }

    for (const [field, region] of [
      ['DASHSCOPE_INTL_ANTHROPIC_BASE_URL', 'intl'],
      ['DASHSCOPE_CN_ANTHROPIC_BASE_URL', 'cn'],
    ] as const satisfies ReadonlyArray<
      ['DASHSCOPE_INTL_ANTHROPIC_BASE_URL' | 'DASHSCOPE_CN_ANTHROPIC_BASE_URL', ModelDataRegion]
    >) {
      try {
        normalizeQwenAnthropicBaseUrl(region, environment[field]);
      } catch (error) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [field],
          message: error instanceof Error ? error.message : `invalid ${field}`,
        });
      }
    }
  })
  .transform((environment) => ({
    ...environment,
    HOLADAY_PUBLIC_BASE_URL: parseHoladayPublicBaseUrl(
      environment.HOLADAY_PUBLIC_BASE_URL,
      environment.NODE_ENV,
    ),
    DASHSCOPE_INTL_ANTHROPIC_BASE_URL: normalizeQwenAnthropicBaseUrl(
      'intl',
      environment.DASHSCOPE_INTL_ANTHROPIC_BASE_URL,
    ).baseURL,
    DASHSCOPE_CN_ANTHROPIC_BASE_URL: normalizeQwenAnthropicBaseUrl(
      'cn',
      environment.DASHSCOPE_CN_ANTHROPIC_BASE_URL,
    ).baseURL,
  }));

export type Env = z.infer<typeof envSchema>;

export const env: Env = envSchema.parse(process.env);
