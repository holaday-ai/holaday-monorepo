import { createHash } from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import {
  BASIC_ROLE_PICK_LIMIT,
  HOLADAY_SKILLS,
  OPEN_POOL_ROLE_IDS,
  type PlanId,
  gateRoleForUser,
  newExternalId,
  normalizeSkillIds,
  skillById,
  videoParameterIssue,
} from '@holaday/shared-types';
import { TRPCError } from '@trpc/server';
import { and, asc, desc, eq, gt, gte, inArray, isNull, like, lt, lte, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { ashareQaHandlesMode } from '../../agent/a-share/ashare-qa-lane-gate.js';
import { defaultBrowserNetworkPolicy } from '../../agent/browser-network-policy.js';
import {
  extractRunnableDirectOpenUrl,
  offlineBrowserUnavailableMessage,
  runDirectOpen,
  verifyDirectOpenUrlSafety,
} from '../../agent/direct-open.js';
import { runGenerateTask } from '../../agent/generate-runner.js';
import {
  type ImageAttachment,
  type RunImageTaskResult,
  runImageTask,
} from '../../agent/image/image-runner.js';
import { classifyExecutionMode } from '../../agent/intent-classifier.js';
import { DrizzleLlmCallRecorder } from '../../agent/llm-call-recorder.js';
// Phase 24 RC follow-up — nav-failure safety net. Catches the
// "false success" case where the agent calls task_done with a body
// that is just a DNS/SSL/timeout/refused error message; the sidebar
// would otherwise label it "已完成" because the runner respected the
// agent's terminal decision.
import { detectNavFailure } from '../../agent/nav-failure-detector.js';
import type { SkillCatalogueEntry } from '../../agent/planner.js';
import { runScrapeTask } from '../../agent/scrape-runner.js';
import { buildBaiduSmokePlan } from '../../agent/smoke-plans.js';
import { generateSuggestions } from '../../agent/suggestions-generator.js';
import { matchExpertWorkflow } from '../../agent/supercar/expert-workflows.js';
import {
  type SupercarActionCaptureEvent,
  type SupercarOutcome,
  classifyAsCrossPlatformAutomation,
  classifyAsSimpleSearch,
  hasParkedSupercarHandle,
  runSupercarTask,
  supercarAbort,
  supercarHandoffToGenerate,
  supercarReply,
} from '../../agent/supercar/index.js';
import { MemoryService } from '../../agent/supercar/memory-service.js';
import {
  parseOtaAllowlist,
  resolveOtaCanaryLane,
} from '../../agent/supercar/ota-user-browser-policy.js';
import { runOtaUserBrowserReadonly } from '../../agent/supercar/ota-user-browser-runner.js';
import { generatePlan, shouldSkipPlan } from '../../agent/supercar/plan-service.js';
import {
  formatForPrompt as formatPlaybooksForPrompt,
  matchPlaybooks,
} from '../../agent/supercar/playbook-service.js';
import { classifyRole, selectModelAndEffort } from '../../agent/supercar/prompt-layers.js';
import {
  StatsService,
  classifyTaskType,
  extractDomain,
} from '../../agent/supercar/stats-service.js';
import {
  buildSupercarWaitingUserMessage,
  classifySupercarTaskStateTransition,
  shouldPersistSupercarTerminalOutcome,
  shouldRunSupercarTerminalSideEffects,
  supercarResponseLayerTerminalStatus,
} from '../../agent/supercar/task-state-machine.js';
import type { PlannedStep, TaskState } from '../../agent/task-controller.js';
import { TaskController } from '../../agent/task-controller.js';
import { friendlyTaskFailureReason } from '../../agent/task-failure-copy.js';
import { TaskRepository } from '../../agent/task-repository.js';
import {
  type RunTemplateFillResult,
  type TemplateAttachment,
  runTemplateFillTask,
} from '../../agent/template/template-fill-runner.js';
// Phase 1 follow-up — final-text sanitiser + scrape-failure
// humaniser. Strips tool-XML / base64 / stop-reason markers from
// outcome.summary BEFORE it goes through verify + persist.
import {
  humaniseScrapeFailure,
  sanitizeFinalText,
  stripStopReasonMarkers,
} from '../../agent/text-sanitizer.js';
import { injectResolvedUrl, resolveIntentUrl } from '../../agent/url-resolver.js';
import type { VideoScript } from '../../agent/video/types.js';
import { VIDEO_CREATION_ALLOWLIST } from '../../agent/video/video-access.js';
import { probeCloneReferenceDurationSeconds } from '../../agent/video/video-clone-reference.js';
import {
  claimVideoConfirmAfterVerifierPreflight,
  deriveVideoType,
  mapVideoFailureReason,
  videoQualityVerificationMetadata,
} from '../../agent/video/video-confirm-meta.js';
import {
  decideVideoGate,
  parseVideoConfirm,
  quoteCloneVideo,
  quoteIpVideo,
  quoteVideo,
} from '../../agent/video/video-confirm.js';
import type { IpVideoConfig } from '../../agent/video/video-ip-lipsync.js';
import type {
  AspectRatio,
  SimpleVideoConfig,
  VideoSource,
} from '../../agent/video/video-lane-simple.js';
import type { PetI2vModel } from '../../agent/video/video-pet-i2v.js';
import type { VideoStyle } from '../../agent/video/video-script.js';
import type { WanAnimateMixMode } from '../../agent/video/wan-animate-mix-client.js';
import { describeSignal } from '../../agent/vision-loop/anti-bot-detector.js';
import { classify as classifyDomain } from '../../agent/vision-loop/domain/classifier.js';
import type { PageLike, PlaywrightExecutor } from '../../agent/vision-loop/playwright-executor.js';
import { startVisionLoopTask } from '../../agent/vision-loop/task-runner.js';
import {
  BrowserSessionRestoreFlights,
  restorableBrowserTarget,
} from '../../browser-pool/browser-session-recovery.js';
import { env as appEnv } from '../../config/env.js';
import { readAffectedRows } from '../../db/mysql-result.js';
import { projects } from '../../db/schema/projects.js';
import { skills } from '../../db/schema/skills.js';
import { taskActionCaptures } from '../../db/schema/task-action-captures.js';
import { taskEvents } from '../../db/schema/task-events.js';
import { taskFiles } from '../../db/schema/task-files.js';
import { taskSteps } from '../../db/schema/task-steps.js';
import { tasks as tasksTable } from '../../db/schema/tasks.js';
import { users } from '../../db/schema/users.js';
import { EvidenceArtifactRepository } from '../../evidence/evidence-artifact-repository.js';
import { routeTaskEvidenceOnDelete } from '../../evidence/evidence-deletion-service.js';
import { writeLedgerToDb } from '../../evidence/ledger-write-service.js';
import type { VerificationResult } from '../../execution/answer-verifier.js';
// Phase 1 Day 5 — execution-pipeline glue. All four entry points are
// no-ops when the corresponding feature flag is off (default), so
// importing them adds no runtime cost on a baseline deploy.
import {
  type FinalTerminalStatus,
  type VerifyOutput,
  deriveFinalStatus,
  disposeExecution,
  extractFailedChecks,
  initExecution,
  persistExecution,
  recheckPostFormat,
  recordEvidence,
  summariseVerificationFailure,
  verifyAndFinalize,
} from '../../execution/execution-pipeline.js';
import { parseInputs } from '../../execution/expert-workflow-parser.js';
import {
  getExpertWorkflowById,
  matchExpertWorkflow as matchTypedExpertWorkflow,
} from '../../execution/expert-workflow-registry.js';
import { getFeatureFlags as getExecutionFeatureFlags } from '../../execution/feature-flags.js';
import { fencedFileIds, isDocumentOutput } from '../../execution/file-artifact-consistency.js';
import { MAX_DOWNLOAD_BYTES } from '../../files/download-manager.js';
import { FileService, taskInternalIdFor } from '../../files/file-service.js';
import { parseFileForPrompt } from '../../files/parsers.js';
import { getSharedStorageProvider } from '../../files/storage-provider.js';
import { allowedFormatsForPlan, isCreateFileFormat, renderFile } from '../../files/writers.js';
import { TaskActionCaptureRepository } from '../../playbook/task-action-capture-repository.js';
import {
  QuotaService,
  concurrencyExhaustedMessage,
  getConcurrencyLimit,
  quotaErrorFor,
} from '../../quota/quota-service.js';
import { tryAcquire as rateLimitTryAcquire } from '../../quota/rate-limiter.js';
import {
  runResponseLayerForLane,
  stampResponseLayerColumns,
} from '../../response-layer/lane-integration.js';
import {
  TASK_ACTIVE_STATUSES,
  TASK_QUEUE_DEPTH_STATUSES,
  isTaskTerminalStatus,
} from '../../task-status.js';
import { extensionNoClientMessage } from '../../ws/extension-tool-copy.js';
import {
  broadcastToUser,
  getExtensionLoginState,
  hasConnectedExtension,
  hasConnectedSwClient,
  sendExtensionToolCall,
  updateTaskStateForUser,
} from '../../ws/server.js';
import { protectedProcedure, router } from '../trpc.js';
import {
  followUpParentHasBrowserContext,
  followUpParentReasonLabel,
  followUpTerminalGuardMessage,
  resolveBrowserFollowUpContinuation,
  resolveFollowUpExecutionMode,
} from './task-followup-copy.js';
import { markQueuedTaskExecutingOrThrow } from './task-queue-start.js';
import { annotateTaskResultAttachmentAvailability } from './task-result-attachment-availability.js';
import {
  type CapturedBrowserFinalState as CapturedFinalState,
  captureBrowserFinalState as captureFinalState,
  persistAndBroadcastBrowserDispatchFailure,
  persistAndBroadcastVisionLoopThrow,
} from './task-terminal-recovery.js';

const taskController = new TaskController();
const FAILURE_REVIEW_STATUSES = ['failed', 'partial_success'] as const;

const unsuccessfulCountProcedure = protectedProcedure.query(async ({ ctx }) => {
  const [userRow] = await ctx.db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.externalId, ctx.userId))
    .limit(1);
  if (!userRow) return { count: 0 };
  const [row] = await ctx.db
    .select({ count: sql<number>`COUNT(*)` })
    .from(tasksTable)
    .where(
      and(
        eq(tasksTable.userId, userRow.id),
        inArray(tasksTable.status, [...FAILURE_REVIEW_STATUSES]),
        eq(tasksTable.origin, 'user'),
      ),
    );
  return { count: Number(row?.count ?? 0) };
});

const clearUnsuccessfulProcedure = protectedProcedure.mutation(async ({ ctx }) => {
  const [userRow] = await ctx.db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.externalId, ctx.userId))
    .limit(1);
  if (!userRow) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'unknown user' });
  }

  const unsuccessfulRows = await ctx.db
    .select({ id: tasksTable.id })
    .from(tasksTable)
    .where(
      and(
        eq(tasksTable.userId, userRow.id),
        inArray(tasksTable.status, [...FAILURE_REVIEW_STATUSES]),
        eq(tasksTable.origin, 'user'),
      ),
    );
  const unsuccessfulIds = unsuccessfulRows.map((row) => row.id);
  if (unsuccessfulIds.length === 0) {
    return { ok: true as const, deleted: 0 };
  }

  // Same evidence semantics as single-task delete: route artifacts
  // before deleting rows while task_id is still populated. Without
  // this, the evidence_artifacts.task_id FK would SET NULL and leave
  // task_evidence / audit rows orphaned without applying the
  // user-delete vs audit-retention split from design §4.9.
  for (const taskId of unsuccessfulIds) {
    try {
      await routeTaskEvidenceOnDelete(ctx.db, taskId, { logger: ctx.logger });
    } catch (err) {
      ctx.logger.warn(
        { err, taskInternalId: taskId },
        'tasks.clearUnsuccessful: evidence routing failed (non-blocking)',
      );
    }
  }

  // task_steps cascades via FK; task_events has no FK and must be
  // deleted explicitly to avoid orphan audit rows.
  await ctx.db.transaction(async (tx) => {
    await tx.delete(taskEvents).where(inArray(taskEvents.taskId, unsuccessfulIds));
    await tx.delete(tasksTable).where(inArray(tasksTable.id, unsuccessfulIds));
  });
  return { ok: true as const, deleted: unsuccessfulIds.length };
});

/**
 * Phase 24 — controlled quota bypass for the test account.
 *
 * The per-mode (browser / generate) split that 21b had was needed
 * because the per-user shared Brave was a single contended resource.
 * Phase 24's per-task pool means there's no shared resource to
 * starve — every task gets its own Brave (capped by pool capacity)
 * and generate tasks don't touch the pool at all.
 *
 * RC follow-up: with the global TaskQueue gating dispatch to the
 * 10-slot pool, this admit-time concurrency check no longer needs
 * to mirror pool capacity. The queue handles the actual throttling
 * (10 in flight, the rest sit in 'queued' status). Sizing this to
 * match the queue's depth ceiling lets the test account submit a
 * full RC batch (165 tasks) without hitting an admit-time wall
 * before the queue can do its job.
 *
 * Plan limits (daily/monthly task counter) are still skipped for
 * bypass users so smoke testing isn't blocked by the 3/day cap.
 */
const QUOTA_BYPASS_USERS: ReadonlySet<string> = new Set(['usr_EeYpvsvLtyDzN4VLQi7BT']);
const BYPASS_CONCURRENCY = 100;
const BYPASS_RATE = { max: 30, windowMs: 60_000 };
const GLOBAL_QUEUE_DEPTH_LIMIT = 100;

// Phase 1 #2 ④ — a-share 问答灰度白名单（ASHARE_QA_ALLOWLIST CSV）。flag off 或
// 不在名单 → a-share 问句落通用路径。空名单 = 全量（widen 后）；非空 = 灰度。
const ASHARE_QA_ALLOWLIST: ReadonlySet<string> = new Set(
  (appEnv.ASHARE_QA_ALLOWLIST ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
);

// VIDEO_CREATION_ALLOWLIST + isVideoEnabledFor live in
// agent/video/video-access.ts (single source shared with auth.me's
// videoEnabled frontend gate — imported above; can't drift).

// Anthropic model for the video优化/脚本 step.
// TODO(env): 接进 env.ts (VIDEO_SCRIPT_MODEL) when the video lane env block lands.
const VIDEO_SCRIPT_MODEL = 'claude-sonnet-4-6';

/**
 * Build the simplified-video-lane config from env. Model ids / 音色 / 字体 use
 * built-in defaults (Vultr-verified); env-ising them is a nice-to-have.
 * TODO(env): VEO_*_MODEL / QWEN_TTS_MODEL / PRESET_VOICE / font paths.
 */
function buildVideoCfg(): SimpleVideoConfig {
  return {
    dashscopeApiKey: appEnv.DASHSCOPE_API_KEY,
    dashscopeBaseUrl: appEnv.DASHSCOPE_BASE_URL,
    ...(appEnv.DASHSCOPE_WORKSPACE_ID
      ? { dashscopeWorkspaceId: appEnv.DASHSCOPE_WORKSPACE_ID }
      : {}),
    geminiApiKey: appEnv.GEMINI_API_KEY,
    geminiBaseUrl: appEnv.GEMINI_BASE_URL,
    qwenTtsModel: 'qwen3-tts-flash',
    presetVoice: 'Cherry',
    geminiImageModel: appEnv.GEMINI_IMAGE_MODEL,
    wanxiangT2vModel: appEnv.WANXIANG_T2V_MODEL,
    happyhorseModel: appEnv.HAPPYHORSE_T2V_MODEL ?? 'happyhorse-1.1-t2v',
    wanI2vModel: appEnv.WANXIANG_I2V_MODEL ?? 'wan2.2-i2v-flash',
    happyhorseI2vModel: appEnv.HAPPYHORSE_I2V_MODEL ?? 'happyhorse-1.0-i2v',
    watermarkFontFile: '/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc',
  };
}

/** Phase 2 第三期 — IP 人物 B-lane(克隆音 + fal 换口型)config. */
function buildIpVideoCfg(): IpVideoConfig {
  return {
    dashscopeApiKey: appEnv.DASHSCOPE_API_KEY,
    dashscopeBaseUrl: appEnv.DASHSCOPE_BASE_URL,
    ...(appEnv.DASHSCOPE_WORKSPACE_ID
      ? { dashscopeWorkspaceId: appEnv.DASHSCOPE_WORKSPACE_ID }
      : {}),
    qwenTtsVcModel: appEnv.QWEN_TTS_VC_MODEL,
    falApiKey: appEnv.FAL_KEY,
    falBaseUrl: appEnv.FAL_BASE_URL,
    falLipsyncModel: appEnv.FAL_LIPSYNC_MODEL,
    watermarkFontFile: '/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc',
  };
}

// Module-scope Anthropic client for url-resolver. Cheap to construct
// but no reason to pay per request — cache once at import time.
const anthropicForResolver: Anthropic | null = appEnv.ANTHROPIC_API_KEY ? new Anthropic() : null;

const taskIdInput = z.object({ taskId: z.string().min(1) });

const createInput = z.object({
  intent: z.string().min(1).max(4_000),
  occupation: z.string().optional(),
  /**
   * Phase 10 Tier 3 — external ids for files the user uploaded
   * BEFORE this tasks.create call (via POST /files/upload). The
   * server reads them, parses each into the right Anthropic content
   * block, and prepends them to the agent's first user message.
   */
  fileIds: z.array(z.string()).max(5).optional(),
  /**
   * Phase 14 audit follow-up — multi-turn追问. When the user is
   * looking at a terminal task and types a follow-up
   * (e.g. "为什么失败"), the SPA passes the parent task's
   * external id here. Server then:
   *   1. Validates the parent belongs to the same user and is in
   *      a terminal state (completed / partial_success / failed / cancelled).
   *   2. Skips quota consumption — follow-ups are free; they
   *      reuse the cost the user already paid.
   *   3. Prepends a "前一个任务"<intent>"，结果：<summary>" block
   *      to the agent's intent so the model has full context.
   * Concurrency limit still applies — a runaway loop of follow-ups
   * would still hammer the agent loop.
   */
  replyToTaskId: z.string().min(1).optional(),
  /**
   * O4 — execution mode. 'auto' (default) runs the agent immediately.
   * 'plan' instructs the agent to first emit a plan + wait for user
   * approval (the agent stops on awaiting_user; user replies "执行"
   * via tasks.reply to continue). Quota is consumed on submit either
   * way — the plan-mode pause is a UX moment, not a billing dodge.
   */
  mode: z.enum(['auto', 'plan']).optional(),
  /**
   * Codex Pack C1 — task-level expert mode toggle. Sent by the SPA's
   * composer (defaults to undefined = auto when the user doesn't
   * pick). `expert` forces the typed-workflow tier on regardless of
   * whether the intent matcher would have chosen it; `normal`
   * forces it off (general-purpose lane, cheaper / faster). Auto is
   * the historical behaviour: matchExpertWorkflow decides.
   */
  expertMode: z.enum(['normal', 'expert', 'auto']).optional(),
  /**
   * Phase 21a — explicit skill/role id chosen for this task. When
   * present, the looksLikeCodeIntent guard is skipped: the user has
   * picked a domain expert, so "帮我写个网站翻译脚本" under 技术翻译
   * is intended, not a stray app-building request. The resolved
   * AgentRole isn't used here in the gate — the supercar layer
   * picks roles via classifyRole on its own — but having the id on
   * the wire lets us short-circuit the guard cleanly.
   */
  skillId: z.string().min(1).max(64).optional(),
  skillSource: z.enum(['manual']).optional(),
  /**
   * Phase 1 #2 ④ — alias for skillId. 历史上 skill/role 字段在本仓库混用，
   * API 调用方（含对抗实测）常传 `roleId`。接受为 skillId 的别名，避免选了
   * a-share 技能却因字段名不符落通用路径泄漏建议（Q3 修）。
   */
  roleId: z.string().min(1).max(64).optional(),
  /**
   * Optimization #3 R1 — viewport profile the SPA wants for this
   * task's per-Brave geometry. Picked from the user's current
   * panel layout: sidepanel / desktop / fullscreen / mobile. The
   * pool reads this at allocate time to size Xvfb + Brave's
   * `--window-size` + the CDP streamer's frame cap. Validated as
   * a literal union so unknown values land as a tRPC BAD_REQUEST
   * rather than silently falling through to the default geometry.
   * Optional — omitted requests get the legacy 'desktop' default.
   */
  viewportProfile: z.enum(['sidepanel', 'desktop', 'fullscreen', 'mobile']).optional(),
  /**
   * Phase 2 第一期 — 视频独立界面参数。SPA「普通视频」面板把用户选的模型档/
   * 风格/画幅/画质/时长带上来:Phase1 video fork 据此报价(诚实定价)+ 存进
   * result.metadata.videoOptions,confirmVideo 原子抢占后透传给 runSimpleVideoCreation。
   * omitted = 各项走 lane 默认(veo_fast / 自动 / 竖屏 9:16 / 1080p / 8s)。
   * 仅当 video fork 命中(VIDEO_CREATION_ENABLED + 灰度内)才被读取;其余意图忽略。
   */
  videoOptions: z
    .object({
      /** 'normal' 普通文生 / 'pet' 宠物图生 i2v / 'ip_person' 真人换口型(第三期). Default 普通. */
      tab: z.enum(['normal', 'pet', 'ip_person']).optional(),
      model: z.enum(['veo_fast', 'veo_lite', 'veo_standard', 'happyhorse', 'wanxiang']).optional(),
      /** 宠物 i2v 档(tab='pet'). Default 'wan_i2v'(省钱+已证可达). */
      petModel: z.enum(['wan_i2v', 'happyhorse_i2v']).optional(),
      /** 宠物照片的已上传 fileId(tab='pet' 必填). confirmVideo 据此 mint presigned GET 当 img_url. */
      petImageFileId: z.string().min(1).max(64).optional(),
      /** 复刻视频的已上传参考视频 fileId(tab='pet' 必填). */
      referenceVideoFileId: z.string().min(1).max(64).optional(),
      /** 浏览器从真实视频 metadata 读取的时长，仅用于报价；供应商按实际输出时长计费。 */
      referenceVideoDurationSeconds: z.number().min(2).max(30).optional(),
      /** Wan Animate 2.2 character-swap service mode. */
      cloneMode: z.enum(['wan-std', 'wan-pro']).optional(),
      style: z.enum(['auto', 'realistic', 'atmospheric', 'science']).optional(),
      aspectRatio: z.enum(['9:16', '16:9', '1:1', '4:3', '3:4']).optional(),
      resolution: z.enum(['720p', '1080p']).optional(),
      durationSeconds: z.number().int().min(3).max(15).optional(),
    })
    .optional(),
  imageOptions: z
    .object({
      model: z.enum(['nano_banana_2', 'nano_banana_pro']).optional(),
      aspectRatio: z.enum(['9:16', '16:9', '1:1', '4:3', '3:4']),
      imageCount: z.number().int().min(1).max(4),
    })
    .optional(),
});

const ASHARE_SKILL_IDS = new Set(['a-share-market-briefing', 'a-share-analyst']);

function assertManualSkillSelectionEnabled(
  input: {
    skillId?: string | null;
    roleId?: string | null;
    skillSource?: 'manual' | undefined;
  },
  selectedSkillIds: unknown,
): string | null {
  if (input.skillSource !== 'manual') return null;
  const skillId = (input.skillId ?? input.roleId ?? '').trim();
  const skill = skillById(skillId);
  if (!skill) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: '该技能不存在或已更新，请刷新技能页后重试',
    });
  }
  const enabled = new Set(normalizeSkillIds(selectedSkillIds));
  if (!enabled.has(skill.id)) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: '请先启用该技能，再在输入框中 @ 调用',
    });
  }
  return skill.id;
}

function normalizeTaskSkillInputId(input: {
  skillId?: string | null;
  roleId?: string | null;
}): string | undefined {
  const raw = (input.skillId ?? input.roleId ?? '').trim();
  if (!raw) return undefined;
  return skillById(raw)?.id ?? raw;
}

function resolveTaskSkillContext(
  input: {
    skillId?: string | null;
    roleId?: string | null;
    skillSource?: 'manual' | undefined;
  },
  selectedSkillIds: unknown,
): string | undefined {
  return (
    assertManualSkillSelectionEnabled(input, selectedSkillIds) ?? normalizeTaskSkillInputId(input)
  );
}

function resolveTaskDispatchSkillId(
  taskSkillId: string | undefined,
  gatedRole: string,
): string | undefined {
  return taskSkillId ?? (gatedRole === 'none' ? undefined : gatedRole);
}

type SkillCatalogueRow = {
  slug: string;
  description: string | null;
  occupationTag: string | null;
  manifest: unknown;
};

function buildPlannerSkillCatalogue(rows: SkillCatalogueRow[]): SkillCatalogueEntry[] {
  const out: SkillCatalogueEntry[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    if (!row.description) continue;
    const canonical = skillById(row.slug)?.id ?? row.slug;
    out.push({
      slug: canonical,
      description: row.description,
      occupationTag: row.occupationTag,
      allowedOrigins: extractAllowedOrigins(row.manifest),
    });
    seen.add(row.slug);
    seen.add(canonical);
  }

  for (const skill of HOLADAY_SKILLS) {
    if (seen.has(skill.id)) continue;
    out.push({
      slug: skill.id,
      description: skill.description,
      occupationTag: null,
      allowedOrigins: [],
    });
    seen.add(skill.id);
  }

  return out;
}

function buildPlannerIntent(intent: string, taskSkillId: string | undefined): string {
  if (!taskSkillId) return intent;
  const skill = skillById(taskSkillId);
  if (!skill) return intent;
  return [
    `【用户选择的技能】${skill.name}（${skill.id}）`,
    `技能说明：${skill.description}`,
    '请优先按该技能的目标、语气和限制规划任务；如果用户需求与该技能不相关，以用户原始需求为准。',
    '',
    intent,
  ].join('\n');
}

/**
 * O15 — friendly refusal for coding / app-building intents. HOLA DAY
 * is a browser-task agent, not a code IDE; trying to satisfy a "帮我
 * 写一个 React 组件" prompt burns Anthropic budget on something Claude
 * Code or Cursor does much better. Match BEFORE quota consumption so
 * the user sees a fast no-cost rejection instead of "executing → fail
 * after 8 turns".
 *
 * Pattern: requires a CODE keyword (write/build/develop/debug/deploy
 * + 中文 写代码/编程/开发) AND a SUBJECT keyword (网站/网页/app/组件/
 * 接口/api/sdk/库). A standalone "写" without subject is too vague to
 * reject; "做个网站" alone could be a website-research task. Both
 * dimensions in the same intent → refuse.
 */
const CODE_VERBS = [
  '写代码',
  '写程序',
  '编程',
  '编写',
  '写一个',
  '写一段',
  '写个',
  '做',
  '做个',
  '做一个',
  '开发',
  '搭建',
  '搭一个',
  '搭个',
  '建',
  '建个',
  '建一个',
  '构建',
  '调试',
  '部署',
  '上线',
  '修复 bug',
  '修 bug',
  'debug',
  '重构',
  '实现一个',
  'write code',
  'build a',
  'build me',
  'develop',
  'deploy',
  'compile',
  'refactor',
];
const CODE_SUBJECTS = [
  '网站',
  '网页',
  '后台',
  '前端',
  '后端',
  '应用',
  '系统',
  '组件',
  '函数',
  '接口',
  'api',
  'sdk',
  '库',
  '插件',
  '扩展',
  '小程序',
  '页面',
  '脚本',
  '程序',
  '代码',
  '小工具',
  '数据库',
  '服务器',
  'website',
  'webapp',
  'web app',
  'app',
  'component',
  'function',
  'script',
  'plugin',
  'package',
  'module',
  'library',
];
// Full-phrase fast-path. The verb-AND-subject double-keyword check
// can miss compact intents like "做个网站" because "做" is too
// generic to whitelist on its own (BOSS reported false-negative).
// These exact substrings light up regardless of the strict pair check.
const CODE_PHRASES = [
  '做个网站',
  '做一个网站',
  '建个网站',
  '建一个网站',
  '搭个网站',
  '搭一个网站',
  '帮我做网站',
  '帮我建网站',
  '帮我搭网站',
  '帮我建站',
  '建站',
  '写个网站',
  '写个 app',
  '写个app',
  '写个应用',
  '做个 app',
  '做个app',
  '做个小程序',
  '建个小程序',
  '帮我开发',
  '帮我编程',
  '帮我写代码',
  'build me a website',
  'build a website',
  'make me an app',
  'build a webapp',
];
/**
 * Phase 1 follow-up — analysis-intent whitelist. The verb+subject
 * heuristic was too aggressive: prompts like "总结人工智能应用系统的
 * 发展趋势" matched `开发` (verb) + `应用系统` (subject) and triggered
 * the rejection. Real users asking for analysis got told to use
 * Cursor.
 *
 * The whitelist applies ONLY to the verb+subject pair; CODE_PHRASES
 * (full unambiguous phrases like "做个网站") still always trigger.
 * The user's analytical framing is the signal — if any of these
 * words is present, the intent is "explain / analyze / report ON
 * the technology" rather than "build the technology for me".
 */
const ANALYSIS_INTENT_WORDS = [
  '分析',
  '总结',
  '复盘',
  '报告',
  '研究',
  '调研',
  '调查',
  '说明',
  '解释',
  '介绍',
  '描述',
  '阐述',
  '讲讲',
  '讲一下',
  '方法',
  '方法论',
  '方案',
  '策略',
  '思路',
  '趋势',
  '现状',
  '特点',
  '特征',
  '原理',
  '架构思路',
  '本质',
  '是什么',
  '什么是',
  '如何理解',
  '怎么看',
  // English
  'analyze ',
  'analyse ',
  'summarize ',
  'summarise ',
  'explain ',
  'describe ',
  'compare ',
  'overview',
  'introduction',
  'what is',
  'how does',
];
/**
 * Codex Pack B1 — broadcast a transient sub-status marker for the
 * SPA's live-progress chip. Wraps `server.task.progress` so the
 * existing handler in task-store picks it up; the new `subStatus`
 * field tells the chip which Chinese label to render and when to
 * start the 30s-elapsed timer. Nothing persists — purely a UX
 * affordance for runs that take more than a few seconds.
 *
 * Best-effort: a broadcast failure (closed socket, JSON serialise
 * error) is swallowed so a transient WS hiccup never tears down the
 * runner. Labels mirror the spec table; callers may pass a more
 * specific `message` override (e.g. "正在打开 baidu.com" instead of
 * "正在操作浏览器…") and the SPA renders that verbatim.
 */
type TaskSubStatus =
  | 'planning'
  | 'browsing'
  | 'extracting'
  | 'verifying'
  | 'generating'
  | 'generating_image';

const TASK_SUB_STATUS_LABEL: Record<TaskSubStatus, string> = {
  planning: '正在规划任务…',
  browsing: '正在操作浏览器…',
  extracting: '正在提取数据…',
  verifying: '正在验证结果…',
  generating: '正在生成回答…',
  generating_image: '正在生成图片…',
};

function broadcastSubStatus(
  userId: string,
  taskId: string,
  subStatus: TaskSubStatus,
  message?: string,
): void {
  try {
    broadcastToUser(userId, {
      type: 'server.task.progress',
      taskId,
      message: message ?? TASK_SUB_STATUS_LABEL[subStatus],
      subStatus,
    });
  } catch {
    /* best-effort */
  }
}

function hasAnalysisIntent(lower: string): boolean {
  return ANALYSIS_INTENT_WORDS.some((w) => lower.includes(w));
}
function looksLikeCodeIntent(intent: string): boolean {
  const lower = intent.toLowerCase();
  // Unambiguous full phrases always trigger — the user explicitly
  // said "build me a website" / "做个网站". No whitelist for these.
  if (CODE_PHRASES.some((p) => lower.includes(p))) return true;
  const hasVerb = CODE_VERBS.some((v) => lower.includes(v));
  if (!hasVerb) return false;
  if (!CODE_SUBJECTS.some((s) => lower.includes(s))) return false;
  // Verb + subject pair matched — but if the prompt also has an
  // analysis-intent word, the user is asking ABOUT the tech, not
  // asking us to build it. Skip the rejection.
  if (hasAnalysisIntent(lower)) return false;
  return true;
}

type ModeBPingOutcome = {
  ok: boolean;
  result?: unknown;
  error?: { message: string; code?: string };
};

export type NormalizedModeBPingResult =
  | {
      ok: true;
      finalUrl: string;
      title: string;
      bodyText: string;
    }
  | {
      ok: false;
      error: { message: string; code: string };
    };

export function normalizeModeBPingOutcome(outcome: ModeBPingOutcome): NormalizedModeBPingResult {
  if (!outcome.ok) {
    return {
      ok: false,
      error: {
        message: outcome.error?.message || '浏览器扩展执行失败，请稍后重试',
        code: outcome.error?.code || 'unknown',
      },
    };
  }

  if (typeof outcome.result !== 'object' || outcome.result === null) {
    return {
      ok: false,
      error: {
        message: '浏览器扩展返回结果不完整，请重试',
        code: 'malformed_result',
      },
    };
  }

  const result = outcome.result as {
    finalUrl?: unknown;
    title?: unknown;
    bodyText?: unknown;
  };
  const finalUrl = typeof result.finalUrl === 'string' ? result.finalUrl.trim() : '';
  if (!finalUrl || !isSafeUrl(finalUrl)) {
    return {
      ok: false,
      error: {
        message: '浏览器扩展没有返回有效页面地址，请重试',
        code: 'malformed_result',
      },
    };
  }

  const title = typeof result.title === 'string' ? result.title.trim().slice(0, 300) : '';
  const rawBodyText = typeof result.bodyText === 'string' ? result.bodyText.trim() : '';
  const bodyText = rawBodyText.length > 12_000 ? rawBodyText.slice(0, 12_000) : rawBodyText;

  return {
    ok: true,
    finalUrl: finalUrl.slice(0, 2048),
    title,
    bodyText,
  };
}

function isSafeUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

const browserSessionRestoreFlights = new BrowserSessionRestoreFlights();

export const tasksRouter = router({
  create: protectedProcedure.input(createInput).mutation(async ({ ctx, input }) => {
    // O15 — code-task refusal lands BEFORE user lookup so even an
    // unauthenticated-token-in-fail-path doesn't get scaffolding.
    //
    // Phase 21a — whitelist this guard when the user has signaled
    // they're operating in a specialist context: either explicit
    // skillId on the task, or the role classifier (keyword-only,
    // free) matched something. A user asking 技术翻译专家 to "帮我
    // 写个网站本地化脚本" knows what they want; a guard that says
    // "用 Cursor" insults them. The guard is meant to catch raw
    // free-form attempts to build apps in HOLA DAY, not legitimate
    // expert-mode scripting.
    const inputSkillId = normalizeTaskSkillInputId(input);
    const intentImpliesRole = classifyRole(input.intent) !== 'none';
    const inSpecialistContext = Boolean(inputSkillId) || intentImpliesRole;
    if (!inSpecialistContext && looksLikeCodeIntent(input.intent)) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message:
          'HOLA DAY 专注浏览器任务执行（搜索 / 操作 / 比价 / 抓内容）。代码开发请用 Claude Code 或 Cursor 等专业工具。',
      });
    }
    const [userRow] = await ctx.db
      .select({
        id: users.id,
        plan: users.plan,
        selectedRoles: users.selectedRoles,
        selectedSkills: users.selectedSkills,
        // Phase 2 第三期 — IP 人物生成门控(三件齐 + 授权才放行)。
        qwenVoiceId: users.qwenVoiceId,
        baseVideoFileId: users.baseVideoFileId,
        videoSelfUseAuthorizedAt: users.videoSelfUseAuthorizedAt,
      })
      .from(users)
      .where(eq(users.externalId, ctx.userId))
      .limit(1);
    if (!userRow) {
      throw new TRPCError({ code: 'UNAUTHORIZED', message: 'unknown user' });
    }
    const taskSkillId = resolveTaskSkillContext(input, userRow.selectedSkills);

    // Phase 14 audit follow-up — multi-turn 追问. When `replyToTaskId`
    // is set, the new task piggybacks on a previously completed/failed
    // task: skips quota and prefixes the agent's intent with the parent's
    // intent + result so the model has full context for "为什么失败" /
    // "再试一次" style follow-ups.
    let parentContextBlock = '';
    let isFollowUp = false;
    /**
     * Phase 3 R1 (Codex follow-up #2) — recovered parent workflow id.
     * When this is a follow-up tasks.create (replyToTaskId set), we
     * read the parent's `result.metadata.expertWorkflowId` so the
     * follow-up inherits the parent's workflow even if the chip's
     * prompt doesn't trip the typed matcher (e.g. "生成发布日历"
     * has no platform keyword). Null if no parent or parent wasn't
     * a workflow task.
     */
    let parentWorkflowId: string | null = null;
    let parentHasBrowserContext = false;
    let parentBrowserRestoreUrl: string | null = null;
    if (input.replyToTaskId) {
      const [parent] = await ctx.db
        .select({
          intent: tasksTable.intent,
          status: tasksTable.status,
          result: tasksTable.result,
          errorMessage: tasksTable.errorMessage,
        })
        .from(tasksTable)
        .where(
          and(
            eq(tasksTable.externalId, input.replyToTaskId),
            eq(tasksTable.userId, userRow.id),
            eq(tasksTable.origin, 'user'),
          ),
        )
        .limit(1);
      if (!parent) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: '找不到要追问的任务（可能已删除或不属于你）',
        });
      }
      if (!isTaskTerminalStatus(parent.status)) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: followUpTerminalGuardMessage(),
        });
      }
      const parentResult = (parent.result ?? null) as {
            summary?: string;
            reason?: string;
            metadata?: {
              expertWorkflowId?: string | null;
              executionMode?: string | null;
              finalUrl?: string | null;
            };
            expertWorkflowId?: string | null;
            executionMode?: string | null;
            finalUrl?: string | null;
            finalScreenshot?: unknown;
      } | null;
      // Workflow id can be either nested under metadata (newer tasks)
      // or top-level on result (older / generate-resume rows). Probe
      // both so old tasks don't lose context on follow-up.
      const candidateWfId =
        parentResult?.metadata?.expertWorkflowId ?? parentResult?.expertWorkflowId ?? null;
      if (typeof candidateWfId === 'string' && candidateWfId.length > 0) {
        parentWorkflowId = candidateWfId;
      }
      parentHasBrowserContext = followUpParentHasBrowserContext({
        executionMode: parentResult?.metadata?.executionMode ?? parentResult?.executionMode ?? null,
        finalUrl: parentResult?.finalUrl ?? null,
        hasFinalScreenshot: Boolean(parentResult?.finalScreenshot),
        intent: parent.intent,
      });
      const parentFinalUrl = parentResult?.finalUrl ?? parentResult?.metadata?.finalUrl ?? null;
      parentBrowserRestoreUrl =
        typeof parentFinalUrl === 'string' && isSafeUrl(parentFinalUrl)
          ? parentFinalUrl.trim().slice(0, 2048)
          : null;
      const summary = parentResult?.summary?.trim() ?? '';
      const reason = parentResult?.reason?.trim() ?? (parent.errorMessage ?? '').trim();
      const reasonLabel = followUpParentReasonLabel(parent.status);
      const outcomeLine =
        (parent.status === 'completed' || parent.status === 'partial_success') && summary
          ? `结果：${summary}`
          : reason
            ? `${reasonLabel}：${reason}`
            : `状态：${parent.status}（无详细输出）`;
      parentContextBlock = [
        '---',
        '【追问上下文】',
        `前一个任务："${parent.intent}"`,
        outcomeLine,
        '---',
        '',
      ].join('\n');
      isFollowUp = true;
    }

    /**
     * The intent the AGENT sees. For a follow-up, the parent's
     * intent + outcome are prepended so the model has full context.
     * The DB still stores `input.intent` verbatim — that's what the
     * user actually typed and what they expect to see in history.
     */
    // O4 plan-mode preamble. Cache-safe: appended to the first user
    // message (not the system prompt), so cache hit rate stays
    // intact. The agent obeys this by emitting a plan and stopping
    // on a question-suffix line, which the supercar awaiting_user
    // detector parks the loop on; tasks.reply ("执行" / "开始" /
    // "go" or any free-form approval) unblocks it.
    const planPreamble =
      input.mode === 'plan'
        ? [
            '【执行模式】先列计划，等用户确认',
            '请先输出 2-5 步执行计划（用编号列表），不要立刻调任何工具。',
            '末尾用一句问句问用户是否同意：例如"按这个计划执行吗？"',
            '用户回复"执行"/"开始"/"go"/"按计划做" → 继续；回复修改意见 → 调整后再问；',
            '从计划开始到用户回复期间，禁止调 navigate/computer/web_search/create_file。',
            '',
          ].join('\n')
        : '';
    // Codex Pack C1 — task-level expert mode override. The user's
    // composer pick wins over the intent matcher:
    //   'normal' → skip the legacy matcher entirely (force null)
    //   'expert' → use whatever matcher returns; if null, the typed
    //              matcher below may still pick one up
    //   'auto'   → matcher unchanged (the historical behaviour)
    const expertModeOverride = input.expertMode ?? 'auto';
    const expertWorkflow =
      expertModeOverride === 'normal'
        ? null
        : matchExpertWorkflow(input.intent, {
            hasAttachments: Boolean(input.fileIds && input.fileIds.length > 0),
          });
    const expertWorkflowPreamble = expertWorkflow?.promptPreamble ?? '';
    const effectiveIntent =
      planPreamble +
      (expertWorkflowPreamble ? `${expertWorkflowPreamble}\n` : '') +
      (parentContextBlock ? parentContextBlock : '') +
      input.intent;

    // Phase 10 Tier 2 — quota + concurrency gate. Both block task
    // creation BEFORE the row is inserted, so the user gets a clean
    // error rather than a half-spawned task. Role classification is
    // also done here so we can record role_id + opus_used on the
    // task row at insert time (avoids a follow-up UPDATE).
    const planId: PlanId =
      userRow.plan === 'basic' || userRow.plan === 'pro' ? userRow.plan : 'free';
    const rawSelectedRoles = (userRow.selectedRoles ?? []) as string[];
    // P1-final — sanitize for Basic. Mirror what roles.list does so
    // a Basic user whose persisted selected_roles still contains
    // legacy Pro-only ids (e.g. contract-reviewer left over from the
    // skill/role split migration) doesn't get gated on a count that
    // includes ids they can't actually benefit from. The gate runs
    // against OPEN_POOL-only ids; gateRoleForUser also receives the
    // sanitized list so the keyword-classifier path stays consistent.
    const OPEN_POOL_SET = new Set<string>(OPEN_POOL_ROLE_IDS);
    const selectedRoles =
      planId === 'basic'
        ? rawSelectedRoles.filter((id) => OPEN_POOL_SET.has(id))
        : rawSelectedRoles;

    // P1-A — Basic-plan over-limit gate. The skill/role split
    // migration left some users with > 5 entries in selected_roles.
    // gateRoleForUser would happily inject any of the 8 detected
    // matches, effectively letting Basic users benefit from a 8-pick
    // allowance they never paid for. Refuse the task until they
    // trim back to ≤ 5 in /settings/roles. Auto-trim is intentionally
    // avoided — the user should pick which 5 to keep.
    if (planId === 'basic' && selectedRoles.length > BASIC_ROLE_PICK_LIMIT) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: `你当前选择 ${selectedRoles.length} 个角色，超出基础版 ${BASIC_ROLE_PICK_LIMIT} 个上限。请到 /settings/roles 调整，或升级到专业版解除限制。`,
      });
    }

    // Role gate. classifyRole runs the same keyword classifier the
    // agent-loop uses; gateRoleForUser then drops it back to 'none'
    // when the plan / selection forbids it. Free → always 'none'.
    // Basic → 'none' unless the role is open-pool AND in the user's
    // pick. Pro → all roles allowed.
    const detectedRole = classifyRole(input.intent);
    let gatedRole = gateRoleForUser(detectedRole, planId, selectedRoles);
    // Pro upgrade: when the classifier picked an open-pool role that
    // has a Pro-only counterpart, swap up. Today the only such pair
    // is xiaohongshu-{operator → expert}; the basic role stays for
    // Basic-plan users to keep the upsell visible. If we add more
    // tiered roles, encode them here as a flat map.
    if (planId === 'pro' && gatedRole === 'xiaohongshu-operator') {
      gatedRole = 'xiaohongshu-expert';
    }
    const dispatchSkillId = resolveTaskDispatchSkillId(taskSkillId, gatedRole);
    const dispatchRoleId = dispatchSkillId ?? null;
    const routed = selectModelAndEffort(input.intent, dispatchSkillId ?? 'none');
    const isOpus = routed.model === 'claude-opus-4-7';

    // Free + Basic don't have an Opus quota; selectModelAndEffort
    // only routes to Opus for COMPLEX_ROLES, all of which are
    // pro-exclusive. So in practice isOpus is true only for Pro
    // users — but defend against future config drift by clamping
    // here rather than relying on prompt-layers' invariants.
    const willConsumeOpus = isOpus && planId === 'pro';

    const quotaService = new QuotaService(ctx.db);
    const isBypass = QUOTA_BYPASS_USERS.has(ctx.userId);

    // Phase 21b — classify execution mode FIRST so the concurrency
    // gate can apply per-mode caps (bypass users have separate
    // browser/generate budgets). Adds ~500ms latency on cache miss;
    // skill-hint + keyword fast paths inside the classifier short-
    // circuit most cases for free.
    const classifiedExecutionMode = await classifyExecutionMode({
      intent: input.intent,
      skillId: taskSkillId,
      // §5 fileIds-aware soft template-fill: an attachment + a fill clue
      // ("填入…模板…留空") relaxes the strict-pattern adjacency requirement.
      hasFileAttachment: Boolean(input.fileIds && input.fileIds.length > 0),
      logger: ctx.logger.child({ userId: ctx.userId, stage: 'router' }),
    });
    // Phase 2b — typed expert workflow lane override. When the new
    // typed matcher (content-topic / ecom-daily / douyin-review)
    // fires AND the EXPERT_WORKFLOW flag is on, force generate-mode
    // — these workflows never want a browser. This sits after the
    // legacy matcher so routeOverride='browser' from the legacy
    // douyin-livestream-review (when user has platform-source
    // keywords) still wins; in practice the two matchers don't
    // overlap on browser-needing intents.
    // Codex Pack C1 — same override applies to the typed matcher.
    // `normal` skips matching so the task drops to general-purpose
    // generate/scrape lanes even when the intent looks like a
    // workflow (e.g. user wants a quick 抖音 fact-check instead of
    // the full report).
    const typedWorkflowFromMatcher =
      expertModeOverride === 'normal'
        ? null
        : getExecutionFeatureFlags().EXPERT_WORKFLOW
          ? matchTypedExpertWorkflow({
              intent: input.intent,
              roleId: taskSkillId ?? null,
            })
          : null;
    // Phase 3 R1 (Codex follow-up #2) — on follow-up tasks the chip
    // prompt usually doesn't carry workflow keywords ("生成发布日历"
    // / "深挖 ROI 不达预期" / "生成下场直播 SOP"). Fall back to the
    // parent task's workflow id so the contract stays full-tier and
    // the verifier's section_presence + source_annotation checks
    // continue to fire on the follow-up's report.
    const typedWorkflowFromParent =
      isFollowUp && parentWorkflowId ? getExpertWorkflowById(parentWorkflowId) : null;
    const typedWorkflow = typedWorkflowFromMatcher ?? typedWorkflowFromParent;
    const typedWorkflowOverride =
      typedWorkflow != null && expertWorkflow?.routeOverride !== 'browser'
        ? ('generate' as const)
        : null;
    const executionMode = resolveFollowUpExecutionMode({
      parentHasBrowserContext,
      typedWorkflowOverride,
      expertRouteOverride: expertWorkflow?.routeOverride,
      classifiedExecutionMode,
      explicitMediaMode: input.imageOptions
        ? 'image'
        : input.videoOptions
          ? 'video_creation'
          : null,
    });
    if (appEnv.NODE_ENV === 'production' && executionMode === 'browser' && !ctx.browserPool) {
      // Server-side browser tasks must use the per-task pool because that
      // path is pinned to BrowserEgressProxy. A shared CDP fallback can only
      // apply app-level URL checks and cannot eliminate DNS rebinding or
      // subresource access to cloud metadata.
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: '安全浏览器执行环境尚未就绪，未创建任务。请稍后重试。',
      });
    }
    const directOpenUrl =
      executionMode === 'browser' ? extractRunnableDirectOpenUrl(input.intent, input.mode) : null;
    const directOpenSafetyError = directOpenUrl
      ? await verifyDirectOpenUrlSafety(directOpenUrl)
      : null;
    if (directOpenSafetyError) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: directOpenSafetyError,
      });
    }
    const directOpenFallbackExecutor = directOpenUrl
      ? (ctx.playwrightExecutor ??
        ctx.executionRouter?.getExecutor('headed') ??
        ctx.executionRouter?.getExecutor('headless') ??
        null)
      : null;
    const directOpenUsesBrowserPool = Boolean(
      directOpenUrl && ctx.browserPool && shouldUseBrowserPool(ctx.userId),
    );
    if (directOpenUrl && !directOpenUsesBrowserPool && !directOpenFallbackExecutor) {
      // Availability is deployment readiness. Reject before charging the
      // user when no browser can produce the promised page evidence.
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: '浏览器执行器尚未就绪，未创建空白任务。请稍后重试。',
      });
    }
    const offlineUnavailable =
      executionMode === 'browser' && !directOpenUrl
        ? offlineBrowserUnavailableMessage(Boolean(appEnv.ANTHROPIC_API_KEY))
        : null;
    if (offlineUnavailable) {
      // Reject before quota consumption and before inserting a row.
      // A missing model controller is deployment readiness, not a
      // user task attempt, and must never become a 20-minute zombie.
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: offlineUnavailable,
      });
    }
    // Codex Round 2 P1-7 — explicit observability log at the dispatch
    // boundary. Lets BOSS run `pm2 logs | grep task:expert_dispatch`
    // to compare normal vs expert outcomes (expertModeRequested ==
    // 'normal' AND expertWorkflowMatched != null = a forced-skip that
    // would otherwise have fired a workflow — useful for measuring
    // "did the user opt out of value or junk").
    ctx.logger.info(
      {
        userId: ctx.userId,
        expertModeRequested: expertModeOverride,
        expertWorkflowMatched: typedWorkflow?.workflowId ?? expertWorkflow?.id ?? null,
        executionMode,
      },
      'task:expert_dispatch',
    );
    if (typedWorkflow != null && executionMode === 'generate') {
      ctx.logger.info(
        {
          typedWorkflowId: typedWorkflow.workflowId,
          classifiedExecutionMode,
          legacyRouteOverride: expertWorkflow?.routeOverride ?? null,
        },
        'typed-workflow: forced generate lane',
      );
    }
    if (expertWorkflow?.routeOverride) {
      ctx.logger.info(
        {
          workflowId: expertWorkflow.id,
          routeOverride: expertWorkflow.routeOverride,
          classifiedExecutionMode,
          missingInputs: expertWorkflow.missingInputs,
        },
        'expert-workflow: route override applied',
      );
    }

    // Phase 21a P0 — global queue-depth guard. Applies to ALL users,
    // bypass or not, so a runaway client (or a bug elsewhere) can't
    // pile tasks faster than the executor pool drains. Counts across
    // pending/planning/queued/executing. Parked user-wait states do
    // not consume executor capacity. The query hits an index on `status`, so this is
    // sub-ms even at high concurrency.
    const [activeRow] = await ctx.db
      .select({ count: sql<number>`COUNT(*)` })
      .from(tasksTable)
      .where(inArray(tasksTable.status, [...TASK_QUEUE_DEPTH_STATUSES]));
    const queueDepth = Number(activeRow?.count ?? 0);
    if (queueDepth >= GLOBAL_QUEUE_DEPTH_LIMIT) {
      ctx.logger.warn(
        { userId: ctx.userId, queueDepth, limit: GLOBAL_QUEUE_DEPTH_LIMIT },
        'tasks.create: rejected — global queue depth exceeded',
      );
      throw new TRPCError({
        code: 'TOO_MANY_REQUESTS',
        message: `系统繁忙（队列深度 ${queueDepth}/${GLOBAL_QUEUE_DEPTH_LIMIT}），请稍后再试。`,
      });
    }

    // Phase 24 — per-user concurrency. With per-task browsers (one
    // task = one Brave) the in-memory mode tracker is no longer
    // needed — the DB total count of active tasks is the source of
    // truth. Bypass users still get a higher ceiling (matches pool
    // capacity so a single bypass user can saturate the pool, fine
    // for testing). Non-bypass users get their plan limit (1/3/5).
    const concurrencyLimit = isBypass ? BYPASS_CONCURRENCY : getConcurrencyLimit(planId);
    const concurrentCount = await quotaService.getActiveTaskCount(userRow.id);
    if (concurrentCount >= concurrencyLimit) {
      throw new TRPCError({
        code: 'TOO_MANY_REQUESTS',
        message: isBypass
          ? `bypass 并发上限 ${concurrencyLimit}（当前 ${concurrentCount}），请稍后再试。`
          : concurrencyExhaustedMessage(planId),
      });
    }

    // Phase 21a P0 — per-bypass-user submission rate limit. In-memory
    // sliding window (see quota/rate-limiter.ts). Only fires for users
    // in QUOTA_BYPASS_USERS today; non-bypass users are governed by
    // their plan's monthly/daily counter (see tryConsume below) which
    // is already a different shape of throttle.
    if (isBypass) {
      const rl = rateLimitTryAcquire(ctx.userId, BYPASS_RATE);
      if (!rl.ok) {
        ctx.logger.warn(
          { userId: ctx.userId, count: rl.count, retryAfterMs: rl.retryAfterMs },
          'tasks.create: bypass rate limit hit',
        );
        throw new TRPCError({
          code: 'TOO_MANY_REQUESTS',
          message: `bypass 速率上限 ${BYPASS_RATE.max}/分钟，约 ${Math.ceil(rl.retryAfterMs / 1000)} 秒后重试。`,
        });
      }
    }

    // Follow-ups are free — they reuse the cost of the parent task. Skip
    // tryConsume entirely so a quota-exhausted user can still ask
    // "为什么失败" without paying again. opus_used flag stays false on
    // the DB row for the same reason (the follow-up doesn't count).
    //
    // Bypass users also skip tryConsume — they're not on a metered
    // plan for testing purposes. Concurrency + rate-limit + global
    // queue-depth (above) provide all the throttling we need.
    let opusActuallyConsumed = false;
    if (isBypass) {
      opusActuallyConsumed = willConsumeOpus;
      ctx.logger.info(
        {
          userId: ctx.userId,
          queueDepth,
          concurrentCount,
          taskIntent: input.intent.slice(0, 60),
        },
        'tasks.create: bypass admit (concurrency + rate-limit ok)',
      );
    } else if (!isFollowUp) {
      const consume = await quotaService.tryConsume(userRow.id, planId, willConsumeOpus);
      if (!consume.ok) {
        // Pro running out of Opus mid-task should downgrade to Sonnet
        // automatically rather than block the task. Re-attempt with
        // isOpus=false so the regular pool absorbs it.
        if (consume.reason === 'opus_limit' && planId === 'pro') {
          const fallback = await quotaService.tryConsume(userRow.id, planId, false);
          if (!fallback.ok) {
            throw quotaErrorFor(fallback.reason);
          }
          ctx.logger.info(
            { userId: ctx.userId, taskIntent: input.intent.slice(0, 60) },
            'quota: opus exhausted — task will run on Sonnet',
          );
        } else {
          throw quotaErrorFor(consume.reason);
        }
      }
      opusActuallyConsumed = consume.ok && willConsumeOpus;
    } else {
      ctx.logger.info(
        {
          userId: ctx.userId,
          replyToTaskId: input.replyToTaskId,
          taskIntent: input.intent.slice(0, 60),
        },
        'tasks.create: follow-up reply mode (quota skipped)',
      );
    }

    // Phase 10 Tier 3 — resolve attachments BEFORE the supercar / vision
    // branch decision. We read the buffers + parse them up front so the
    // user message we hand the agent is fully baked; both paths get
    // identical attachment semantics. Failures (missing file, expired
    // row, parse error) log + skip — the task still runs without that
    // file rather than failing creation outright.
    const fileService = new FileService(ctx.db, ctx.logger);
    const attachmentBlocks: Awaited<ReturnType<typeof parseFileForPrompt>>['blocks'] = [];
    if (input.fileIds && input.fileIds.length > 0) {
      const loaded = await fileService.loadMany(input.fileIds, userRow.id);
      for (const f of loaded) {
        try {
          const parsed = await parseFileForPrompt(f.buffer, f.row.filename, f.row.mimetype);
          attachmentBlocks.push(...parsed.blocks);
        } catch (err) {
          ctx.logger.warn(
            { err: err instanceof Error ? err.message : String(err), fileId: f.row.externalId },
            'tasks.create: file parse failed — skipping',
          );
        }
      }
    }

    // Compute these once — used both by the diagnostic log AND by the
    // gate. Hoisting them up avoids re-classifying the intent twice.
    const isSimpleSearchIntent = classifyAsSimpleSearch(input.intent);
    /**
     * Per-user pool fast lane: when the global headless singleton is
     * dead but this user has (or can spawn) their own pool slot, we
     * can still run supercar — the per-user Brave is functionally
     * equivalent to the singleton from runSupercarTask's view. Sync
     * `canAllocate` peek; the actual `allocate` happens inside the
     * branch and may fail under race (Brave crash mid-spawn). When
     * it does, primaryExecutor stays null and runSupercarTask's null
     * guard fails the task gracefully — the gate doesn't have to
     * second-guess. Without this condition, every PRD / 笔记 / 分析
     * task fell through to vision-loop the moment the singleton
     * crashed, defeating Phase 8 + Phase 10 entirely.
     */
    const browserPoolEligible = Boolean(
      ctx.browserPool && shouldUseBrowserPool(ctx.userId) && ctx.browserPool.canAllocate(),
    );

    // ===== image-mode fork (sprint #5 — nano banana) =====
    // 文生图 / 图生图 tasks: classify NB2 vs Pro, call Gemini, persist
    // each PNG to R2, surface as FileDownloadCard via
    // result.metadata.attachments. No agent loop, no pool slot, no
    // verifier — a single outbound API call that produces a file.
    //
    // Gated on GEMINI_API_KEY (mirrors FIRECRAWL_API_KEY gating scrape):
    // when the key is unset the image intent falls through to the
    // generate lane below, so deploying before the key is provisioned
    // is a no-op for users instead of a "未配置" error on every 画图 ask.
    if (executionMode === 'image' && appEnv.GEMINI_API_KEY) {
      const taskId = newExternalId('task');
      const repo = new TaskRepository(ctx.db);

      await repo.insertTask(
        {
          taskId,
          status: 'executing',
          plan: [],
          cursor: 0,
          pendingConfirm: null,
        },
        {
          userId: userRow.id,
          intent: input.intent,
          roleId: dispatchRoleId,
          opusUsed: false,
        },
      );

      ctx.logger.info(
        { taskId, userId: ctx.userId, executorLane: 'image', executionMode },
        'task: executor lane selected',
      );
      broadcastSubStatus(ctx.userId, taskId, 'generating_image');

      // Input images (图生图 / edit) come from the user's uploaded
      // attachments, already parsed into base64 image content blocks.
      const inputImages: Array<{ data: string; mimeType: string }> = [];
      for (const b of attachmentBlocks) {
        if (b.type === 'image' && b.source.type === 'base64') {
          inputImages.push({ data: b.source.data, mimeType: b.source.media_type });
        }
      }

      const imageStartedAt = Date.now();
      void (async () => {
        const taskInternalId = await taskInternalIdFor(ctx.db, taskId);
        let result: RunImageTaskResult;
        if (taskInternalId == null) {
          result = {
            status: 'failed',
            summary: '',
            reason: '任务记录丢失，请重试。',
            attachments: [],
          };
        } else {
          const save = async (
            img: { buffer: Buffer; mimeType: string },
            index: number,
          ): Promise<ImageAttachment> => {
            if (img.buffer.length > MAX_DOWNLOAD_BYTES) {
              throw new Error(
                `generated image too large (${img.buffer.length} bytes > ${MAX_DOWNLOAD_BYTES} cap)`,
              );
            }
            const ext =
              img.mimeType === 'image/jpeg'
                ? 'jpg'
                : img.mimeType === 'image/webp'
                  ? 'webp'
                  : img.mimeType === 'image/gif'
                    ? 'gif'
                    : 'png';
            const filename = `holaday-image-${index + 1}.${ext}`;
            if (ctx.downloadManager) {
              const saved = await ctx.downloadManager.save({
                userIdInternal: userRow.id,
                userExternalId: ctx.userId,
                taskIdInternal: taskInternalId,
                content: img.buffer,
                filename,
                mimetype: img.mimeType,
              });
              return {
                fileId: saved.fileId,
                downloadUrl: saved.downloadUrl,
                filename: saved.filename,
                mimetype: saved.mimetype,
                sizeBytes: saved.sizeBytes,
                expiresAt: saved.expiresAt.toISOString(),
                kind: 'output',
              };
            }
            const stored = await fileService.storeOutput({
              userIdInternal: userRow.id,
              userExternalId: ctx.userId,
              taskIdInternal: taskInternalId,
              filename,
              mimetype: img.mimeType,
              buffer: img.buffer,
            });
            return {
              fileId: stored.externalId,
              downloadUrl: `/api/files/${stored.externalId}/download`,
              filename: stored.filename,
              mimetype: stored.mimetype,
              sizeBytes: Number(stored.sizeBytes),
              expiresAt: stored.expiresAt
                ? stored.expiresAt.toISOString()
                : new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
              kind: 'output',
            };
          };

          result = await runImageTask({
            intent: input.intent,
            ...(inputImages.length > 0 ? { inputImages } : {}),
            ...(input.imageOptions?.aspectRatio
              ? { aspectRatio: input.imageOptions.aspectRatio }
              : {}),
            ...(input.imageOptions?.imageCount
              ? { imageCount: input.imageOptions.imageCount as 1 | 2 | 3 | 4 }
              : {}),
            apiKey: appEnv.GEMINI_API_KEY,
            baseUrl: appEnv.GEMINI_BASE_URL,
            flashModel: appEnv.GEMINI_IMAGE_MODEL,
            proModel: appEnv.GEMINI_IMAGE_MODEL_PRO,
            ...(input.imageOptions?.model
              ? {
                  preferredTier:
                    input.imageOptions.model === 'nano_banana_pro'
                      ? ('pro' as const)
                      : ('flash' as const),
                }
              : {}),
            save,
            logger: ctx.logger,
          });
        }

        const metadata = {
          executionMode: 'image' as const,
          finalExecutionMode: 'image' as const,
          model: result.model ?? null,
          imageTier: result.tier ?? null,
          ...(input.imageOptions ? { imageOptions: input.imageOptions } : {}),
          elapsedMs: Date.now() - imageStartedAt,
          ...(result.attachments.length > 0 ? { attachments: result.attachments } : {}),
        };

        ctx.logger.info(
          {
            taskId,
            userId: ctx.userId,
            runnerStatus: result.status,
            model: result.model ?? null,
            imageCount: result.attachments.length,
          },
          'task:completed',
        );

        let imagePersisted = false;
        try {
          if (result.status === 'completed') {
            const persisted = await repo.persistVisionOutcome(taskId, {
              status: 'completed',
              summary: result.summary,
              tickCount: 1,
              metadata,
            });
            imagePersisted = persisted.persisted;
          } else {
            const persisted = await repo.persistVisionOutcome(taskId, {
              status: 'failed',
              reason: result.reason ?? '图片生成失败，请稍后重试。',
              tickCount: 1,
              metadata,
            });
            imagePersisted = persisted.persisted;
          }
        } catch (err) {
          ctx.logger.error({ err, taskId }, 'image: persist failed');
        }

        try {
          if (imagePersisted && result.status === 'completed') {
            broadcastToUser(ctx.userId, {
              type: 'server.task.terminal',
              taskId,
              status: 'completed',
              ...(result.summary ? { summary: result.summary } : {}),
              // P1 timing fix: ship attachments ON the terminal frame so
              // the SPA renders the image card WITH the summary text
              // instead of after a separate tasks.detail round-trip
              // (was: text "已生成1张图片" first, thumbnail seconds later).
              ...(result.attachments.length > 0 ? { attachments: result.attachments } : {}),
            });
          } else if (imagePersisted) {
            broadcastToUser(ctx.userId, {
              type: 'server.task.terminal',
              taskId,
              status: 'failed',
              ...(result.reason ? { reason: result.reason } : {}),
            });
          }
        } catch (err) {
          ctx.logger.warn({ err, taskId }, 'image: broadcast terminal failed');
        }
      })();

      return {
        taskId,
        status: 'executing' as const,
        steps: [],
        executionMode: 'image' as const,
      };
    }
    // ===== end image-mode fork =====

    // ===== video-creation fork (Phase 1 #4 原方案, flag + allowlist 灰度) =====
    // 两段式:Phase1 出 awaiting_user 报价卡(只跑 optimize=LLM,零 Veo);确认走
    // tasks.confirmVideo(结构化按钮)。Veo 烧钱严格在 confirmVideo 的原子抢占之后。
    // 默认 VIDEO_CREATION_ENABLED=false → video 意图落通用 generate(诚实说不能出视频)。
    {
      const videoAllowed =
        VIDEO_CREATION_ALLOWLIST.size === 0 || VIDEO_CREATION_ALLOWLIST.has(ctx.userId);
      // 视频意图:分类器命中 video_creation,或选了 video-creator 技能,**或**前端「视频任务」
      // 界面显式带了 videoOptions.tab(普通/宠物/IP)。后者是关键——宠物动作 prompt / IP 口播文案
      // 本身不含「视频」关键词,分类器会判 generate;只有 videoOptions.tab 这个显式信号能可靠把
      // 三类 tab 提交都送进视频 fork(只有视频界面会设它,其它 createTask 路径绝不带)。
      const videoIntent =
        executionMode === 'video_creation' ||
        input.roleId === 'video-creator' ||
        input.videoOptions?.tab !== undefined;
      if (appEnv.VIDEO_CREATION_ENABLED && videoIntent && videoAllowed && anthropicForResolver) {
        const anthropicClient = anthropicForResolver;
        const { buildFallbackVideoScript, optimizeUserScript, segmentCapForText } = await import(
          '../../agent/video/video-script.js'
        );
        // Phase 2 第一期 — SPA「普通视频」面板把模型档/风格/画幅/画质/时长带上来。
        const vOpts = input.videoOptions ?? {};

        // ===== 复刻视频 — Wan Animate 2.2 真实角色替换 =====
        // 主角图片 + 参考视频均以独立 typed fileId 保存；确认后再签短期 URL
        // 调用 character-swap。没有参考视频时绝不降级为单图 i2v。
        if (vOpts.tab === 'pet') {
          if (!vOpts.petImageFileId || !vOpts.referenceVideoFileId) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: '复刻视频需要主角照片和参考视频。',
            });
          }
          const [imageReachable, videoReachable] = await Promise.all([
            fileService.signedReadUrl(vOpts.petImageFileId, userRow.id, 60),
            fileService.signedReadUrl(vOpts.referenceVideoFileId, userRow.id, 60),
          ]);
          if (!imageReachable || !videoReachable) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: '主角照片或参考视频不可用，请重新上传。',
            });
          }
          let measuredDurationSeconds: number;
          try {
            measuredDurationSeconds = await probeCloneReferenceDurationSeconds(videoReachable);
          } catch {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: '参考视频无法读取，或时长不在 2 到 30 秒之间，请重新上传。',
            });
          }
          const cloneMode: WanAnimateMixMode = vOpts.cloneMode ?? 'wan-std';
          const cloneQuote = quoteCloneVideo(measuredDurationSeconds, cloneMode);
          const taskId = newExternalId('task');
          const repo = new TaskRepository(ctx.db);
          await repo.insertTask(
            { taskId, status: 'awaiting_user', plan: [], cursor: 0, pendingConfirm: null },
            { userId: userRow.id, intent: input.intent, roleId: 'video-creator', opusUsed: false },
          );
          const initialized = await repo.persistInitialAwaitingUser({
            taskExternalId: taskId,
            question: cloneQuote.message,
            awaitingKind: 'video_quote',
            result: {
              summary: cloneQuote.message,
              metadata: {
                lane: 'video_creation_confirm',
                petImageFileId: vOpts.petImageFileId,
                referenceVideoFileId: vOpts.referenceVideoFileId,
                referenceVideoDurationSeconds: measuredDurationSeconds,
                cloneMode,
                videoOptions: vOpts,
              },
            },
          });
          if (!initialized.persisted) {
            throw new TRPCError({
              code: 'INTERNAL_SERVER_ERROR',
              message: '视频报价任务初始化失败，请重试。',
            });
          }
          ctx.logger.info(
            {
              taskId,
              userId: ctx.userId,
              executorLane: 'video_creation_confirm',
              cloneMode,
              videoCny: cloneQuote.videoCny,
            },
            'task: executor lane selected (clone video)',
          );
          broadcastToUser(ctx.userId, {
            type: 'server.supercar.awaiting_user',
            taskId,
            question: cloneQuote.message,
            awaitingKind: 'video_quote',
          });
          return {
            taskId,
            status: 'awaiting_user' as const,
            steps: [],
            executionMode: 'generate' as const,
          };
        }
        // ===== end 复刻视频分支 =====

        // ===== IP 人物 换口型分支 (Phase 2 第三期, B 架构单 clip 口播) =====
        // 门控:三件齐(克隆声音 + 出镜底版 + 本人授权)才放行;缺则引导去 onboarding。
        // 无 optimize 多段那套:全文案直接 quoteIpVideo → 报价卡 → confirmVideo 跑 B lane。
        if (vOpts.tab === 'ip_person') {
          const ipReady =
            !!userRow.qwenVoiceId &&
            !!userRow.baseVideoFileId &&
            !!userRow.videoSelfUseAuthorizedAt;
          if (!ipReady) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: '请先在「视频任务 → IP 人物」完成素材准备(本人授权 + 声音 + 出镜底版)。',
            });
          }
          const ipQuote = quoteIpVideo(input.intent);
          const taskId = newExternalId('task');
          const repo = new TaskRepository(ctx.db);
          await repo.insertTask(
            { taskId, status: 'awaiting_user', plan: [], cursor: 0, pendingConfirm: null },
            { userId: userRow.id, intent: input.intent, roleId: 'video-creator', opusUsed: false },
          );
          const initialized = await repo.persistInitialAwaitingUser({
            taskExternalId: taskId,
            question: ipQuote.message,
            awaitingKind: 'video_quote',
            result: {
              summary: ipQuote.message,
              metadata: {
                lane: 'video_creation_confirm',
                ipCopyText: input.intent,
                videoOptions: vOpts,
              },
            },
          });
          if (!initialized.persisted) {
            throw new TRPCError({
              code: 'INTERNAL_SERVER_ERROR',
              message: '视频报价任务初始化失败，请重试。',
            });
          }
          ctx.logger.info(
            {
              taskId,
              userId: ctx.userId,
              executorLane: 'video_creation_confirm',
              ipChars: ipQuote.chars,
              videoCny: ipQuote.videoCny,
            },
            'task: executor lane selected (ip lip-sync)',
          );
          broadcastToUser(ctx.userId, {
            type: 'server.supercar.awaiting_user',
            taskId,
            question: ipQuote.message,
            awaitingKind: 'video_quote',
          });
          return {
            taskId,
            status: 'awaiting_user' as const,
            steps: [],
            executionMode: 'generate' as const,
          };
        }
        // ===== end IP 人物分支 =====

        const style = vOpts.style as VideoStyle | undefined;
        const tier: VideoSource = vOpts.model ?? 'veo_fast';
        if (
          videoParameterIssue({
            model: tier,
            resolution: vOpts.resolution ?? '1080p',
            durationSeconds: vOpts.durationSeconds ?? 8,
          })
        ) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Veo 1080p 仅支持 8 秒，请选择 8 秒或改用 720p 标清。',
          });
        }
        let script: VideoScript | null = null;
        try {
          // optimize = LLM(~¥0.01),**非 Veo**。出真实段数以便动态报价;风格只调画面语气。
          // 段数按文案内容量定上限(segmentCapForText):一句话→1~2 段,长文案→6 段。
          // 避免短文案被硬凑成 6 段 48s、报价虚高(quoteVideo = 段数 × 每段秒数)。
          const segCap = segmentCapForText(input.intent);
          script = await optimizeUserScript(
            { userText: input.intent, maxSegments: segCap, ...(style ? { style } : {}) },
            {
              llm: async ({ system, user }) => {
                const resp = await anthropicClient.messages.create({
                  model: VIDEO_SCRIPT_MODEL,
                  max_tokens: 2000,
                  system,
                  messages: [{ role: 'user', content: user }],
                });
                const b = resp.content[0];
                return b && b.type === 'text' ? b.text : '';
              },
            },
          );
        } catch (err) {
          ctx.logger.warn(
            { err, userId: ctx.userId },
            'video_creation: optimize(报价前) failed — using faithful single-segment fallback',
          );
          script = buildFallbackVideoScript(input.intent);
        }
        if (script) {
          const quote = quoteVideo(script.segments.length, tier, {
            ...(vOpts.resolution ? { resolution: vOpts.resolution } : {}),
            ...(vOpts.durationSeconds ? { durationSeconds: vOpts.durationSeconds } : {}),
            ...(vOpts.aspectRatio ? { aspectRatio: vOpts.aspectRatio } : {}),
          });
          const taskId = newExternalId('task');
          const repo = new TaskRepository(ctx.db);
          await repo.insertTask(
            { taskId, status: 'awaiting_user', plan: [], cursor: 0, pendingConfirm: null },
            { userId: userRow.id, intent: input.intent, roleId: 'video-creator', opusUsed: false },
          );
          // Initial awaiting_user quote: stamp awaitingKind/result and
          // write the matching task.awaiting_user event in one repository call.
          // result.metadata 存 videoScript(确认后复用,保证段数=报价段数)+ lane(给
          // consumeVideoConfirm 原子抢占识别)。
          const initialized = await repo.persistInitialAwaitingUser({
            taskExternalId: taskId,
            question: quote.message,
            awaitingKind: 'video_quote',
            result: {
              summary: quote.message,
              metadata: {
                lane: 'video_creation_confirm',
                videoScript: script,
                videoTier: tier,
                videoOptions: vOpts,
              },
            },
          });
          if (!initialized.persisted) {
            throw new TRPCError({
              code: 'INTERNAL_SERVER_ERROR',
              message: '视频报价任务初始化失败，请重试。',
            });
          }
          ctx.logger.info(
            {
              taskId,
              userId: ctx.userId,
              executorLane: 'video_creation_confirm',
              segs: script.segments.length,
              videoCny: quote.videoCny,
            },
            'task: executor lane selected',
          );
          broadcastToUser(ctx.userId, {
            type: 'server.supercar.awaiting_user',
            taskId,
            question: quote.message,
            awaitingKind: 'video_quote',
          });
          return {
            taskId,
            status: 'awaiting_user' as const,
            steps: [],
            executionMode: 'generate' as const,
          };
        }
      }
    }
    // ===== end video-creation fork =====

    // ===== a-share 即时问答 fork (Phase 1 #2 ④, flag + allowlist 灰度) =====
    // 命中 a-share 个股问答 → 自取数组装确定性事实卡 → LLM③解读 → 合规闸门
    // （越线降级纯数据 + 打日志计数）→ 直接完成任务。镜像 template-fill lane：
    // 无 agent loop、无 pool slot、背景 async 出答案后 persist + 广播 terminal。
    // 默认 ASHARE_QA_ENABLED=false：关时落通用 generate 路径，零副作用。
    // BOSS 拍板门控（持久启用式 + signal-based）：**启用** a-share 技能（users.selectedSkills）
    // 或显式选技能（skillId/roleId/gatedRole）= 上下文内。上下文内**命中任一 A股信号**（个股
    // 解析成功 / A股术语 / 持仓语境词 / 自选股整体问）→ 进合规框架（lane 或引导兜底）；**完全无
    // A股信号**（如「帮我写周报」）→ 放行通用路径，不误拦。per-task 选择器(发 skillId)记 backlog。
    const ashareSkillEnabled = normalizeSkillIds(userRow.selectedSkills).some((id) =>
      ASHARE_SKILL_IDS.has(id),
    );
    const ashareContext =
      ashareSkillEnabled ||
      (taskSkillId ? ASHARE_SKILL_IDS.has(taskSkillId) : false) ||
      ASHARE_SKILL_IDS.has(gatedRole);
    // Cross-session guard (#1 session, 2026-06-13, see SESSION_STATUS): only
    // enter the a-share QA lane for GENERIC info intents — a dedicated lane the
    // classifier already chose (template_fill / image / browser) must win, or
    // the matcher hijacks it (bug: "按这个周报模板填充…" → answered as stock 600415).
    // widen（BOSS 批准，④ 验收关闭）：ASHARE_QA_ALLOWLIST 为空 = 全量用户可用（flag on）；
    // 非空 = 仅名单内（灰度）。
    const ashareQaAllowed = ASHARE_QA_ALLOWLIST.size === 0 || ASHARE_QA_ALLOWLIST.has(ctx.userId);
    if (
      appEnv.ASHARE_QA_ENABLED &&
      ashareQaHandlesMode(executionMode) &&
      anthropicForResolver &&
      ashareQaAllowed
    ) {
      const { resolveAshareQa, resolveAshareInContext } = await import(
        '../../agent/a-share/ashare-qa-matcher.js'
      );
      const { HttpAkshareClient } = await import('../../agent/a-share/akshare-http-client.js');
      const { listWatchlistForUser } = await import('../../agent/a-share/briefing-service.js');
      const wl = await listWatchlistForUser(ctx.db, userRow.id);
      const watchlist = wl.map((w) => ({ symbol: w.symbol, displayName: w.displayName }));
      const aksClient = new HttpAkshareClient({
        baseUrl: process.env.AKSHARE_HTTP_URL ?? 'http://127.0.0.1:8848',
        logger: ctx.logger,
      });
      const searchFn = async (q: string) => {
        const env = await aksClient.searchSymbol(q);
        return (env.data ?? [])
          .map((r) => ({
            symbol: String(r.code ?? ''),
            displayName: r.name != null ? String(r.name) : null,
          }))
          .filter((s) => s.symbol);
      };
      let ashareQaMatch: Awaited<ReturnType<typeof resolveAshareQa>> = null;
      let guidanceNeeded = false;
      let indexIntent = false;
      if (ashareContext) {
        // 上下文内：命中个股 → 个股 lane；指数/大盘问句 → 指数 lane；命中信号但无个股/非
        // 指数 → 引导兜底；无信号 → 放行通用。
        const r = await resolveAshareInContext(
          { intent: input.intent, watchlist, now: new Date() },
          searchFn,
        );
        ashareQaMatch = r.match;
        indexIntent = r.indexIntent;
        guidanceNeeded = !r.match && !r.indexIntent && r.hasSignal;
      } else {
        // 非上下文（未启用/未选技能）：强信号(术语+个股)出 lane，否则放行（无引导兜底）。
        ashareQaMatch = await resolveAshareQa(
          {
            intent: input.intent,
            roleId: taskSkillId ?? null,
            watchlist,
            now: new Date(),
          },
          searchFn,
        );
      }
      if (ashareQaMatch) {
        const taskId = newExternalId('task');
        const repo = new TaskRepository(ctx.db);
        await repo.insertTask(
          { taskId, status: 'executing', plan: [], cursor: 0, pendingConfirm: null },
          {
            userId: userRow.id,
            intent: input.intent,
            roleId: dispatchRoleId,
            opusUsed: false,
          },
        );
        ctx.logger.info(
          {
            taskId,
            userId: ctx.userId,
            executorLane: ashareQaMatch.deep ? 'ashare_panorama' : 'ashare_qa',
            kind: ashareQaMatch.kind,
            stocks: ashareQaMatch.stocks.map((s) => s.symbol),
          },
          'task: executor lane selected',
        );
        broadcastSubStatus(ctx.userId, taskId, 'generating');

        const anthropicClient = anthropicForResolver;
        const qaModel = appEnv.ASHARE_QA_MODEL;
        void (async () => {
          const { runAshareQa, runAsharePanorama } = await import(
            '../../agent/a-share/ashare-qa-runner.js'
          );
          // 技能 markdown（人设/红线）→ DB skills.manifest.body；缺则内置兜底人设
          // （合规硬约束已在 runner 的 system prompt，故缺 markdown 也安全）。
          let skillMarkdown: string | null = null;
          try {
            const { skills } = await import('../../db/schema/skills.js');
            const [row] = await ctx.db
              .select({ manifest: skills.manifest })
              .from(skills)
              .where(inArray(skills.slug, Array.from(ASHARE_SKILL_IDS)))
              .limit(1);
            const body = (row?.manifest as { body?: unknown } | null)?.body;
            if (typeof body === 'string' && body.trim()) skillMarkdown = body;
          } catch (err) {
            ctx.logger.warn({ err, taskId }, 'ashare-qa: 技能 markdown 读取失败，用兜底人设');
          }
          const FALLBACK_PERSONA =
            '你是严谨的 A股信息分析助手：只聚合公开信息、客观陈述事实，绝不荐股、不预测涨跌、不给买卖或择时建议。';
          let answer: string;
          let terminalStatus: 'completed' | 'failed' = 'completed';
          try {
            // deep 意图（详细分析/全面看看）→ 七维全景版（含 ④基本面⑤估值 + ⑦分析师视角）；
            // 否则轻量速览（①②③ + ③解读）。⑦ prompt 自含人设，不依赖 skillMarkdown。
            const runner = ashareQaMatch.deep ? runAsharePanorama : runAshareQa;
            const r = await runner(
              {
                client: aksClient,
                skillMarkdown: skillMarkdown ?? FALLBACK_PERSONA,
                interpret: async ({ system, user }) => {
                  const resp = await anthropicClient.messages.create({
                    model: qaModel,
                    max_tokens: 700,
                    // 低温：③/⑦ 更忠实照抄数字（降低 ungrounded 误降级），措辞仍自然。
                    temperature: 0.3,
                    system,
                    messages: [{ role: 'user', content: user }],
                  });
                  const block = resp.content[0];
                  return block && block.type === 'text' ? block.text : '';
                },
                // Phase2 ⑦ 意图判官（第二层，flag 控制）：温度0 求确定性（同股同文同判，治"时好时降级"）。
                judge: appEnv.ASHARE_INTENT_JUDGE_ENABLED
                  ? async ({ system, user }) => {
                      const resp = await anthropicClient.messages.create({
                        model: qaModel,
                        max_tokens: 160,
                        temperature: 0,
                        system,
                        messages: [{ role: 'user', content: user }],
                      });
                      const block = resp.content[0];
                      return block && block.type === 'text' ? block.text : '';
                    }
                  : undefined,
                // Phase 2「看懂层」P1：腿A 逐指标注解开关（默认 OFF，零新增 LLM）。
                seethrough: appEnv.ASHARE_SEETHROUGH_ENABLED,
                // ④ 风险信号雷达 P1：腿A 确定性检测开关（默认 OFF，零新增 LLM）。
                riskRadar: appEnv.ASHARE_RISK_RADAR_ENABLED,
                // P3 F 走势组 P1：腿A K线波动总结开关（默认 OFF，零新增 LLM）。
                perfTrend: appEnv.ASHARE_PERF_TREND_ENABLED,
                logger: ctx.logger,
                now: new Date(),
                context: { userId: ctx.userId, taskId },
              },
              ashareQaMatch,
            );
            answer = r.answer;
            ctx.logger.info(
              { taskId, degraded: r.degraded, reason: r.reason, interpreted: r.interpreted },
              'ashare-qa: lane done',
            );
          } catch (err) {
            ctx.logger.error({ err, taskId }, 'ashare-qa: lane failed');
            answer = '抱歉，A股问答处理失败，请稍后重试。';
            terminalStatus = 'failed';
          }
          try {
            let asharePersisted = false;
            const taskInternalId = await taskInternalIdFor(ctx.db, taskId);
            if (taskInternalId != null) {
              if (terminalStatus === 'completed') {
                const persisted = await repo.persistVisionOutcome(taskId, {
                  status: 'completed',
                  summary: answer,
                  tickCount: 1,
                  metadata: { executionMode: 'generate', lane: 'ashare_qa' },
                });
                asharePersisted = persisted.persisted;
              } else {
                const persisted = await repo.persistVisionOutcome(taskId, {
                  status: 'failed',
                  reason: answer,
                  tickCount: 1,
                  metadata: { executionMode: 'generate', lane: 'ashare_qa' },
                });
                asharePersisted = persisted.persisted;
              }
            }
            if (asharePersisted && terminalStatus === 'completed') {
              broadcastToUser(ctx.userId, {
                type: 'server.task.terminal',
                taskId,
                status: 'completed',
                summary: answer,
              });
            } else if (asharePersisted) {
              broadcastToUser(ctx.userId, {
                type: 'server.task.terminal',
                taskId,
                status: 'failed',
                reason: answer,
              });
            }
          } catch (err) {
            ctx.logger.error({ err, taskId }, 'ashare-qa: persist/broadcast failed');
          }
        })();

        return {
          taskId,
          status: 'executing' as const,
          steps: [],
          executionMode: 'generate' as const,
        };
      }
      // 指数 lane（E16）：「查今天A股三大指数收盘 / 大盘怎么样」类指数/大盘问句 → 确定性
      // 三大指数速览卡（无 LLM、无闸门），不进个股 lane（防普通词 name-search 误命中个股）。
      if (indexIntent) {
        const { buildIndexCard } = await import('../../agent/a-share/ashare-fact-card.js');
        const taskId = newExternalId('task');
        const repo = new TaskRepository(ctx.db);
        await repo.insertTask(
          { taskId, status: 'executing', plan: [], cursor: 0, pendingConfirm: null },
          {
            userId: userRow.id,
            intent: input.intent,
            roleId: dispatchRoleId,
            opusUsed: false,
          },
        );
        ctx.logger.info(
          { taskId, userId: ctx.userId, executorLane: 'ashare_index' },
          'task: executor lane selected',
        );
        broadcastSubStatus(ctx.userId, taskId, 'generating');
        void (async () => {
          let answer: string;
          let terminalStatus: 'completed' | 'failed' = 'completed';
          try {
            answer = await buildIndexCard({ client: aksClient, now: new Date() });
          } catch (err) {
            ctx.logger.error({ err, taskId }, 'ashare-index: lane failed');
            answer = '抱歉，A股大盘指数查询处理失败，请稍后重试。';
            terminalStatus = 'failed';
          }
          try {
            let indexPersisted = false;
            const taskInternalId = await taskInternalIdFor(ctx.db, taskId);
            if (taskInternalId != null) {
              if (terminalStatus === 'completed') {
                const persisted = await repo.persistVisionOutcome(taskId, {
                  status: 'completed',
                  summary: answer,
                  tickCount: 1,
                  metadata: { executionMode: 'generate', lane: 'ashare_index' },
                });
                indexPersisted = persisted.persisted;
              } else {
                const persisted = await repo.persistVisionOutcome(taskId, {
                  status: 'failed',
                  reason: answer,
                  tickCount: 1,
                  metadata: { executionMode: 'generate', lane: 'ashare_index' },
                });
                indexPersisted = persisted.persisted;
              }
            }
            if (indexPersisted && terminalStatus === 'completed') {
              broadcastToUser(ctx.userId, {
                type: 'server.task.terminal',
                taskId,
                status: 'completed',
                summary: answer,
              });
            } else if (indexPersisted) {
              broadcastToUser(ctx.userId, {
                type: 'server.task.terminal',
                taskId,
                status: 'failed',
                reason: answer,
              });
            }
          } catch (err) {
            ctx.logger.error({ err, taskId }, 'ashare-index: persist/broadcast failed');
          }
        })();
        return {
          taskId,
          status: 'executing' as const,
          steps: [],
          executionMode: 'generate' as const,
        };
      }
      // P0 兜底（BOSS 要求①）：上下文内命中 A股信号（持仓语境词/术语）但没解析出个股 →
      // 静态引导话术，**绝不落通用 LLM**。无 A股信号的问句 guidanceNeeded=false，正常放行
      // 通用路径（如「帮我写周报」不误拦）。
      if (guidanceNeeded) {
        const { ASHARE_QA_GUIDANCE } = await import('../../agent/a-share/ashare-qa-runner.js');
        const taskId = newExternalId('task');
        const repo = new TaskRepository(ctx.db);
        await repo.insertTask(
          { taskId, status: 'executing', plan: [], cursor: 0, pendingConfirm: null },
          {
            userId: userRow.id,
            intent: input.intent,
            roleId: dispatchRoleId,
            opusUsed: false,
          },
        );
        ctx.logger.info(
          { taskId, userId: ctx.userId, executorLane: 'ashare_qa_guidance' },
          'task: executor lane selected',
        );
        void (async () => {
          try {
            let guidancePersisted = false;
            const taskInternalId = await taskInternalIdFor(ctx.db, taskId);
            if (taskInternalId != null) {
              const persisted = await repo.persistVisionOutcome(taskId, {
                status: 'completed',
                summary: ASHARE_QA_GUIDANCE,
                tickCount: 1,
                metadata: { executionMode: 'generate', lane: 'ashare_qa_guidance' },
              });
              guidancePersisted = persisted.persisted;
            }
            if (guidancePersisted) {
              broadcastToUser(ctx.userId, {
                type: 'server.task.terminal',
                taskId,
                status: 'completed',
                summary: ASHARE_QA_GUIDANCE,
              });
            }
          } catch (err) {
            ctx.logger.error({ err, taskId }, 'ashare-qa-guidance: persist/broadcast failed');
          }
        })();
        return {
          taskId,
          status: 'executing' as const,
          steps: [],
          executionMode: 'generate' as const,
        };
      }
    }
    // ===== end a-share QA fork =====

    // ===== template-fill fork (Phase 1 #1) =====
    // Fill a user-uploaded Office template (docx/xlsx) deterministically
    // and return the filled file. Mirrors the image fork: no agent loop,
    // no pool slot, no verifier — safety check + extract placeholders +
    // ONE constrained model mapping call + engine fill + storeOutput →
    // FileDownloadCard via result.metadata.attachments.
    //
    // Gated on TEMPLATE_FILL_ENABLED (mirrors GEMINI_API_KEY gating the
    // image lane): when the flag is off, template_fill intents fall
    // through to the generate lane below, where the model honestly says
    // it cannot fill the user's file — so shipping before the feature is
    // vetted is a no-op for users instead of a broken lane.
    if (executionMode === 'template_fill' && appEnv.TEMPLATE_FILL_ENABLED && anthropicForResolver) {
      const taskId = newExternalId('task');
      const repo = new TaskRepository(ctx.db);

      await repo.insertTask(
        {
          taskId,
          status: 'executing',
          plan: [],
          cursor: 0,
          pendingConfirm: null,
        },
        {
          userId: userRow.id,
          intent: input.intent,
          roleId: dispatchRoleId,
          opusUsed: false,
        },
      );

      ctx.logger.info(
        { taskId, userId: ctx.userId, executorLane: 'template_fill', executionMode },
        'task: executor lane selected',
      );
      broadcastSubStatus(ctx.userId, taskId, 'generating');

      const anthropicClient = anthropicForResolver;
      const templateModel = appEnv.TEMPLATE_FILL_MODEL;
      const templateStartedAt = Date.now();
      const fileIds = input.fileIds ?? [];
      void (async () => {
        const taskInternalId = await taskInternalIdFor(ctx.db, taskId);
        let result: RunTemplateFillResult;
        if (taskInternalId == null) {
          result = {
            status: 'failed',
            summary: '',
            reason: '任务记录丢失，请重试。',
            attachments: [],
          };
        } else {
          // Re-load the uploaded files for RAW bytes — the shared
          // attachmentBlocks above are parsed-for-prompt, not raw. The
          // template is the first Office file (docx preferred); any other
          // file (csv/xlsx/json) is parsed to text as the data source.
          let template: { buffer: Buffer; filename: string; mimetype: string } | undefined;
          const dataTexts: string[] = [];
          if (fileIds.length > 0) {
            const loaded = await fileService.loadMany(fileIds, userRow.id);
            const isOffice = (name: string, mime: string): boolean =>
              /\.(?:docx|xlsx)$/i.test(name) ||
              /wordprocessingml\.document|spreadsheetml\.sheet/i.test(mime);
            const isDocx = (name: string, mime: string): boolean =>
              /\.docx$/i.test(name) || /wordprocessingml\.document/i.test(mime);
            const officeFiles = loaded.filter((f) => isOffice(f.row.filename, f.row.mimetype));
            const tpl =
              officeFiles.find((f) => isDocx(f.row.filename, f.row.mimetype)) ?? officeFiles[0];
            if (tpl) {
              template = {
                buffer: tpl.buffer,
                filename: tpl.row.filename,
                mimetype: tpl.row.mimetype,
              };
            }
            for (const f of loaded) {
              if (tpl && f === tpl) continue;
              try {
                const parsed = await parseFileForPrompt(f.buffer, f.row.filename, f.row.mimetype);
                for (const b of parsed.blocks) {
                  if (b.type === 'text') dataTexts.push(b.text);
                }
              } catch (err) {
                ctx.logger.warn(
                  { err: err instanceof Error ? err.message : String(err) },
                  'template-fill: data file parse failed — skipping',
                );
              }
            }
          }

          const save = async (out: {
            buffer: Buffer;
            filename: string;
            mimetype: string;
          }): Promise<TemplateAttachment> => {
            const stored = await fileService.storeOutput({
              userIdInternal: userRow.id,
              userExternalId: ctx.userId,
              taskIdInternal: taskInternalId,
              filename: out.filename,
              mimetype: out.mimetype,
              buffer: out.buffer,
            });
            return {
              fileId: stored.externalId,
              downloadUrl: `/api/files/${stored.externalId}/download`,
              filename: stored.filename,
              mimetype: stored.mimetype,
              sizeBytes: Number(stored.sizeBytes),
              expiresAt: stored.expiresAt
                ? stored.expiresAt.toISOString()
                : new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
              kind: 'output',
            };
          };

          const model = async (req: {
            system: string;
            user: string;
          }): Promise<string> => {
            const resp = await anthropicClient.messages.create({
              model: templateModel,
              max_tokens: 8192,
              system: req.system,
              messages: [{ role: 'user', content: req.user }],
            });
            let text = '';
            for (const block of resp.content) {
              if (block.type === 'text') text += (text ? '\n' : '') + block.text;
            }
            return text;
          };

          result = await runTemplateFillTask({
            intent: input.intent,
            ...(template ? { template } : {}),
            ...(dataTexts.length > 0 ? { dataText: dataTexts.join('\n\n') } : {}),
            allowedFormats: allowedFormatsForPlan(planId),
            save,
            model,
            logger: ctx.logger,
          });
        }

        const metadata = {
          executionMode: 'template_fill' as const,
          finalExecutionMode: 'template_fill' as const,
          templateFormat: result.format ?? null,
          ...(result.degraded ? { templateDegraded: result.degraded } : {}),
          elapsedMs: Date.now() - templateStartedAt,
          ...(result.attachments.length > 0 ? { attachments: result.attachments } : {}),
        };

        ctx.logger.info(
          {
            taskId,
            userId: ctx.userId,
            runnerStatus: result.status,
            templateFormat: result.format ?? null,
            missingCount: result.missing?.length ?? 0,
          },
          'task:completed',
        );

        let templatePersisted = false;
        let templateAwaitingPersisted = false;
        try {
          if (result.status === 'completed') {
            const persisted = await repo.persistVisionOutcome(taskId, {
              status: 'completed',
              summary: result.summary,
              tickCount: 1,
              metadata,
            });
            templatePersisted = persisted.persisted;
          } else if (result.status === 'partial_success') {
            const persisted = await repo.persistVisionOutcome(taskId, {
              status: 'partial_success',
              summary: result.summary,
              tickCount: 1,
              metadata,
            });
            templatePersisted = persisted.persisted;
          } else if (result.status === 'awaiting_user') {
            // Chat-only clarification (please upload a template) — same
            // shape as the generate-lane intake park.
            const persisted = await repo.persistAwaitingUser({
              taskExternalId: taskId,
              question: result.awaitingQuestion ?? '请补充信息后继续。',
              awaitingKind: 'clarification',
              result: { ...metadata, executionMode: 'template_fill' as const },
            });
            templateAwaitingPersisted = persisted.persisted;
          } else {
            const persisted = await repo.persistVisionOutcome(taskId, {
              status: 'failed',
              reason: result.reason ?? '模板填充失败，请稍后重试。',
              tickCount: 1,
              metadata,
            });
            templatePersisted = persisted.persisted;
          }
        } catch (err) {
          ctx.logger.error({ err, taskId }, 'template-fill: persist failed');
        }

        try {
          if (
            templatePersisted &&
            (result.status === 'completed' || result.status === 'partial_success')
          ) {
            broadcastToUser(ctx.userId, {
              type: 'server.task.terminal',
              taskId,
              status: result.status,
              ...(result.summary ? { summary: result.summary } : {}),
            });
          } else if (result.status === 'awaiting_user' && templateAwaitingPersisted) {
            broadcastToUser(ctx.userId, {
              type: 'server.supercar.awaiting_user',
              taskId,
              question: result.awaitingQuestion ?? '请补充信息后继续。',
              awaitingKind: 'clarification',
            });
          } else if (templatePersisted) {
            broadcastToUser(ctx.userId, {
              type: 'server.task.terminal',
              taskId,
              status: 'failed',
              ...(result.reason ? { reason: result.reason } : {}),
            });
          }
        } catch (err) {
          ctx.logger.warn({ err, taskId }, 'template-fill: broadcast terminal failed');
        }
      })();

      return {
        taskId,
        status: 'executing' as const,
        steps: [],
        executionMode: 'template_fill' as const,
      };
    }
    // ===== end template-fill fork =====

    // ===== Phase 21b — generate-mode fork =====
    // Pure-generation tasks (write a PRD, translate this, summarize that)
    // skip the supercar agent loop entirely. One Anthropic call with
    // web_search available, persists outcome, broadcasts terminal frame,
    // returns immediately. No pool slot, no Playwright, no plan-step
    // state machine. Falls through to the existing supercar branch
    // below for executionMode === 'browser'.
    if (
      (executionMode === 'generate' ||
        executionMode === 'image' ||
        executionMode === 'template_fill') &&
      appEnv.ANTHROPIC_API_KEY &&
      anthropicForResolver
    ) {
      const taskId = newExternalId('task');
      const repo = new TaskRepository(ctx.db);

      await repo.insertTask(
        {
          taskId,
          status: 'executing',
          plan: [],
          cursor: 0,
          pendingConfirm: null,
        },
        {
          userId: userRow.id,
          intent: input.intent,
          roleId: dispatchRoleId,
          opusUsed: opusActuallyConsumed,
        },
      );

      ctx.logger.info(
        { taskId, userId: ctx.userId, executorLane: 'generate', executionMode },
        'task: executor lane selected',
      );

      // Phase 1 Day 5 — initialise execution pipeline. No-op when
      // every feature flag is off (default). When flags are flipped
      // on, this seeds the ledger with the user_input fact and
      // generates the contract for later verification.
      initExecution({
        taskId,
        intent: input.intent,
        executionMode: 'generate',
        expertWorkflowId: typedWorkflow?.workflowId ?? expertWorkflow?.id ?? null,
        hasAttachments: attachmentBlocks.length > 0,
      });
      // Codex Pack B1 — planning chip: contract + ledger seeded, the
      // runner hasn't dispatched yet. Fires once per task, immediately
      // after tasks.create returns to the SPA.
      broadcastSubStatus(ctx.userId, taskId, 'planning');

      // Fire-and-forget — generate doesn't share Brave instances so
      // there's no per-user FIFO queue to enqueue into. Concurrent
      // generate tasks parallelize on the Anthropic API.
      const anthropicClient = anthropicForResolver;
      const generateStartedAt = Date.now();
      void (async () => {
        // A2 deferred — generate→browser fallback would re-enter the
        // supercar branch which needs pool slots, queueing, and a
        // distinct outcome shape. Tracked as fallbackChain=['generate']
        // here for the eval pipeline; if generate fails today, we
        // surface the failure as-is rather than risk the cross-runner
        // re-dispatch.
        const fallbackChain: string[] = ['generate'];
        let outcome;
        try {
          // Codex Pack B1 — generating chip: about to invoke the LLM
          // stream. runGenerateTask emits its own progress markers
          // inside; this prefix marker covers the brief setup gap.
          broadcastSubStatus(ctx.userId, taskId, 'generating');
          outcome = await runGenerateTask({
            taskId,
            userId: ctx.userId,
            // Use effectiveIntent (with parent context block when in
            // a follow-up + workflow preambles) whenever EITHER the
            // legacy or typed matcher fires. Earlier this only checked
            // legacy; P2_CT_008 surfaced the gap — typed-only matches
            // (content-topic / ecom-daily) lost their parent context
            // on follow-up tasks.create with replyToTaskId.
            // Phase 3 R1 (Codex #2): use effectiveIntent (parent
            // context block + workflow preamble prepended) whenever
            // any of:
            //   - legacy matcher fires
            //   - typed matcher fires (or recovered from parent)
            //   - this is a follow-up (replyToTaskId set) — the
            //     parent's outcome is load-bearing context for the
            //     model regardless of whether a workflow matched
            // Otherwise pass the bare user input.
            intent: expertWorkflow || typedWorkflow || isFollowUp ? effectiveIntent : input.intent,
            // Phase 2b — pass the resolved typed workflow so the
            // runner skips its inline matcher (which would re-match
            // against the parent-context-prefixed intent and could
            // pick a different workflow — P2_ED_008 surfaced this
            // when the parent ecom-daily report's summary text
            // happened to contain douyin-review keywords like 诊断).
            workflowOverride: typedWorkflow,
            skillId: dispatchSkillId,
            client: anthropicClient,
            logger: ctx.logger,
            ...(attachmentBlocks.length > 0 ? { attachments: attachmentBlocks } : {}),
            // Phase 24 RC follow-up — stream LLM deltas to the SPA
            // so users see incremental output instead of a blank
            // panel for 30-90s. broadcast errors are swallowed by
            // the runner; we never let WS issues stall the loop.
            onStreamDelta: (delta) => {
              try {
                broadcastToUser(ctx.userId, {
                  type: 'server.task.stream',
                  taskId,
                  delta,
                });
              } catch (err) {
                ctx.logger.warn({ err, taskId }, 'generate: broadcast stream delta failed');
              }
            },
          });
        } catch (err) {
          ctx.logger.error({ err, taskId }, 'generate: runner threw');
          outcome = {
            status: 'failed' as const,
            summary: '',
            reason: err instanceof Error ? err.message : 'generate: unknown error',
            inputTokens: 0,
            outputTokens: 0,
            durationMs: 0,
          };
        }

        // Phase 1 follow-up — sanitise outcome.summary BEFORE the
        // verifier sees it. Tool-XML / base64 / stop-reason fragments
        // that occasionally leak into the model's visible output
        // would otherwise pollute persisted result.summary and the
        // verifier's grounding check (the URL regex inside a
        // base64 blob is not a real URL the user can click).
        if (outcome.status === 'completed' && outcome.summary) {
          const cleaned = sanitizeFinalText(outcome.summary);
          if (cleaned !== outcome.summary) {
            outcome = { ...outcome, summary: cleaned };
          }
        }

        // Phase 1 Day 5 — pipeline verification on the runner's
        // final answer. No-op when EXECUTION_VERIFIER_ENABLED is
        // off; in that case verifiedSummary === outcome.summary
        // and executionVerification === null.
        let executionVerification: VerificationResult | null = null;
        if (outcome.status === 'completed') {
          recordEvidence(taskId, {
            fact: `response_length=${outcome.summary.length}`,
            sourceType: 'tool_result',
            sourceDetail: 'llm_generate_response',
            confidence: 'observed',
          });
          // Codex Pack B1 — verifying chip: deterministic + optional
          // LLM verifier about to run.
          broadcastSubStatus(ctx.userId, taskId, 'verifying');
          const verified: VerifyOutput = await verifyAndFinalize({
            taskId,
            answerText: outcome.summary,
            client: anthropicClient,
            logger: ctx.logger,
          });
          if (verified.finalText !== outcome.summary) {
            outcome = { ...outcome, summary: verified.finalText };
          }
          executionVerification = verified.verification;
        }

        // Codex Pack A3 — derive the terminal status from the runner
        // outcome + verifier verdict. Soft-fail (fixable) becomes
        // partial_success (keeps summary, SPA shows yellow banner);
        // hard-fail becomes failed (with synthesised reason);
        // anything else stays as the runner reported.
        const terminalStatus: FinalTerminalStatus = deriveFinalStatus(
          outcome.status,
          executionVerification,
        );
        const failureSummary =
          terminalStatus === 'failed' && executionVerification
            ? summariseVerificationFailure(executionVerification)
            : null;

        // B3 — structured task:completed log.
        const elapsedMs = Date.now() - generateStartedAt;
        const metadata = {
          executionMode: 'generate' as const,
          finalExecutionMode: 'generate' as const,
          expertWorkflowId: typedWorkflow?.workflowId ?? expertWorkflow?.id ?? null,
          // Codex Pack C1 — user's composer pick. SPA reads this from
          // tasks.detail.result.metadata.expertMode to decide whether
          // to render the "本次使用了技能" footer chip.
          expertMode: expertModeOverride,
          selectedRole: dispatchRoleId,
          model: 'claude-sonnet-4-6',
          fallbackChain,
          elapsedMs,
          modelFinalText: outcome.status === 'completed' ? outcome.summary.slice(0, 200) : null,
        };
        ctx.logger.info(
          {
            taskId,
            userId: ctx.userId,
            runnerStatus: outcome.status,
            finalStatus: terminalStatus,
            ...metadata,
            failureReason: outcome.status === 'failed' ? outcome.reason : failureSummary,
          },
          'task:completed',
        );

        // Optimization #2 (Codex follow-up) — response-layer formatter
        // runs AFTER the verifier (already done above) + BEFORE
        // persist so the row's `result.summary` carries the polished
        // text. `runResponseLayerForLane` is a no-op when the flag
        // is off; on flag-on it dynamic-imports the formatter +
        // OpenAI SDK. We stamp the metadata columns AFTER persist
        // (see `stampResponseLayerColumns` call below) so we don't
        // UPDATE a row that doesn't exist yet on failure path.
        const generateRl = await runResponseLayerForLane({
          taskId,
          status: outcome.status,
          summary: outcome.status === 'completed' ? outcome.summary : '',
          expertWorkflowId: typedWorkflow?.workflowId ?? expertWorkflow?.id ?? null,
          logger: ctx.logger,
        });
        // Codex Round 2 P1-5 — post-formatter recheck. If the response
        // layer dropped a citation or merged items, downgrade the
        // terminal verdict from completed → partial_success so the
        // SPA's yellow banner fires with a specific "formatter shrunk
        // the content" hint. Zero-cost when the formatter passed
        // through (same string reference).
        let generatePostFormatDowngrade: { downgrade: boolean; reason: string | null } = {
          downgrade: false,
          reason: null,
        };
        if (outcome.status === 'completed' && generateRl.summary !== outcome.summary) {
          const preFormatSummary = outcome.summary;
          generatePostFormatDowngrade = recheckPostFormat(preFormatSummary, generateRl.summary);
          outcome = {
            ...outcome,
            summary: generatePostFormatDowngrade.downgrade ? preFormatSummary : generateRl.summary,
          };
        }
        let generateTerminalStatus = terminalStatus;
        const generateExtraFailedChecks: Array<{ type: string; detail: string }> = [];
        if (generatePostFormatDowngrade.downgrade && generateTerminalStatus === 'completed') {
          generateTerminalStatus = 'partial_success';
          generateExtraFailedChecks.push({
            type: 'post_format_regression',
            detail: generatePostFormatDowngrade.reason ?? '格式化层后内容缩水',
          });
          ctx.logger.warn(
            { taskId, reason: generatePostFormatDowngrade.reason },
            'generate: post-format recheck flagged regression — keeping pre-format summary',
          );
        }
        // Compute before persistence so refresh/history/detail views
        // carry the same verifier bullets as the live terminal frame.
        const generateFailedChecks = [
          ...(executionVerification && !executionVerification.passed
            ? extractFailedChecks(executionVerification)
            : []),
          ...generateExtraFailedChecks,
        ];
        let generateTerminalPersisted = false;
        let generateAwaitingPersisted = false;

        try {
          if (generateTerminalStatus === 'completed' && outcome.status === 'completed') {
            const persisted = await repo.persistVisionOutcome(taskId, {
              status: 'completed',
              summary: outcome.summary,
              tickCount: 1,
              metadata,
            });
            generateTerminalPersisted = persisted.persisted;
          } else if (
            generateTerminalStatus === 'partial_success' &&
            outcome.status === 'completed'
          ) {
            // Codex Pack A3 — verifier flagged soft failure; row keeps
            // summary, status='partial_success' so the SPA renders a
            // yellow "结果可能不完整" banner above the answer.
            const persisted = await repo.persistVisionOutcome(taskId, {
              status: 'partial_success',
              summary: outcome.summary,
              tickCount: 1,
              metadata,
              failedChecks: generateFailedChecks,
            });
            generateTerminalPersisted = persisted.persisted;
          } else if (generateTerminalStatus === 'failed') {
            // Either the runner failed OR the verifier verdict
            // escalated a completed task to failed (hard_fail). Prefer
            // the verifier-synthesised summary when the runner thought
            // it had succeeded; the SPA renders red "质量校验未通过".
            const reason =
              outcome.status === 'failed'
                ? (outcome.reason ?? 'generate: api failed')
                : (failureSummary ?? '质量校验未通过');
            const persisted = await repo.persistVisionOutcome(taskId, {
              status: 'failed',
              reason,
              tickCount: 1,
              metadata,
              failedChecks: generateFailedChecks,
            });
            generateTerminalPersisted = persisted.persisted;
          } else if (outcome.status === 'awaiting_user') {
            // Expert-workflow intake park out of the generate runner.
            // Persist status='awaiting_user' + the visible question
            // so a refresh during the pause re-renders correctly,
            // and stamp `awaiting_kind='clarification'` so the SPA's
            // BrowserPanel does NOT auto-expand / show the verify
            // banner — this is a chat-only intake. We also stamp
            // `result.executionMode='generate'` (rather than going
            // through persistVisionOutcome) so the reply path can
            // tell this task is parked from generate, not supercar.
            const awaitingPersist = await repo.persistAwaitingUser({
              taskExternalId: taskId,
              question: outcome.summary,
              awaitingKind: 'clarification',
              result: { ...metadata, executionMode: 'generate' as const },
            });
            generateAwaitingPersisted = awaitingPersist.persisted;
            if (!awaitingPersist.persisted) {
              ctx.logger.warn({ taskId }, 'generate: awaiting_user persist refused by state guard');
            }
          }
        } catch (err) {
          ctx.logger.error({ err, taskId }, 'generate: persist failed');
        }

        // Stamp the response-layer metadata columns now that persist
        // has landed. Best-effort: a stamp failure logs but doesn't
        // tear down terminal broadcast. Only fires when the formatter
        // actually ran (flag on); the awaiting_user branch never
        // produces a formatter run (non-terminal status filter
        // inside `runResponseLayerForLane`).
        if (generateTerminalPersisted) {
          await stampResponseLayerColumns(
            ctx.db,
            taskId,
            generateRl.responseLayerOriginal,
            outcome.status === 'completed' ? outcome.summary : '',
            generateRl.responseLayerMetadata,
            ctx.logger,
          );
        }

        try {
          if (
            generateTerminalPersisted &&
            generateTerminalStatus === 'completed' &&
            outcome.status === 'completed'
          ) {
            broadcastToUser(ctx.userId, {
              type: 'server.task.terminal',
              taskId,
              status: 'completed',
              ...(outcome.summary ? { summary: outcome.summary } : {}),
            });
          } else if (
            generateTerminalPersisted &&
            generateTerminalStatus === 'partial_success' &&
            outcome.status === 'completed'
          ) {
            broadcastToUser(ctx.userId, {
              type: 'server.task.terminal',
              taskId,
              status: 'partial_success',
              ...(outcome.summary ? { summary: outcome.summary } : {}),
              ...(generateFailedChecks.length > 0 ? { failedChecks: generateFailedChecks } : {}),
            });
          } else if (generateTerminalPersisted && generateTerminalStatus === 'failed') {
            const reason =
              outcome.status === 'failed' ? outcome.reason : (failureSummary ?? undefined);
            broadcastToUser(ctx.userId, {
              type: 'server.task.terminal',
              taskId,
              status: 'failed',
              ...(reason ? { reason } : {}),
              ...(generateFailedChecks.length > 0 ? { failedChecks: generateFailedChecks } : {}),
            });
          } else if (outcome.status === 'awaiting_user' && generateAwaitingPersisted) {
            broadcastToUser(ctx.userId, {
              type: 'server.supercar.awaiting_user',
              taskId,
              question: outcome.summary,
              awaitingKind: 'clarification',
            });
          }
        } catch (err) {
          ctx.logger.warn({ err, taskId }, 'generate: broadcast terminal failed');
        }

        // Phase 1 Day 5 — fire-and-forget execution-pipeline persist
        // + always cleanup the in-memory contract / ledger registries
        // even when persist is a no-op (flags off) so the maps don't
        // leak across long-running PM2 lifetimes.
        void persistExecution({
          taskId,
          verification: executionVerification,
          db: ctx.db,
          logger: ctx.logger,
        })
          .then((persisted) =>
            persisted
              ? writeLedgerToDb({
                  taskExternalId: taskId,
                  verification: executionVerification,
                  db: ctx.db,
                  logger: ctx.logger,
                })
              : null,
          )
          .finally(() => disposeExecution(taskId));
      })();

      return {
        taskId,
        status: 'executing' as const,
        steps: [],
        executionMode: 'generate' as const,
      };
    }
    // ===== end generate-mode fork =====

    // ===== scrape-mode fork (Phase 24 RC follow-up) =====
    // Tasks classified as 'scrape' want page content but NOT live
    // browser interaction. Firecrawl pulls markdown in 2-3s, then
    // Claude synthesises an answer from those bytes. Cost is roughly
    // 5-10× cheaper than the browser path; latency 5-10× faster.
    //
    // If FIRECRAWL_API_KEY is missing at boot, ctx.firecrawl is null
    // and the scrape branch persists a clear failure (rather than
    // silently degrading to the browser path which is what the
    // classifier explicitly avoided routing to).
    if (executionMode === 'scrape' && appEnv.ANTHROPIC_API_KEY && anthropicForResolver) {
      const taskId = newExternalId('task');
      const repo = new TaskRepository(ctx.db);

      await repo.insertTask(
        {
          taskId,
          status: 'executing',
          plan: [],
          cursor: 0,
          pendingConfirm: null,
        },
        {
          userId: userRow.id,
          intent: input.intent,
          roleId: dispatchRoleId,
          opusUsed: opusActuallyConsumed,
        },
      );

      ctx.logger.info(
        { taskId, userId: ctx.userId, executorLane: 'scrape', executionMode },
        'task: executor lane selected',
      );

      // Defensive — if the adapter wasn't configured at boot, fail
      // loudly with the exact reason. SPA / translateError surfaces
      // a clear "Firecrawl 未配置" instead of "服务繁忙".
      if (!ctx.firecrawl) {
        let missingFirecrawlPersisted = false;
        try {
          const persisted = await repo.persistVisionOutcome(taskId, {
            status: 'failed',
            reason: 'scrape: Firecrawl 未配置（FIRECRAWL_API_KEY 缺失），任务无法执行',
            tickCount: 0,
          });
          missingFirecrawlPersisted = persisted.persisted;
        } catch (err) {
          ctx.logger.warn({ err, taskId }, 'scrape: persist failed-row write threw');
        }
        try {
          if (missingFirecrawlPersisted) {
            broadcastToUser(ctx.userId, {
              type: 'server.task.terminal',
              taskId,
              status: 'failed',
              reason: 'Firecrawl 未配置',
            });
          }
        } catch {
          /* swallow — best-effort */
        }
        return {
          taskId,
          status: 'executing' as const,
          steps: [],
          executionMode: 'scrape' as const,
        };
      }

      // Phase 1 Day 5 — initialise execution pipeline. No-op when
      // every feature flag is off (default). The firecrawl-null
      // early return above bails BEFORE this init so the registries
      // never see a task that won't terminate.
      initExecution({
        taskId,
        intent: input.intent,
        executionMode: 'scrape',
        expertWorkflowId: typedWorkflow?.workflowId ?? expertWorkflow?.id ?? null,
        hasAttachments: attachmentBlocks.length > 0,
      });
      // Codex Pack B1 — planning chip (scrape lane).
      broadcastSubStatus(ctx.userId, taskId, 'planning');

      const firecrawl = ctx.firecrawl;
      const anthropicClient = anthropicForResolver;
      const scrapeStartedAt = Date.now();
      void (async () => {
        // Fallback chain (A4) — every lane the dispatcher actually
        // tried for this task. Logged + persisted under
        // result.metadata.fallbackChain so the eval pipeline can see
        // which path produced the final outcome.
        const fallbackChain: string[] = ['scrape'];
        let finalExecutionMode: 'scrape' | 'generate' = 'scrape';
        let scrapeOutcome;
        try {
          // Codex Pack B1 — extracting chip: firecrawl about to fetch.
          broadcastSubStatus(ctx.userId, taskId, 'extracting');
          scrapeOutcome = await runScrapeTask({
            taskId,
            userId: ctx.userId,
            // Use effectiveIntent (with parent context block when in
            // a follow-up + workflow preambles) whenever EITHER the
            // legacy or typed matcher fires. Earlier this only checked
            // legacy; P2_CT_008 surfaced the gap — typed-only matches
            // (content-topic / ecom-daily) lost their parent context
            // on follow-up tasks.create with replyToTaskId.
            // Phase 3 R1 (Codex #2): use effectiveIntent (parent
            // context block + workflow preamble prepended) whenever
            // any of:
            //   - legacy matcher fires
            //   - typed matcher fires (or recovered from parent)
            //   - this is a follow-up (replyToTaskId set) — the
            //     parent's outcome is load-bearing context for the
            //     model regardless of whether a workflow matched
            // Otherwise pass the bare user input.
            intent: expertWorkflow || typedWorkflow || isFollowUp ? effectiveIntent : input.intent,
            skillId: dispatchSkillId,
            client: anthropicClient,
            firecrawl,
            logger: ctx.logger,
            // Phase 24 RC follow-up — stream LLM deltas + push
            // coarse Firecrawl-phase progress to the SPA. Same
            // contract as generate-runner; broadcast errors are
            // swallowed.
            onStreamDelta: (delta) => {
              try {
                broadcastToUser(ctx.userId, {
                  type: 'server.task.stream',
                  taskId,
                  delta,
                });
              } catch (err) {
                ctx.logger.warn({ err, taskId }, 'scrape: broadcast stream delta failed');
              }
            },
            onProgress: (message) => {
              try {
                broadcastToUser(ctx.userId, {
                  type: 'server.task.progress',
                  taskId,
                  message,
                });
              } catch (err) {
                ctx.logger.warn({ err, taskId }, 'scrape: broadcast progress failed');
              }
            },
          });
        } catch (err) {
          ctx.logger.error({ err, taskId }, 'scrape: runner threw');
          scrapeOutcome = {
            status: 'failed' as const,
            summary: '',
            reason: err instanceof Error ? err.message : 'scrape: unknown error',
            inputTokens: 0,
            outputTokens: 0,
            durationMs: 0,
            source: 'scrape' as const,
            sources: [] as string[],
          };
        }

        // A1 — scrape failed → fall back to generate. Generate has
        // zero infra dependencies (no Brave, no Firecrawl) so it's
        // always reachable; if the model can't answer the intent
        // directly, generate itself will return failed and we keep
        // the chain visible in metadata for triage. The intent +
        // skill + attachments are identical between the two runners,
        // so the fallback produces the same surface for the user.
        let outcome:
          | {
              status: 'completed';
              summary: string;
              reason?: string;
            }
          | {
              status: 'failed';
              summary?: string;
              reason: string;
            };
        if (scrapeOutcome.status === 'completed') {
          outcome = {
            status: 'completed',
            summary: scrapeOutcome.summary,
          };
        } else {
          ctx.logger.warn(
            {
              taskId,
              scrapeReason: scrapeOutcome.reason,
              fallbackTo: 'generate',
            },
            'scrape failed, falling back to generate',
          );
          fallbackChain.push('generate');
          finalExecutionMode = 'generate';
          let generateOutcome;
          try {
            generateOutcome = await runGenerateTask({
              taskId,
              userId: ctx.userId,
              // Phase 3 R1 (Codex #2): use effectiveIntent (parent
            // context block + workflow preamble prepended) whenever
            // any of:
            //   - legacy matcher fires
            //   - typed matcher fires (or recovered from parent)
            //   - this is a follow-up (replyToTaskId set) — the
            //     parent's outcome is load-bearing context for the
            //     model regardless of whether a workflow matched
            // Otherwise pass the bare user input.
            intent:
                expertWorkflow || typedWorkflow || isFollowUp ? effectiveIntent : input.intent,
              workflowOverride: typedWorkflow,
              skillId: dispatchSkillId,
              client: anthropicClient,
              logger: ctx.logger,
              ...(attachmentBlocks.length > 0 ? { attachments: attachmentBlocks } : {}),
              onStreamDelta: (delta) => {
                try {
                  broadcastToUser(ctx.userId, {
                    type: 'server.task.stream',
                    taskId,
                    delta,
                  });
                } catch (err) {
                  ctx.logger.warn(
                    { err, taskId },
                    'fallback-generate: broadcast stream delta failed',
                  );
                }
              },
            });
          } catch (err) {
            ctx.logger.error({ err, taskId }, 'fallback-generate: runner threw');
            generateOutcome = {
              status: 'failed' as const,
              summary: '',
              reason: err instanceof Error ? err.message : 'fallback-generate: unknown error',
              inputTokens: 0,
              outputTokens: 0,
              durationMs: 0,
            };
          }
          if (generateOutcome.status === 'completed') {
            outcome = {
              status: 'completed',
              summary: generateOutcome.summary,
            };
          } else {
            // Phase 1 follow-up — humanise the failure reason so the
            // user sees actionable Chinese guidance instead of a raw
            // stack trace / English error code.
            outcome = {
              status: 'failed',
              reason: humaniseScrapeFailure(
                `scrape failed (${scrapeOutcome.reason}); generate fallback also failed (${generateOutcome.reason ?? 'unknown'})`,
              ),
            };
          }
        }

        // Phase 1 follow-up — sanitise the completed-path summary
        // before verification. Same rationale as the generate lane.
        if (outcome.status === 'completed' && outcome.summary) {
          const cleaned = sanitizeFinalText(outcome.summary);
          if (cleaned !== outcome.summary) {
            outcome = { ...outcome, summary: cleaned };
          }
        }

        // Phase 1 Day 5 — pipeline verification on the runner's
        // final answer. Same pattern as the generate fork: ledger
        // gets a tool_result for each scraped source + a
        // response_length entry, then the verifier runs.
        let executionVerification: VerificationResult | null = null;
        if (outcome.status === 'completed') {
          for (const url of scrapeOutcome.sources.slice(0, 10)) {
            recordEvidence(taskId, {
              fact: `scraped_url=${url}`,
              sourceType: 'tool_result',
              sourceDetail: `firecrawl_${scrapeOutcome.source}`,
              confidence: 'extracted',
            });
          }
          recordEvidence(taskId, {
            fact: `response_length=${outcome.summary.length}`,
            sourceType: 'tool_result',
            sourceDetail: 'llm_scrape_response',
            confidence: 'observed',
          });
          // Codex Pack B1 — verifying chip (scrape lane).
          broadcastSubStatus(ctx.userId, taskId, 'verifying');
          const verified: VerifyOutput = await verifyAndFinalize({
            taskId,
            answerText: outcome.summary,
            client: anthropicClient,
            logger: ctx.logger,
          });
          if (verified.finalText !== outcome.summary) {
            outcome = { ...outcome, summary: verified.finalText };
          }
          executionVerification = verified.verification;
        }

        // Codex Pack A3 — verifier verdict drives the terminal status.
        const terminalStatus: FinalTerminalStatus = deriveFinalStatus(
          outcome.status,
          executionVerification,
        );
        const failureSummary =
          terminalStatus === 'failed' && executionVerification
            ? summariseVerificationFailure(executionVerification)
            : null;

        // B3 — structured task:completed log. Single record per task
        // termination with all fields the eval pipeline needs.
        const elapsedMs = Date.now() - scrapeStartedAt;
        const metadata = {
          executionMode: 'scrape' as const,
          finalExecutionMode,
          expertWorkflowId: typedWorkflow?.workflowId ?? expertWorkflow?.id ?? null,
          expertMode: expertModeOverride,
          selectedRole: dispatchRoleId,
          model: 'claude-sonnet-4-6',
          fallbackChain,
          elapsedMs,
          modelFinalText: outcome.status === 'completed' ? outcome.summary.slice(0, 200) : null,
        };
        ctx.logger.info(
          {
            taskId,
            userId: ctx.userId,
            runnerStatus: outcome.status,
            finalStatus: terminalStatus,
            ...metadata,
            failureReason: outcome.status === 'failed' ? outcome.reason : failureSummary,
          },
          'task:completed',
        );

        // Optimization #2 (Codex follow-up) — same wire-up pattern
        // as the generate lane: format after verifier, before
        // persist; stamp metadata columns after persist.
        const scrapeRl = await runResponseLayerForLane({
          taskId,
          status: outcome.status,
          summary: outcome.status === 'completed' ? outcome.summary : '',
          expertWorkflowId: typedWorkflow?.workflowId ?? expertWorkflow?.id ?? null,
          logger: ctx.logger,
        });
        // Codex Round 2 P1-5 — same post-formatter recheck as generate
        // lane. Scrape's LLM synthesis lands a citation block at the
        // end; the formatter rarely shrinks it, but the safety net is
        // free when the text passes through unchanged.
        let scrapePostFormatDowngrade: { downgrade: boolean; reason: string | null } = {
          downgrade: false,
          reason: null,
        };
        if (outcome.status === 'completed' && scrapeRl.summary !== outcome.summary) {
          const preFormatSummary = outcome.summary;
          scrapePostFormatDowngrade = recheckPostFormat(preFormatSummary, scrapeRl.summary);
          outcome = {
            ...outcome,
            summary: scrapePostFormatDowngrade.downgrade ? preFormatSummary : scrapeRl.summary,
          };
        }
        let scrapeTerminalStatus = terminalStatus;
        const scrapeExtraFailedChecks: Array<{ type: string; detail: string }> = [];
        if (scrapePostFormatDowngrade.downgrade && scrapeTerminalStatus === 'completed') {
          scrapeTerminalStatus = 'partial_success';
          scrapeExtraFailedChecks.push({
            type: 'post_format_regression',
            detail: scrapePostFormatDowngrade.reason ?? '格式化层后内容缩水',
          });
          ctx.logger.warn(
            { taskId, reason: scrapePostFormatDowngrade.reason },
            'scrape: post-format recheck flagged regression — keeping pre-format summary',
          );
        }
        const scrapeFailedChecks = [
          ...(executionVerification && !executionVerification.passed
            ? extractFailedChecks(executionVerification)
            : []),
          ...scrapeExtraFailedChecks,
        ];
        let scrapeTerminalPersisted = false;

        try {
          if (scrapeTerminalStatus === 'completed' && outcome.status === 'completed') {
            const persisted = await repo.persistVisionOutcome(taskId, {
              status: 'completed',
              summary: outcome.summary,
              tickCount: 1,
              metadata,
            });
            scrapeTerminalPersisted = persisted.persisted;
          } else if (scrapeTerminalStatus === 'partial_success' && outcome.status === 'completed') {
            const persisted = await repo.persistVisionOutcome(taskId, {
              status: 'partial_success',
              summary: outcome.summary,
              tickCount: 1,
              metadata,
              failedChecks: scrapeFailedChecks,
            });
            scrapeTerminalPersisted = persisted.persisted;
          } else {
            const reason =
              outcome.status === 'failed' ? outcome.reason : (failureSummary ?? '质量校验未通过');
            const persisted = await repo.persistVisionOutcome(taskId, {
              status: 'failed',
              reason,
              tickCount: 1,
              metadata,
              failedChecks: scrapeFailedChecks,
            });
            scrapeTerminalPersisted = persisted.persisted;
          }
        } catch (err) {
          ctx.logger.error({ err, taskId }, 'scrape: persist failed');
        }

        if (scrapeTerminalPersisted) {
          await stampResponseLayerColumns(
            ctx.db,
            taskId,
            scrapeRl.responseLayerOriginal,
            outcome.status === 'completed' ? outcome.summary : '',
            scrapeRl.responseLayerMetadata,
            ctx.logger,
          );
        }

        try {
          if (
            scrapeTerminalPersisted &&
            scrapeTerminalStatus === 'completed' &&
            outcome.status === 'completed'
          ) {
            broadcastToUser(ctx.userId, {
              type: 'server.task.terminal',
              taskId,
              status: 'completed',
              ...(outcome.summary ? { summary: outcome.summary } : {}),
            });
          } else if (
            scrapeTerminalPersisted &&
            scrapeTerminalStatus === 'partial_success' &&
            outcome.status === 'completed'
          ) {
            broadcastToUser(ctx.userId, {
              type: 'server.task.terminal',
              taskId,
              status: 'partial_success',
              ...(outcome.summary ? { summary: outcome.summary } : {}),
              ...(scrapeFailedChecks.length > 0 ? { failedChecks: scrapeFailedChecks } : {}),
            });
          } else if (scrapeTerminalPersisted) {
            const reason =
              outcome.status === 'failed' ? outcome.reason : (failureSummary ?? undefined);
            broadcastToUser(ctx.userId, {
              type: 'server.task.terminal',
              taskId,
              status: 'failed',
              ...(reason ? { reason } : {}),
              ...(scrapeFailedChecks.length > 0 ? { failedChecks: scrapeFailedChecks } : {}),
            });
          }
        } catch (err) {
          ctx.logger.warn({ err, taskId }, 'scrape: broadcast terminal failed');
        }

        // Phase 1 Day 5 — fire-and-forget execution-pipeline persist
        // + cleanup. Same pattern as the generate fork.
        void persistExecution({
          taskId,
          verification: executionVerification,
          db: ctx.db,
          logger: ctx.logger,
        })
          .then((persisted) =>
            persisted
              ? writeLedgerToDb({
                  taskExternalId: taskId,
                  verification: executionVerification,
                  db: ctx.db,
                  logger: ctx.logger,
                })
              : null,
          )
          .finally(() => disposeExecution(taskId));
      })();

      return {
        taskId,
        status: 'executing' as const,
        steps: [],
        executionMode: 'scrape' as const,
      };
    }
    // ===== end scrape-mode fork =====

    // Deterministic direct-open lane. An explicit "打开 https://..."
    // command needs no model judgement: navigate the managed browser,
    // capture the real page, and finish. This also keeps offline local
    // QA honest — it never creates StubPlanner's about:blank smoke plan.
    if (directOpenUrl) {
      const taskId = newExternalId('task');
      const repo = new TaskRepository(ctx.db);
      const willQueueDirectOpen = Boolean(ctx.taskQueue && directOpenUsesBrowserPool);
      await repo.insertTask(
        {
          taskId,
          status: willQueueDirectOpen ? 'queued' : 'executing',
          plan: [],
          cursor: 0,
          pendingConfirm: null,
        },
        {
          userId: userRow.id,
          intent: input.intent,
          roleId: dispatchRoleId,
          opusUsed: opusActuallyConsumed,
        },
      );

      const dispatchDirectOpen = async (): Promise<void> => {
        let executor = directOpenFallbackExecutor;
        let allocatedPool = false;
        let adoptedBrowserSession = false;
        try {
          if (directOpenUsesBrowserPool && ctx.browserPool) {
            const adopted = input.replyToTaskId
              ? ctx.browserPool.adoptRetained(input.replyToTaskId, taskId, ctx.userId)
              : null;
            const instance =
              adopted ??
              (await ctx.browserPool.allocate(taskId, ctx.userId, input.viewportProfile));
            executor = instance.executor;
            allocatedPool = true;
            adoptedBrowserSession = adopted != null;
          }
          if (!executor) throw new Error('浏览器执行器尚未就绪');
          const readyExecutor = executor;

          const directExecutor = {
            resetPageForTask: () => readyExecutor.resetPageForTask(),
            getPage: async () => (await readyExecutor.getPage()) as unknown as PageLike,
            navigate: (page: PageLike, url: string) => readyExecutor.navigate(page, url),
            screenshot: (page: PageLike) => readyExecutor.screenshot(page),
          };
          const evidence = await runDirectOpen(directExecutor, directOpenUrl, {
            preserveExistingPage: adoptedBrowserSession,
          });
          const persisted = await repo.persistVisionOutcome(taskId, {
            status: 'completed',
            summary: `已打开 ${evidence.finalUrl}`,
            tickCount: 1,
            finalUrl: evidence.finalUrl,
            finalScreenshot: evidence.finalScreenshot,
            ...(evidence.finalViewport ? { finalViewport: evidence.finalViewport } : {}),
            metadata: {
              executionMode: 'browser',
              lane: 'direct_open',
            },
          });
          if (!persisted.persisted) return;

          broadcastToUser(ctx.userId, {
            type: 'server.vision.screencast',
            taskId,
            tickIndex: 1,
            imageBase64: evidence.finalScreenshot,
            url: evidence.finalUrl,
            viewport: evidence.finalViewport ?? { width: 1280, height: 800 },
            timestamp: new Date().toISOString(),
          });
          broadcastToUser(ctx.userId, {
            type: 'server.task.terminal',
            taskId,
            status: 'completed',
            summary: `已打开 ${evidence.finalUrl}`,
          });
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          try {
            const persisted = await repo.persistVisionOutcome(taskId, {
              status: 'failed',
              reason: `浏览器打开失败：${reason}`.slice(0, 500),
              errorCode: 'DIRECT_OPEN_FAILED',
              tickCount: 0,
              metadata: { executionMode: 'browser', lane: 'direct_open' },
            });
            if (persisted.persisted) {
              broadcastToUser(ctx.userId, {
                type: 'server.task.terminal',
                taskId,
                status: 'failed',
                reason: `浏览器打开失败：${reason}`.slice(0, 200),
              });
            }
          } catch (persistErr) {
            ctx.logger.error(
              { err: persistErr, taskId },
              'direct-open: failed outcome could not be persisted',
            );
          }
        } finally {
          if (allocatedPool && ctx.browserPool) {
            const retained = ctx.browserPool.retain(
              taskId,
              appEnv.BROWSER_TERMINAL_RETENTION_MS,
              'direct-open-review',
            );
            if (!retained) {
              await ctx.browserPool.release(taskId, `direct-open-${taskId}-done`).catch(() => {});
            }
          }
          if (willQueueDirectOpen) ctx.taskQueue?.signalSlotFreed();
        }
      };

      if (willQueueDirectOpen && ctx.taskQueue) {
        const enqueueResult = ctx.taskQueue.enqueue({
          taskId,
          userId: ctx.userId,
          runFn: dispatchDirectOpen,
          onStart: async (): Promise<void> => {
            await markQueuedTaskExecutingOrThrow({ repo, taskId, logger: ctx.logger });
          },
          onTimeout: async (): Promise<void> => {
            const reason = '排队等待时间过长，任务已自动停止。请稍后重新执行。';
            try {
              const failed = await repo.markQueuedTaskFailed(taskId, `queue timeout: ${reason}`, {
                errorCode: 'QUEUE_TIMEOUT',
                source: 'direct_open_queue_timeout',
              });
              if (failed.persisted) {
                broadcastToUser(ctx.userId, {
                  type: 'server.task.terminal',
                  taskId,
                  status: 'failed',
                  reason,
                });
              }
            } catch (err) {
              ctx.logger.error(
                { err, taskId },
                'direct-open: queue timeout could not be persisted',
              );
            }
          },
        });

        if (enqueueResult.kind === 'rejected') {
          await repo.markQueuedTaskFailed(taskId, enqueueResult.reason, {
            errorCode: 'QUEUE_REJECTED',
            source: 'direct_open_queue_rejected',
          });
          throw new TRPCError({
            code: 'TOO_MANY_REQUESTS',
            message: enqueueResult.reason,
          });
        }
        if (enqueueResult.kind === 'queued') {
          broadcastToUser(ctx.userId, {
            type: 'server.task.queued',
            taskId,
            position: enqueueResult.position,
          });
        }
        return {
          taskId,
          status:
            enqueueResult.kind === 'dispatched' ? ('executing' as const) : ('queued' as const),
          steps: [],
          executionMode: 'browser' as const,
        };
      }

      void dispatchDirectOpen().catch((err) => {
        ctx.logger.error({ err, taskId }, 'direct-open: detached dispatch rejected');
      });

      return {
        taskId,
        status: 'executing' as const,
        steps: [],
        executionMode: 'browser' as const,
      };
    }

    // Diagnostic: log the supercar-gate inputs on every tasks.create
    // so BOSS can tell from pm2 logs exactly why a task fell into the
    // legacy branch. Happens BEFORE the gate so the log always lands.
    ctx.logger.info(
      {
        gate: 'supercar-vs-legacy',
        AGENT_MODE: appEnv.AGENT_MODE,
        playwrightExecutorPresent: Boolean(ctx.playwrightExecutor),
        anthropicKeyPresent: Boolean(appEnv.ANTHROPIC_API_KEY),
        isSimpleSearchIntent,
        browserPoolEligible,
        willUseSupercar:
          appEnv.AGENT_MODE === 'supercar' &&
          Boolean(appEnv.ANTHROPIC_API_KEY) &&
          (Boolean(ctx.playwrightExecutor) || browserPoolEligible),
      },
      'tasks.create: control-plane decision',
    );

    // Supercar path — Anthropic's official computer_20251124 +
    // web_search_20260209 tools driving Playwright directly, with
    // adaptive thinking + prompt caching. This is the default starting
    // with the superstar rewrite; flip AGENT_MODE=legacy to fall back
    // to the hand-rolled vision-loop.
    if (
      appEnv.AGENT_MODE === 'supercar' &&
      appEnv.ANTHROPIC_API_KEY &&
      (ctx.playwrightExecutor || browserPoolEligible)
    ) {
      const taskId = newExternalId('task');
      const repo = new TaskRepository(ctx.db);

      // Phase 13 Dim 1 — first-frame plan. Skipped for simple-search
      // (the model's web_search tool handles those in one shot),
      // trivial intents, and any intent shorter than 8 chars. Plan
      // failures are non-fatal — generatePlan returns { planText:
      // null, planStatus: null } and the loop continues without one.
      // Run in parallel with memory retrieval below to keep the
      // tasks.create RTT close to its pre-Phase-13 footprint.
      const skipPlan = isSimpleSearchIntent || shouldSkipPlan(input.intent);
      const memoryService = new MemoryService(ctx.db, ctx.logger);
      const [planResult, relevantMemories] = await Promise.all([
        skipPlan
          ? Promise.resolve({ planText: null, planStatus: null })
          : generatePlan({
              apiKey: appEnv.ANTHROPIC_API_KEY,
              intent: input.intent,
              logger: ctx.logger,
              taskId,
            }),
        memoryService.pickRelevant(userRow.id, input.intent),
      ]);
      const memoryPreamble = memoryService.formatForPrompt(relevantMemories);
      // Phase 14 — site-playbook injection. Match the user's intent
      // against the playbook catalogue (中文 name / domain / English
      // name); render the matched tips into a user-message preamble.
      // Empty when no site is mentioned — keeps unrelated tasks
      // unaffected. matchPlaybooks is a small in-memory loop over
      // ~25 entries (microseconds). The matched array is also reused
      // below by the router cold-start recommendation when stats has
      // < 3 samples for the target site.
      const matchedPlaybooks = matchPlaybooks(input.intent);
      const playbookContext = formatPlaybooksForPrompt(matchedPlaybooks);
      if (matchedPlaybooks.length > 0) {
        ctx.logger.info(
          { taskId, sites: matchedPlaybooks.map((p) => p.domain) },
          'playbook: injected site context',
        );
      }

      // Phase 24 RC follow-up — TaskQueue gates dispatch when the
      // per-task BrowserPool is at its 10-slot capacity. We seed the
      // row with status='queued' so a 30-task burst doesn't show 30
      // fake-executing rows while 20 of them are actually waiting.
      // The queue's onStart callback flips the row to 'executing' the
      // moment a slot frees; if the queue isn't wired (e.g. legacy
      // boot without MULTI_USER) we fall back to the historical
      // 'executing' seed.
      const willQueueDispatch = Boolean(
        ctx.taskQueue && executionMode === 'browser' && shouldUseBrowserPool(ctx.userId),
      );
      await repo.insertTask(
        {
          taskId,
          status: willQueueDispatch ? 'queued' : 'executing',
          plan: [],
          cursor: 0,
          pendingConfirm: null,
        },
        {
          userId: userRow.id,
          intent: input.intent,
          roleId: dispatchRoleId,
          opusUsed: opusActuallyConsumed,
        },
      );
      // Phase 13 Dim 1 — persist plan onto the task row and broadcast
      // it to the SPA so the user sees upcoming steps before any
      // tool fires. Best-effort: write failures log + continue.
      if (planResult.planText) {
        await ctx.db
          .update(tasksTable)
          .set({
            planText: planResult.planText,
            planStatus: planResult.planStatus as unknown,
          })
          .where(eq(tasksTable.externalId, taskId))
          .catch((err) => ctx.logger.warn({ err, taskId }, 'plan persist failed'));
        try {
          broadcastToUser(ctx.userId, {
            type: 'server.task.plan',
            taskId,
            planText: planResult.planText,
            planStatus: planResult.planStatus ?? [],
          });
        } catch (err) {
          ctx.logger.warn({ err, taskId }, 'plan broadcast failed');
        }
      }
      // Phase 10 Tier 3 — back-fill task_files.task_id once the task
      // row exists. Best-effort so a failed link doesn't kill the run;
      // worst case the file is orphaned (still readable by id, just
      // not linkable from /tasks/:id).
      if (input.fileIds && input.fileIds.length > 0) {
        const [taskDb] = await ctx.db
          .select({ id: tasksTable.id })
          .from(tasksTable)
          .where(eq(tasksTable.externalId, taskId))
          .limit(1);
        if (taskDb) {
          await fileService
            .linkToTask(input.fileIds, taskDb.id, userRow.id)
            .catch((err) => ctx.logger.warn({ err }, 'tasks.create: file link failed'));
        }
      }

      const classification = classifyDomain(input.intent);
      ctx.logger.info(
        { taskId, domain: classification.domain, confidence: classification.confidence },
        'supercar: task domain classified',
      );

      const userId = ctx.userId;
      const [taskDbRow] = await ctx.db
        .select({ id: tasksTable.id })
        .from(tasksTable)
        .where(eq(tasksTable.externalId, taskId))
        .limit(1);
      const taskDbId = taskDbRow?.id;

      // Phase 8.1: HEADED Brave is the primary browser. Phase 6-2
      // shipped with headless as primary + headed as a stuck/anti-bot
      // fallback, but that meant the user watched the Panel VNC stream
      // (wired to the headed Xvfb) while the agent was actually
      // driving the hidden headless instance — they never matched
      // up in the UI. Demoting headless to "last-resort fallback"
      // makes the UI stream and the agent's focus the same browser.
      //
      // Empty headed lane (dev boxes without Xvfb + Brave) falls back
      // to headless → plain injected executor → router-less deploy
      // ancestor. Each null just hops to the next layer.
      const headedExec = ctx.executionRouter?.getExecutor('headed') ?? null;
      const headlessExec =
        ctx.executionRouter?.getExecutor('headless') ?? ctx.playwrightExecutor ?? null;

      // Phase 21b — executionMode was decided up at the admission
      // gate (so per-mode concurrency could apply). It's reused here
      // to gate pool.allocate; for 'generate' we don't need a per-
      // user pool slot. Note that this branch only fires for the
      // BROWSER execution mode under 21b — pure-generate tasks fork
      // off into runGenerateTask before reaching the supercar gate.
      ctx.logger.info(
        { taskId, userId: ctx.userId, executionMode },
        'tasks.create: supercar branch — execution mode',
      );

      // Phase 8.2: when the caller is in MULTI_USER_USERS allow-list,
      // replace the shared headed singleton with their own pool slot.
      // The pool's executor is a freshly-connected PlaywrightExecutor
      // pointing at a dedicated Brave + Xvfb + VNC quartet — the rest
      // of the supercar loop sees a plain PlaywrightExecutor and
      // doesn't know the difference. If allocate throws (capacity
      // exceeded, spawn timeout) we surface a typed error so the UI
      // can show "browser-pool busy" rather than an opaque 500.
      //
      // 21a — also skip when executionMode='generate' (no per-user
      // browser slot needed for pure-generation tasks).
      // Phase 24 RC follow-up — wrap allocate + supercarArgs build +
      // runFn invocation in dispatchToBrave so the global TaskQueue
      // can hold it past the 10-slot pool cap. Body unchanged from
      // the pre-queue flow; only outer scheduling differs (taskQueue
      // .enqueue vs `void runFn()`).
      const dispatchToBrave = async (): Promise<void> => {
      let perUserExec = null;
      let adoptedBrowserSession = false;
        if (ctx.browserPool && shouldUseBrowserPool(ctx.userId) && executionMode === 'browser') {
        try {
          // Phase 24 — keyed by taskId, not userId. One task = one
          // Brave (no shared instance, no refcount). The runFn
          // .finally below calls release(taskId) to tear down
          // immediately on completion. Per-user concurrency is gated
          // upstream via getActiveTaskCount + plan limits.
          const adopted = input.replyToTaskId
              ? ctx.browserPool.adoptRetained(input.replyToTaskId, taskId, ctx.userId)
            : null;
          let allocatedForContinuation = false;
          const instance = adopted
            ? adopted
              : await ctx.browserPool.allocate(taskId, ctx.userId, input.viewportProfile);
          allocatedForContinuation = adopted == null;
          const continuation = resolveBrowserFollowUpContinuation({
            hasParentTask: Boolean(input.replyToTaskId),
            parentHasBrowserContext,
            adopted: adopted != null,
            restoreUrl: parentBrowserRestoreUrl,
          });
          if (continuation === 'unavailable') {
              await ctx.browserPool.release(taskId, 'follow-up-page-unavailable').catch(() => {});
              throw new Error('当前浏览器页面已过期，且没有可恢复地址。请重新打开目标页面。');
          }
          if (continuation === 'restore') {
            if (!parentBrowserRestoreUrl) {
                await ctx.browserPool.release(taskId, 'follow-up-page-unavailable');
                throw new Error('当前浏览器页面已过期，且没有可恢复地址。请重新打开目标页面。');
            }
              const decision = await defaultBrowserNetworkPolicy.check(parentBrowserRestoreUrl);
            if (!decision.allowed) {
              await ctx.browserPool.release(taskId, 'follow-up-url-blocked');
              throw new Error(decision.message);
            }
            try {
              await instance.executor.resetPageForTask();
              const page = (await instance.executor.getPage()) as unknown as PageLike;
                const navigation = await instance.executor.navigate(page, parentBrowserRestoreUrl);
              if (!navigation.ok) {
                  throw new Error(navigation.message ?? '无法恢复前一个任务的页面');
              }
              ctx.logger.info(
                {
                  sourceTaskId: input.replyToTaskId,
                  destinationTaskId: taskId,
                  userId: ctx.userId,
                  url: parentBrowserRestoreUrl,
                },
                'pool: restored follow-up page after retained browser expired',
              );
            } catch (err) {
              if (allocatedForContinuation) {
                await ctx.browserPool
                  .release(taskId, 'follow-up-page-restore-failed')
                  .catch(() => {});
              }
              throw err;
            }
          }
          perUserExec = instance.executor;
            adoptedBrowserSession = continuation === 'adopted' || continuation === 'restore';
          ctx.logger.info(
              {
                taskId,
                userId: ctx.userId,
                cdpPort: instance.cdpPort,
                displayNum: instance.display,
              },
            'pool: allocated browser for task',
          );
        } catch (err) {
          // No singleton fallback. The earlier behaviour ("degrade to
          // shared Brave") could land a user's clicks on another
          // user's session and bypassed the per-task hijack guards.
          // Re-throw so dispatchToBrave aborts; the runFn .finally
          // marks the task failed and the queue slot releases.
          // Capacity errors should be rare since the queue gates on
          // pool depth; treat them as alert-worthy when they hit.
          ctx.logger.error(
            { err: err instanceof Error ? err.message : String(err), userId: ctx.userId, taskId },
            'pool: allocate failed — refusing to fall back to singleton, failing task',
          );
          const reason =
            err instanceof Error ? err.message : `pool allocate failed: ${String(err)}`;
          try {
            await persistAndBroadcastBrowserDispatchFailure({
              repo,
              taskId,
              userId: ctx.userId,
              reason,
              logger: ctx.logger,
              broadcastToUser,
            });
          } finally {
            if (willQueueDispatch) ctx.taskQueue?.signalSlotFreed();
          }
          return;
        }
      }

      // primaryExecutor may be null when:
      //   - the gate admitted via canShortCircuitBrave (simple-search,
      //     no browser needed — Brave handles it); or
      //   - the gate admitted via browserPoolEligible but pool.allocate
      //     above raced and lost (Brave crashed mid-spawn).
      // runSupercarTask's null-executor guard handles both: Brave/Zapier
      // short-circuits fire first, and if neither matches it returns
      // status='failed' with a clear "browser unavailable" reason.
      // That marks the task failed in the DB rather than 500ing the
      // tasks.create call, which would lose the audit trail.
      const primaryExecutor = perUserExec ?? headedExec ?? headlessExec;
      // Phase 22a — captured once at admit time so the runFn .finally
      // below can release the slot without re-checking pool state.
      const didAllocatePool = perUserExec !== null;
      // Phase 19c follow-up — log which executor lane this task
      // landed on. Lets BOSS confirm in pm2 logs that the per-user
      // pool path is actually winning (and falling back to a
      // singleton lane is the exception, not the rule). Helps
      // future "agent operates on a different browser than the
      // user is watching" reports get diagnosed in one log line.
      const executorLane = perUserExec
        ? 'per-user-pool'
        : primaryExecutor === headedExec
          ? 'singleton-headed-fallback'
          : primaryExecutor === headlessExec
            ? 'singleton-headless-fallback'
            : 'none';
      ctx.logger.info(
        { taskId, userId: ctx.userId, executorLane },
        'task: executor lane selected',
      );
      // Phase 13 Dim 6 — single StatsService instance shared across
      // all stats records the loop emits. Wiring is best-effort
      // (StatsService.record swallows its own errors), so a stats
      // backend hiccup never stalls the agent.
      const statsService = new StatsService(ctx.db, ctx.logger);
      const taskTypeForStats = classifyTaskType(input.intent);
      // Phase 13 Dim 6 — optimal-lane hint from prior stats. Best-
      // effort observability: derives the target site from any URL
      // mention in the intent (e.g. "在 jd.com 搜..."), then logs
      // the historically winning lane for (this user, that site).
      // Routing decisions are unchanged this commit; the log line
      // exists so we can validate the recommender empirically before
      // wiring it to the gate. Null target_site → no lookup.
      const intentSiteMatch = input.intent.match(
        /\b(?:https?:\/\/)?((?:[a-z0-9-]+\.)+(?:com|cn|net|org|tech|ai|io|co))\b/i,
      );
        const intentTargetSite = intentSiteMatch ? extractDomain(intentSiteMatch[1] ?? null) : null;
      // Phase 14 — playbook-driven cold-start lane recommendation.
      // The "router: cold-start lane from playbook" log fires when:
      //   (a) intent has a URL but stats < 3 samples, OR
      //   (b) intent has no URL but a playbook matched by name.
      // The intent-only branch is a best-effort observability hook;
      // routing decisions still go through the legacy gate this
      // commit. Stats stay primary once they exceed the sample
      // threshold (priority order in router-decision.ts).
      const playbookForRouter = matchedPlaybooks[0] ?? null;
      const routerTargetSite = intentTargetSite ?? playbookForRouter?.domain ?? null;
      if (routerTargetSite) {
        try {
          const optimalLane = await statsService.getOptimalLane({
            userIdInternal: userRow.id,
            targetSite: routerTargetSite,
          });
          if (optimalLane) {
            ctx.logger.info(
              {
                taskId,
                taskType: taskTypeForStats,
                targetSite: routerTargetSite,
                optimalLane,
                source: 'stats',
              },
              'router: optimal lane from stats',
            );
          } else if (playbookForRouter) {
            ctx.logger.info(
              {
                taskId,
                taskType: taskTypeForStats,
                targetSite: routerTargetSite,
                recommendedLane: playbookForRouter.preferredLane,
                source: 'playbook',
              },
              'router: cold-start lane from playbook',
            );
            // Phase 14 (extension follow-up) — when the matched
            // playbook flags this site as login-required AND the
            // user has a live extension WS connection AND the
            // extension reports them as logged in there, log a
            // hint so we can later wire the chrome-extension
            // transport as a higher-priority lane than headed.
            // Read-only observability this commit; no routing
            // change. Treats the playbook's own domain as
            // canonical (covers the case where intent has no URL).
            if (
              playbookForRouter.loginRequired !== false &&
              hasConnectedSwClient(ctx.userId) &&
              getExtensionLoginState(ctx.userId, playbookForRouter.domain) === true
            ) {
              ctx.logger.info(
                {
                  taskId,
                  targetSite: playbookForRouter.domain,
                  loginRequired: playbookForRouter.loginRequired,
                },
                'router: extension lane available with verified login state',
              );
            }
          } else {
            ctx.logger.info(
              { taskId, targetSite: routerTargetSite },
              'router: no usable stats history for site (default route)',
            );
          }
        } catch (err) {
          ctx.logger.warn(
            { err: err instanceof Error ? err.message : String(err) },
            'router: stats lookup failed (non-fatal)',
          );
        }
      }
      // Per-task buffer of web_search results from the current
      // iteration. onWebSearch pushes here; onTick (which fires once
      // at the end of each iteration) flushes them into the persisted
      // step's output JSON so a refresh-after-completion can rebuild
      // webSearchByTask without replaying the WS frames. Local to
      // dispatchToBrave so concurrent tasks don't share a buffer.
      let pendingWebSearches: Array<{
        readonly query: string;
        readonly sources: ReadonlyArray<{ title: string; url: string; snippet?: string }>;
      }> = [];
      // Codex P3 follow-up — per-task buffer of save_page_as_pdf
      // results. Each successful call appends one entry here; the
      // terminal-state merge below folds the list into
      // `metadata.attachments` so the eval haystack + SPA AttachmentBar
      // see every PDF the agent saved during the run (not just the
      // last one). Local to the .create closure so concurrent tasks
      // don't share state. Each entry mirrors the L1 screenshot
      // attachment shape (`kind: 'pdf'`).
      const pdfAttachments: Array<{
        fileId: string;
        downloadUrl: string;
        filename: string;
        mimetype: string;
        sizeBytes: number;
        expiresAt: string;
        kind: 'pdf';
      }> = [];
      // Phase 1 Playbook B2 — per-action capture. Wire onAction ONLY when
      // ACTION_CAPTURE is on; the agent-loop skips the whole capture (incl.
      // the page.evaluate) when opts.onAction is absent → OFF = zero
      // overhead. Persist is fire-and-forget (mirrors the onTick consumer).
      const actionCaptureEnabled = getExecutionFeatureFlags().ACTION_CAPTURE;
      const taskActionCaptureRepo = actionCaptureEnabled
        ? new TaskActionCaptureRepository(ctx.db)
        : null;
      // Phase 1 Playbook B4 — screenshot anchor. Independent flag, AND
      // ACTION_CAPTURE (rides the same onAction event). Instances built only
      // when enabled; per-task counter caps R2 spend at MAX_SCREENSHOT_ANCHORS.
      const screenshotAnchorEnabled =
        actionCaptureEnabled && getExecutionFeatureFlags().B4_SCREENSHOT_ANCHOR;
      const evidenceArtifactRepo = screenshotAnchorEnabled
        ? new EvidenceArtifactRepository(ctx.db)
        : null;
      const sharedStorage = screenshotAnchorEnabled
        ? getSharedStorageProvider({ logger: ctx.logger })
        : null;
      const MAX_SCREENSHOT_ANCHORS = 8;
      let screenshotAnchorCount = 0;
      // Phase 1 Playbook ④ prerequisite — wire the supercar loop to the
      // shared LLM cost recorder so each browse turn lands in `llm_calls`
      // (the loop builds its own Anthropic client and was never recorded →
      // browse tasks showed $0). Recording is fire-and-forget inside the loop;
      // a write failure only logs here.
      const llmCallRecorder = new DrizzleLlmCallRecorder(ctx.db, {
        onError: (err) =>
          ctx.logger.warn(
            { err: err instanceof Error ? err.message : String(err), taskId },
            'supercar: llm_calls cost record failed (non-blocking)',
          ),
      });
      const supercarArgs: Parameters<typeof runSupercarTask>[0] = {
          taskId,
          // Phase 1 Playbook ④ prerequisite — cost accounting for the browse
          // loop (recorder + the external user id llm_calls.user_id needs).
          recorder: llmCallRecorder,
          userExternalId: ctx.userId,
          // Phase 1 Playbook B4 — gate screenshot-anchor attachment in the loop
          // (OFF → loop never attaches the screenshot = zero overhead).
          captureScreenshotAnchors: screenshotAnchorEnabled,
          // Phase 14 audit follow-up — feed the agent the parent-task
          // context block when this is a 追问. DB still stores
          // `input.intent` (what the user typed); only the model sees
          // the prefixed version.
          intent: effectiveIntent,
          ...(memoryPreamble ? { memoryPreamble } : {}),
          ...(playbookContext ? { playbookContext } : {}),
          ...(planResult.planText ? { planText: planResult.planText } : {}),
          ...(planResult.planStatus ? { planSteps: planResult.planStatus } : {}),
          // Phase 13 Dim 1 follow-up — persist + broadcast every
          // plan-step state change as the model emits markers. Best-
          // effort: a DB blip or broadcast failure logs and continues
          // (the loop already has the up-to-date state in memory).
          onPlanStepUpdate: (steps) => {
            void (async () => {
              const persisted = await repo.persistActivePlanStatus(taskId, steps);
              if (!persisted.persisted) {
                ctx.logger.info({ taskId }, 'plan-step skipped stale update');
                return;
              }
              try {
                broadcastToUser(ctx.userId, {
                  type: 'server.task.plan_step',
                  taskId,
                  planStatus: steps,
                });
              } catch (err) {
                ctx.logger.warn({ err, taskId }, 'plan-step broadcast failed');
              }
            })().catch((err) => ctx.logger.warn({ err, taskId }, 'plan-step persist failed'));
          },
          onStatsRecord: ({ laneUsed, targetSite, success, latencyMs, errorType }) => {
            void statsService.record({
              userIdInternal: userRow.id,
              taskExternalId: taskId,
              taskType: taskTypeForStats,
              targetSite,
              laneUsed,
              success,
              latencyMs,
              errorType,
            });
          },
          onEvidence: (ev) => {
            try {
              recordEvidence(taskId, ev);
            } catch (err) {
              ctx.logger.warn(
                { err: err instanceof Error ? err.message : String(err), taskId },
                'supercar: record evidence callback failed',
              );
            }
          },
          ...(taskActionCaptureRepo
            ? {
                onAction: (ev: SupercarActionCaptureEvent) => {
                  if (!taskDbId || !taskActionCaptureRepo) return;
                  // Fire-and-forget (mirrors the onTick consumer): a DB
                  // failure only drops this capture row + logs; the browse
                  // action is never awaited on it.
                  void (async () => {
                    try {
                      const capture = await taskActionCaptureRepo.create({
                        taskId: taskDbId,
                        siteDomain: ev.siteDomain,
                        actionIndex: ev.actionIndex,
                        stepType: ev.stepType,
                        visibleText: ev.visibleText,
                        targetSelectorJson: ev.targetSelector
                          ? { selector: ev.targetSelector }
                          : null,
                        coordinateJson: ev.coordinate,
                        framePath: ev.framePath,
                        entryUrl: ev.entryUrl,
                        inputValue: ev.inputValue,
                      });
                      // Phase 1 Playbook B4 — screenshot anchor (gated + capped).
                      // Own try so a failure keeps the capture row above + never
                      // blocks/throws. Counter bumped BEFORE upload = caps R2
                      // ATTEMPTS (a failed upload still consumes the budget).
                      if (
                        ev.screenshotBase64 &&
                        evidenceArtifactRepo &&
                        sharedStorage &&
                        screenshotAnchorCount < MAX_SCREENSHOT_ANCHORS
                      ) {
                        screenshotAnchorCount += 1;
                        try {
                          const buffer = Buffer.from(ev.screenshotBase64, 'base64');
                          const sha256 = createHash('sha256').update(buffer).digest('hex');
                          const { storagePath } = await sharedStorage.put({
                            userExternalId: taskId,
                            kind: 'output',
                            fileExternalId: newExternalId('file'),
                            filename: 'anchor.jpg',
                            buffer,
                            mimetype: 'image/jpeg',
                          });
                          const artifact = await evidenceArtifactRepo.create({
                            ownerUserId: userRow.id,
                            taskId: taskDbId,
                            artifactKind: 'screenshot',
                            purpose: 'action_anchor',
                            r2Bucket: process.env.R2_BUCKET ?? 'local',
                            r2Key: storagePath,
                            contentType: 'image/jpeg',
                            sizeBytes: buffer.byteLength,
                            sha256,
                            capturedAt: new Date(),
                            collectorLane: 'screenshot-anchor',
                            retentionPolicy: 'manual_hold',
                          });
                          // Backfill the capture row's anchor FK BY PRIMARY KEY
                          // (create() above returned the row + its id). PK is
                          // unique + retry-safe: (task_id, action_index) is
                          // NON-unique and the auto-retry wrapper re-runs the loop
                          // with the same taskDbId + resets action_index, so it can
                          // duplicate rows at the same action_index — keying on the
                          // row's own id is the only target that hits exactly the
                          // just-inserted capture row.
                          await ctx.db
                            .update(taskActionCaptures)
                            .set({ screenshotAnchorId: artifact.id })
                            .where(eq(taskActionCaptures.id, capture.id));
                        } catch (e2) {
                          ctx.logger.warn(
                            { err: e2 instanceof Error ? e2.message : String(e2), taskId },
                            'supercar: screenshot anchor failed (capture kept, anchor null)',
                          );
                        }
                      }
                    } catch (err) {
                      ctx.logger.warn(
                        { err: err instanceof Error ? err.message : String(err), taskId },
                        'supercar: persist action capture failed',
                      );
                    }
                  })();
                },
              }
            : {}),
          executor: primaryExecutor,
          preserveExistingPage: adoptedBrowserSession,
          domain: classification.domain,
          // Swap target: the NON-primary browser. When headed was
          // used as primary, a stuck/anti-bot signal falls back to
          // headless (in case Brave is what's being fingerprinted).
          // When headless is primary (Brave unavailable), swap
          // points at nothing — agent-loop no-ops the swap. Per-user
          // pool mode has no fallback — the user's own Brave is the
          // only tab they're watching, swapping to a shared headless
          // would stream frames of the wrong page.
          headedExecutor: perUserExec
              ? null
              : primaryExecutor === headedExec
              ? (headlessExec ?? null)
                : null,
          zapierAdapter: ctx.executionRouter?.zapier ?? null,
          apifyAdapter: ctx.executionRouter?.apify ?? null,
          firecrawl: ctx.firecrawl ?? null,
          isSimpleSearch: isSimpleSearchIntent,
          isCrossPlatformAutomation: classifyAsCrossPlatformAutomation(input.intent),
          zapierWebhookPath: process.env.ZAPIER_WEBHOOK_PATH ?? null,
          // Pass the resolved dispatch context so prompt-layers cannot
          // resurrect the raw classifier match. Manual skills win over
          // automatic role classification; otherwise this is the gated role.
          roleIdOverride: dispatchSkillId ?? 'none',
          // Phase 10 Tier 3 — attachments parsed above, prepended to
          // the agent's first user message before the screenshot.
          ...(attachmentBlocks.length > 0 ? { attachments: attachmentBlocks } : {}),
          // Phase 10 Tier 3 — per-plan create_file format whitelist.
          // Empty list (free) suppresses the tool entirely; basic gets
          // text-shaped formats only; pro gets office formats too.
          createFileFormats: allowedFormatsForPlan(planId),
          // Closure that lazily resolves the task's DB id (the supercar
          // queue runs async; the row exists by the time the model
          // calls a tool). Stores the buffer + index row, then returns
          // a download URL the model embeds in the final summary.
          // Phase 3 R3 L2 — save_page_as_pdf storage callback. The
          // supercar loop renders the page to a PDF Buffer; we just
          // persist it via DownloadManager (which enforces the 50MB
          // cap + builds the URL). Only wired when downloadManager
          // exists on ctx (always true in prod boot path; nullable
          // in test deps).
          ...(ctx.downloadManager
            ? {
                async onSavePageAsPdf({
                  filename,
                  pdfBuffer,
                }: {
                  filename: string;
                  pdfBuffer: Buffer;
                }) {
                  try {
                    const taskInternalId = await taskInternalIdFor(ctx.db, taskId);
                    if (taskInternalId == null) {
                      return { error: 'task row not found' };
                    }
                    const saved = await ctx.downloadManager!.save({
                      userIdInternal: userRow.id,
                      userExternalId: ctx.userId,
                      taskIdInternal: taskInternalId,
                      content: pdfBuffer,
                      filename,
                      mimetype: 'application/pdf',
                    });
                    // Codex P3 follow-up — accumulate per-task so the
                    // terminal-state merge folds every saved PDF into
                    // metadata.attachments. Previously the model's tool
                    // result text was the only record of the PDF, which
                    // meant the SPA's AttachmentBar + eval haystack saw
                    // none of the saved PDFs.
                    pdfAttachments.push({
                      fileId: saved.fileId,
                      downloadUrl: saved.downloadUrl,
                      filename: saved.filename,
                      mimetype: saved.mimetype,
                      sizeBytes: saved.sizeBytes,
                      expiresAt: saved.expiresAt.toISOString(),
                      kind: 'pdf',
                    });
                    return {
                      fileId: saved.fileId,
                      filename: saved.filename,
                      sizeBytes: saved.sizeBytes,
                      downloadUrl: saved.downloadUrl,
                    };
                  } catch (err) {
                    return {
                      error: err instanceof Error ? err.message : String(err),
                    };
                  }
                },
              }
            : {}),
          async onCreateFile({ filename, format, content }) {
            if (!isCreateFileFormat(format)) {
              return { error: `unsupported format: ${format}` };
            }
            try {
              const rendered = await renderFile(format, content);
              const taskInternalId = await taskInternalIdFor(ctx.db, taskId);
              if (taskInternalId == null) {
                return { error: 'task row not found' };
              }
              const stored = await fileService.storeOutput({
                userIdInternal: userRow.id,
                userExternalId: ctx.userId,
                taskIdInternal: taskInternalId,
                filename,
                mimetype: rendered.mimetype,
                buffer: rendered.buffer,
              });
              return {
                fileId: stored.externalId,
                filename: stored.filename,
                size: stored.sizeBytes,
                downloadUrl: `/api/files/${stored.externalId}/download`,
              };
            } catch (err) {
              return {
                error: err instanceof Error ? err.message : String(err),
              };
            }
          },
          onTick(ev) {
            // Synthesise a tick.start + tick.end pair per iteration so
            // the existing UI step cards light up without frontend
            // changes. actionKind is the first client-side tool the
            // model invoked this turn, or "text" when Claude just
            // spoke (e.g. mid-turn thinking → commentary).
            //
            // Also bump the per-user pool's lastActiveAt so an active
            // task never trips the 30-min idle GC — pool.touch is a
            // no-op when the user isn't on a pool slot.
            if (ctx.browserPool && perUserExec) {
              ctx.browserPool.touch(taskId);
            }
            const actionKind = ev.toolsInTurn[0] ?? 'text';
            const actionSummary = ev.textPreamble
              ? truncateString(stripPlanTrackerMarkers(ev.textPreamble), 80)
              : ev.toolsInTurn.join(', ') || 'thinking';
            const now = Date.now();
            try {
              broadcastToUser(userId, {
                type: 'server.vision.tick.start',
                taskId,
                tickIndex: ev.iteration,
                mode: 'screenshot',
              });
              broadcastToUser(userId, {
                type: 'server.vision.tick.end',
                taskId,
                tickIndex: ev.iteration,
                mode: 'screenshot',
                actionKind,
                actionSummary,
                durationMs: ev.apiLatencyMs,
                ok: true,
              });
            } catch (err) {
              ctx.logger.warn({ err, taskId }, 'supercar: broadcast tick failed');
            }
            // Persist the iteration to task_steps so history survives
            // reloads — same shape the legacy vision-loop uses.
            // Snapshot + reset pendingWebSearches so the async insert
            // below sees this iteration's batch even if the next
            // iteration starts before the insert finishes.
            const webSearches = pendingWebSearches;
            pendingWebSearches = [];
            if (taskDbId) {
              void (async () => {
                try {
                  await ctx.db.insert(taskSteps).values({
                    externalId: newExternalId('taskStep'),
                    taskId: taskDbId,
                    seq: ev.iteration,
                    kind: actionKind,
                    status: 'done',
                    riskLevel: 'low',
                    input: { summary: actionSummary },
                    output: {
                      apiLatencyMs: ev.apiLatencyMs,
                      tools: ev.toolsInTurn,
                      ...(webSearches.length > 0 ? { webSearches } : {}),
                    },
                    startedAt: new Date(now - ev.apiLatencyMs),
                    completedAt: new Date(now),
                  });
                } catch (err) {
                  ctx.logger.warn(
                    { err, taskId, iteration: ev.iteration },
                    'supercar: persist step failed',
                  );
                }
              })();
            }
          },
          onScreencast(ev) {
            try {
              broadcastToUser(userId, {
                type: 'server.vision.screencast',
                taskId,
                tickIndex: ev.iteration,
                imageBase64: ev.imageBase64,
                url: ev.url,
                viewport: { width: ev.viewportWidth, height: ev.viewportHeight },
                timestamp: new Date().toISOString(),
              });
            } catch (err) {
              ctx.logger.warn({ err, taskId }, 'supercar: broadcast screencast failed');
            }
          },
          onWebSearch(ev) {
            // Broadcasts as a synthetic tick so the UI shows a step
            // card for the search. No screencast — web_search is
            // server-side and has no DOM to capture. Sources (when
            // present) are forwarded so the SearchResultCard can
            // render favicon + title + snippet rows.
            //
            // Also buffer for the next onTick so the persisted step
            // row carries the sources — this is what lets a SPA
            // refresh-after-completion rebuild webSearchByTask from
            // tasks.detail instead of needing a WS replay.
            pendingWebSearches.push({
              query: ev.query,
              sources: ev.sources ?? [],
            });
            try {
              broadcastToUser(userId, {
                type: 'server.supercar.web_search',
                taskId,
                iteration: ev.iteration,
                query: ev.query,
                ...(ev.sources && ev.sources.length > 0 ? { sources: ev.sources } : {}),
              });
            } catch (err) {
              ctx.logger.warn({ err, taskId }, 'supercar: broadcast web_search failed');
            }
          },
          async onAwaitingUser(ev) {
            let awaitingPersisted = false;
            try {
              const persisted = await repo.persistAwaitingUser({
                taskExternalId: taskId,
                question: ev.question,
                awaitingKind: ev.awaitingKind,
              });
              awaitingPersisted = persisted.persisted;
            } catch (err) {
              ctx.logger.warn({ err, taskId }, 'supercar: persist awaiting_user state failed');
            }
            if (!awaitingPersisted) return;
            try {
              broadcastToUser(userId, {
                type: 'server.supercar.awaiting_user',
                taskId,
                question: ev.question,
                // P2-A — propagate kind to the SPA so the BrowserPanel
                // doesn't have to guess. WS receivers older than this
                // build will ignore the field (zod passthrough).
                awaitingKind: ev.awaitingKind,
              });
            } catch (err) {
              ctx.logger.warn({ err, taskId }, 'supercar: broadcast awaiting_user failed');
            }
            // Phase 1 follow-up — stamp `executionMode='browser'`,
            // `finalUrl`, AND `finalScreenshot` into result on park.
            //
            // Why screenshot on park (not just on terminal):
            // when the user refreshes the page during a login park,
            // the WS screencast disconnects and the BrowserPanel
            // would otherwise show a blank `about:blank`. With a
            // persisted `finalScreenshot` the SPA renders the last
            // visible frame instead of empty space.
            //
            // Why executionMode here: analytics / eval pipeline lane
            // classification reads result.metadata.executionMode OR
            // result.executionMode; without this, login parks fall
            // through to lane='unknown'.
            const parkUrl = ev.currentUrl;
            void (async () => {
              try {
                // Capture a screenshot off the per-task Brave. This
                // shares the captureFinalState helper used at terminal
                // — best-effort, returns {} on any failure (no
                // executor / page closed / capture timeout).
                const captured = perUserExec
                  ? await captureFinalState({
                      executor: {
                        getPage: () => perUserExec.getPage(),
                        screenshot: (page, options) =>
                          perUserExec.screenshot(
                            page as unknown as Parameters<PlaywrightExecutor['screenshot']>[0],
                            options,
                          ),
                      },
                      logger: ctx.logger,
                      taskId,
                    })
                  : {};
                const [row] = await ctx.db
                  .select({ result: tasksTable.result })
                  .from(tasksTable)
                  .where(eq(tasksTable.externalId, taskId))
                  .limit(1);
                const prev = (row?.result ?? {}) as Record<string, unknown>;
                const next: Record<string, unknown> = {
                  ...prev,
                  executionMode: 'browser',
                };
                // Prefer the URL the agent gave us via the event;
                // fall back to whatever captureFinalState read off
                // the page if `ev.currentUrl` was undefined.
                const finalUrl = parkUrl ?? captured.finalUrl;
                if (finalUrl) next.finalUrl = finalUrl;
                if (captured.finalScreenshot) {
                  next.finalScreenshot = captured.finalScreenshot;
                }
                if (captured.finalViewport) {
                  next.finalViewport = captured.finalViewport;
                }
                const persisted = await repo.persistAwaitingUserResult({
                  taskExternalId: taskId,
                  awaitingKind: ev.awaitingKind,
                  result: next,
                });
                if (!persisted.persisted) {
                  ctx.logger.info(
                    { taskId, awaitingKind: ev.awaitingKind },
                    'supercar: skipped stale park metadata write',
                  );
                }
              } catch (err) {
                ctx.logger.warn({ err, taskId }, 'supercar: persist park metadata failed');
              }
            })();
          },
          onThinking(summary) {
            try {
              broadcastToUser(userId, {
                type: 'server.supercar.thinking',
                taskId,
                summary: truncateString(summary, 2_000),
              });
            } catch (err) {
              ctx.logger.warn({ err, taskId }, 'supercar: broadcast thinking failed');
            }
          },
          onAntiBotSignal(ev) {
            // Reuse the vision-loop captcha_detected frame shape so the
            // task-store's existing captcha-wait banner lights up
            // without any frontend changes. BrowserPanel auto-flips to
            // interactive mode (Phase 2) when this fires, so the user
            // can solve a slider captcha in-panel.
            try {
              broadcastToUser(userId, {
                type: 'server.vision.captcha_detected',
                taskId,
                antiBotType: ev.signal.type,
                message: describeSignal(ev.signal),
                waitTimeoutMs: ev.waitTimeoutMs,
              });
            } catch (err) {
              ctx.logger.warn({ err, taskId }, 'supercar: broadcast captcha_detected failed');
            }
          },
          onAntiBotResolved(ev) {
            try {
              broadcastToUser(userId, {
                type: 'server.vision.captcha_resolved',
                taskId,
                reason: ev.reason,
              });
            } catch (err) {
              ctx.logger.warn({ err, taskId }, 'supercar: broadcast captcha_resolved failed');
            }
          },
        };
      // Phase 1 Day 5 Round 2 — initialise execution pipeline for
      // the supercar/browser lane. No-op when flags are off. Light
      // tier per the original Phase 1 spec (browser → light): the
      // verifier checks data_present + URL grounding + the optional
      // url_match (only when the resolver supplied a target domain).
      // Per-step navigation evidence isn't instrumented in agent-loop
      // yet — the post-runner hook below seeds the ledger with the
      // terminal browser state + response_length, which is enough
      // for the light-tier criteria to evaluate meaningfully.
      initExecution({
        taskId,
        intent: input.intent,
        executionMode: 'browser',
        expertWorkflowId: typedWorkflow?.workflowId ?? expertWorkflow?.id ?? null,
        hasAttachments: attachmentBlocks.length > 0,
      });
      // Codex Pack B1 — planning chip (supercar/browser lane). The
      // browsing chip fires later, right before the agent loop spins
      // up Brave; here we just signal that the runner is staged.
      broadcastSubStatus(ctx.userId, taskId, 'planning');
      // Captures the verifier's verdict so the .finally() persist
      // block can serialise it after the run terminates. Stays null
      // for any path that doesn't reach the verify hook (failures,
      // handoffs to generate, runner exceptions) — those rows just
      // get contract + ledger persisted with verification=null.
      let executionVerification: VerificationResult | null = null;
      const browserStartedAt = Date.now();
      // Phase 3 R1 — outer watchdog. The agent-loop has its OWN
      // deadline (SUPERCAR_TIMEOUT_MS, default 10 min) but if the
      // loop wedges (an Anthropic fetch never resolves, a Playwright
      // command hangs, etc.) the .finally() below never fires and
      // Brave + the per-task pool slot stay allocated until the
      // process restarts. The watchdog fires `internalDeadline +
      // 30s` and force-releases Brave + clears the pool slot. Idempotent
      // with the .finally release (browser-pool.release on a
      // non-allocated slot no-ops).
      const SUPERCAR_TIMEOUT_MS = Number.parseInt(
        process.env.SUPERCAR_TIMEOUT_MS ?? '600000',
        10,
      );
      const WATCHDOG_GRACE_MS = 30_000;
      let watchdogFinalized = false;
      const watchdogTimer = setTimeout(() => {
        ctx.logger.warn(
          {
            taskId,
            userId: ctx.userId,
            watchdogMs: SUPERCAR_TIMEOUT_MS + WATCHDOG_GRACE_MS,
          },
          'supercar: watchdog fired — forcing brave release (agent-loop may be wedged)',
        );
        // Step 1: tell agent-loop to abort. If it's in a non-blocking
        // state (between API calls / tool steps) it'll exit cleanly
        // and the .finally below still fires the regular release.
        try {
          supercarAbort(taskId);
        } catch {
          /* swallow — abort is best-effort */
        }
        // Step 2: mark the user-visible task terminal. The old
        // watchdog only released Brave; if the agent loop stayed
        // wedged, the DB row remained `executing` until the next
        // orchestrator restart boot-sweep. That looked like an
        // endless task to the user and kept quota/concurrency noisy.
        void (async (): Promise<void> => {
          const reason = '任务执行超时，已自动停止。建议：简化任务描述后重试。';
          try {
            const persisted = await repo.persistVisionOutcome(taskId, {
              status: 'failed',
              reason,
              tickCount: 0,
              errorCode: 'SUPERCAR_WATCHDOG_TIMEOUT',
              metadata: { executionMode: 'browser', watchdog: true },
            });
            watchdogFinalized = persisted.persisted;
            if (persisted.persisted) {
              broadcastToUser(userId, {
                type: 'server.task.terminal',
                taskId,
                status: 'failed',
                reason,
              });
            }
          } catch (err) {
            watchdogFinalized = false;
            ctx.logger.warn(
              { err: err instanceof Error ? err.message : String(err), taskId },
              'supercar: watchdog failed to persist terminal timeout',
            );
          }
        })();
        // Step 3: force-release the per-task Brave even if abort
        // didn't take. The pool's release method is idempotent: a
        // second call when the slot is already torn down no-ops.
        if (didAllocatePool && ctx.browserPool) {
            void ctx.browserPool.release(taskId, 'watchdog-force-release').catch((relErr) => {
              ctx.logger.warn(
                { err: relErr, taskId, userId: ctx.userId },
                'pool: watchdog force-release failed',
              );
            });
        }
      }, SUPERCAR_TIMEOUT_MS + WATCHDOG_GRACE_MS);
      // Mark the timer as unref'd so it doesn't keep the Node process
      // alive on shutdown — the pool's own draining handles cleanup.
      watchdogTimer.unref?.();
      // Codex Pack B1 — browsing chip fires right before the agent
      // loop actually runs (Brave allocate, first tool call, etc.).
      broadcastSubStatus(ctx.userId, taskId, 'browsing');
      // B-专项 Step 2 — read-only OTA user-browser lane. ONLY when the
      // OTA_USER_BROWSER flag is on AND the user's extension is online
      // AND the intent matches an OTA-prefer site. Otherwise this is a
      // no-op and the task runs the server-Brave supercar exactly as
      // today. The readonly runner uses the extension's Mode B
      // navigate/screenshot channel (no chrome.debugger, no click/type,
      // no order/pay) and returns a SupercarOutcome consumed by the same
      // terminal handler below.
      // Step 2.5 — canary-scoped gate. user-browser-readonly fires ONLY
      // for an allowlisted user + allowlisted OTA domain + online
      // extension, on top of the master flag. Empty allowlists (prod
      // default) ⇒ nobody is canaried ⇒ server Brave for everyone.
      const otaExtensionOnline = hasConnectedExtension(ctx.userId);
      const otaMasterEnabled =
        getExecutionFeatureFlags().OTA_USER_BROWSER && Boolean(anthropicForResolver);
      const otaAllowedDomains = parseOtaAllowlist(process.env.OTA_USER_BROWSER_ALLOWED_DOMAINS);
      const otaCanary = resolveOtaCanaryLane({
        intent: input.intent,
        userId: ctx.userId,
        extensionOnline: otaExtensionOnline,
        masterEnabled: otaMasterEnabled,
        allowedUserIds: parseOtaAllowlist(process.env.OTA_USER_BROWSER_ALLOWED_USER_IDS),
        allowedDomains: otaAllowedDomains,
      });
      const useOtaUserBrowser = otaCanary.lane === 'user-browser';
      if (otaCanary.lane !== null) {
        // Rollout audit — every OTA-prefer task records its gate outcome.
        ctx.logger.info(
          {
            event: 'ota.user_browser.rollout',
            taskId,
            userId: ctx.userId,
            domain: otaCanary.matchedDomain,
            flagEnabled: otaMasterEnabled,
            userAllowed: otaCanary.userAllowed,
            domainAllowed: otaCanary.domainAllowed,
            extensionOnline: otaExtensionOnline,
            intentSubtype: otaCanary.intentSubtype,
            subtypeReason: otaCanary.reason,
            decision: otaCanary.lane,
            reason: otaCanary.reason,
          },
          'ota: user-browser rollout decision',
        );
      }
      const runUserBrowserReadonly = (): Promise<SupercarOutcome> =>
        runOtaUserBrowserReadonly({
          taskId,
          intent: effectiveIntent,
          deps: {
            client: anthropicForResolver!,
            dispatchNavigate: async (url: string) => {
              const r = await sendExtensionToolCall(ctx.userId, {
                taskId,
                kind: 'navigate',
                args: { url },
              });
              return r.ok
                  ? {
                      ok: true,
                      result: r.result as { finalUrl: string; title: string; bodyText: string },
                    }
                : { ok: false, error: r.error };
            },
            dispatchScreenshot: () =>
              sendExtensionToolCall(ctx.userId, { taskId, kind: 'screenshot' }),
            audit: (rec) => ctx.logger.info(rec, 'ota: user-browser audit'),
              onProgress: (message) => broadcastSubStatus(ctx.userId, taskId, 'browsing', message),
            logger: ctx.logger,
            allowedDomains: otaAllowedDomains,
          },
        });
      const runFn = () =>
        (useOtaUserBrowser
          ? runUserBrowserReadonly()
          : runSupercarWithRetry(supercarArgs, { userId, taskId, logger: ctx.logger })
        )
          .then(async (outcome) => {
            ctx.logger.info(
                {
                  taskId,
                  status: outcome.status,
                  iterations: outcome.iterations,
                  toolsUsed: outcome.toolsUsed,
                },
              'supercar: task terminated',
            );
            if (watchdogFinalized) {
              ctx.logger.warn(
                { taskId, status: outcome.status },
                'supercar: late runner outcome ignored after watchdog terminal persist',
              );
              return;
            }
            // F1 — handoff to generate. User replied with manual data
            // (numeric metrics, "数据如下:", etc.); supercar exited
            // without continuing the browser loop. Run generate against
            // the original intent + the user's data and persist THAT
            // outcome under this task id. No new task row, no quota
            // re-charge — same task, same id, just a different runner.
            if (outcome.status === 'handoff_to_generate') {
              const userManualData = outcome.question ?? '';
              const combinedIntent = [
                input.intent,
                  userManualData ? `\n\n[用户提供的数据]\n${userManualData}` : '',
                ]
                  .join('')
                  .trim();
              ctx.logger.info(
                {
                  taskId,
                  userId,
                  manualDataLen: userManualData.length,
                  combinedIntentLen: combinedIntent.length,
                },
                'supercar: handoff to generate runner',
              );
              const handoffStartedAt = Date.now();
              let generateOutcome;
              try {
                generateOutcome = await runGenerateTask({
                  taskId,
                  userId: ctx.userId,
                  intent: combinedIntent,
                  workflowOverride: typedWorkflow,
                  skillId: dispatchSkillId,
                  client: anthropicForResolver!,
                  logger: ctx.logger,
                    ...(attachmentBlocks.length > 0 ? { attachments: attachmentBlocks } : {}),
                  onStreamDelta: (delta) => {
                    try {
                      broadcastToUser(userId, {
                        type: 'server.task.stream',
                        taskId,
                        delta,
                      });
                    } catch (err) {
                      ctx.logger.warn(
                        { err, taskId },
                        'handoff-generate: broadcast stream delta failed',
                      );
                    }
                  },
                });
              } catch (err) {
                  ctx.logger.error({ err, taskId }, 'handoff-generate: runner threw');
                generateOutcome = {
                  status: 'failed' as const,
                  summary: '',
                    reason: err instanceof Error ? err.message : 'handoff-generate: unknown error',
                  inputTokens: 0,
                  outputTokens: 0,
                  durationMs: 0,
                };
              }
              const elapsedMs = Date.now() - handoffStartedAt;
              const metadata = {
                executionMode: 'browser' as const,
                finalExecutionMode: 'generate' as const,
                expertWorkflowId: typedWorkflow?.workflowId ?? expertWorkflow?.id ?? null,
                expertMode: expertModeOverride,
                selectedRole: dispatchRoleId,
                model: 'claude-sonnet-4-6',
                fallbackChain: ['browser', 'generate'],
                elapsedMs,
                modelFinalText:
                  generateOutcome.status === 'completed'
                    ? (generateOutcome.summary ?? '').slice(0, 200)
                    : null,
              };
              ctx.logger.info(
                {
                  taskId,
                  userId,
                  finalStatus: generateOutcome.status,
                  ...metadata,
                  failureReason:
                      generateOutcome.status === 'failed' ? generateOutcome.reason : null,
                },
                'task:completed',
              );
              // Optimization #2 (Codex follow-up) — format the
              // handoff-generate output. Unlike the standalone
              // generate/scrape lanes this path has no upstream
              // verifier, but the formatter's deterministic
              // post-check (no new URLs / numbers, no marker drops)
              // still applies. Flag-off → no-op.
              const handoffRl = await runResponseLayerForLane({
                taskId,
                status: generateOutcome.status,
                  summary: generateOutcome.status === 'completed' ? generateOutcome.summary : '',
                  expertWorkflowId: typedWorkflow?.workflowId ?? expertWorkflow?.id ?? null,
                logger: ctx.logger,
              });
              if (
                generateOutcome.status === 'completed' &&
                handoffRl.summary !== generateOutcome.summary
              ) {
                generateOutcome = {
                  ...generateOutcome,
                  summary: handoffRl.summary,
                };
              }
              let handoffTerminalPersisted = false;
              try {
                if (generateOutcome.status === 'completed') {
                  const persisted = await repo.persistVisionOutcome(taskId, {
                    status: 'completed',
                    summary: generateOutcome.summary,
                    tickCount: outcome.iterations,
                    metadata,
                  });
                  handoffTerminalPersisted = persisted.persisted;
                  // P1 — generate has no plan-step marker discipline
                  // (no [STEP N done] emission), so any pending /
                  // running steps left over from the supercar's
                  // browser phase would freeze at "x/N 完成" forever
                  // even though the user just got a complete answer.
                  // Roll them all to done now and broadcast so the
                  // PlanCard catches up. Best-effort: a DB blip
                  // can't block terminal broadcast.
                  if (persisted.persisted) {
                    void convergePlanStatusOnSuccess(ctx, taskId, userId);
                    broadcastToUser(userId, {
                      type: 'server.task.terminal',
                      taskId,
                      status: 'completed',
                        ...(generateOutcome.summary ? { summary: generateOutcome.summary } : {}),
                    });
                  }
                } else {
                  const persisted = await repo.persistVisionOutcome(taskId, {
                    status: 'failed',
                      reason: generateOutcome.reason ?? 'handoff-generate: api failed',
                    tickCount: outcome.iterations,
                    metadata,
                  });
                  handoffTerminalPersisted = persisted.persisted;
                  if (persisted.persisted) {
                    broadcastToUser(userId, {
                      type: 'server.task.terminal',
                      taskId,
                      status: 'failed',
                        ...(generateOutcome.reason ? { reason: generateOutcome.reason } : {}),
                    });
                  }
                }
              } catch (err) {
                  ctx.logger.error({ err, taskId }, 'handoff-generate: persist/broadcast failed');
              }
              // Stamp metadata columns after persist. Safe to call
              // only when the terminal row actually landed. The
              // helper itself guards terminal source statuses; this
              // extra gate prevents a late handoff result from
              // stamping formatter metadata onto a task that was
              // already cancelled or otherwise superseded.
              if (handoffTerminalPersisted) {
                await stampResponseLayerColumns(
                  ctx.db,
                  taskId,
                  handoffRl.responseLayerOriginal,
                    generateOutcome.status === 'completed' ? generateOutcome.summary : '',
                  handoffRl.responseLayerMetadata,
                  ctx.logger,
                );
              }
              return;
            }
            // R7 — grab the final-state evidence BEFORE persistSupercar
            // and pool.release. The BrowserPanel renders the static
            // screenshot for terminal tasks instead of trying to
            // reconnect the screencast WS to a torn-down Brave.
            // Skip for non-browser-mode tasks (perUserExec is null
            // when executionMode='generate' / 'scrape' — there's no
            // browser to screenshot).
            const finalState = perUserExec
              ? await captureFinalState({
                  executor: {
                    getPage: () => perUserExec.getPage(),
                    screenshot: (page, options) =>
                      perUserExec.screenshot(
                        page as unknown as Parameters<PlaywrightExecutor['screenshot']>[0],
                        options,
                      ),
                  },
                  logger: ctx.logger,
                  taskId,
                })
              : {};
            // B3 — structured eval log fields. Persisted under
            // result.metadata so tasks.detail consumers (Codex eval
            // pipeline) get them without a schema migration. Same
            // shape as the scrape / generate fork logs above so
            // downstream parsing is uniform.
            const elapsedMs = Date.now() - browserStartedAt;
            const metadata: Record<string, unknown> = {
              executionMode: executionMode === 'browser' ? 'browser' : executionMode,
              finalExecutionMode: executionMode === 'browser' ? 'browser' : executionMode,
              expertWorkflowId: typedWorkflow?.workflowId ?? expertWorkflow?.id ?? null,
              expertMode: expertModeOverride,
              selectedRole: dispatchRoleId,
              model: opusActuallyConsumed ? 'claude-opus-4-7' : 'claude-sonnet-4-6',
              fallbackChain: ['browser'],
              elapsedMs,
              iterations: outcome.iterations,
              toolsUsed: outcome.toolsUsed,
              // awaitingUserCount isn't exposed on SupercarOutcome
              // today — Codex pipeline can derive it from
              // task_events `vision.paused` rows for now. Stub at 0.
              awaitingUserCount: 0,
              modelFinalText:
                  outcome.status === 'completed' ? (outcome.summary ?? '').slice(0, 200) : null,
              ...(finalState.finalUrl ? { finalUrl: finalState.finalUrl } : {}),
              ...(finalState.finalViewport ? { finalViewport: finalState.finalViewport } : {}),
              hasFinalScreenshot: Boolean(finalState.finalScreenshot),
            };
            // Phase 3 R3 — L1 auto-save final screenshot as a
            // downloadable file. Only fires when:
            //   1. The task is in browser-mode (finalState came from
            //      captureFinalState which is null for generate/scrape)
            //   2. We actually captured a screenshot (lone "browser
            //      crashed before goto" failures leave finalScreenshot
            //      empty)
            //   3. There's a task DB id to attach to (taskDbId is set
            //      after the initial insert; falsy only on a code-path
            //      bug we'd want to log anyway)
            // Failures here log + continue — the user's task still
            // completes; they just lose the downloadable artifact.
            // The screenshot's base64 form is already inside
            // metadata.result via persistVisionOutcome, so the SPA's
            // BrowserPanel still has a frame to render.
              let screenshotAttachment:
                | import('../../files/download-manager.js').DownloadResult
                | null = null;
            if (
              finalState.finalScreenshot &&
              taskDbId &&
              outcome.status !== 'cancelled' &&
              ctx.downloadManager
            ) {
              try {
                // captureFinalState pulls a JPEG (quality 80) off the
                // PlaywrightExecutor (vision-loop/playwright-executor.ts
                // L610: `page.screenshot({ type: 'jpeg', quality: 80 })`).
                // Earlier this code labeled it as PNG, so downloads ended
                // up as foo.png containing JPEG bytes — most viewers fall
                // back on sniffing, but eval pipelines + strict viewers
                // (Slack preview, some PDF embedders) refuse to render.
                screenshotAttachment = await ctx.downloadManager.save({
                  userIdInternal: userRow.id,
                  userExternalId: ctx.userId,
                  taskIdInternal: taskDbId,
                  content: finalState.finalScreenshot,
                  filename: `screenshot-${taskId}.jpg`,
                  mimetype: 'image/jpeg',
                });
                ctx.logger.info(
                  {
                    taskId,
                    fileId: screenshotAttachment.fileId,
                    sizeBytes: screenshotAttachment.sizeBytes,
                  },
                  'L1: final screenshot saved as downloadable file',
                );
                // Surface to SPA + eval-runner via result.metadata.
                // The shape mirrors what the L2 save_pdf tool will
                // produce, so consumers iterate one homogeneous list.
                const attachments = (metadata.attachments as unknown[]) ?? [];
                metadata.attachments = [
                  ...attachments,
                  {
                    fileId: screenshotAttachment.fileId,
                    downloadUrl: screenshotAttachment.downloadUrl,
                    filename: screenshotAttachment.filename,
                    mimetype: screenshotAttachment.mimetype,
                    sizeBytes: screenshotAttachment.sizeBytes,
                    expiresAt: screenshotAttachment.expiresAt.toISOString(),
                    kind: 'screenshot',
                  },
                ];
              } catch (err) {
                ctx.logger.warn(
                  { err: err instanceof Error ? err.message : String(err), taskId },
                  'L1: final screenshot save failed (non-fatal)',
                );
              }
            }
            // Codex P3 follow-up — fold any save_page_as_pdf outputs the
            // agent accumulated during the run into metadata.attachments
            // alongside the L1 screenshot. The accumulator is appended
            // (not replaced) so the screenshot block above (which
            // already wrote to metadata.attachments) stays intact.
            if (pdfAttachments.length > 0) {
              const existing = (metadata.attachments as unknown[]) ?? [];
              metadata.attachments = [...existing, ...pdfAttachments];
              ctx.logger.info(
                {
                  taskId,
                  pdfCount: pdfAttachments.length,
                  fileIds: pdfAttachments.map((a) => a.fileId),
                },
                'L2: folded save_page_as_pdf outputs into metadata.attachments',
              );
            }
            ctx.logger.info(
              {
                taskId,
                userId,
                finalStatus: outcome.status,
                ...metadata,
                failureReason:
                  outcome.status === 'failed' || outcome.status === 'timeout'
                    ? outcome.reason
                    : null,
              },
              'task:completed',
            );
            // Phase 1 follow-up — sanitise the supercar's final
            // answer before any downstream step (verification,
            // persistence, broadcast). Tool-XML scaffolding from
            // computer_20251124 traces leaks here more often than
            // in the generate / scrape lanes.
            if (outcome.status === 'completed' && outcome.summary) {
              const cleaned = sanitizeFinalText(outcome.summary);
              if (cleaned !== outcome.summary) {
                outcome = { ...outcome, summary: cleaned };
              }
            }
            // Phase 24 RC follow-up — nav-failure safety net.
            // Codex caught the "false success" case: bare-URL tasks
            // like `打开 https://thisdomaindoesnotexist12345.com`
            // would land with status=completed and a summary that's
            // just the friendly DNS error message. The agent thinks
            // it completed (it accurately reported the failure), but
            // the user's goal (open the page) was never reached, so
            // labelling the row "已完成" is misleading. detectNavFailure
            // pattern-matches a short summary against DNS / SSL /
            // timeout / refused signals; on a hit we flip the row
            // to failed BEFORE the verifier + persist run. Long
            // legitimate reports that happen to mention a nav error
            // as one bullet are not flipped (≤400 char gate).
            if (outcome.status === 'completed' && outcome.summary) {
              const navSignal = detectNavFailure(outcome.summary);
              if (navSignal.detected) {
                ctx.logger.info(
                  {
                    taskId,
                    matchedPattern: navSignal.matchedPattern,
                    kind: navSignal.kind,
                  },
                  'supercar: nav-failure detector tripped — downgrading completed → failed',
                );
                outcome = {
                  ...outcome,
                  status: 'failed',
                  reason: navSignal.reason ?? '导航失败，未完成任务',
                };
              }
            }
            // File-artifact consistency (B). The agent creates
            // downloadable files via the create_file tool and is told
            // to surface them with a ```holaday-file fence in the final
            // answer; QA found ~1/3 of file tasks where the prose claims
            // a file but the fence is omitted/garbled, so the user is
            // told to click a download that isn't there. Fold any
            // created output file NOT already referenced by a fence into
            // metadata.attachments — the SPA's AttachmentBar then renders
            // a download card without any SPA change. Deduped against
            // fences so a correctly-surfaced file isn't doubled.
            let outputDocDescriptors: Array<{ filename: string; mimetype: string }> = [];
            if (taskDbId && outcome.status === 'completed') {
              try {
                const now = Date.now();
                // DOCUMENT outputs only — the auto-final-screenshot is
                // also a kind='output' row (added to attachments by L1
                // above) and must not be re-folded here nor count as the
                // claimed PDF/Markdown artifact.
                const outputDocs = (await fileService.listForTask(taskDbId)).filter(
                  (f) =>
                    f.kind === 'output' &&
                    f.status !== 'expired' &&
                    (f.expiresAt == null || f.expiresAt.getTime() > now) &&
                    isDocumentOutput({ filename: f.filename, mimetype: f.mimetype }),
                );
                outputDocDescriptors = outputDocs.map((f) => ({
                  filename: f.filename,
                  mimetype: f.mimetype,
                }));
                if (outputDocs.length > 0) {
                  const fenced = fencedFileIds(outcome.summary ?? '');
                  const existing = (metadata.attachments as Array<{ fileId?: unknown }>) ?? [];
                  const alreadyAttached = new Set(
                    existing.map((a) => (typeof a.fileId === 'string' ? a.fileId : '')),
                  );
                  const unfenced = outputDocs.filter(
                    (f) => !fenced.has(f.externalId) && !alreadyAttached.has(f.externalId),
                  );
                  if (unfenced.length > 0) {
                    metadata.attachments = [
                      ...existing,
                      ...unfenced.map((f) => ({
                        fileId: f.externalId,
                        downloadUrl: `/api/files/${f.externalId}/download`,
                        filename: f.filename,
                        mimetype: f.mimetype,
                        sizeBytes: f.sizeBytes,
                        expiresAt: f.expiresAt ? f.expiresAt.toISOString() : null,
                        kind: 'file',
                      })),
                    ];
                    ctx.logger.info(
                      { taskId, recovered: unfenced.map((f) => f.externalId) },
                      'file-artifact: folded un-fenced document outputs into metadata.attachments',
                    );
                  }
                }
              } catch (err) {
                ctx.logger.warn(
                  { err: err instanceof Error ? err.message : String(err), taskId },
                  'file-artifact: output-file fold failed (non-fatal)',
                );
              }
            }
            // Phase 1 Day 5 Round 2 — pipeline verification on the
            // supercar/browser final answer. Mirrors the generate +
            // scrape pattern: seed terminal-state evidence into the
            // ledger, then run the verifier. autoFix can substitute
            // a fabricated URL with a grounded one BEFORE
            // persistSupercarOutcome writes the row, so the user
            // sees the corrected text on first render.
            if (outcome.status === 'completed' && outcome.summary) {
              if (finalState.finalUrl) {
                recordEvidence(taskId, {
                  fact: `final_url=${finalState.finalUrl}`,
                  sourceType: 'browser_state',
                  sourceDetail: 'supercar terminal state',
                  confidence: 'observed',
                });
              }
              recordEvidence(taskId, {
                fact: `response_length=${outcome.summary.length}`,
                sourceType: 'tool_result',
                sourceDetail: 'supercar agent response',
                confidence: 'observed',
              });
              // Codex Pack B1 — verifying chip (supercar lane).
              broadcastSubStatus(ctx.userId, taskId, 'verifying');
              const verified: VerifyOutput = await verifyAndFinalize({
                taskId,
                answerText: outcome.summary,
                ...(finalState.finalUrl ? { finalUrl: finalState.finalUrl } : {}),
                client: anthropicForResolver,
                logger: ctx.logger,
                // File-artifact guard (C): a download claim with no
                // fence AND no matching DOCUMENT output → fixable. The
                // screenshot is excluded from outputDocDescriptors.
                outputFiles: outputDocDescriptors,
              });
              if (verified.finalText !== outcome.summary) {
                outcome = { ...outcome, summary: verified.finalText };
              }
              executionVerification = verified.verification;
            }
            // Codex Pack A3 — verifier verdict drives the supercar lane
            // terminal status. The override flows through both
            // persistSupercarOutcome (DB write) and buildTaskTerminalMessage
            // (WS broadcast) via the new verdict params.
            const supercarTerminalStatus: FinalTerminalStatus = deriveFinalStatus(
              outcome.status,
              executionVerification,
            );
            const supercarFailureSummary =
              supercarTerminalStatus === 'failed' && executionVerification
                ? summariseVerificationFailure(executionVerification)
                : null;
            const supercarFailedChecks =
              executionVerification && !executionVerification.passed
                ? extractFailedChecks(executionVerification)
                : undefined;
            const supercarStateTransition = classifySupercarTaskStateTransition({
              status: outcome.status,
              question: outcome.question,
              summary: outcome.summary,
            });
            // Optimization #2 — OpenAI response formatter / style
            // layer. Runs AFTER the verifier (so we polish facts that
            // have already been grounded) and BEFORE persistence. The
            // shouldFormat guard short-circuits on short response
            // (unless expert workflow); the deterministic post-check
            // refuses any rewrite that introduces new URLs / numbers
            // or drops a marker. On fallback the formatted text equals
            // the original — caller sees no visible change, the
            // metadata records the reason.
            //
            // Codex P2 follow-up — the flag check is hoisted to the
            // CALLER so flag-off → zero DB writes (original_summary /
            // formatted_summary / response_layer_metadata stay NULL).
            // Without this gate, the always-flow wrote an audit row
            // for every terminal task even when no user had opted in.
            let responseLayerOriginal: string | undefined;
            let responseLayerMetadata: unknown = undefined;
            // Inline flag gate — kept in sync with
            // openai-response-layer.ts `isResponseLayerEnabled`. Inline
            // (vs. import + call) so the common flag-off path avoids
            // loading the response-layer module + its `openai` dep at
            // every terminal.
            const responseLayerFlag = (
              process.env.OPENAI_RESPONSE_LAYER_ENABLED ?? 'false'
            ).toLowerCase();
            const responseLayerActive =
              (responseLayerFlag === 'true' || responseLayerFlag === '1') &&
              !!process.env.OPENAI_API_KEY;
            const responseLayerTerminalStatus =
              supercarResponseLayerTerminalStatus(supercarTerminalStatus);
              if (responseLayerTerminalStatus && outcome.summary && responseLayerActive) {
              try {
                const { format: formatResponse } = await import(
                  '../../response-layer/openai-response-layer.js'
                );
                const fmt = await formatResponse(
                  {
                    original: outcome.summary,
                    terminalStatus: responseLayerTerminalStatus,
                    expertWorkflowId:
                      typeof metadata?.expertWorkflowId === 'string'
                        ? metadata.expertWorkflowId
                        : undefined,
                  },
                  { logger: ctx.logger },
                );
                if (fmt.formatted !== outcome.summary) {
                  responseLayerOriginal = outcome.summary;
                  outcome = { ...outcome, summary: fmt.formatted };
                }
                responseLayerMetadata = fmt.metadata;
              } catch (err) {
                // Belt-and-braces — format() already catches its own
                // errors; a throw here would be a programming bug.
                ctx.logger.warn(
                  { err: err instanceof Error ? err.message : String(err), taskId },
                  'openai-response-layer: unexpected throw — keeping original',
                );
              }
            }
            let terminalPersisted = false;
            if (supercarStateTransition.kind === 'waiting_user') {
              try {
                const finalFields = finalStatePersistFields(finalState);
                const waitingPersisted = await repo.persistAwaitingUser({
                  taskExternalId: taskId,
                  question: supercarStateTransition.question,
                  awaitingKind: supercarStateTransition.awaitingKind,
                  result: {
                    ...(metadata ?? {}),
                    executionMode:
                      typeof metadata?.executionMode === 'string'
                        ? metadata.executionMode
                        : 'browser',
                    ...finalFields,
                  },
                });
                if (waitingPersisted.persisted) {
                    broadcastToUser(
                      userId,
                      buildSupercarWaitingUserMessage({
                    taskId,
                    transition: supercarStateTransition,
                      }),
                    );
                }
              } catch (err) {
                ctx.logger.warn(
                  { err, taskId },
                  'supercar: persist/broadcast awaiting_user fallback failed',
                );
              }
            } else {
              const terminalResult = await persistSupercarOutcome(
                repo,
                taskId,
                outcome,
                finalState,
                metadata,
                supercarTerminalStatus,
                supercarFailureSummary,
                supercarFailedChecks,
              );
              terminalPersisted = terminalResult.persisted;
            }
            // Optimization #2 — stamp the formatter columns. Best-
            // effort UPDATE after the row landed; failure here logs
            // but doesn't tear down the terminal flow. Only writes
            // when we actually have something to record (formatter
            // ran, even if it fell back).
            if (terminalPersisted && responseLayerMetadata) {
              try {
                const stamped = await stampResponseLayerColumns(
                  ctx.db,
                  taskId,
                  responseLayerOriginal,
                  outcome.summary ?? '',
                  responseLayerMetadata,
                  ctx.logger,
                );
                if (!stamped) {
                  ctx.logger.warn(
                    { taskId },
                    'openai-response-layer: supercar stamp skipped because task was no longer terminal',
                  );
                }
              } catch (err) {
                ctx.logger.warn(
                  { err: err instanceof Error ? err.message : String(err), taskId },
                  'openai-response-layer: persist metadata failed (non-fatal)',
                );
              }
            }
            // Reconcile-driven step rewrite. When the agent loop's
            // reconcileFinalAnswer rewrote the model's text (URL or
            // title mismatched the live page), the LAST step row's
            // `input.summary` and the matching `tick.end` actionSummary
            // are now stale. The "最近操作" overlay reads from steps,
            // not summary, so without this rewrite the user opens the
            // overlay and still sees the wrong URL the model invented.
            // Best-effort: a DB / broadcast blip leaves the row stale
            // but doesn't impact terminal flow.
            if (outcome.reconciledStepUpdate && taskDbId) {
              const upd = outcome.reconciledStepUpdate;
              try {
                await ctx.db
                  .update(taskSteps)
                  .set({ input: { summary: upd.actionSummary } })
                    .where(and(eq(taskSteps.taskId, taskDbId), eq(taskSteps.seq, upd.tickIndex)));
              } catch (err) {
                ctx.logger.warn(
                  { err, taskId, tickIndex: upd.tickIndex },
                  'supercar: persist reconciled step failed',
                );
              }
              try {
                broadcastToUser(userId, {
                  type: 'server.vision.tick.end',
                  taskId,
                  tickIndex: upd.tickIndex,
                  mode: 'screenshot',
                  actionKind: 'text',
                  actionSummary: upd.actionSummary,
                  durationMs: 0,
                  ok: true,
                });
              } catch (err) {
                ctx.logger.warn(
                  { err, taskId, tickIndex: upd.tickIndex },
                  'supercar: broadcast reconciled step failed',
                );
              }
            }
            // Codex P3 follow-up — gate terminal-only side effects on
            // `terminalPersisted`. When the atomic state-machine guard
            // refused the UPDATE (row still in awaiting_user — happens
            // when a takeover-timeout fires AFTER the user already
            // came back and replied), the WS terminal frame would
            // clobber the in-progress state in the SPA store, memory
            // extraction would store a half-finished summary, and a
            // stale suggestion bubble would surface alongside the
            // running task. Skip all three when the row didn't move.
            const runTerminalSideEffects = shouldRunSupercarTerminalSideEffects({
              transition: supercarStateTransition,
              persisted: terminalPersisted,
            });
            if (!runTerminalSideEffects) {
              ctx.logger.info(
                { taskId, transition: supercarStateTransition.kind },
                'supercar: skipping terminal broadcast / memory / suggestions',
              );
            }
            if (runTerminalSideEffects) {
              try {
                // Codex Round 2 P1-6 — surface verifier failed checks
                // to the SPA banner. Only populated when verifier
                // verdict failed; empty list omitted by helper.
                broadcastToUser(
                  userId,
                  buildTaskTerminalMessage(
                    taskId,
                    outcome,
                    supercarTerminalStatus,
                    supercarFailureSummary,
                    supercarFailedChecks,
                  ),
                );
              } catch (err) {
                ctx.logger.warn({ err, taskId }, 'supercar: broadcast terminal failed');
              }
            }
            // Phase 13 Dim 5 — memory extraction. Run only on
            // completed tasks to avoid storing tips from the
            // partial / failed state of the agent. Best-effort:
            // rejections log + continue (the user's task is done
            // regardless of memory outcome).
              if (
                terminalPersisted &&
                outcome.status === 'completed' &&
                outcome.summary &&
                appEnv.ANTHROPIC_API_KEY
              ) {
              void memoryService
                .extractAndStore({
                  apiKey: appEnv.ANTHROPIC_API_KEY,
                  userIdInternal: userRow.id,
                  intent: input.intent,
                  summary: outcome.summary,
                  taskId,
                })
                  .catch((err) => ctx.logger.warn({ err, taskId }, 'memory: extract crashed'));

              // O5 — backend-generated suggestions. The agent's
              // in-summary `suggestions` block is unreliable
              // (model omits it under some prompts); a dedicated
              // Sonnet call is more consistent. Fire-and-forget so
              // the user gets the terminal frame immediately and
              // suggestions trickle in a second later.
              void generateSuggestions({
                apiKey: appEnv.ANTHROPIC_API_KEY,
                intent: input.intent,
                summary: outcome.summary,
              })
                .then((suggestions) => {
                  if (suggestions.length === 0) return;
                  try {
                    broadcastToUser(userId, {
                      type: 'server.supercar.suggestions',
                      taskId,
                      suggestions,
                    });
                  } catch (err) {
                      ctx.logger.warn({ err, taskId }, 'suggestions: broadcast failed');
                  }
                })
                .catch((err) =>
                  ctx.logger.warn({ err, taskId }, 'suggestions: generate crashed'),
                );
            }
          })
          .catch(async (err) => {
            // Phase 22a — uncaught throws used to leave the task at
            // status='executing' forever (the .then chain didn't run,
            // so persistSupercarOutcome was never called). Persist a
            // failed outcome here BEFORE logging so the task always
            // reaches a terminal state. Wrapped in its own try so a
            // DB blip during the recovery persist doesn't bubble up
            // and tear down the .finally below.
            const reason = err instanceof Error ? err.message : String(err);
              ctx.logger.error({ err, taskId }, 'supercar: loop threw — persisting failed');
            // Codex P3 follow-up — same `persisted` gate as the happy
            // path. If the runner threw AFTER the row landed in
            // awaiting_user (rare but possible: runtime stack unwind
            // after the agent fired onAwaitingUser), don't broadcast
            // terminal-failed and clobber the park state.
            let catchPersisted = false;
            try {
              const failureFinalState = perUserExec
                ? await captureFinalState({
                    executor: {
                      getPage: () => perUserExec.getPage(),
                      screenshot: (page, options) =>
                        perUserExec.screenshot(
                          page as unknown as Parameters<PlaywrightExecutor['screenshot']>[0],
                          options,
                        ),
                    },
                    logger: ctx.logger,
                    taskId,
                  })
                : {};
              const out = await repo.persistVisionOutcome(taskId, {
                status: 'failed',
                reason: `runner threw: ${reason}`.slice(0, 500),
                tickCount: 0,
                  ...(failureFinalState.finalUrl ? { finalUrl: failureFinalState.finalUrl } : {}),
                ...(failureFinalState.finalScreenshot
                  ? { finalScreenshot: failureFinalState.finalScreenshot }
                  : {}),
                ...(failureFinalState.finalViewport
                  ? { finalViewport: failureFinalState.finalViewport }
                  : {}),
                metadata: {
                  executionMode,
                  finalExecutionMode: executionMode,
                  lane: 'supercar_exception',
                },
              });
              catchPersisted = out.persisted;
            } catch (persistErr) {
              ctx.logger.error(
                { err: persistErr, taskId },
                'supercar: catch-block persist also failed',
              );
            }
            if (catchPersisted) {
              try {
                broadcastToUser(userId, {
                  type: 'server.task.terminal',
                  taskId,
                  status: 'failed',
                  reason: `runner threw: ${reason}`.slice(0, 200),
                });
              } catch {
                /* swallow — broadcast is best-effort */
              }
            }
          })
          .finally(() => {
            // Phase 3 R1 — clear the watchdog now that the runner
            // settled normally. If it already fired, clearTimeout is
            // a no-op and the watchdog's release call has already
            // happened (idempotent with the regular release below).
            clearTimeout(watchdogTimer);
            // Keep the completed browser briefly available for the task's
            // review workspace. The lease is bounded and reclaimable: a new
            // task at capacity releases the oldest retained browser first.
            if (didAllocatePool && ctx.browserPool) {
              const retained = ctx.browserPool.retain(
                taskId,
                appEnv.BROWSER_TERMINAL_RETENTION_MS,
                'terminal-review',
              );
              if (!retained) {
                  void ctx.browserPool.release(taskId, `task-${taskId}-done`).catch((relErr) => {
                    ctx.logger.warn(
                      { err: relErr, taskId, userId: ctx.userId },
                      'pool: post-task release failed',
                    );
                  });
              }
            }
            // Phase 24 RC follow-up — wake the TaskQueue worker so
            // the next queued task fires immediately instead of
            // waiting for the next 5s tick. Safe even when no queue
            // is wired (the optional-chain shorts).
            ctx.taskQueue?.signalSlotFreed();
            // Phase 1 Day 5 Round 2 — fire-and-forget pipeline
            // persist + cleanup. Same pattern as the generate +
            // scrape lanes. Always runs (then OR catch path), so
            // even a runner exception still serialises the contract
            // + ledger that were inited at task start.
            void persistExecution({
              taskId,
              verification: executionVerification,
              db: ctx.db,
              logger: ctx.logger,
            })
          .then((persisted) =>
            persisted
                    ? writeLedgerToDb({
                        taskExternalId: taskId,
                        verification: executionVerification,
                        db: ctx.db,
                        logger: ctx.logger,
                      })
              : null,
          )
          .finally(() => disposeExecution(taskId));
          });

      // Phase 24 — fire the runFn directly (pre-queue path). Per-task
      // isolation removes the need for serialisation — each task gets
      // its own Brave, can run in parallel up to the user's plan-
      // derived concurrency limit (already gated at admit time via
      // getActiveTaskCount).
      await runFn();
      };
      // ↑ end of dispatchToBrave wrap

      // Phase 24 RC follow-up — global pool-capacity-aware queue.
      // Without this, a 30-task burst overruns the 10-slot pool;
      // pool.allocate throws PoolCapacityError, the catch falls
      // through to a shared singleton, and every overflow task races
      // the same Brave on `initial screenshot failed`. The queue
      // holds overflow in 'queued' status until pool capacity frees,
      // then dispatches FIFO.
      if (willQueueDispatch && ctx.taskQueue) {
        const enqueueResult = ctx.taskQueue.enqueue({
          taskId,
          userId: ctx.userId,
          runFn: dispatchToBrave,
          onStart: async (): Promise<void> => {
            await markQueuedTaskExecutingOrThrow({ repo, taskId, logger: ctx.logger });
            // No queued→executing WS frame — supercar's own
            // `server.task.plan` / step events fire next from the
            // dispatched runFn, and the SPA's task store reads the
            // fresh row on its existing tRPC poll. Avoid adding a
            // new message type for a transition that's already
            // observable via the next event.
          },
          onTimeout: async (): Promise<void> => {
            ctx.logger.warn(
              { taskId, userId: ctx.userId },
              'task-queue: queue timeout — marking failed',
            );
            const queueTimeoutReason = '排队等待时间过长，任务已自动停止。请稍后重新执行。';
            try {
              const failed = await repo.markQueuedTaskFailed(
                taskId,
                `queue timeout: ${queueTimeoutReason}`,
                { errorCode: 'QUEUE_TIMEOUT', source: 'task_queue_timeout' },
              );
              if (failed.persisted) {
                broadcastToUser(ctx.userId, {
                  type: 'server.task.terminal',
                  taskId,
                  status: 'failed',
                  reason: queueTimeoutReason,
                });
              }
            } catch (err) {
              ctx.logger.warn(
                { err: err instanceof Error ? err.message : String(err), taskId },
                'task-queue: onTimeout persist failed',
              );
            }
          },
        });
        if (enqueueResult.kind === 'rejected') {
          ctx.logger.warn(
            { taskId, userId: ctx.userId, reason: enqueueResult.reason },
            'task-queue: enqueue rejected (queue at depth cap)',
          );
          try {
            await repo.markQueuedTaskFailed(taskId, enqueueResult.reason, {
              errorCode: 'QUEUE_REJECTED',
              source: 'task_queue_rejected',
            });
          } catch (err) {
            ctx.logger.warn(
              { err: err instanceof Error ? err.message : String(err), taskId },
              'task-queue: rejection-row update failed',
            );
          }
          throw new TRPCError({
            code: 'TOO_MANY_REQUESTS',
            message: enqueueResult.reason,
          });
        }
        ctx.logger.info(
          {
            taskId,
            userId: ctx.userId,
            kind: enqueueResult.kind,
            position: enqueueResult.position,
            queueSize: ctx.taskQueue.size(),
          },
          'task-queue: task enqueued',
        );
        if (enqueueResult.kind === 'queued') {
          broadcastToUser(ctx.userId, {
            type: 'server.task.queued',
            taskId,
            position: enqueueResult.position,
          });
        }
        const statusOut = enqueueResult.kind === 'dispatched' ? 'executing' : 'queued';
        return {
          taskId,
          status: statusOut as 'executing' | 'queued',
          steps: [],
          executionMode: 'browser' as const,
        };
      }

      // Legacy / non-pool path — fire directly without queue gating.
      void dispatchToBrave();

      return {
        taskId,
        status: 'executing' as const,
        steps: [],
        executionMode: 'browser' as const,
      };
    }

    // Vision-loop path — the new control plane. Claude looks at each
    // tick's screenshot and picks one action at a time; there is no
    // pre-generated plan, no ResilientSelector, no Skill matching.
    // Activates when the env flag is off AND a vision commander is
    // wired at boot (needs ANTHROPIC_API_KEY). Falls through to the
    // legacy plan-once path otherwise.
    if (ctx.visionCommander) {
      const taskId = newExternalId('task');
      const repo = new TaskRepository(ctx.db);
      // Seed task row with status='executing' and empty plan — the
      // vision loop has no pre-planned steps; task_steps rows get
      // written as the loop progresses (Phase B: per-tick row; Phase
      // A: single synthetic row reflecting terminal outcome).
      await repo.insertTask(
        {
          taskId,
          status: 'executing',
          plan: [],
          cursor: 0,
          pendingConfirm: null,
        },
        {
          userId: userRow.id,
          intent: input.intent,
          roleId: dispatchRoleId,
          opusUsed: opusActuallyConsumed,
        },
      );
      // Start the loop asynchronously. We return to the popup
      // immediately with the taskId; the loop proceeds in the
      // background, driven by WS round-trips to the connected SW.
      // Outcome persistence is best-effort: we log failures instead
      // of surfacing them to the caller (they already got the taskId
      // and can poll tasks.detail).
      // F3: serialise per-user through the vision-loop task queue.
      // Multiple Run clicks for the same user (popup glitch / user
      // queueing intentional follow-ups) FIFO onto a single
      // Playwright Page — no racing clicks. Different users don't
      // block each other.
      // Bug 1 — URL resolver. Turn colloquial references ("openclaw")
      // into authoritative URLs before the commander starts guessing.
      // One Claude call per task create; null on vague intents (safe
      // fall-through to the commander's search-first prompt).
      const resolved = await resolveIntentUrl(input.intent, {
        client: anthropicForResolver,
      });
      const enrichedIntent = resolved ? injectResolvedUrl(input.intent, resolved) : input.intent;
      if (resolved && resolved.source === 'model') {
        ctx.logger.info(
          { taskId, token: resolved.token, url: resolved.url },
          'urlResolve: injected resolved URL into intent',
        );
      }

      // Per-task domain specialisation. Classifier is keyword-only
      // (no LLM call), safe to run on every create. If the commander
      // supports per-task specialisation, clone it with the classified
      // domain; otherwise fall back to the generic singleton.
      const classification = classifyDomain(enrichedIntent);
      const commander = ctx.visionCommander.withDomain
        ? ctx.visionCommander.withDomain(classification.domain)
        : ctx.visionCommander;
      ctx.logger.info(
        {
          taskId,
          domain: classification.domain,
          confidence: classification.confidence,
          matched: classification.matched,
        },
        'vision-loop domain classification',
      );
      const userId = ctx.userId;
      // Resolve the tasks.id once — every onTickEnd needs it to insert
      // the task_steps row. Avoids a DB lookup on every tick.
      const [taskDbRow] = await ctx.db
        .select({ id: tasksTable.id })
        .from(tasksTable)
        .where(eq(tasksTable.externalId, taskId))
        .limit(1);
      const taskDbId = taskDbRow?.id;
      const runTaskFn = () =>
        startVisionLoopTask({
          userId: ctx.userId,
          taskId,
          // Pass the URL-enriched intent to the vision loop. The
          // *displayed* intent (saved to the tasks row above + shown
          // in the UI's user bubble) stays the user's original text.
          intent: enrichedIntent,
          commander,
          // Phase D Step 3: when PlaywrightExecutor is wired at boot,
          // the runner bypasses the WS/SW path and drives Chrome
          // directly via CDP. Falls through to the legacy WS transport
          // automatically when absent.
          ...(ctx.playwrightExecutor ? { playwrightExecutor: ctx.playwrightExecutor } : {}),
          // G4: stream per-tick progress to the web workbench. Best-
          // effort — a broadcast throw is swallowed so loop progress
          // is never gated on the UI being online.
          onTickStart(info) {
            try {
              broadcastToUser(userId, {
                type: 'server.vision.tick.start',
                taskId,
                tickIndex: info.tickIndex,
                mode: info.mode,
              });
            } catch (err) {
              ctx.logger.warn(
                { err, taskId, tickIndex: info.tickIndex },
                'broadcast tick.start failed',
              );
            }
          },
          onTickEnd(info) {
            // Bug 4 — persist every tick as a task_steps row so task
            // history survives page reloads + clicking back into old
            // tasks. Fire-and-forget: DB failure logs but must not
            // stall the loop.
            if (taskDbId) {
              void (async () => {
                try {
                  await ctx.db.insert(taskSteps).values({
                      externalId: newExternalId('taskStep'),
                      taskId: taskDbId,
                      seq: info.tickIndex,
                      kind: info.actionKind,
                      status: info.ok ? 'done' : 'failed',
                      riskLevel: 'low',
                      input: { summary: info.actionSummary },
                      output: {
                        durationMs: info.durationMs,
                        mode: info.mode,
                        ...(info.message ? { message: info.message } : {}),
                        ...(info.antiBot
                          ? {
                              antiBot: {
                                type: info.antiBot.type,
                                confidence: info.antiBot.confidence,
                                message: describeSignal(info.antiBot),
                              },
                            }
                          : {}),
                      },
                      ...(info.ok ? {} : { errorMessage: (info.message ?? '').slice(0, 2000) }),
                      startedAt: new Date(Date.now() - info.durationMs),
                      completedAt: new Date(),
                    });
                } catch (err) {
                  ctx.logger.warn(
                    { err, taskId, tickIndex: info.tickIndex },
                    'persist step row failed',
                  );
                }
              })();
            }
            try {
              broadcastToUser(userId, {
                type: 'server.vision.tick.end',
                taskId,
                tickIndex: info.tickIndex,
                mode: info.mode,
                actionKind: info.actionKind,
                actionSummary: info.actionSummary,
                durationMs: info.durationMs,
                ok: info.ok,
                ...(info.message ? { message: info.message } : {}),
                ...(info.antiBot
                  ? {
                      // Flatten the server-side signal into the
                      // WS-facing shape. Keep raw detector snippets out
                      // of user-visible progress; logs/forensics can use
                      // the server-side AntiBotSignal before this point.
                      antiBot: {
                        type: info.antiBot.type,
                        confidence: info.antiBot.confidence,
                        message: describeSignal(info.antiBot),
                      },
                    }
                  : {}),
              });
            } catch (err) {
              ctx.logger.warn(
                { err, taskId, tickIndex: info.tickIndex },
                'broadcast tick.end failed',
              );
            }
          },
          onScreencast(info) {
            try {
              broadcastToUser(userId, {
                type: 'server.vision.screencast',
                taskId,
                tickIndex: info.tickIndex,
                imageBase64: info.imageBase64,
                url: info.url,
                viewport: { width: info.viewportWidth, height: info.viewportHeight },
                timestamp: new Date().toISOString(),
              });
            } catch (err) {
              ctx.logger.warn(
                { err, taskId, tickIndex: info.tickIndex },
                'broadcast screencast failed',
              );
            }
          },
          onCaptchaDetected(info) {
            ctx.logger.info(
              { taskId, antiBotType: info.antiBotType, waitTimeoutMs: info.waitTimeoutMs },
              'vision loop paused on captcha signal',
            );
            try {
              broadcastToUser(userId, {
                type: 'server.vision.captcha_detected',
                taskId,
                antiBotType: info.antiBotType,
                message: info.message,
                waitTimeoutMs: info.waitTimeoutMs,
              });
            } catch (err) {
              ctx.logger.warn({ err, taskId }, 'broadcast captcha_detected failed');
            }
          },
          onCaptchaResolved(info) {
            ctx.logger.info({ taskId, reason: info.reason }, 'vision loop captcha wait ended');
            try {
              broadcastToUser(userId, {
                type: 'server.vision.captcha_resolved',
                taskId,
                reason: info.reason,
              });
            } catch (err) {
              ctx.logger.warn({ err, taskId }, 'broadcast captcha_resolved failed');
            }
          },
          onDegrade(info) {
            ctx.logger.info(
              { taskId, level: info.level, strategy: info.strategy, ok: info.ok },
              'degradation tier attempted',
            );
            try {
              broadcastToUser(userId, {
                type: 'server.vision.degrade',
                taskId,
                level: info.level,
                strategy: info.strategy,
                ok: info.ok,
                message: info.message,
                ...(info.handoffToExtension ? { handoffToExtension: true } : {}),
                ...(info.nextUrl ? { nextUrl: info.nextUrl } : {}),
              });
            } catch (err) {
              ctx.logger.warn({ err, taskId }, 'broadcast degrade failed');
            }
          },
          onExecutorFallback(info) {
            ctx.logger.info(
              { taskId, reason: info.reason, available: info.available },
              'vision loop executor fallback triggered',
            );
            try {
              broadcastToUser(userId, {
                type: 'server.vision.executor_fallback',
                taskId,
                reason: info.reason,
                available: info.available,
              });
            } catch (err) {
              ctx.logger.warn({ err, taskId }, 'broadcast executor_fallback failed');
            }
          },
        })
          .then(async (outcome) => {
            ctx.logger.info(
              {
                taskId,
                status: outcome.status,
                tickCount: outcome.history.length,
              },
              'vision loop terminated',
            );
            let visionPersisted = false;
            try {
              if (outcome.status === 'completed') {
                const persisted = await repo.persistVisionOutcome(taskId, {
                  status: 'completed',
                  summary: outcome.summary,
                  tickCount: outcome.history.length,
                });
                visionPersisted = persisted.persisted;
              } else if (outcome.status === 'failed') {
                const persisted = await repo.persistVisionOutcome(taskId, {
                  status: 'failed',
                  reason: outcome.reason,
                  tickCount: outcome.history.length,
                });
                visionPersisted = persisted.persisted;
              } else if (outcome.status === 'paused') {
                const persisted = await repo.persistVisionOutcome(taskId, {
                  status: 'paused',
                  reason: outcome.reason,
                  tickCount: outcome.history.length,
                });
                visionPersisted = persisted.persisted;
              } else {
                const persisted = await repo.persistVisionOutcome(taskId, {
                  status: 'cancelled',
                  tickCount: outcome.history.length,
                });
                visionPersisted = persisted.persisted;
              }
            } catch (err) {
              ctx.logger.error({ err, taskId }, 'persistVisionOutcome failed');
            }
            // Push the settled state to any connected client so the
            // UI can update without polling. Paused is recoverable, so
            // it uses task.control(pause) rather than task.terminal.
            try {
              if (visionPersisted) {
                if (outcome.status === 'paused') {
                  broadcastToUser(ctx.userId, {
                    type: 'server.task.control',
                    taskId,
                    command: 'pause',
                    reason: 'max_steps_reached',
                    detail: { message: outcome.reason },
                  });
                } else {
                  broadcastToUser(ctx.userId, {
                    type: 'server.task.terminal',
                    taskId,
                    status: outcome.status,
                    ...(outcome.status === 'completed' ? { summary: outcome.summary } : {}),
                    ...(outcome.status === 'failed' ? { reason: outcome.reason } : {}),
                  });
                }
              }
            } catch (err) {
              ctx.logger.warn({ err, taskId }, 'broadcast task settle failed');
            }
          })
          .catch(async (err) => {
            // Phase 22a — same fix as the supercar branch: persist a
            // failed terminal state when the runner throws so the task
            // doesn't sit at 'executing' forever. Broadcast only after
            // the guarded recovery persist actually changes the row.
            const reason = err instanceof Error ? err.message : String(err);
            ctx.logger.error({ err, taskId }, 'vision loop threw — persisting failed');
            await persistAndBroadcastVisionLoopThrow({
              repo,
              taskId,
              userId: ctx.userId,
              reason,
              logger: ctx.logger,
              broadcastToUser,
            });
          });

      // Phase 24 — fire directly (no per-user FIFO queue). Per-task
      // isolation removes the need for serialisation; per-user
      // concurrency is gated upstream at admit time.
      void runTaskFn();
      return {
        taskId,
        status: 'executing' as const,
        steps: [],
      };
    }

    const catalogue = await loadSkillCatalogue(ctx.db, input.occupation ?? null);

    let plan: Awaited<ReturnType<typeof ctx.planner.plan>>;
    try {
      plan = await ctx.planner.plan({
        intent: buildPlannerIntent(input.intent, taskSkillId),
        userId: ctx.userId,
        occupation: input.occupation ?? null,
        skills: catalogue,
      });
    } catch (err) {
      // Upstream planner failures (Anthropic 4xx/5xx, network) are NOT our
      // internal bug — surface them as 502 BAD_GATEWAY with the original
      // message so the popup can show "Anthropic: 403 forbidden" instead
      // of an opaque 500. Full stack is logged for the operator.
      ctx.logger.error(
        { err, userId: ctx.userId, intent: input.intent.slice(0, 200) },
        'planner upstream error',
      );
      const message = err instanceof Error ? err.message : String(err);
      throw new TRPCError({
        code: 'BAD_GATEWAY',
        message: `planner upstream error: ${message}`,
        cause: err,
      });
    }
    if (plan.length === 0) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'planner returned empty plan',
      });
    }

    // Origin allowlist: identify which Skills in the catalogue the
    // generated plan actually reaches (i.e. any Skill whose
    // allowedOrigins covers ≥1 goto URL in the plan). Union the
    // allowedOrigins of just those. When the plan uses NO Skill (free-
    // form intent the commander answered without adopting a Skill — e.g.
    // "在 Bing 搜一下 XXX"), `usedSkills` is empty, `allowedOrigins`
    // comes back `[]`, and the driver treats that as unrestricted.
    //
    // Earlier bug: we used to union allowedOrigins across the ENTIRE
    // active catalogue. That meant a free-form plan emitted bing.com
    // but the union was { douyin.com, xueqiu.com, ... } and the driver
    // refused bing.com as ORIGIN_BLOCKED. The catalogue is a menu, not
    // a restraining order — only Skills the plan actually uses should
    // constrain what the driver is allowed to visit.
    const usedSkills = pickSkillsUsedByPlan(plan, catalogue);
    const allowedOrigins = unionAllowedOrigins(usedSkills);

    const taskId = newExternalId('task');
    const { state, effects } = taskController.start({
      state: null,
      taskId,
      plan,
      ...(allowedOrigins.length > 0 ? { allowedOrigins } : {}),
    });

    const repo = new TaskRepository(ctx.db);
    await repo.insertTask(state, {
      userId: userRow.id,
      intent: input.intent,
      roleId: dispatchRoleId,
      opusUsed: opusActuallyConsumed,
    });

    // Drive the first dispatch out to any connected WS clients.
    // Without this the task sits in `executing` in the DB but the
    // extension never receives `server.task.dispatch` and the Agent
    // Loop never starts. Symmetric with pause/resume/confirm below.
    updateTaskStateForUser(ctx.userId, state);
    for (const eff of effects) {
      if (eff.kind === 'send') broadcastToUser(ctx.userId, eff.message);
    }

    return {
      taskId: state.taskId,
      status: state.status,
      steps: state.plan.map((s) => ({
        id: s.id,
        kind: s.kind,
        risk: s.risk,
        requiresConfirm: s.requiresConfirm ?? false,
      })),
    };
  }),

  /**
   * Diagnostic end-to-end: run a hardcoded Baidu search plan against
   * the real browser driver. No Anthropic call, no Skill catalogue,
   * no user intent — the plan is static, the selectors are known
   * stable (#kw, #su). Use this to confirm the SW ↔ orchestrator ↔
   * adapter loop is healthy when planner-generated plans are
   * failing on selector mismatch.
   */
  smokeTest: protectedProcedure.mutation(async ({ ctx }) => {
    const [userRow] = await ctx.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.externalId, ctx.userId))
      .limit(1);
    if (!userRow) {
      throw new TRPCError({ code: 'UNAUTHORIZED', message: 'unknown user' });
    }

    const plan = buildBaiduSmokePlan();
    const taskId = newExternalId('task');
    // Smoke drives Baidu only; pinning the allowlist here also serves
    // as a live test that the end-to-end wiring (dispatch → SW →
    // driver) actually enforces the list.
    const smokeAllowedOrigins = ['*.baidu.com'] as const;
    const { state, effects } = taskController.start({
      state: null,
      taskId,
      plan,
      allowedOrigins: smokeAllowedOrigins,
    });

    const repo = new TaskRepository(ctx.db);
    await repo.insertTask(state, {
      userId: userRow.id,
      intent: '[smoke] Baidu search for "半导体" — diagnostic, not Opus-planned',
    });

    updateTaskStateForUser(ctx.userId, state);
    for (const eff of effects) {
      if (eff.kind === 'send') broadcastToUser(ctx.userId, eff.message);
    }

    return {
      taskId: state.taskId,
      status: state.status,
      steps: state.plan.map((s) => ({
        id: s.id,
        kind: s.kind,
        risk: s.risk,
        requiresConfirm: s.requiresConfirm ?? false,
      })),
    };
  }),

  pause: protectedProcedure.input(taskIdInput).mutation(async ({ ctx, input }) => {
    const repo = new TaskRepository(ctx.db);
    const prev = await loadTaskState(repo, input.taskId, ctx.userId);

    const { state: next, effects } = taskController.pause(prev, 'user');
    if (next === prev) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: `cannot pause from status=${prev.status}`,
      });
    }

    const persisted = await repo.applyControlTransition(prev, next);
    if (!persisted.persisted) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: 'task state changed; refresh and retry',
      });
    }
    updateTaskStateForUser(ctx.userId, next);
    for (const eff of effects) {
      if (eff.kind === 'send') broadcastToUser(ctx.userId, eff.message);
    }
    return { taskId: next.taskId, status: next.status, pauseReason: next.pauseReason ?? null };
  }),

  resume: protectedProcedure.input(taskIdInput).mutation(async ({ ctx, input }) => {
    const repo = new TaskRepository(ctx.db);
    const prev = await loadTaskState(repo, input.taskId, ctx.userId);

    const { state: next, effects } = taskController.resume(prev);
    if (next === prev) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: `cannot resume from status=${prev.status}`,
      });
    }

    const persisted = await repo.applyControlTransition(prev, next);
    if (!persisted.persisted) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: 'task state changed; refresh and retry',
      });
    }
    updateTaskStateForUser(ctx.userId, next);
    for (const eff of effects) {
      if (eff.kind === 'send') broadcastToUser(ctx.userId, eff.message);
    }
    return { taskId: next.taskId, status: next.status };
  }),

  confirm: protectedProcedure
    .input(
      z
        .object({
          taskId: z.string().min(1),
          // New decision enum (approve / skip / reject) — maps to the
          // single-confirm and batch-confirm paths on the controller.
          decision: z.enum(['approve', 'skip', 'reject']).optional(),
          // Back-compat: popup v0 sent `approve: boolean`. Translate it
          // to the decision enum when present and no explicit decision.
          approve: z.boolean().optional(),
        })
        .refine((v) => v.decision !== undefined || v.approve !== undefined, {
          message: 'one of decision or approve must be provided',
        }),
    )
    .mutation(async ({ ctx, input }) => {
      const repo = new TaskRepository(ctx.db);
      const prev = await loadTaskState(repo, input.taskId, ctx.userId);
      if (prev.status !== 'awaiting_user') {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: `cannot confirm from status=${prev.status}`,
        });
      }

      const decision: 'approve' | 'skip' | 'reject' =
        input.decision ?? (input.approve ? 'approve' : 'reject');

      const { state: next, effects } = taskController.userConfirm(prev, decision);

      // Pick the repo method by the shape of the transition.
      //   reject                → control transition (cancelled)
      //   batch + approve       → batch-approve (cursor unchanged, clear
      //                           pending blob, NOT a step completion)
      //   otherwise (skip,
      //   single approve)       → step-result (cursor advances, step row
      //                           marked completed)
      const batchApprove = prev.pendingConfirm?.kind === 'batch' && decision === 'approve';
      if (next.status === 'cancelled') {
        const persisted = await repo.applyControlTransition(prev, next);
        if (!persisted.persisted) {
          throw new TRPCError({
            code: 'PRECONDITION_FAILED',
            message: 'task state changed; refresh and retry',
          });
        }
      } else if (batchApprove) {
        const persisted = await repo.applyBatchApprove(prev, next);
        if (!persisted.persisted) {
          throw new TRPCError({
            code: 'PRECONDITION_FAILED',
            message: 'task state changed; refresh and retry',
          });
        }
      } else {
        const persisted = await repo.applyStepResult(
          prev,
          next,
          { confirmed: true, decision },
          undefined,
          'user',
        );
        if (!persisted.persisted) {
          throw new TRPCError({
            code: 'PRECONDITION_FAILED',
            message: 'task state changed; refresh and retry',
          });
        }
      }
      updateTaskStateForUser(ctx.userId, next);
      for (const eff of effects) {
        if (eff.kind === 'send') broadcastToUser(ctx.userId, eff.message);
      }
      return { taskId: next.taskId, status: next.status };
    }),

  /**
   * Phase 1 #4 — 视频报价确认(结构化)。Veo 烧钱严格在此之后,且仅当
   * consumeVideoConfirm 原子抢占成功时(防双击双扣)。`choice` 结构化按钮优先;
   * `text` 自由文本兜底走 parseVideoConfirm(否定护栏优先 + 锚定确认词)。
   */
  confirmVideo: protectedProcedure
    .input(
      z.object({
        taskId: z.string().min(1),
        choice: z.enum(['confirm_video', 'confirm_image', 'cancel']).optional(),
        text: z.string().max(200).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [userRow] = await ctx.db
        .select({
          id: users.id,
          // Phase 2 第三期 — IP 人物 lane 需要克隆声音 + 出镜底版 + 本人授权(合规硬闸)。
          qwenVoiceId: users.qwenVoiceId,
          baseVideoFileId: users.baseVideoFileId,
          videoSelfUseAuthorizedAt: users.videoSelfUseAuthorizedAt,
        })
        .from(users)
        .where(eq(users.externalId, ctx.userId))
        .limit(1);
      if (!userRow) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'user not found' });
      const repo = new TaskRepository(ctx.db);
      const [row] = await ctx.db
        .select({
          status: tasksTable.status,
          awaitingKind: tasksTable.awaitingKind,
          intent: tasksTable.intent,
          result: tasksTable.result,
        })
        .from(tasksTable)
        .where(
          and(
            eq(tasksTable.externalId, input.taskId),
            eq(tasksTable.userId, userRow.id),
            eq(tasksTable.origin, 'user'),
          ),
        )
        .limit(1);
      if (!row || row.status !== 'awaiting_user' || row.awaitingKind !== 'video_quote') {
        throw new TRPCError({ code: 'NOT_FOUND', message: '找不到待确认的视频报价' });
      }

      const choice = parseVideoConfirm({
        ...(input.choice ? { action: input.choice } : {}),
        ...(input.text ? { text: input.text } : {}),
      });

      // cancel — 标记消费(杜绝再确认)+ 取消,绝不进生成。
      if (choice === 'cancel') {
        const cancelled = await repo.cancelVideoConfirm(input.taskId);
        if (!cancelled.persisted) {
          throw new TRPCError({ code: 'NOT_FOUND', message: '找不到待确认的视频报价' });
        }
        broadcastToUser(ctx.userId, {
          type: 'server.task.terminal',
          taskId: input.taskId,
          status: 'cancelled',
          summary: '已取消，未产生任何费用。',
        });
        return { taskId: input.taskId, status: 'cancelled' as const };
      }
      // unclear — 没听懂 → 重出报价卡,仍 awaiting,不消费、不烧钱。
      if (choice === 'unclear') {
        const question = '请点按钮选择：确认制作 / 图片版 / 取消。';
        const reprompted = await repo.repromptVideoConfirm(input.taskId, question);
        if (!reprompted.persisted) {
          throw new TRPCError({ code: 'NOT_FOUND', message: '找不到待确认的视频报价' });
        }
        broadcastToUser(ctx.userId, {
          type: 'server.supercar.awaiting_user',
          taskId: input.taskId,
          question,
          awaitingKind: 'video_quote',
        });
        return { taskId: input.taskId, status: 'awaiting_user' as const };
      }

      // Validate the quote payload before the atomic consume. A malformed
      // quote should not be marked completed before we know generation can
      // at least start.
      const meta =
        (
          row.result as {
            metadata?: {
              videoScript?: VideoScript;
              videoTier?: VideoSource;
              // Phase 2 第二期 宠物 i2v — single-image, no script.
              petImageFileId?: string;
              petModel?: PetI2vModel;
              i2vPrompt?: string;
              referenceVideoFileId?: string;
              referenceVideoDurationSeconds?: number;
              cloneMode?: WanAnimateMixMode;
              // Phase 2 第三期 IP 人物 — full copy text, no script.
              ipCopyText?: string;
              videoOptions?: {
                model?: VideoSource;
                style?: VideoStyle;
                aspectRatio?: AspectRatio;
                resolution?: '720p' | '1080p';
                durationSeconds?: number;
                tab?: 'normal' | 'pet' | 'ip_person';
              };
            };
          } | null
        )?.metadata ?? {};
      const isPet = !!meta.petImageFileId;
      const isClone = isPet && !!meta.referenceVideoFileId;
      const isIp = meta.videoOptions?.tab === 'ip_person' || meta.ipCopyText !== undefined;
      const script = meta.videoScript;
      const tier: VideoSource = meta.videoTier ?? 'veo_fast';
      const vOpts = meta.videoOptions ?? {};
      if (
        choice === 'video' &&
        videoParameterIssue({
          model: tier,
          resolution: vOpts.resolution ?? '1080p',
          durationSeconds: vOpts.durationSeconds ?? 8,
        })
      ) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Veo 1080p 仅支持 8 秒，请返回视频任务修改参数后重新提交。',
        });
      }
      // 宠物 i2v / IP 换口型无脚本;普通文生必须有脚本(报价时存的).
      if (!isPet && !isIp && !script)
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: '报价脚本丢失' });
      const preflight = await claimVideoConfirmAfterVerifierPreflight(
        {
          choice,
          hasVerifier: Boolean(anthropicForResolver),
        },
        () => repo.consumeVideoConfirm(input.taskId),
      );
      if (preflight.issue) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: preflight.issue,
        });
      }

      // video|image — 原子抢占(防双击双扣)。只有抢到才生成。
      const claimed = preflight.claimed;
      const action = decideVideoGate(choice, claimed);
      if (action === 'already_consumed') {
        const [current] = await ctx.db
          .select({
            status: tasksTable.status,
            result: tasksTable.result,
          })
          .from(tasksTable)
          .where(
            and(
              eq(tasksTable.externalId, input.taskId),
              eq(tasksTable.userId, userRow.id),
              eq(tasksTable.origin, 'user'),
            ),
          )
          .limit(1);
        const currentStatus = current?.status;
        if (currentStatus === 'completed') {
          const summary =
            readResultSummary(current?.result) ?? '该报价已开始制作视频，未重复扣费。';
          broadcastToUser(ctx.userId, {
            type: 'server.task.terminal',
            taskId: input.taskId,
            status: 'completed',
            summary,
          });
          return { taskId: input.taskId, status: 'completed' as const };
        }
        if (currentStatus === 'cancelled') {
          const summary = readResultSummary(current?.result) ?? '已取消，未产生任何费用。';
          broadcastToUser(ctx.userId, {
            type: 'server.task.terminal',
            taskId: input.taskId,
            status: 'cancelled',
            summary,
          });
          return { taskId: input.taskId, status: 'cancelled' as const };
        }
        ctx.logger.warn(
          { taskId: input.taskId, currentStatus },
          'video confirm consume raced but task is not terminal; refusing synthetic terminal broadcast',
        );
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: '报价状态已变化，请刷新后重试。',
        });
      }

      // generate_video | generate_image — Veo 在此之后(已过原子抢占=确认后)。
      const visualMode = action === 'generate_image' ? ('image' as const) : ('video' as const);

      const newTaskId = newExternalId('task');
      await repo.insertTask(
        { taskId: newTaskId, status: 'executing', plan: [], cursor: 0, pendingConfirm: null },
        { userId: userRow.id, intent: row.intent, roleId: 'video-creator', opusUsed: false },
      );
      broadcastSubStatus(ctx.userId, newTaskId, 'generating');

      const anthropicClient = anthropicForResolver;
      const userExternalId = ctx.userId;
      const userInternalId = userRow.id;
      const ipVoiceId = userRow.qwenVoiceId; // Phase 2 第三期 IP lane
      const ipBaseFileId = userRow.baseVideoFileId;
      const ipAuthorized = !!userRow.videoSelfUseAuthorizedAt; // 合规:确认时复核本人授权(可能已被撤销)
      const logger = ctx.logger;
      const db = ctx.db;
      const intentText = row.intent;
      void (async () => {
        const taskInternalId = await taskInternalIdFor(db, newTaskId);
        if (taskInternalId == null) return;
        const { runSimpleVideoCreation } = await import('../../agent/video/video-lane-simple.js');
        const { runFfmpeg } = await import('../../agent/video/ffmpeg-exec.js');
        const { createAnthropicVideoQualityAnalyzer, verifyFinalVideoQuality } = await import(
          '../../agent/video/video-quality-verifier.js'
        );
        const os = await import('node:os');
        const path = await import('node:path');
        const { promises: fsp } = await import('node:fs');
        const fileService = new FileService(db, logger);
        const workdir = await fsp.mkdtemp(path.join(os.tmpdir(), 'hd-video-'));
        let finalAtt: ImageAttachment | null = null;
        // 首帧 poster 的下载 URL（poster 由 lane 在成片后抽帧存盘，再盖到 finalAtt 上）。
        let posterUrl: string | null = null;
        const llm = async ({ system, user }: { system: string; user: string }) => {
          if (!anthropicClient) return '';
          const resp = await anthropicClient.messages.create({
            model: VIDEO_SCRIPT_MODEL,
            max_tokens: 2000,
            system,
            messages: [{ role: 'user', content: user }],
          });
          const b = resp.content[0];
          return b && b.type === 'text' ? b.text : '';
        };
        const analyzeVideoQuality = anthropicClient
          ? createAnthropicVideoQualityAnalyzer(anthropicClient)
          : async () => '';
        const verifyFinalVideo = (qualityInput: Parameters<typeof verifyFinalVideoQuality>[0]) =>
          verifyFinalVideoQuality(qualityInput, {
            runFfmpeg,
            readFile: (filePath) => fsp.readFile(filePath),
            analyzeFrames: analyzeVideoQuality,
          });
        // 仅最终 video.mp4 落用户文件;中间段产物只用 workdir 副本(pipeline 用本地路径)。
        const storeOutput = async (i: { filename: string; mimetype: string; buffer: Buffer }) => {
          if (i.filename === 'poster.jpg') {
            const ps = await fileService.storeOutput({
              userIdInternal: userInternalId,
              userExternalId,
              taskIdInternal: taskInternalId,
              filename: 'holaday-video-poster.jpg',
              mimetype: 'image/jpeg',
              buffer: i.buffer,
            });
            const url = `/api/files/${ps.externalId}/download`;
            posterUrl = url;
            const fa = finalAtt;
            if (fa) fa.posterUrl = url;
            return { fileId: ps.externalId, storagePath: ps.externalId };
          }
          if (i.filename !== 'video.mp4') {
            return { fileId: `tmp:${i.filename}`, storagePath: `tmp:${i.filename}` };
          }
          const s = await fileService.storeOutput({
            userIdInternal: userInternalId,
            userExternalId,
            taskIdInternal: taskInternalId,
            filename: 'holaday-video.mp4',
            mimetype: 'video/mp4',
            buffer: i.buffer,
          });
          finalAtt = {
            fileId: s.externalId,
            downloadUrl: `/api/files/${s.externalId}/download`,
            filename: s.filename,
            mimetype: s.mimetype,
            sizeBytes: Number(s.sizeBytes),
            expiresAt: s.expiresAt
              ? s.expiresAt.toISOString()
              : new Date(Date.now() + 864e5).toISOString(),
            kind: 'output',
            ...(posterUrl ? { posterUrl } : {}),
          };
          return { fileId: s.externalId, storagePath: s.externalId };
        };
        const storeOutputFile = async (i: {
          filename: string;
          mimetype: string;
          sourcePath: string;
        }) => {
          if (i.filename !== 'video.mp4') {
            throw new Error(`unexpected streamed video output: ${i.filename}`);
          }
          const s = await fileService.storeOutputFile({
            userIdInternal: userInternalId,
            userExternalId,
            taskIdInternal: taskInternalId,
            filename: 'holaday-video.mp4',
            mimetype: i.mimetype,
            sourcePath: i.sourcePath,
          });
          finalAtt = {
            fileId: s.externalId,
            downloadUrl: `/api/files/${s.externalId}/download`,
            filename: s.filename,
            mimetype: s.mimetype,
            sizeBytes: Number(s.sizeBytes),
            expiresAt: s.expiresAt
              ? s.expiresAt.toISOString()
              : new Date(Date.now() + 864e5).toISOString(),
            kind: 'output',
            ...(posterUrl ? { posterUrl } : {}),
          };
          return { fileId: s.externalId, storagePath: s.externalId };
        };
        try {
          let summary: string;
          if (isClone) {
            const { runCloneVideoCreation } = await import('../../agent/video/video-clone.js');
            const petImageFileId = meta.petImageFileId;
            const referenceVideoFileId = meta.referenceVideoFileId;
            if (!petImageFileId || !referenceVideoFileId) {
              throw new Error('复刻视频缺少主角照片或参考视频');
            }
            const [imageUrl, referenceVideoUrl] = await Promise.all([
              fileService.signedReadUrl(petImageFileId, userInternalId),
              fileService.signedReadUrl(referenceVideoFileId, userInternalId),
            ]);
            if (!imageUrl || !referenceVideoUrl) {
              throw new Error('主角照片或参考视频不可用（已过期或无法生成访问链接）');
            }
            await fileService.linkToTask(
              [petImageFileId, referenceVideoFileId],
              taskInternalId,
              userInternalId,
            );
            await runCloneVideoCreation(
              {
                imageUrl,
                referenceVideoUrl,
                description: meta.i2vPrompt ?? intentText,
              },
              buildVideoCfg(),
              { mode: meta.cloneMode ?? 'wan-std' },
              { storeOutput, storeOutputFile, workdir, logger, verifyFinalVideo },
            );
            summary = '复刻视频已生成。';
          } else if (isPet) {
            // 宠物 i2v: fileId → presigned GET → i2v 单图 → pad+水印+静默 → store.
            const { runPetVideoCreation } = await import('../../agent/video/video-pet-i2v.js');
            const petImageFileId = meta.petImageFileId;
            if (!petImageFileId) {
              throw new Error('宠物视频缺少宠物照片');
            }
            const imageUrl = await fileService.signedReadUrl(petImageFileId, userInternalId);
            if (!imageUrl) {
              throw new Error('宠物照片不可用(已过期或无法生成访问链接)');
            }
            await runPetVideoCreation(
              { imageUrl, motionPrompt: meta.i2vPrompt ?? intentText },
              buildVideoCfg(),
              {
                ...(meta.petModel ? { model: meta.petModel } : {}),
                ...(vOpts.aspectRatio ? { aspectRatio: vOpts.aspectRatio } : {}),
                ...(vOpts.durationSeconds ? { durationSeconds: vOpts.durationSeconds } : {}),
              },
              { storeOutput, storeOutputFile, workdir, logger, verifyFinalVideo },
            );
            summary = '宠物视频已生成。';
          } else if (isIp) {
            // IP 人物 B 架构: 克隆音(全文案)→ 1 次 fal 换口型(loop_mode 补够)→ 字幕+水印 → store.
            const { runIpVideoCreation } = await import('../../agent/video/video-ip-lipsync.js');
            // 合规硬闸:确认时复核三件齐 + 本人授权(报价后、生成前可能已撤销/清除素材)。
            if (!ipVoiceId || !ipBaseFileId || !ipAuthorized) {
              throw new Error('IP 素材或授权缺失(可能已被清除),请重新完成 onboarding');
            }
            const baseVideoUrl = await fileService.signedReadUrl(ipBaseFileId, userInternalId);
            if (!baseVideoUrl) throw new Error('出镜底版不可用(无法生成访问链接)');
            // IP final outputs stay user-visible. Cloned audio uses a hidden
            // short-TTL row so an Orchestrator crash cannot leave it behind as
            // an ordinary deliverable; normal completion still deletes it.
            const storeOutputIp = async (i: {
              filename: string;
              mimetype: string;
              buffer: Buffer;
            }) => {
              const s = await fileService.storeOutput({
                userIdInternal: userInternalId,
                userExternalId,
                taskIdInternal: taskInternalId,
                filename:
                  i.filename === 'video.mp4'
                    ? 'holaday-ip-video.mp4'
                    : i.filename === 'poster.jpg'
                      ? 'holaday-ip-video-poster.jpg'
                      : i.filename,
                mimetype: i.mimetype,
                buffer: i.buffer,
              });
              if (i.filename === 'video.mp4') {
                finalAtt = {
                  fileId: s.externalId,
                  downloadUrl: `/api/files/${s.externalId}/download`,
                  filename: s.filename,
                  mimetype: s.mimetype,
                  sizeBytes: Number(s.sizeBytes),
                  expiresAt: s.expiresAt
                    ? s.expiresAt.toISOString()
                    : new Date(Date.now() + 864e5).toISOString(),
                  kind: 'output',
                  ...(posterUrl ? { posterUrl } : {}),
                };
              }
              if (i.filename === 'poster.jpg') {
                const url = `/api/files/${s.externalId}/download`;
                posterUrl = url;
                const fa = finalAtt;
                if (fa) fa.posterUrl = url;
              }
              return { fileId: s.externalId };
            };
            const storeTemporaryAudioIp = async (i: {
              filename: string;
              mimetype: string;
              buffer: Buffer;
            }) => {
              const s = await fileService.storeTemporaryOutput({
                userIdInternal: userInternalId,
                userExternalId,
                taskIdInternal: taskInternalId,
                filename: i.filename,
                mimetype: i.mimetype,
                buffer: i.buffer,
              });
              return { fileId: s.externalId };
            };
            const storeOutputFileIp = async (i: {
              filename: string;
              mimetype: string;
              sourcePath: string;
            }) => {
              if (i.filename !== 'video.mp4') {
                throw new Error(`unexpected streamed IP video output: ${i.filename}`);
              }
              const s = await fileService.storeOutputFile({
                userIdInternal: userInternalId,
                userExternalId,
                taskIdInternal: taskInternalId,
                filename: 'holaday-ip-video.mp4',
                mimetype: i.mimetype,
                sourcePath: i.sourcePath,
              });
              finalAtt = {
                fileId: s.externalId,
                downloadUrl: `/api/files/${s.externalId}/download`,
                filename: s.filename,
                mimetype: s.mimetype,
                sizeBytes: Number(s.sizeBytes),
                expiresAt: s.expiresAt
                  ? s.expiresAt.toISOString()
                  : new Date(Date.now() + 864e5).toISOString(),
                kind: 'output',
                ...(posterUrl ? { posterUrl } : {}),
              };
              return { fileId: s.externalId };
            };
            const result = await runIpVideoCreation(
              { copyText: meta.ipCopyText ?? intentText },
              buildIpVideoCfg(),
              { voiceId: ipVoiceId, baseVideoUrl },
              { ...(vOpts.aspectRatio ? { aspectRatio: vOpts.aspectRatio } : {}) },
              {
                storeOutput: storeOutputIp,
                storeOutputFile: storeOutputFileIp,
                storeTemporaryAudio: storeTemporaryAudioIp,
                presignByFileId: (fid: string) =>
                  fileService.signedReadUrl(fid, userInternalId, 900),
                deleteOutput: (fid: string) => fileService.deleteForUser(fid, userInternalId),
                workdir,
                logger,
                verifyFinalVideo,
              },
            );
            summary = `真人换口型视频已生成（约 ${Math.round(result.totalDurationMs / 1000)} 秒）。`;
          } else {
            if (!script) {
              throw new Error('普通视频报价脚本丢失');
            }
            const result = await runSimpleVideoCreation(
              {
                userText: intentText,
                script,
                ...(vOpts.style ? { style: vOpts.style } : {}),
              },
              buildVideoCfg(),
              {
                visualMode,
                videoSource: tier,
                ...(vOpts.aspectRatio ? { aspectRatio: vOpts.aspectRatio } : {}),
                ...(vOpts.resolution ? { veoResolution: vOpts.resolution } : {}),
                ...(vOpts.durationSeconds ? { veoDurationSeconds: vOpts.durationSeconds } : {}),
              },
              {
                storeOutput,
                storeOutputFile,
                workdir,
                logger,
                llm,
                verifyFinalVideo,
              },
            );
            summary = `视频已生成（${result.segments} 段 / ${Math.round(result.totalDurationMs / 1000)} 秒）。`;
          }
          const persisted = await repo.persistVisionOutcome(newTaskId, {
            status: 'completed',
            summary,
            tickCount: 1,
            metadata: {
              executionMode: 'generate',
              lane: 'video_creation',
              visualMode,
              videoType: deriveVideoType({ isPet, isIp, tab: vOpts.tab }),
              ...videoQualityVerificationMetadata(),
              ...(finalAtt ? { attachments: [finalAtt] } : {}),
            },
          });
          if (persisted.persisted) {
            broadcastToUser(userExternalId, {
              type: 'server.task.terminal',
              taskId: newTaskId,
              status: 'completed',
              summary,
              ...(finalAtt ? { attachments: [finalAtt] } : {}),
            });
          }
        } catch (err) {
          // Full error to the server log (internal); a SAFE whitelisted reason
          // to the user — never leak stack / detail / urls / file ids.
          logger.error({ err, taskId: newTaskId }, 'video_creation: lane failed');
          const friendlyReason = mapVideoFailureReason(err);
          const persisted = await repo
            .persistVisionOutcome(newTaskId, {
              status: 'failed',
              reason: friendlyReason,
              tickCount: 1,
              metadata: { executionMode: 'generate', lane: 'video_creation' },
            })
            .catch(() => ({ persisted: false }));
          if (persisted.persisted) {
            broadcastToUser(userExternalId, {
              type: 'server.task.terminal',
              taskId: newTaskId,
              status: 'failed',
              reason: friendlyReason,
            });
          }
        } finally {
          await fsp.rm(workdir, { recursive: true, force: true }).catch(() => {});
        }
      })();
      return { taskId: newTaskId, status: 'executing' as const };
    }),

  /**
   * Task history, scoped to the caller. DESC-id cursor pagination so
   * the popup's "history" section can lazy-load more rows as the user
   * scrolls without re-fetching the head. Shape mirrors
   * `llmCalls.list` (commit 52ef5fa) so the popup can use one cursor
   * idiom across both lists.
   *
   * Intentionally omits the full step plan / output blobs — those
   * come from `tasks.detail(taskId)` when a row is expanded. Keeps
   * the list payload small even when a user has hundreds of tasks.
   */
  list: protectedProcedure
    .input(
      z
        .object({
          cursor: z.number().int().positive().optional(),
          limit: z.number().int().min(1).max(100).default(20),
          /**
           * Phase 16b — when set, only return tasks linked to this
           * project. The id is the external prj_… form; we translate
           * to the bigint id once before the WHERE clause.
           */
          projectId: z.string().min(1).optional(),
          /**
           * Spec A — server-side filters. SearchOverlay / HistoryPage /
           * StarredPage / project filter all funnel through this list
           * endpoint instead of filtering the in-memory first-50 slice
           * client-side. Combined with AND; cursor pagination still
           * uses `lt(id, cursor)` so existing infinite-scroll wiring
           * keeps working.
           *
           * `query` matches `intent OR title` with LIKE — the columns
           * use a `_ci` collation in MySQL so LIKE is case-insensitive.
           * `status` is constrained to the canonical UI enum.
           * `starred=true` switches ORDER BY to `starredAt DESC` so the
           * Starred page reads in last-starred order.
           */
          query: z.string().min(1).max(200).optional(),
          // Accepts either one status or a small set — `HistoryPage`'s
          // "进行中" chip OR's together five non-terminal statuses, so
          // a flat enum can't express that filter without round-tripping
          // five separate calls. Single values stay terse on the wire
          // (`status: 'failed'`); arrays encode the bundle.
          status: z
            .union([
              z.enum([
                'pending',
                'planning',
                'queued',
                'executing',
                'awaiting_user',
                'paused',
                'completed',
                'partial_success',
                'failed',
                'cancelled',
              ]),
              z
                .array(
                  z.enum([
                    'pending',
                    'planning',
                    'queued',
                    'executing',
                    'awaiting_user',
                    'paused',
                    'completed',
                    'partial_success',
                    'failed',
                    'cancelled',
                  ]),
                )
                .min(1)
                .max(10),
            ])
            .optional(),
          starred: z.boolean().optional(),
          dateFrom: z.coerce.date().optional(),
          dateTo: z.coerce.date().optional(),
        })
        .default({ limit: 20 }),
    )
    .query(async ({ ctx, input }) => {
      const [userRow] = await ctx.db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.externalId, ctx.userId))
        .limit(1);
      if (!userRow) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'unknown user' });
      }
      // Phase 1 #3 — isolation boundary: user history excludes canary/exploration/eval
      // tasks (no-op today; every row defaults to origin='user').
      const conds = [eq(tasksTable.userId, userRow.id), eq(tasksTable.origin, 'user')];
      // Cursor is an opaque numeric token whose interpretation matches
      // the active ORDER BY. In starred mode we order by `starredAt
      // DESC` and treat the cursor as a unix-ms timestamp; otherwise
      // we order by `id DESC` and the cursor is a row id. The frontend
      // just hands `nextCursor` back unchanged, so the contract stays
      // single-field.
      if (input.cursor) {
        conds.push(
          input.starred
            ? lt(tasksTable.starredAt, new Date(input.cursor))
            : lt(tasksTable.id, input.cursor),
        );
      }
      if (input.projectId) {
        const [projRow] = await ctx.db
          .select({ id: projects.id })
          .from(projects)
          .where(and(eq(projects.externalId, input.projectId), eq(projects.userId, userRow.id)))
          .limit(1);
        if (!projRow) {
          // Unknown project for this user → return empty rather
          // than 404 so the SPA renders an empty state.
          return { tasks: [], nextCursor: null };
        }
        conds.push(eq(tasksTable.projectId, projRow.id));
      }
      if (input.query) {
        // Wrap in % — caller passes a bare substring. Drizzle's `like`
        // doesn't auto-escape SQL `%` / `_` wildcards in user input,
        // but the worst case is a slightly-broader match (a query of
        // "5%" would also match "5y" / "5x"). Fine for a search box.
        const needle = `%${input.query}%`;
        const matchIntent = like(tasksTable.intent, needle);
        const matchTitle = like(tasksTable.title, needle);
        const queryCond = or(matchIntent, matchTitle);
        if (queryCond) conds.push(queryCond);
      }
      if (input.status) {
        if (Array.isArray(input.status)) {
          conds.push(
            input.status.length === 1
              ? eq(tasksTable.status, input.status[0]!)
              : inArray(tasksTable.status, input.status),
          );
        } else {
          conds.push(eq(tasksTable.status, input.status));
        }
      }
      if (input.starred) {
        conds.push(sql`${tasksTable.starredAt} IS NOT NULL`);
      }
      if (input.dateFrom) {
        conds.push(gte(tasksTable.createdAt, input.dateFrom));
      }
      if (input.dateTo) {
        conds.push(lte(tasksTable.createdAt, input.dateTo));
      }
      const rows = await ctx.db
        .select({
          id: tasksTable.id,
          externalId: tasksTable.externalId,
          intent: tasksTable.intent,
          title: tasksTable.title,
          status: tasksTable.status,
          awaitingKind: tasksTable.awaitingKind,
          awaitingQuestion: tasksTable.awaitingQuestion,
          pauseReason: tasksTable.pauseReason,
          errorCode: tasksTable.errorCode,
          errorMessage: tasksTable.errorMessage,
          opusUsed: tasksTable.opusUsed,
          starred: tasksTable.starred,
          starredAt: tasksTable.starredAt,
          projectId: tasksTable.projectId,
          createdAt: tasksTable.createdAt,
          updatedAt: tasksTable.updatedAt,
          completedAt: tasksTable.completedAt,
          // Codex Pack A4 — verifier verdict surfaced on list so the
          // sidebar / TaskListItem can show a partial-success / hard-
          // fail indicator without re-fetching detail.
          verificationPassed: tasksTable.verificationPassed,
          failureLevel: tasksTable.failureLevel,
        })
        .from(tasksTable)
        .where(and(...conds))
        // Starred mode reads in last-starred order so the most-recent
        // bookmark surfaces first; everything else stays newest-first
        // by id (autoincrement so monotonic with insertion time).
        .orderBy(input.starred ? desc(tasksTable.starredAt) : desc(tasksTable.id))
        .limit(input.limit);

      // Keep the ordered history query free of large JSON values. Terminal
      // browser screenshots live inside `result` and can exceed MySQL's sort
      // buffer before the application has a chance to strip them. Fetch the
      // selected rows' lightweight result JSON separately, with the screenshot
      // removed in SQL so it never crosses the database boundary for a list.
      const resultRows =
        rows.length > 0
        ? await ctx.db
            .select({
              id: tasksTable.id,
              result: sql<unknown>`JSON_REMOVE(${tasksTable.result}, '$.finalScreenshot')`.as(
                'result',
              ),
            })
            .from(tasksTable)
            .where(
              and(
                eq(tasksTable.userId, userRow.id),
                eq(tasksTable.origin, 'user'),
                inArray(
                  tasksTable.id,
                  rows.map((row) => row.id),
                ),
              ),
            )
        : [];
      const resultByTaskId = new Map(resultRows.map((row) => [row.id, row.result] as const));
      const attachmentNow = new Date();
      const availableAttachmentRows =
        rows.length > 0
          ? await ctx.db
              .select({
                taskId: taskFiles.taskId,
                externalId: taskFiles.externalId,
              })
              .from(taskFiles)
              .where(
                and(
                  eq(taskFiles.userId, userRow.id),
                  inArray(
                    taskFiles.taskId,
                    rows.map((row) => row.id),
                  ),
                  eq(taskFiles.kind, 'output'),
                  eq(taskFiles.status, 'active'),
                  or(isNull(taskFiles.expiresAt), gt(taskFiles.expiresAt, attachmentNow)),
                ),
              )
          : [];
      const availableAttachmentIdsByTaskId = new Map<number, Set<string>>();
      for (const file of availableAttachmentRows) {
        if (file.taskId == null) continue;
        const ids = availableAttachmentIdsByTaskId.get(file.taskId) ?? new Set<string>();
        ids.add(file.externalId);
        availableAttachmentIdsByTaskId.set(file.taskId, ids);
      }

      // Resolve project external ids in one round-trip — mapping
      // bigint project_id back to the public prj_… string the SPA
      // uses for routing. Tasks with no project skip the lookup.
      const internalProjectIds = Array.from(
        new Set(rows.map((r) => r.projectId).filter((v): v is number => v != null)),
      );
      const projectExtById = new Map<number, string>();
      if (internalProjectIds.length > 0) {
        const projectRows = await ctx.db
          .select({ id: projects.id, externalId: projects.externalId })
          .from(projects)
          .where(inArray(projects.id, internalProjectIds));
        for (const p of projectRows) projectExtById.set(p.id, p.externalId);
      }

      return {
        tasks: rows.map((r) => ({
          taskId: r.externalId,
          intent: r.intent,
          title: r.title,
          status: r.status,
          awaitingKind: r.awaitingKind,
          awaitingQuestion: r.awaitingQuestion,
          pauseReason: r.pauseReason,
          errorCode: r.errorCode,
          errorMessage: r.errorMessage,
          // R7 — strip the base64 final-state screenshot from the list
          // shape. It can be ~80KB per row (quality-80 JPEG, base64
          // overhead 33%); 100 tasks would bloat the list response by
          // ~8MB. tasks.detail still ships it for the BrowserPanel
          // evidence view; the sidebar doesn't render screenshots.
          result: stripFinalScreenshot(
            annotateTaskResultAttachmentAvailability(
              normalizeOutput(resultByTaskId.get(r.id)),
              availableAttachmentIdsByTaskId.get(r.id) ?? new Set<string>(),
              attachmentNow,
            ),
          ),
          starred: Boolean(r.starred),
          starredAt: r.starredAt,
          projectId: r.projectId != null ? (projectExtById.get(r.projectId) ?? null) : null,
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
          completedAt: r.completedAt,
          verificationPassed: r.verificationPassed,
          failureLevel: r.failureLevel,
        })),
        nextCursor:
          rows.length === input.limit
            ? input.starred
              ? (rows[rows.length - 1]?.starredAt?.getTime() ?? null)
              : (rows[rows.length - 1]?.id ?? null)
            : null,
      };
    }),

  /**
   * One task + all its steps. Steps include the `output` blob (extract
   * texts, screenshot metadata, SELECTOR_NOT_FOUND diagnostic payload,
   * etc.) so the popup can render the same ResultsSection it uses for
   * live tasks. Task ownership is verified — unknown or not-owned task
   * returns NOT_FOUND rather than leaking existence via UNAUTHORIZED.
   */
  detail: protectedProcedure
    .input(z.object({ taskId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const [userRow] = await ctx.db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.externalId, ctx.userId))
        .limit(1);
      if (!userRow) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'unknown user' });
      }
      const [taskRow] = await ctx.db
        .select()
        .from(tasksTable)
        .where(
          and(
            eq(tasksTable.externalId, input.taskId),
            eq(tasksTable.userId, userRow.id),
            eq(tasksTable.origin, 'user'),
          ),
        )
        .limit(1);
      if (!taskRow) {
        throw new TRPCError({ code: 'NOT_FOUND', message: `task ${input.taskId} not found` });
      }
      const stepRows = await ctx.db
        .select({
          externalId: taskSteps.externalId,
          seq: taskSteps.seq,
          kind: taskSteps.kind,
          status: taskSteps.status,
          riskLevel: taskSteps.riskLevel,
          input: taskSteps.input,
          output: taskSteps.output,
          errorCode: taskSteps.errorCode,
          errorMessage: taskSteps.errorMessage,
          screenshotKey: taskSteps.screenshotKey,
          startedAt: taskSteps.startedAt,
          completedAt: taskSteps.completedAt,
        })
        .from(taskSteps)
        .where(eq(taskSteps.taskId, taskRow.id))
        .orderBy(asc(taskSteps.seq));

      // P1-C — translate internal projectId to the public prj_… id
      // so the SPA gets the same shape `tasks.list` ships. Without
      // this, an upsert from a deep link would land a UiTask whose
      // projectId is the bigint primary key, which the sidebar
      // can't match to a project route.
      const projectExternalId = await (async (): Promise<string | null> => {
        if (taskRow.projectId == null) return null;
        const [proj] = await ctx.db
          .select({ externalId: projects.externalId })
          .from(projects)
          .where(eq(projects.id, taskRow.projectId))
          .limit(1);
        return proj?.externalId ?? null;
      })();
      const attachmentNow = new Date();
      const availableAttachmentRows = await ctx.db
        .select({ externalId: taskFiles.externalId })
        .from(taskFiles)
        .where(
          and(
            eq(taskFiles.userId, userRow.id),
            eq(taskFiles.taskId, taskRow.id),
            eq(taskFiles.kind, 'output'),
            eq(taskFiles.status, 'active'),
            or(isNull(taskFiles.expiresAt), gt(taskFiles.expiresAt, attachmentNow)),
          ),
        );
      const availableAttachmentIds = new Set(
        availableAttachmentRows.map((file) => file.externalId),
      );
      return {
        taskId: taskRow.externalId,
        intent: taskRow.intent,
        title: taskRow.title,
        status: taskRow.status,
        pauseReason: taskRow.pauseReason,
        // F11 follow-up — only meaningful while status='awaiting_user'.
        // SPA gates on status, so leaving the column populated for
        // historical rows is harmless. Returned alongside status so
        // a refresh during a pause re-renders the input.
        awaitingQuestion: taskRow.awaitingQuestion ?? null,
        // P2-A — kind classifier for the awaiting state. NULL on
        // legacy rows or non-awaiting tasks; SPA defaults to
        // 'clarification' when missing.
        awaitingKind: taskRow.awaitingKind ?? null,
        errorCode: taskRow.errorCode,
        errorMessage: taskRow.errorMessage,
        // P1-C — extra fields the SPA's UiTask shape needs when this
        // task isn't already in the loaded sidebar list (deep links
        // beyond the first 50). tasks.list ships these too.
        opusUsed: Boolean(taskRow.opusUsed),
        starred: Boolean(taskRow.starred),
        starredAt: taskRow.starredAt,
        projectId: projectExternalId,
        result: annotateTaskResultAttachmentAvailability(
          normalizeOutput(taskRow.result),
          availableAttachmentIds,
          attachmentNow,
        ),
        // Phase 13 Dim 1 — surface plan body so a re-opened tab
        // re-renders the PlanCard from persisted state instead of
        // waiting for a (now-impossible) WS replay.
        planText: taskRow.planText,
        planStatus: normalizeOutput(taskRow.planStatus),
        // Codex Pack A4 — verifier verdict columns. Null on tasks
        // that ran before the verifier flag flipped; SPA treats null
        // as "no opinion" and renders the standard success card.
        verificationPassed: taskRow.verificationPassed,
        failureLevel: taskRow.failureLevel,
        createdAt: taskRow.createdAt,
        completedAt: taskRow.completedAt,
        steps: stepRows.map((s) => ({
          id: s.externalId,
          seq: s.seq,
          kind: s.kind,
          status: s.status,
          riskLevel: s.riskLevel,
          // MariaDB JSON columns arrive as strings on some driver
          // configs; the repo's normalizeJson handles that, inline
          // the parse here so callers get a real object.
          input: normalizeOutput(s.input),
          output: normalizeOutput(s.output),
          errorCode: s.errorCode,
          errorMessage: s.errorMessage,
          screenshotKey: s.screenshotKey,
          startedAt: s.startedAt,
          completedAt: s.completedAt,
        })),
      };
    }),

  /**
   * Supercar-only: resume a task that parked on `server.supercar.awaiting_user`.
   * Returns `{ ok: false }` when the task isn't currently waiting (already
   * finished, unknown id, wrong user). Does NOT load the full task state —
   * the only valid state for reply is an in-memory handle registered by
   * the running loop, so we bail fast when it's missing.
   */
  reply: protectedProcedure
    .input(
      z.object({
        taskId: z.string().min(1),
        message: z.string().min(1).max(4_000),
        // F2 — attachments uploaded with the reply. Same shape as
        // `tasks.create.fileIds`. Resolved + parsed below into
        // content blocks, then plumbed through `supercarReply`'s
        // attachmentBlocks param. Cap mirrors create.
        fileIds: z.array(z.string()).max(5).optional(),
      }),
    )
    // Explicit return-type annotation breaks the circular type
    // inference: this handler calls `tasksRouter.createCaller` (F4
    // backend handoff), which references the very router this
    // handler is inside. Without the annotation tsc gives up and
    // resolves the whole router as `any`, breaking SPA type-safety.
    .mutation(
      async ({
        ctx,
        input,
      }): Promise<{
        ok: boolean;
        state?: 'resumed' | 'stillAwaiting' | 'persistFailed';
        handoff?: 'browser';
        handoffTaskId?: string;
      }> => {
      const [userRow] = await ctx.db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.externalId, ctx.userId))
        .limit(1);
      if (!userRow) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'unknown user' });
      }
      const [taskRow] = await ctx.db
        .select({ id: tasksTable.id })
        .from(tasksTable)
          .where(
            and(
              eq(tasksTable.externalId, input.taskId),
              eq(tasksTable.userId, userRow.id),
              eq(tasksTable.origin, 'user'),
            ),
          )
        .limit(1);
      if (!taskRow) {
        throw new TRPCError({ code: 'NOT_FOUND', message: `task ${input.taskId} not found` });
      }
      // F2 — resolve + parse attachments before classification so the
      // resulting blocks are ready for whichever delivery path fires.
      // Same pattern as tasks.create: any individual file that fails
      // to load / parse is skipped with a warn; the reply still
      // delivers with whatever did parse.
        const replyAttachmentBlocks: Awaited<ReturnType<typeof parseFileForPrompt>>['blocks'] = [];
      if (input.fileIds && input.fileIds.length > 0) {
        const fileService = new FileService(ctx.db, ctx.logger);
        const loaded = await fileService.loadMany(input.fileIds, userRow.id);
        for (const f of loaded) {
          try {
              const parsed = await parseFileForPrompt(f.buffer, f.row.filename, f.row.mimetype);
            replyAttachmentBlocks.push(...parsed.blocks);
          } catch (err) {
            ctx.logger.warn(
              {
                err: err instanceof Error ? err.message : String(err),
                fileId: f.row.externalId,
              },
              'tasks.reply: file parse failed — skipping',
            );
          }
        }
      }
      // F1 — classify the user's reply intent. Four buckets:
      //   manual_data     — user pasted metrics / "数据如下" / numeric
      //                     blob; supercar should hand off to generate.
      //   login_completed — user finished a manual login or captcha
      //                     ("扫完了" / "登录好了"); continue browser.
      //   still_awaiting  — user said "等一下 / 稍等 / wait"; keep
      //                     supercar parked, don't resume the loop.
      //   default         — auto, anything else; continue browser.
      // The classifier is intentionally conservative (favors `default`)
      // — false-handoff aborts a working browser session, so we only
      // hand off when the message is unambiguously self-sufficient.
      const replyKind = classifyReplyIntent(input.message);
      ctx.logger.info(
        { taskId: input.taskId, replyKind, msgLen: input.message.length },
        'reply: classified',
      );

      // Fix 2 — still_awaiting short-circuit. Don't deliver to
      // supercarReply, don't resume the loop, don't touch DB status.
      // Task stays in awaiting_user; SPA's replyToTask gates on
      // `state` and preserves the BrowserPanel takeover UI.
      if (replyKind === 'still_awaiting') {
        // Best-effort re-broadcast so any SPA tab that lost its
        // awaitingUserByTask entry (e.g. after a long idle) gets it
        // back without needing tasks.detail re-fetch.
        try {
          const [row] = await ctx.db
            .select({
              status: tasksTable.status,
              awaitingQuestion: tasksTable.awaitingQuestion,
              awaitingKind: tasksTable.awaitingKind,
            })
            .from(tasksTable)
            .where(
              and(
                eq(tasksTable.externalId, input.taskId),
                eq(tasksTable.userId, userRow.id),
                eq(tasksTable.origin, 'user'),
              ),
            )
            .limit(1);
          if (row?.status === 'awaiting_user' && row.awaitingQuestion) {
            broadcastToUser(ctx.userId, {
              type: 'server.supercar.awaiting_user',
              taskId: input.taskId,
              question: row.awaitingQuestion,
              awaitingKind: normalizeReplyAwaitingKindForBroadcast(row.awaitingKind),
            });
          }
        } catch (err) {
          ctx.logger.warn(
            { err, taskId: input.taskId },
            'reply: still_awaiting rebroadcast failed (non-fatal)',
          );
        }
        return { ok: true, state: 'stillAwaiting' as const };
      }

      // Phase 3 R1 — state-machine invariant requires the row to be
      // in `executing` BEFORE the agent-loop is woken from its
      // awaiting_user park. Otherwise the agent's next iteration
      // could complete + call persistVisionOutcome while the row
      // still says `awaiting_user`, and the new state guard in
      // task-repository would refuse the completed write.
      //
      // Sequence:
      //   1. AWAIT the DB transition awaiting_user → executing.
      //   2. Then call supercarReply / supercarHandoffToGenerate to
      //      wake the agent.
      //   3. Agent's next persistVisionOutcome sees status=executing,
      //      writes complete normally.
      // If the DB write fails we DON'T deliver the reply — the row
      // would be inconsistent and the agent could complete into a
      // refused write, leaving the user with a parked task that
      // never moves.
      const supercarHasHandle = hasParkedSupercarHandle(input.taskId);
      if (supercarHasHandle) {
        try {
          const repo = new TaskRepository(ctx.db);
          const persisted = await repo.markAwaitingReplyResumed(input.taskId);
          if (!persisted.persisted) {
            ctx.logger.warn(
              { taskId: input.taskId },
              'reply: awaiting_user → executing guard refused; not delivering reply',
            );
            return { ok: false, state: 'persistFailed' as const };
          }
        } catch (err) {
          ctx.logger.error(
            { err, taskId: input.taskId },
            'reply: failed to flip awaiting_user → executing; refusing to deliver reply',
          );
          return { ok: false, state: 'persistFailed' as const };
        }
      }

      const delivered =
        replyKind === 'manual_data'
          ? supercarHandoffToGenerate(input.taskId, input.message)
          : supercarReply(
              input.taskId,
              input.message,
              replyAttachmentBlocks.length > 0 ? replyAttachmentBlocks : undefined,
            );
      if (delivered) {
        return { ok: true, state: 'resumed' as const };
      }

      // No supercar handle — could be a generate-lane intake park
      // (expert workflow with `missingInputs > 0` routes through
      // `runGenerateTask`, parks on `[AWAITING_USER_INPUT]`, has no
      // agent loop to register a handle). In that case we resume by
      // re-running runGenerateTask under the same taskId with the
      // combined original-intent + user-reply text.
      const [parkRow] = await ctx.db
        .select({
          intent: tasksTable.intent,
          status: tasksTable.status,
          result: tasksTable.result,
          opusUsed: tasksTable.opusUsed,
          roleId: tasksTable.roleId,
        })
        .from(tasksTable)
        .where(eq(tasksTable.externalId, input.taskId))
        .limit(1);
        const prevResult = (parkRow?.result ?? null) as Record<string, unknown> | null;
      const wasGenerateParked =
        Boolean(parkRow) &&
        parkRow!.status === 'awaiting_user' &&
        prevResult?.executionMode === 'generate';
      if (!wasGenerateParked) {
        return { ok: false };
      }

      // Sweep P2 fix: user replies the bare VALUE (e.g. "美妆护肤")
      // for an intake question, but the typed workflow's
      // extractPattern requires an anchor like "品类:" before the
      // value. The re-parse on the unmodified combined intent
      // re-misses the field and we park with the SAME question
      // forever.
      //
      // Mitigation: peek at the typed workflow that was driving the
      // original park and, for each required field whose
      // extractPattern doesn't match the bare reply text, prepend
      // the field's label as an anchor so the regex can pick it up
      // on the next parse round. Uses the EXECUTION registry match
      // (the typed-workflow lane), not the supercar matcher.
      const parkingTypedWorkflow = matchTypedExpertWorkflow({
        intent: parkRow!.intent,
        roleId: parkRow!.roleId ?? null,
      });
      const userReply = input.message.trim();
      let anchoredReply = userReply;
      if (parkingTypedWorkflow && userReply.length > 0) {
        const priorParse = parseInputs(parkRow!.intent, parkingTypedWorkflow);
        const additions: string[] = [];
        for (const field of priorParse.missingRequired) {
          if (!field.extractPattern) continue;
          if (field.extractPattern.test(userReply)) continue;
          const anchor = (field.label ?? field.name).split(/[\s/]/)[0];
          additions.push(`${anchor}: ${userReply}`);
        }
        if (additions.length > 0) {
          anchoredReply = [...additions, userReply].join('\n');
        }
      }

        const combinedIntent = [parkRow!.intent, `\n\n[用户补充]\n${anchoredReply}`]
          .join('')
          .trim();

      // Re-evaluate the workflow on the COMBINED intent. Two outcomes
      // matter here:
      //   1. missingInputs is now empty + user supplied platform-source
      //      keywords (罗盘/抖店) → routeOverride='browser'. We can't
      //      cleanly hand off to supercar from inside this handler
      //      today (the supercar dispatch is 1500 lines of inline glue
      //      in tasks.create, not a callable helper). So we surface a
      //      structured response and let the SPA prompt the user to
      //      open a new task with `intent=combinedIntent`. Tracked as
      //      a follow-up to extract `dispatchSupercar` once we have a
      //      dedicated reviewer for the refactor.
      //   2. Otherwise (manual data / paste / "我自己给数据" / still
      //      missing inputs) → re-run runGenerateTask one shot. The
      //      runner will either complete (report) or park again with
      //      a new intake question (the model decides).
      //
      // Short-circuit: if the user clearly pasted metrics/data
      // (`replyKind === 'manual_data'`) we skip the workflow re-run
      // and go straight to generate. The classifier is conservative,
      // so a `manual_data` verdict means there are unambiguous numeric
      // figures or "数据如下" markers — no need to ask whether the
      // user actually wants the browser path. Avoids edge cases where
      // a paste happens to contain platform keywords ("罗盘 GMV 156k
      // UV 28k") and would otherwise trip the browser-handoff branch.
      const newWorkflow = matchExpertWorkflow(combinedIntent, {
        hasAttachments: false,
      });
      const wantsBrowser =
          replyKind !== 'manual_data' && newWorkflow?.routeOverride === 'browser';

      if (wantsBrowser) {
        ctx.logger.info(
          {
            taskId: input.taskId,
            workflowId: newWorkflow!.id,
            missingInputs: newWorkflow!.missingInputs,
          },
          'reply: combined intent now wants browser lane — backend auto-handoff',
        );
        // F4 — backend-orchestrated auto-handoff. The earlier round
        // broadcast `autoHandoff: { intent }` and let the SPA fire
        // createTask, which had two problems:
        //   1. SPA reconnect could replay the terminal frame and
        //      double-create the handoff task.
        //   2. The SPA's createTask charged user quota — even though
        //      the handoff is logically a continuation of the parent.
        // Now the backend invokes `tasksRouter.create` itself via
        // createCaller with `replyToTaskId` set to the parent. That
        // path skips the quota gate (existing follow-up semantics),
        // injects the parent context, and returns the new taskId.
        // Idempotency guard: if `result.handoffTaskId` is already
        // populated for this parent, reuse it instead of creating a
        // duplicate (handles WS replay / double-click).
          const handoffNotice = '需要登录浏览器去后台读取数据，已为你新建一个浏览器任务接续执行。';
        let handoffTaskId: string | null =
            typeof prevResult?.handoffTaskId === 'string' ? prevResult.handoffTaskId : null;
        // F4 ordering fix — createCaller's `tasks.create` follow-up
        // gate (replyToTaskId path) rejects parents in awaiting_user
        // ("只能追问已完成/失败/取消的任务"). We must flip the parent
        // to `completed` BEFORE invoking createCaller, otherwise the
        // call throws and handoffTaskId stays null. Persist the
        // pre-handoff state first, then run createCaller, then patch
        // the result row again to include handoffTaskId on success.
        // If createCaller throws AFTER the status flip, the parent
        // stays completed (with combinedIntent in result) — slightly
        // worse UX than ideal but never blocks the user, and matches
        // the prior behaviour for partial failure.
        const repo = new TaskRepository(ctx.db);
        try {
          const parentResult = {
            ...(prevResult ?? {}),
            executionMode: 'generate',
            handoffSuggestion: 'browser',
            combinedIntent,
            summary: handoffNotice,
          };
          const persisted = await repo.markAwaitingReplyCompleted(input.taskId, parentResult);
          if (!persisted.persisted) {
            ctx.logger.warn(
              { taskId: input.taskId },
              'reply: handoff parent-flip guard refused; not creating handoff task',
            );
            return { ok: false, state: 'persistFailed' as const };
          }
        } catch (err) {
          ctx.logger.error(
            { err, taskId: input.taskId },
            'reply: handoff parent-flip persist failed',
          );
          return { ok: false, state: 'persistFailed' as const };
        }

        if (!handoffTaskId) {
          try {
              const handoff = await tasksRouter.createCaller(ctx).create({
                intent: combinedIntent,
                replyToTaskId: input.taskId,
              });
            handoffTaskId = handoff.taskId;
            ctx.logger.info(
              {
                parentTaskId: input.taskId,
                handoffTaskId,
                handoffStatus: handoff.status,
                handoffExecutionMode: handoff.executionMode,
              },
              'reply: spawned handoff task via createCaller',
            );
          } catch (err) {
            ctx.logger.error(
              {
                err: err instanceof Error ? err.message : String(err),
                parentTaskId: input.taskId,
              },
              'reply: handoff createCaller failed',
            );
            // Continue — parent already marked completed above; SPA
            // shows the completion notice without auto-navigation.
          }
        } else {
          ctx.logger.info(
            { parentTaskId: input.taskId, handoffTaskId },
            'reply: handoff already exists — idempotent reuse',
          );
        }

        // Patch result with handoffTaskId now that createCaller has
        // returned (or failed). Best-effort — terminal broadcast
        // below already carries the field for live SPA listeners.
        try {
          if (handoffTaskId) {
            const patched = await repo.patchCompletedTaskResult(input.taskId, {
              ...(prevResult ?? {}),
              executionMode: 'generate',
              handoffSuggestion: 'browser',
              combinedIntent,
              summary: handoffNotice,
              handoffTaskId,
            });
            if (!patched.persisted) {
              ctx.logger.warn(
                { taskId: input.taskId, handoffTaskId },
                'reply: handoff result patch guard refused; skipping stale terminal broadcast',
              );
              return {
                ok: false,
                state: 'persistFailed' as const,
                handoff: 'browser' as const,
                handoffTaskId,
              };
            }
          }
          broadcastToUser(ctx.userId, {
            type: 'server.task.terminal',
            taskId: input.taskId,
            status: 'completed',
            summary: handoffNotice,
            ...(handoffTaskId ? { handoffTaskId } : {}),
          });
        } catch (err) {
            ctx.logger.error({ err, taskId: input.taskId }, 'reply: handoff persist failed');
        }
        return {
          ok: true,
          handoff: 'browser' as const,
          state: 'resumed' as const,
          ...(handoffTaskId ? { handoffTaskId } : {}),
        };
      }

      // Generate-lane resume. Flip to executing, then dispatch the
      // runner with the combined intent. The preamble carries the
      // expert-workflow context (now with `missingInputs.length === 0`
      // → no intake-guard, so the model will produce a real report).
      const anthropicClient = anthropicForResolver;
      if (!anthropicClient) {
        ctx.logger.error(
          { taskId: input.taskId },
          'reply: anthropic client not configured — cannot resume',
        );
        return { ok: false };
      }
      const repo = new TaskRepository(ctx.db);
      const newWorkflowPreamble = newWorkflow?.promptPreamble ?? '';
      const effectiveCombined =
        (newWorkflowPreamble ? `${newWorkflowPreamble}\n` : '') + combinedIntent;
      const resumePersisted = await repo.markAwaitingReplyResumed(input.taskId);
      if (!resumePersisted.persisted) {
        ctx.logger.warn(
          { taskId: input.taskId },
          'reply: generate resume guard refused; not dispatching runner',
        );
        return { ok: false, state: 'persistFailed' as const };
      }
      const resumeStartedAt = Date.now();
      void (async () => {
        let outcome;
        try {
          outcome = await runGenerateTask({
            taskId: input.taskId,
            userId: ctx.userId,
            intent: effectiveCombined,
            ...(parkRow!.roleId ? { skillId: parkRow!.roleId } : {}),
            client: anthropicClient,
            logger: ctx.logger,
            // F2 — pass user-uploaded attachments through to the
            // generate runner so a parked-from-generate task that
            // resumes with a file (e.g. Excel of metrics) sees the
            // attachment alongside the original intent.
              ...(replyAttachmentBlocks.length > 0 ? { attachments: replyAttachmentBlocks } : {}),
            onStreamDelta: (delta) => {
              try {
                broadcastToUser(ctx.userId, {
                  type: 'server.task.stream',
                  taskId: input.taskId,
                  delta,
                });
              } catch (err) {
                ctx.logger.warn(
                  { err, taskId: input.taskId },
                  'reply: broadcast stream delta failed',
                );
              }
            },
          });
        } catch (err) {
          ctx.logger.error({ err, taskId: input.taskId }, 'reply: runner threw');
          outcome = {
            status: 'failed' as const,
            summary: '',
              reason: err instanceof Error ? err.message : 'reply: unknown error',
            inputTokens: 0,
            outputTokens: 0,
            durationMs: 0,
          };
        }
        const elapsedMs = Date.now() - resumeStartedAt;
        const metadata = {
          executionMode: 'generate' as const,
          finalExecutionMode: 'generate' as const,
          expertWorkflowId: newWorkflow?.id ?? null,
          selectedRole: parkRow!.roleId ?? null,
          model: 'claude-sonnet-4-6',
          fallbackChain: ['generate-resume'],
          elapsedMs,
            modelFinalText: outcome.status === 'completed' ? outcome.summary.slice(0, 200) : null,
        };
        try {
          if (outcome.status === 'completed') {
            const persisted = await repo.persistVisionOutcome(input.taskId, {
              status: 'completed',
              summary: outcome.summary,
              tickCount: 1,
              metadata,
            });
            if (persisted.persisted) {
              broadcastToUser(ctx.userId, {
                type: 'server.task.terminal',
                taskId: input.taskId,
                status: 'completed',
                ...(outcome.summary ? { summary: outcome.summary } : {}),
              });
            }
          } else if (outcome.status === 'awaiting_user') {
            // Park again — model still wants more info.
            const persisted = await repo.persistAwaitingUser({
              taskExternalId: input.taskId,
              question: outcome.summary,
              awaitingKind: 'clarification',
              result: { ...metadata, executionMode: 'generate' as const },
            });
            if (persisted.persisted) {
              broadcastToUser(ctx.userId, {
                type: 'server.supercar.awaiting_user',
                taskId: input.taskId,
                question: outcome.summary,
                awaitingKind: 'clarification',
              });
            }
          } else {
            const persisted = await repo.persistVisionOutcome(input.taskId, {
              status: 'failed',
              reason: outcome.reason ?? 'generate-resume: api failed',
              tickCount: 1,
              metadata,
            });
            if (persisted.persisted) {
              broadcastToUser(ctx.userId, {
                type: 'server.task.terminal',
                taskId: input.taskId,
                status: 'failed',
                ...(outcome.reason ? { reason: outcome.reason } : {}),
              });
            }
          }
        } catch (err) {
            ctx.logger.error({ err, taskId: input.taskId }, 'reply: persist resume outcome failed');
        }
      })();
      return { ok: true, state: 'resumed' as const };
    },
  ),

  /**
   * Supercar-only: abort a running task. Sets the in-memory abort flag;
   * the next loop iteration exits with status=cancelled.
   */
  abort: protectedProcedure
    .input(z.object({ taskId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const [userRow] = await ctx.db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.externalId, ctx.userId))
        .limit(1);
      if (!userRow) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'unknown user' });
      }
      const [taskRow] = await ctx.db
        .select({ id: tasksTable.id, status: tasksTable.status })
        .from(tasksTable)
        .where(
          and(
            eq(tasksTable.externalId, input.taskId),
            eq(tasksTable.userId, userRow.id),
            eq(tasksTable.origin, 'user'),
          ),
        )
        .limit(1);
      if (!taskRow) {
        throw new TRPCError({ code: 'NOT_FOUND', message: `task ${input.taskId} not found` });
      }
      const repo = new TaskRepository(ctx.db);
      const aborted = supercarAbort(input.taskId);
      if (aborted) {
        try {
          await repo.recordCancelRequested(input.taskId, taskRow.status as TaskState['status']);
        } catch (err) {
          ctx.logger.warn(
            { err, taskId: input.taskId, status: taskRow.status },
            'abort: cancel-request event persist failed',
          );
        }
        return { ok: true, state: 'aborting' as const };
      }

      const cancellableStatuses = [...TASK_ACTIVE_STATUSES];
      if (!(cancellableStatuses as readonly string[]).includes(taskRow.status)) {
        return { ok: false, state: taskRow.status };
      }

      // Auth/captcha/permission waits are durable: the supercar loop parks the
      // DB row in awaiting_user and releases its in-memory abort handle. Run the
      // same guarded control transition as pause/resume so a stale read cannot
      // produce a fake task.cancelled event or terminal broadcast.
      const prev: TaskState = {
        taskId: input.taskId,
        status: taskRow.status as TaskState['status'],
        plan: [],
        cursor: 0,
        pendingConfirm: null,
      };
      const next: TaskState = {
        ...prev,
        status: 'cancelled',
        pauseReason: null,
      };
      const persisted = await repo.applyControlTransition(prev, next);
      if (!persisted.persisted) {
        return { ok: false, state: 'stale' as const };
      }
      broadcastToUser(ctx.userId, {
        type: 'server.task.terminal',
        taskId: input.taskId,
        status: 'cancelled',
      });
      return { ok: true, state: 'cancelled' as const };
    }),

  /**
   * Navigate the headed Brave singleton to about:blank so the VNC
   * stream doesn't show a stale URL from a previous task while the
   * user types the next intent. Idempotent + fire-and-forget — we
   * don't surface errors because there's nothing the user can do
   * about a CDP hiccup except try again. Only runs if the primary
   * executor is the headed lane (guarded in the router).
   */
  /**
   * P3 wake mechanism — explicit "bring my browser back" path. After
   * the 5-minute idle GC reaps the user's pool instance, the SPA
   * shows a hibernation card; the wake button calls this. Returns
   * pool stats so the panel can probe-and-redraw, then the SPA
   * triggers a fresh VNC connection.
   *
   * No quota cost — this is just respawning the per-user Brave
   * (cookies preserved in user-data-dir, so logins don't re-prompt).
   * Concurrency limit doesn't apply either: the user isn't starting
   * a new TASK, just lighting up the browser.
   *
   * Returns:
   *   { status: 'ready' }   — instance is alive and ready to stream
   *   { status: 'spawning' } — allocate is still cold-starting
   *                            (~3-5 s); SPA should show a spinner
   *                            and let VNC retry on its own
   *   { status: 'unavailable' } — pool not configured / capacity full
   */
  wakeBrowser: protectedProcedure.mutation(async ({ ctx }) => {
    // Phase 24 — wakeBrowser is now a no-op. Pre-warming a Brave
    // before the user submits a task made sense in the per-user
    // model (one Brave shared across the user's tasks). Per-task
    // means there's no instance until a task exists, so there's
    // nothing to pre-warm. Kept as a no-op endpoint so the SPA's
    // existing call doesn't 404 — frontend can drop the call in a
    // later phase. Returns the existing instance if the user has
    // any active task; null otherwise.
    if (!ctx.browserPool) {
      return { status: 'unavailable' as const, reason: 'pool_disabled' };
    }
    const existing = ctx.browserPool.peekActiveForUser(ctx.userId);
    if (existing) {
      return { status: 'ready' as const, cdpPort: existing.cdpPort };
    }
    return {
      status: 'unavailable' as const,
      reason: 'no_active_task — submit a task to spawn a browser',
    };
  }),

  /**
   * Re-establish the interactive browser owned by an existing terminal task.
   * This does not create a task, consume quota, or manufacture continuity from
   * a screenshot. If the original process is gone, a fresh managed browser is
   * opened under the same task id at the last persisted, policy-checked URL.
   */
  ensureBrowserSession: protectedProcedure
    .input(z.object({ taskId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.browserPool || !shouldUseBrowserPool(ctx.userId)) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: '当前浏览器工作区不可用',
        });
      }
      const browserPool = ctx.browserPool;

      const [userRow] = await ctx.db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.externalId, ctx.userId))
        .limit(1);
      if (!userRow) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'unknown user' });
      }
      const [taskRow] = await ctx.db
        .select({
          status: tasksTable.status,
          origin: tasksTable.origin,
          result: tasksTable.result,
        })
        .from(tasksTable)
        .where(
          and(
            eq(tasksTable.externalId, input.taskId),
            eq(tasksTable.userId, userRow.id),
            eq(tasksTable.origin, 'user'),
          ),
        )
        .limit(1);
      if (!taskRow) {
        throw new TRPCError({ code: 'NOT_FOUND', message: '找不到浏览器任务' });
      }
      return browserSessionRestoreFlights.run(browserPool, input.taskId, async () => {
          const existing = browserPool.peek(input.taskId);
          if (existing?.status === 'ready') {
            if (existing.userId !== ctx.userId) {
              throw new TRPCError({
                code: 'FORBIDDEN',
                message: '浏览器归属校验失败',
              });
            }
            browserPool.retain(
              input.taskId,
              appEnv.BROWSER_TERMINAL_RETENTION_MS,
              'terminal-workspace',
            );
            let currentUrl = 'about:blank';
            try {
              currentUrl = (await existing.executor.getPage()).url();
            } catch {
              const target = restorableBrowserTarget(taskRow);
              if (target) currentUrl = target.url;
            }
            return {
              status: 'ready' as const,
              restored: false,
              url: currentUrl,
            };
          }
          if (existing) {
            throw new TRPCError({
              code: 'CONFLICT',
              message: '浏览器工作区正在释放，请稍后重试',
            });
          }

          const target = restorableBrowserTarget(taskRow);
          if (!target) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: '这个任务没有可恢复的真实浏览器页面',
            });
          }

          const decision = await defaultBrowserNetworkPolicy.check(target.url);
          if (!decision.allowed) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: decision.message,
            });
          }

          let allocated = false;
          try {
          const instance = await browserPool.allocate(input.taskId, ctx.userId);
            allocated = true;
            await instance.executor.resetPageForTask();
            const page = (await instance.executor.getPage()) as unknown as PageLike;
            const navigation = await instance.executor.navigate(page, target.url);
            if (!navigation.ok) {
              throw new Error(navigation.message ?? '无法恢复最后页面');
            }
            const restoredPage = await instance.executor.getPage();
            const restoredUrl = restoredPage.url();
            browserPool.retain(
              input.taskId,
              appEnv.BROWSER_TERMINAL_RETENTION_MS,
              'terminal-workspace',
            );
            return {
              status: 'ready' as const,
              restored: true,
              url: restoredUrl || target.url,
            };
          } catch (err) {
            if (allocated) {
              await browserPool
                .release(input.taskId, 'terminal-workspace-restore-failed')
                .catch(() => {});
            }
            ctx.logger.warn(
              {
                taskId: input.taskId,
                userId: ctx.userId,
                err: err instanceof Error ? err.message : String(err),
              },
              'tasks.ensureBrowserSession: restore failed',
            );
            throw new TRPCError({
              code: 'INTERNAL_SERVER_ERROR',
              message: '浏览器工作区恢复失败，请稍后重试',
            });
          }
      });
    }),

  /** Persist user-driven terminal navigation so a later process-level restore
   * returns to the page the user actually reached, not the agent's older final
   * URL. The live pool ownership check prevents clients from rewriting an
   * unrelated or already-released task record. */
  checkpointBrowserSession: protectedProcedure
    .input(
      z.object({
        taskId: z.string().min(1),
        url: z.string().min(1).max(2048),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!isSafeUrl(input.url) || !ctx.browserPool) {
        return { ok: false as const, reason: 'invalid_or_unavailable' as const };
      }
      const instance = ctx.browserPool.peek(input.taskId);
      if (!instance || instance.status !== 'ready' || instance.userId !== ctx.userId) {
        return { ok: false as const, reason: 'session_not_live' as const };
      }
      const [userRow] = await ctx.db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.externalId, ctx.userId))
        .limit(1);
      if (!userRow) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'unknown user' });
      }
      const [taskRow] = await ctx.db
        .select({ status: tasksTable.status, result: tasksTable.result })
        .from(tasksTable)
        .where(
          and(
            eq(tasksTable.externalId, input.taskId),
            eq(tasksTable.userId, userRow.id),
            eq(tasksTable.origin, 'user'),
          ),
        )
        .limit(1);
      if (!taskRow || !isTaskTerminalStatus(taskRow.status)) {
        return { ok: false as const, reason: 'task_not_terminal' as const };
      }
      const previous =
        taskRow.result && typeof taskRow.result === 'object'
          ? (taskRow.result as Record<string, unknown>)
          : {};
      await ctx.db
        .update(tasksTable)
        .set({ result: { ...previous, finalUrl: input.url } })
        .where(
          and(
            eq(tasksTable.externalId, input.taskId),
            eq(tasksTable.userId, userRow.id),
            eq(tasksTable.status, taskRow.status),
          ),
        );
      ctx.browserPool.touch(input.taskId);
      return { ok: true as const };
    }),

  resetBrowser: protectedProcedure.mutation(async ({ ctx }) => {
    // Pool users reset their own Brave; everyone else resets the
    // shared headed singleton. peek() never allocates — we don't
    // want a fresh quartet just for a new-task nudge, and if the
    // user doesn't yet have one there's nothing to reset.
    // Phase 24 — peekActiveForUser finds the user's most recently
    // active task instance. If they have multiple concurrent tasks,
    // resetting clobbers the most recent one's page. That's a
    // reasonable default: the SPA's "reset browser" button is meant
    // for the panel-visible browser, which is what peekActiveForUser
    // returns.
    const poolInstance =
      ctx.browserPool && shouldUseBrowserPool(ctx.userId)
        ? ctx.browserPool.peekActiveForUser(ctx.userId)
        : null;
    const exec =
      poolInstance?.executor ??
      ctx.executionRouter?.getExecutor('headed') ??
      ctx.executionRouter?.getExecutor('headless') ??
      ctx.playwrightExecutor ??
      null;
    if (!exec) return { ok: false as const, reason: 'no_executor' };
    try {
      await exec.resetPageForTask();
      return { ok: true as const };
    } catch (err) {
      ctx.logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'tasks.resetBrowser: reset failed (non-fatal)',
      );
      return { ok: false as const, reason: 'reset_failed' };
    }
  }),

  /**
   * User-initiated browser chrome navigation on the attached Brave
   * instance. Used by the Panel header's back / forward / reload
   * buttons — the agent loop owns URL changes but the user also needs
   * trivial browser-style navigation when they decide to poke around
   * the rendered site themselves.
   *
   * Fire-and-forget semantics; errors are swallowed and reported as
   * `{ok:false, reason}` so the UI can show a subtle toast rather
   * than a TRPC error banner for something as cheap as "no page yet".
   */
  browserNav: protectedProcedure
    .input(
      z.object({
        direction: z.enum(['back', 'forward', 'reload', 'goto']),
        // For direction='goto': the URL to navigate to. Required for
        // goto, ignored otherwise. Cap at 2KB to keep the request
        // body bounded; longer URLs are almost certainly someone
        // shoving form data into the address bar.
        url: z.string().max(2048).optional(),
        // F3 — when the SPA's BrowserPanel is showing a SPECIFIC
        // task's screencast, it passes that task's id so the nav
        // routes to the right Brave. Without this, peekActiveForUser
        // picked the most-recently-active instance, which races when
        // the user has multiple concurrent tasks. Optional so the
        // explicit "browser live" entrypoint (sidebar globe, no
        // task selected) still falls through to the userId pick.
        taskId: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Resolve the executor in two layers: prefer the per-task pool
      // instance when the SPA passed a taskId — that uniquely binds
      // the nav to whichever Brave the panel is actually streaming.
      // Owner check is non-negotiable: pool.peek returns by taskId
      // alone, so without verifying `inst.userId === ctx.userId` a
      // user could navigate someone ELSE's browser by guessing a
      // task id. Fall through to peekActiveForUser only when no
      // taskId is supplied (sidebar globe entry / legacy path).
      let poolInstance = null;
      if (ctx.browserPool && shouldUseBrowserPool(ctx.userId)) {
        if (input.taskId) {
          const inst = ctx.browserPool.peek(input.taskId);
          if (inst && inst.userId === ctx.userId) {
            poolInstance = inst;
          } else if (inst) {
            ctx.logger.warn(
              { taskId: input.taskId, ownerMismatch: true },
              'tasks.browserNav: peek returned non-owner instance — ignoring',
            );
          }
        } else {
          poolInstance = ctx.browserPool.peekActiveForUser(ctx.userId);
        }
      }
      const exec =
        poolInstance?.executor ??
        (appEnv.NODE_ENV === 'production'
          ? null
          : (ctx.executionRouter?.getExecutor('headed') ??
            ctx.executionRouter?.getExecutor('headless') ??
            ctx.playwrightExecutor ??
            null));
      if (!exec) return { ok: false as const, reason: 'no_executor' };
      try {
        const page = await exec.getPage();
        // waitUntil: 'domcontentloaded' — the default 'load' waits for
        // every sub-resource and times out on heavy SPAs (ctrip /
        // jd homepage can easily break 30s). Back/forward on a fresh
        // tab with no history returns null (not an error) — the
        // caller silently gets ok:true which is fine.
        const navOpts = { timeout: 15_000, waitUntil: 'domcontentloaded' as const };
        if (input.direction === 'back') {
          const r = await page.goBack(navOpts);
          if (!r) return { ok: false as const, reason: 'no_history' };
        } else if (input.direction === 'forward') {
          const r = await page.goForward(navOpts);
          if (!r) return { ok: false as const, reason: 'no_history' };
        } else if (input.direction === 'goto') {
          if (!input.url) {
            return { ok: false as const, reason: 'missing_url' };
          }
          // Normalise: bare hostname → https; anything else passes
          // through. Reject schemes other than http(s) so users can't
          // emit `javascript:` / `file:` / `data:` URLs at the remote
          // browser via the panel address bar.
          let target = input.url.trim();
          if (!/^[a-z][a-z0-9+.-]*:/i.test(target)) {
            target = `https://${target}`;
          }
          if (!/^https?:\/\//i.test(target)) {
            return { ok: false as const, reason: 'bad_scheme' };
          }
          const networkDecision = await defaultBrowserNetworkPolicy.check(target);
          if (!networkDecision.allowed) {
            ctx.logger.warn(
              {
                target,
                reason: networkDecision.reason,
                userId: ctx.userId,
              },
              'tasks.browserNav: target blocked by browser network policy',
            );
            return { ok: false as const, reason: 'blocked_target' };
          }
          await page.goto(target, navOpts);
        } else {
          await page.reload(navOpts);
        }
        return { ok: true as const };
      } catch (err) {
        ctx.logger.warn(
          { err: err instanceof Error ? err.message : String(err), direction: input.direction },
          'tasks.browserNav: nav failed (non-fatal)',
        );
        return { ok: false as const, reason: 'nav_failed' };
      }
    }),

  /**
   * Remove one of the caller's tasks. Cascades to task_steps / task_events
   * via the schema's onDelete. Scoped hard — the WHERE clause requires
   * both the externalId AND caller's userId so a user cannot delete
   * another user's row by guessing its id.
   *
   * In-flight tasks are rejected with PRECONDITION_FAILED rather than
   * silently deleted: the vision loop would continue writing rows for
   * a task that no longer exists, producing an orphaned-step log spam.
   * The UI disables the delete action on non-terminal tasks too, but we
   * defend in depth.
   */
  delete: protectedProcedure
    .input(z.object({ taskId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const [userRow] = await ctx.db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.externalId, ctx.userId))
        .limit(1);
      if (!userRow) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'unknown user' });
      }
      const [taskRow] = await ctx.db
        .select({ id: tasksTable.id, status: tasksTable.status })
        .from(tasksTable)
        .where(
          and(
            eq(tasksTable.externalId, input.taskId),
            eq(tasksTable.userId, userRow.id),
            eq(tasksTable.origin, 'user'),
          ),
        )
        .limit(1);
      if (!taskRow) {
        throw new TRPCError({ code: 'NOT_FOUND', message: `task ${input.taskId} not found` });
      }
      if (
        taskRow.status === 'executing' ||
        taskRow.status === 'planning' ||
        taskRow.status === 'awaiting_user' ||
        taskRow.status === 'pending'
      ) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: `cannot delete task in status=${taskRow.status}; pause or cancel first`,
        });
      }
      // Phase 1 #3 Pack B — route this task's evidence artifacts by
      // purpose/retention BEFORE deleting the task row (while task_id is
      // still set): task_evidence -> delete row + R2; audit/manual_hold
      // -> scrub + retain (design 4.9). No-op when no artifacts.
      try {
        await routeTaskEvidenceOnDelete(ctx.db, taskRow.id, { logger: ctx.logger });
      } catch (err) {
        ctx.logger.warn(
          { err, taskId: input.taskId },
          'tasks.delete: evidence routing failed (non-blocking)',
        );
      }
      // task_steps has onDelete:cascade via FK; task_events has no FK
      // (append-only audit log) so we clean it up manually in one tx
      // to keep the orphan event rows from piling up.
      await ctx.db.transaction(async (tx) => {
        await tx.delete(taskEvents).where(eq(taskEvents.taskId, taskRow.id));
        await tx.delete(tasksTable).where(eq(tasksTable.id, taskRow.id));
      });
      return { ok: true as const, taskId: input.taskId };
    }),

  /**
   * Clear every failed or review-needed task owned by the caller, not
   * just the first page currently loaded by the SPA. This powers the
   * sidebar/user-menu "清除未成功任务" action whose badge is already
   * server-side via `unsuccessfulCount`.
   */
  clearUnsuccessful: clearUnsuccessfulProcedure,
  /** Compatibility alias for older SPA bundles / clients. */
  clearFailed: clearUnsuccessfulProcedure,

  /**
   * Rename a task (sets the display `title` column). Pass an empty
   * string to clear the override — the UI will then fall back to the
   * auto-summary of `intent`. 255-char cap mirrors the column.
   */
  rename: protectedProcedure
    .input(
      z.object({
        taskId: z.string().min(1),
        title: z.string().max(255),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [userRow] = await ctx.db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.externalId, ctx.userId))
        .limit(1);
      if (!userRow) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'unknown user' });
      }
      // Verify ownership before the UPDATE so we return a proper
      // NOT_FOUND (vs. silently succeeding on 0 affected rows) and
      // don't leak unrelated task existence via error messages.
      const [taskRow] = await ctx.db
        .select({ id: tasksTable.id })
        .from(tasksTable)
        .where(
          and(
            eq(tasksTable.externalId, input.taskId),
            eq(tasksTable.userId, userRow.id),
            eq(tasksTable.origin, 'user'),
          ),
        )
        .limit(1);
      if (!taskRow) {
        throw new TRPCError({ code: 'NOT_FOUND', message: `task ${input.taskId} not found` });
      }
      const trimmed = input.title.trim();
      const nextTitle = trimmed.length === 0 ? null : trimmed;
      await ctx.db
        .update(tasksTable)
        .set({ title: nextTitle })
        .where(eq(tasksTable.id, taskRow.id));
      return { ok: true as const, taskId: input.taskId, title: nextTitle };
    }),

  /**
   * P1.1 self-heal metrics — aggregate over the caller's task_steps
   * rows. `healStats` powers the W3 dogfood decision "is self-heal
   * worth keeping / tuning / expanding to 2 retries?" by measuring:
   *   - attempts: how often a step triggered a heal call
   *   - successes: of those, how many were followed by an ok retry
   *   - successRate: successes / attempts
   *   - avgElapsedMs: average wall-clock per heal call
   *   - totalInputTokens / totalOutputTokens: Anthropic token spend
   *
   * Scoped strictly to the caller so one account's rates don't
   * average-out into another's. Empty result (no heals ever) returns
   * zeros — not an error.
   */
  healStats: protectedProcedure
    .input(
      z
        .object({
          /** ISO timestamp; inclusive lower bound on step created_at. */
          since: z.string().datetime().optional(),
        })
        .default({}),
    )
    .query(async ({ ctx, input }) => {
      const [userRow] = await ctx.db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.externalId, ctx.userId))
        .limit(1);
      if (!userRow) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'unknown user' });
      }

      const sinceCond = input.since
        ? sqlFilter`AND ts.created_at >= ${new Date(input.since)}`
        : sqlEmpty;

      // A single aggregation against task_steps JOIN tasks; cheaper
      // than pulling all rows and folding in JS, and the query is
      // simple enough to SQL-native.
      const result = (await ctx.db.execute(sqlFilter`
        SELECT
          COALESCE(SUM(CASE WHEN ts.heal_attempts > 0 THEN 1 ELSE 0 END), 0)  AS attempts,
          COALESCE(SUM(CASE WHEN ts.heal_succeeded > 0 THEN 1 ELSE 0 END), 0) AS successes,
          COALESCE(AVG(NULLIF(ts.heal_elapsed_ms, 0)), 0)                    AS avgElapsedMs,
          COALESCE(SUM(COALESCE(ts.heal_input_tokens, 0)), 0)                AS totalInputTokens,
          COALESCE(SUM(COALESCE(ts.heal_output_tokens, 0)), 0)               AS totalOutputTokens
        FROM task_steps ts
        JOIN tasks t ON ts.task_id = t.id
        WHERE t.user_id = ${userRow.id}
        ${sinceCond}
      `)) as unknown as [Array<Record<string, unknown>>] | Array<Record<string, unknown>>;

      // mysql2 returns `[rows, fields]`; drizzle's mysql2 wrapper
      // sometimes unwraps to `rows`. Handle both.
      const rows: Array<Record<string, unknown>> = Array.isArray(result[0])
        ? (result[0] as Array<Record<string, unknown>>)
        : (result as unknown as Array<Record<string, unknown>>);
      const row = rows[0] ?? {};
      const attempts = toNumber(row.attempts);
      const successes = toNumber(row.successes);
      const avgElapsedMs = toNumber(row.avgElapsedMs);
      const totalInputTokens = toNumber(row.totalInputTokens);
      const totalOutputTokens = toNumber(row.totalOutputTokens);
      return {
        attempts,
        successes,
        successRate: attempts > 0 ? successes / attempts : 0,
        avgElapsedMs,
        totalInputTokens,
        totalOutputTokens,
      };
    }),

  /**
   * Phase 16 — toggle the task's starred ("收藏") flag. Sets
   * starredAt to now() when starring; clears it when unstarring so
   * the sidebar can sort the 收藏 group by most-recently-pinned.
   * Idempotent: starring an already-starred task no-ops gracefully.
   */
  star: protectedProcedure
    .input(z.object({ taskId: z.string().min(1), starred: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const [userRow] = await ctx.db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.externalId, ctx.userId))
        .limit(1);
      if (!userRow) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'unknown user' });
      }
      const [taskRow] = await ctx.db
        .select({ id: tasksTable.id })
        .from(tasksTable)
        .where(
          and(
            eq(tasksTable.externalId, input.taskId),
            eq(tasksTable.userId, userRow.id),
            eq(tasksTable.origin, 'user'),
          ),
        )
        .limit(1);
      if (!taskRow) {
        throw new TRPCError({ code: 'NOT_FOUND', message: `task ${input.taskId} not found` });
      }
      await ctx.db
        .update(tasksTable)
        .set({
          starred: input.starred,
          starredAt: input.starred ? new Date() : null,
        })
        .where(eq(tasksTable.id, taskRow.id));
      return { ok: true as const, taskId: input.taskId, starred: input.starred };
    }),

  /**
   * Phase 16 — assign / unassign a task to a project. Pass
   * projectId = null to remove the task from its current project
   * (returns it to the default 所有任务 list).
   */
  moveToProject: protectedProcedure
    .input(
      z.object({
        taskId: z.string().min(1),
        projectId: z.string().min(1).nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [userRow] = await ctx.db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.externalId, ctx.userId))
        .limit(1);
      if (!userRow) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'unknown user' });
      }
      const [taskRow] = await ctx.db
        .select({ id: tasksTable.id })
        .from(tasksTable)
        .where(
          and(
            eq(tasksTable.externalId, input.taskId),
            eq(tasksTable.userId, userRow.id),
            eq(tasksTable.origin, 'user'),
          ),
        )
        .limit(1);
      if (!taskRow) {
        throw new TRPCError({ code: 'NOT_FOUND', message: `task ${input.taskId} not found` });
      }
      let projectInternalId: number | null = null;
      if (input.projectId) {
        const [projRow] = await ctx.db
          .select({ id: projects.id })
          .from(projects)
          .where(and(eq(projects.externalId, input.projectId), eq(projects.userId, userRow.id)))
          .limit(1);
        if (!projRow) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: `project ${input.projectId} not found`,
          });
        }
        projectInternalId = projRow.id;
      }
      await ctx.db
        .update(tasksTable)
        .set({ projectId: projectInternalId })
        .where(eq(tasksTable.id, taskRow.id));
      return {
        ok: true as const,
        taskId: input.taskId,
        projectId: input.projectId,
      };
    }),

  /**
   * Phase 25 Mode B v0.1 — smoke endpoint for the extension execution
   * path. Bypasses the agent loop entirely: just sends one
   * `server.extension.tool_call` (kind='navigate') to the user's
   * connected extension, awaits the result, and returns it.
   *
   * Purpose: prove the protocol roundtrip end-to-end (orchestrator →
   * extension → user's Chrome → page load with their cookies → result
   * back to orchestrator). Full agent-loop integration (where every
   * navigate/click/type call in the vision-loop is routed through this
   * path) is v0.2.
   *
   * Returns:
   *   { ok: true, finalUrl, title, bodyText }                   // success
   *   { ok: false, error: { message, code } }                   // any failure
   *
   * Failure codes (carried verbatim from sendExtensionToolCall):
   *   no_extension    — user has no extension WS connection
   *   timeout         — extension didn't reply within timeoutMs
   *   socket_closed   — extension disconnected mid-flight
   *   bad_args        — extension rejected the args (e.g. missing url)
   *   exec_error      — chrome.tabs / scripting error inside the SW
   */
  modeBPing: protectedProcedure
    .input(
      z.object({
        url: z.string().url().max(2048).refine(isSafeUrl, { message: 'expected http(s) URL' }),
        waitMs: z.number().int().nonnegative().max(10_000).optional(),
        timeoutMs: z.number().int().positive().max(60_000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.userId;
      if (!hasConnectedExtension(userId)) {
        return {
          ok: false as const,
          error: { message: extensionNoClientMessage(), code: 'no_extension' },
        };
      }
      const outcome = await sendExtensionToolCall(userId, {
        // taskId reused as a logical correlation id — we don't actually
        // persist a tasks row for this smoke endpoint. The extension
        // doesn't care about the value, only that requestId is unique.
        taskId: `mode-b-ping-${Date.now().toString(36)}`,
        kind: 'navigate',
        args: {
          url: input.url,
          ...(input.waitMs !== undefined ? { waitMs: input.waitMs } : {}),
        },
        ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
      });
      return normalizeModeBPingOutcome(outcome);
    }),

  /**
   * BOSS bug fix — total unsuccessful-task count for the caller (across
   * all time, not just the loaded slice). The "清除未成功任务 (N)" badge
   * was driven by tasks.filter(failed).length which only counts what
   * the SPA store has loaded. After a server-side cleanup (admin SQL,
   * batch delete) the badge would lag the truth. SPA bootstrap +
   * post-clear both refetch this.
   */
  unsuccessfulCount: unsuccessfulCountProcedure,
  /** Compatibility alias for older SPA bundles / clients. */
  failedCount: unsuccessfulCountProcedure,
});

import { sql as sqlFilter } from 'drizzle-orm';
const sqlEmpty = sqlFilter``;

/**
 * Truncate helper shared between supercar broadcast hooks — keeps WS
 * frames and step summaries bounded so a rogue thinking block can't
 * wedge a socket write.
 */
function truncateString(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

/**
 * Strip `[STEP N done]` / `[STEP N running]` / `[STEP N pending]` plan-
 * tracker markers from a free-text action summary. The supercar
 * agent leaks these into its `textPreamble` mid-thought; the SPA's
 * step-card view shows them verbatim, which looks like internal
 * debug output to a user. Removing them at the broadcast/insert
 * boundary keeps the tracker available to the model (it sees the
 * raw output) while sparing the user the noise.
 *
 * Conservative regex: only matches `[STEP <digit(s)> <words>]` —
 * won't eat user-typed bracket content.
 */
function stripPlanTrackerMarkers(s: string): string {
  // Also strip stop-reason / awaiting-user machine markers so they never
  // reach the step label / "最近操作" overlay (P2-A). The final summary
  // is sanitised separately via sanitizeFinalText; step labels are not.
  return stripStopReasonMarkers(s.replace(/\[STEP\s+\d+[^\]]*\]/g, ''))
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * R7 — strip the heavy `finalScreenshot` base64 from a result JSON
 * blob. Used by tasks.list so the sidebar doesn't ship 8MB+ of
 * screenshots no UI surface uses. tasks.detail keeps the field —
 * that's where the BrowserPanel reads it from.
 */
function stripFinalScreenshot(result: unknown): unknown {
  if (!result || typeof result !== 'object') return result;
  if (Array.isArray(result)) return result;
  const r = result as Record<string, unknown>;
  if (!('finalScreenshot' in r)) return r;
  const { finalScreenshot: _omitted, ...rest } = r;
  void _omitted;
  return rest;
}

function readResultSummary(result: unknown): string | null {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    return null;
  }
  const summary = (result as Record<string, unknown>).summary;
  return typeof summary === 'string' && summary.trim() ? summary : null;
}

/**
 * Per-user BrowserPool eligibility. Phase 14 audit follow-up:
 * the canary allow-list (MULTI_USER_USERS env) was retired so every
 * authenticated user gets a pool slot. Reasoning:
 *
 *   - The legacy fallback (vision-loop SW transport) needs a Chrome
 *     extension that web users don't have, so anyone NOT on the
 *     allow-list silently lands in a path that times out at tick 0
 *     and fails their first task. That defeats the China-edge entry
 *     point's product premise.
 *   - Capacity is now enforced by MAX_BROWSER_INSTANCES + the per-plan
 *     concurrency limit + the GC's 30s idle timeout, NOT by user
 *     identity. Pool-full is a per-task signal, not a per-user signal.
 *
 * The function is kept (rather than inlined to `true`) so callers
 * stay readable AND so future "blacklist abusive userIds" logic has
 * an obvious place to land. `_userId` is unused today.
 *
 * Callers still must gate on `ctx.browserPool != null` because the
 * pool is only constructed when MULTI_USER=true at boot.
 */
function shouldUseBrowserPool(_userId: string): boolean {
  return true;
}

type ReplyBroadcastAwaitingKind =
  | 'clarification'
  | 'login'
  | 'captcha'
  | 'permission'
  | 'browser_action'
  | 'video_quote';

export function normalizeReplyAwaitingKindForBroadcast(
  raw: string | null | undefined,
): ReplyBroadcastAwaitingKind {
  const validKinds = [
    'clarification',
    'login',
    'captcha',
    'permission',
    'browser_action',
    'video_quote',
  ] as const satisfies readonly ReplyBroadcastAwaitingKind[];
  return validKinds.includes(raw as ReplyBroadcastAwaitingKind)
    ? (raw as ReplyBroadcastAwaitingKind)
    : 'clarification';
}

/**
 * F1 — classify a `tasks.reply` body so the handler picks the right
 * resume path:
 *   manual_data     — user pasted metrics, table-shaped data, or said
 *                     "数据如下" / "我直接给你数据". Supercar should
 *                     hand off to generate; trying to keep driving the
 *                     browser is wasted work and often loops on a
 *                     login page the user has explicitly opted out of.
 *   login_completed — user finished a manual login / captcha so
 *                     supercar should keep driving the browser. Today
 *                     this returns the same code path as `default`,
 *                     but the explicit bucket lets us tune the prompt
 *                     or telemetry separately later.
 *   default         — anything else; let supercar continue.
 *
 * Conservative: false-positives abort a working browser session, so
 * we only flag manual_data when the message has structural signals
 * (≥ 3 numerical figures, OR `key: value` lines, OR an explicit
 * "数据如下" / "I'll provide data" phrase). Casual replies stay default.
 */
export function classifyReplyIntent(
  message: string,
): 'manual_data' | 'login_completed' | 'still_awaiting' | 'default' {
  const trimmed = message.trim();
  if (!trimmed) return 'default';
  const lower = trimmed.toLowerCase();

  // Fix 2 — still-awaiting tells. User is mid-login / mid-captcha and
  // typing "等一下 / 稍等 / wait" to ask the system to keep waiting.
  // Match BEFORE login_completed because "还没登录" has both signals
  // and "still" should win (not "logged in"). Capped at 50 chars to
  // dodge long substantive replies that happen to contain "稍等".
  if (trimmed.length <= 50) {
    const STILL_AWAITING_PHRASES: readonly RegExp[] = [
      /还没(?:登录|登陆|好|完|完成|搞定|弄好|操作完|输入完)/u,
      /还在(?:登录|登陆|操作|输入|扫码|忙)/u,
      /我还在/u,
      /等一?下|稍等|等等|再等(?:等|会儿|一下)?|马上(?:好|完成|就好)/u,
      /没好|继续等(?:待|一下|等)?/u,
      /(?:别|不要|先别)(?:动|继续|执行)/u,
      /\bnot\s+yet\b|\bwait(?:ing)?\b|\bhold\s+on\b|\bone\s+sec(?:ond)?\b/i,
      /\bgive\s+me\s+a\s+(?:sec|moment|minute)\b/i,
      /\b(?:still|just)\s+(?:working|loading|signing|logging)\b/i,
    ];
    if (STILL_AWAITING_PHRASES.some((re) => re.test(trimmed))) {
      return 'still_awaiting';
    }
  }

  // Strong manual-data tells. The phrase patterns are a high-precision
  // signal — users typing "数据如下" or "I'll give you the numbers"
  // almost never mean "keep driving the browser".
  const MANUAL_DATA_PHRASES: readonly RegExp[] = [
    /数据如下|以下是数据|这些(?:是|就是)数据|我(?:直接|手动)?(?:给|提供|发)(?:你)?数据/u,
    /用我(?:上传|提供|发)的(?:数据|表格|文件|附件)/u,
    /(?:不(?:用|要)|跳过|别)(?:登录|登陆)|(?:不要|别)(?:打开|访问)(?:网站|页面|后台)/u,
    /\bhere(?:'s|\s+is)\s+the\s+(?:data|numbers|metrics)/i,
    /\bi(?:'ll)?\s+(?:provide|give|paste)\s+(?:the\s+)?(?:data|numbers)/i,
  ];
  if (MANUAL_DATA_PHRASES.some((re) => re.test(trimmed))) return 'manual_data';

  // Login-completed tells. Conservative — the message has to be short
  // and unambiguously about login state, not a long answer that
  // happens to mention "登录".
  if (trimmed.length <= 30) {
    const LOGIN_DONE_PHRASES: readonly RegExp[] = [
      /(?:扫(?:码)?(?:好|完|完了|完成))|登(?:录|陆)(?:好|完|成功|完成|进去|进了)/u,
      /(?:已|我已经?)(?:登录|登陆)/u,
      /\b(?:logged\s+in|signed\s+in|login\s+(?:done|complete))\b/i,
    ];
    if (LOGIN_DONE_PHRASES.some((re) => re.test(lower))) {
      return 'login_completed';
    }
  }

  // Structural manual-data signal: ≥ 3 distinct numeric figures (with
  // unit / separator hints to dodge the "1, 2, 3 step list" false-fire),
  // OR multiple `key: value` lines.
  const NUMERIC_WITH_HINT =
    /(?:¥|\$|€|£|RMB|usd)\s*[\d,]+(?:\.\d+)?|[\d,]+(?:\.\d+)?\s*(?:%|元|万|亿|人民币)|[\d,]+(?:\.\d+)?(?=\s*(?:GMV|UV|ROI|GPM|UV价值|订单|转化|消耗|分|%))/giu;
  const numericHits = trimmed.match(NUMERIC_WITH_HINT);
  if (numericHits && numericHits.length >= 3) return 'manual_data';

  const KV_LINE = /^[一-龥A-Za-z0-9 \t（）()\-_/]+\s*[：:][^\n]+$/u;
  const kvLines = trimmed.split('\n').filter((l) => KV_LINE.test(l.trim())).length;
  if (kvLines >= 2) return 'manual_data';

  return 'default';
}

/**
 * Persist a supercar run's terminal state via the same
 * `persistVisionOutcome` the legacy vision-loop uses. Maps the
 * supercar-specific statuses back to the tasks.status enum.
 */
async function persistSupercarOutcome(
  repo: TaskRepository,
  taskId: string,
  outcome: SupercarOutcome,
  finalState: CapturedFinalState = {},
  metadata?: Record<string, unknown>,
  /**
   * Codex Pack A3 — verifier-derived overrides. When `verdict` is
   * 'partial_success', a completed outcome persists with that status
   * (summary preserved). When `verdict` is 'failed', a completed
   * outcome is downgraded with `verificationReason` as the reason.
   * Anything else falls through to the original outcome.status path.
   */
  verdict?: FinalTerminalStatus,
  verificationReason?: string | null,
  failedChecks?: Array<{ type: string; detail: string }>,
): Promise<{ persisted: boolean }> {
  // Codex P3 follow-up — forward persistVisionOutcome's `{persisted}`
  // so the caller can short-circuit terminal broadcasts / memory /
  // suggestions when the state-machine guard refused the write (row
  // still in awaiting_user). See task-repository.ts atomic guard for
  // the rationale.
  if (!shouldPersistSupercarTerminalOutcome(outcome.status)) {
    // Awaiting-user is a parked non-terminal state. Persist it through
    // the explicit waiting-user path, never through terminal helpers
    // that would collapse it into paused/failed/cancelled-style semantics.
    console.warn(`[supercar] refusing terminal persist for awaiting_user outcome ${taskId}`);
    return { persisted: false };
  }
  try {
    const finalFields = finalStatePersistFields(finalState);
    // Codex Pack A3 — verifier verdict overrides on a completed run.
    if (outcome.status === 'completed' && verdict === 'partial_success') {
      return await repo.persistVisionOutcome(taskId, {
        status: 'partial_success',
        summary: outcome.summary ?? '',
        tickCount: outcome.iterations,
        ...finalFields,
        ...(metadata ? { metadata } : {}),
        ...(failedChecks && failedChecks.length > 0 ? { failedChecks } : {}),
      });
    }
    if (outcome.status === 'completed' && verdict === 'failed') {
      return await repo.persistVisionOutcome(taskId, {
        status: 'failed',
        reason: verificationReason ?? '质量校验未通过',
        tickCount: outcome.iterations,
        ...finalFields,
        ...(metadata ? { metadata } : {}),
        ...(failedChecks && failedChecks.length > 0 ? { failedChecks } : {}),
      });
    }
    if (outcome.status === 'completed') {
      return await repo.persistVisionOutcome(taskId, {
        status: 'completed',
        summary: outcome.summary ?? '',
        tickCount: outcome.iterations,
        ...finalFields,
        ...(metadata ? { metadata } : {}),
      });
    } else if (outcome.status === 'cancelled') {
      // Phase 1 follow-up — capture terminal frame on cancel too.
      // Users sometimes cancel mid-task and want to see the last
      // visible state.
      return await repo.persistVisionOutcome(taskId, {
        status: 'cancelled',
        tickCount: outcome.iterations,
        ...finalFields,
        ...(metadata ? { metadata } : {}),
      });
    } else if (outcome.status === 'timeout') {
      return await repo.persistVisionOutcome(taskId, {
        status: 'failed',
        reason: friendlyTaskFailureReason(
          outcome.status,
          outcome.reason ?? 'supercar: task timeout',
        ),
        tickCount: outcome.iterations,
        ...finalFields,
        ...(metadata ? { metadata } : {}),
      });
    } else {
      // 'failed'
      return await repo.persistVisionOutcome(taskId, {
        status: 'failed',
        reason: friendlyTaskFailureReason(
          outcome.status,
          outcome.reason ?? 'supercar: task failed',
        ),
        tickCount: outcome.iterations,
        ...finalFields,
        ...(metadata ? { metadata } : {}),
      });
    }
  } catch (err) {
    // Best-effort — persistence failure is logged by the caller's .then().
    // Rethrow so the caller's logger catches it.
    throw err instanceof Error ? err : new Error(String(err));
  }
}

/**
 * P1 — converge `tasks.plan_status` after a successful terminal write
 * for paths whose runner does not emit per-step `[STEP N done]`
 * markers (today: the supercar→generate handoff). Reads the row's
 * current `planStatus`, rolls every pending / running step to `done`
 * (leaves done/failed alone), writes back, and broadcasts the new
 * snapshot so the PlanCard catches up. Best-effort: a DB error is
 * logged, never thrown — the user already saw the terminal frame.
 */
async function convergePlanStatusOnSuccess(
  ctx: { db: import('../../db/client.js').DB; logger: import('pino').Logger },
  taskExternalId: string,
  userExternalId: string,
): Promise<void> {
  try {
    const row = await ctx.db
      .select({ planStatus: tasksTable.planStatus })
      .from(tasksTable)
      .where(eq(tasksTable.externalId, taskExternalId))
      .limit(1)
      .then((r) => r[0] ?? null);
    if (!row) return;
    const raw = row.planStatus;
    if (!Array.isArray(raw) || raw.length === 0) return;
    type PlanRow = {
      idx: number;
      status: 'pending' | 'running' | 'done' | 'failed';
      note?: string;
    };
    const steps = raw as PlanRow[];
    let mutated = false;
    const converged: PlanRow[] = steps.map((s) => {
      if (s.status === 'pending' || s.status === 'running') {
        mutated = true;
        return { ...s, status: 'done' };
      }
      return { ...s };
    });
    if (!mutated) return;
    const result = await ctx.db
      .update(tasksTable)
      .set({ planStatus: converged as unknown })
      .where(and(eq(tasksTable.externalId, taskExternalId), eq(tasksTable.status, 'completed')));
    if (readAffectedRows(result) === 0) {
      ctx.logger.warn(
        { taskId: taskExternalId },
        'plan-step convergence skipped because task was no longer completed',
      );
      return;
    }
    try {
      broadcastToUser(userExternalId, {
        type: 'server.task.plan_step',
        taskId: taskExternalId,
        planStatus: converged,
      });
    } catch (err) {
      ctx.logger.warn({ err, taskId: taskExternalId }, 'plan-step convergence broadcast failed');
    }
  } catch (err) {
    ctx.logger.warn({ err, taskId: taskExternalId }, 'plan-step convergence persist failed');
  }
}

/**
 * R7 — capture the per-task Brave's last visible state right before
 * `pool.release(taskId)` tears it down. The SPA's BrowserPanel uses
 * the result so a refresh-after-completion shows the user "this is
 * what HOLA DAY was looking at when it finished" instead of a blank
 * panel that retries the screencast WS forever.
 *
 * Best-effort: any executor / Playwright failure (already-closed
 * tab, navigation in flight, viewport gone) returns an empty object
 * and the persisted result simply omits the screenshot. The caller
 * doesn't need to differentiate.
 */
function finalStatePersistFields(finalState: CapturedFinalState): CapturedFinalState {
  return {
    ...(finalState.finalScreenshot ? { finalScreenshot: finalState.finalScreenshot } : {}),
    ...(finalState.finalUrl ? { finalUrl: finalState.finalUrl } : {}),
    ...(finalState.finalViewport ? { finalViewport: finalState.finalViewport } : {}),
  };
}

/**
 * Translate a supercar outcome to the status frame the web workbench
 * understands. Terminal outcomes emit `server.task.terminal`; parked
 * clarification emits `server.supercar.awaiting_user`. `timeout`
 * collapses to `failed` over the wire so the schema doesn't need to widen.
 */
function buildTaskTerminalMessage(
  taskId: string,
  outcome: SupercarOutcome,
  /**
   * Codex Pack A3 — verifier-derived overrides for the WS broadcast.
   * When `verdict='partial_success'` and the runner completed, emit
   * a `partial_success` terminal frame (keeps summary). When
   * `verdict='failed'` on a completed runner, downgrade to failed
   * with `verificationReason`.
   */
  verdict?: FinalTerminalStatus,
  verificationReason?: string | null,
  /**
   * Codex Round 2 P1-6 — list of failed structural checks for the
   * SPA's VerificationBanner. Only meaningful when verdict !==
   * 'completed'; callers compute it via `extractFailedChecks` from
   * the verifier verdict and pass it through alongside the reason.
   */
  failedChecks?: Array<{ type: string; detail: string }>,
): import('@holaday/shared-types').ServerMessage {
  const failedChecksField = failedChecks && failedChecks.length > 0 ? { failedChecks } : {};
  if (outcome.status === 'completed' && verdict === 'partial_success') {
    return {
      type: 'server.task.terminal',
      taskId,
      status: 'partial_success',
      ...(outcome.summary ? { summary: outcome.summary } : {}),
      ...failedChecksField,
    };
  }
  if (outcome.status === 'completed' && verdict === 'failed') {
    return {
      type: 'server.task.terminal',
      taskId,
      status: 'failed',
      reason: verificationReason ?? '质量校验未通过',
      ...failedChecksField,
    };
  }
  if (outcome.status === 'completed') {
    return {
      type: 'server.task.terminal',
      taskId,
      status: 'completed',
      ...(outcome.summary ? { summary: outcome.summary } : {}),
    };
  }
  if (outcome.status === 'cancelled') {
    return { type: 'server.task.terminal', taskId, status: 'cancelled' };
  }
  if (outcome.status === 'awaiting_user') {
    return buildSupercarWaitingUserMessage({
      taskId,
      transition: {
        kind: 'waiting_user',
        awaitingKind: 'clarification',
        question: outcome.question ?? '请补充必要信息后继续。',
      },
    });
  }
  // failed / timeout — translate the internal reason into a
  // user-facing Chinese explanation + one actionable suggestion.
  const friendly = friendlyTaskFailureReason(outcome.status, outcome.reason);
  return {
    type: 'server.task.terminal',
    taskId,
    status: 'failed',
    reason: friendly,
  };
}

/**
 * Translate internal supercar reasons to user-facing Chinese text.
 *
 * Goal is to give the user two things every time:
 *   1. What went wrong, in plain Chinese (not "task timeout (600s) elapsed").
 *   2. One actionable suggestion (重试 / 手动登录 / 充值 / 简化任务).
 *
 * We pattern-match on the raw reason string rather than adding a
 * typed enum to SupercarOutcome — the loop emits reasons from many
 * code paths (Anthropic errors, URL resolver, playwright throws)
 * and a regex map is robust to new message shapes without a
 * coordinated schema bump. Unknown reasons fall through to a
 * generic but still friendly template so the user never sees raw
 * English stack trace bullets.
 */
/**
 * Run the supercar loop with one automatic retry on flaky failures.
 *
 * Retryable: the first run returned failed/timeout with iterations
 * < 3 and a reason that looks like AI-service-hiccup or transient
 * browser flake (overloaded, 429, 529, timeout, ECONNRESET, no
 * browser context). A 2nd attempt gets a fresh agent-loop state +
 * re-spawned page, so the odds of recovering are real.
 *
 * Non-retryable: > 2 iterations (agent did some work, probably
 * hit a real wall), login/captcha/credit/api-key failures,
 * cancelled, awaiting_user, completed. Those get returned as-is.
 *
 * We emit a lightweight `server.supercar.retrying` frame on the
 * WS so the UI can surface "正在重试…" without waiting for the
 * second attempt's first tick. Unknown to the client → ignored,
 * which is fine.
 */
async function runSupercarWithRetry(
  args: Parameters<typeof runSupercarTask>[0],
  meta: { userId: string; taskId: string; logger: import('pino').Logger },
): Promise<Awaited<ReturnType<typeof runSupercarTask>>> {
  const first = await runSupercarTask(args);
  if (!shouldAutoRetry(first)) return first;
  meta.logger.info(
    { taskId: meta.taskId, iterations: first.iterations, reason: first.reason },
    'supercar: auto-retrying once after flaky failure',
  );
  try {
    broadcastToUser(meta.userId, {
      type: 'server.task.progress',
      taskId: meta.taskId,
      message: '正在重试…',
    });
  } catch {
    /* broadcast best-effort */
  }
  const second = await runSupercarTask(args);
  meta.logger.info(
    {
      taskId: meta.taskId,
      firstStatus: first.status,
      secondStatus: second.status,
      secondIterations: second.iterations,
    },
    'supercar: retry completed',
  );
  return second;
}

function shouldAutoRetry(outcome: SupercarOutcome): boolean {
  if (outcome.status !== 'failed' && outcome.status !== 'timeout') return false;
  if (outcome.iterations >= 3) return false;
  const r = (outcome.reason ?? '').toLowerCase();
  if (/timeout|elapsed|超时/.test(r)) return true;
  if (/429|rate ?limit|too many requests/.test(r)) return true;
  if (/529|overloaded|overload/.test(r)) return true;
  if (/econn|fetch failed|network/.test(r)) return true;
  if (/no browser context|connectovercdp/.test(r)) return true;
  return false;
}

function toNumber(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  if (typeof v === 'bigint') return Number(v);
  return 0;
}

function normalizeOutput(value: unknown): unknown {
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
  return value;
}

async function loadTaskState(repo: TaskRepository, taskExternalId: string, userExternalId: string) {
  const all = await repo.rehydrateInFlight();
  const hit = all.find(
    (r) => r.state.taskId === taskExternalId && r.userExternalId === userExternalId,
  );
  if (!hit) {
    throw new TRPCError({
      code: 'NOT_FOUND',
      message: `task ${taskExternalId} not in-flight`,
    });
  }
  return hit.state;
}

/**
 * Active skills the user can route to.
 *
 * Phase 0 behaviour: we ALWAYS return every active Skill regardless of
 * the task's occupation. The reason: Skill selection happens inside
 * Opus (given the catalogue + the intent, the commander picks). The
 * orchestrator layer doesn't do keyword/intent matching here — and
 * pre-filtering by occupation was actively harmful (the popup's old
 * hardcoded `occupation: 'finance-research'` meant douyin Skills were
 * never in catalogue, so a "帮我看抖音后台" intent fell through to
 * xueqiu's allowedOrigins and the real douyin URL got ORIGIN_BLOCKED).
 *
 * Cost: catalogue is still small (DB SKILL.md rows + the shared
 * user-visible skill list), a few hundred tokens, Opus handles it.
 * DB-backed SKILL.md rows keep their allowedOrigins; shared fallback
 * rows are descriptive only until a real SKILL.md exists for them.
 *
 * `occupation` is kept on the signature for now as a Phase 1 knob
 * (we may want to *prefer* a Skill matching the user's occupation
 * tag when ranking / prompting Opus), but it no longer filters the
 * SQL query.
 */
async function loadSkillCatalogue(
  db: import('../../db/client.js').DB,
  _occupation: string | null,
): Promise<SkillCatalogueEntry[]> {
  const rows = await db
    .select({
      slug: skills.slug,
      description: skills.description,
      occupationTag: skills.occupationTag,
      manifest: skills.manifest,
    })
    .from(skills)
    .where(eq(skills.status, 'active'));

  return buildPlannerSkillCatalogue(rows);
}

/**
 * Pull `allowedOrigins` out of a `skills.manifest` JSON column. The manifest
 * is the parsed SKILL.md front-matter; we only trust string entries. Returns
 * an empty array when the column is missing, malformed, or the key isn't
 * present — the caller unions across the whole catalogue so one misshaped
 * manifest doesn't widen the allowlist.
 */
function extractAllowedOrigins(manifest: unknown): readonly string[] {
  if (!manifest || typeof manifest !== 'object') return [];
  // MariaDB returns JSON columns as strings on some driver/config combos.
  const parsed =
    typeof manifest === 'string'
      ? (() => {
          try {
            return JSON.parse(manifest);
          } catch {
            return null;
          }
        })()
      : manifest;
  if (!parsed || typeof parsed !== 'object') return [];
  const entries = (parsed as { allowedOrigins?: unknown }).allowedOrigins;
  if (!Array.isArray(entries)) return [];
  return entries.filter((e): e is string => typeof e === 'string' && e.length > 0);
}

/**
 * Pick catalogue entries whose `allowedOrigins` covers ≥ 1 goto URL in
 * the plan — i.e. the Skills the plan will actually visit. A Skill is
 * "used" if any of its allowedOrigins entries matches any goto URL by
 * the same rules the driver will apply at dispatch time.
 *
 * Why bother: the catalogue is the full menu of Skills (all active) so
 * Opus can route, but the origin allowlist the driver enforces should
 * correspond to what the plan is actually doing. A plan that doesn't
 * touch any catalogued Skill is a free-form browse — `allowedOrigins`
 * comes back `[]`, and the driver treats empty as unrestricted.
 *
 * Reuses the driver's own `isOriginAllowed` to avoid rule-matching
 * drift between orchestrator and driver.
 */
function pickSkillsUsedByPlan(
  plan: PlannedStep[],
  catalogue: SkillCatalogueEntry[],
): SkillCatalogueEntry[] {
  const gotoUrls = plan
    .filter((s) => s.kind === 'goto')
    .map((s) => {
      const url = (s.payload as { url?: unknown } | undefined)?.url;
      return typeof url === 'string' ? url : null;
    })
    .filter((u): u is string => u !== null);
  if (gotoUrls.length === 0) return [];
  return catalogue.filter((entry) => {
    const origins = entry.allowedOrigins ?? [];
    if (origins.length === 0) return false;
    return gotoUrls.some((url) => urlMatchesAnyOrigin(url, origins));
  });
}

/**
 * Does `url` satisfy any of the `origins` rules? Mirrors the semantics
 * of `packages/browser-driver/src/origin-guard.ts::isOriginAllowed` —
 * the canonical enforcer lives in the driver; this is a read-only
 * pre-check on the orchestrator side for deciding which Skills to
 * union. Keep the rules identical so a URL that passes here passes
 * there too.
 */
function urlMatchesAnyOrigin(url: string, origins: readonly string[]): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const host = parsed.host.toLowerCase();
  const bareHost = parsed.hostname.toLowerCase();
  for (const rule of origins) {
    const r = rule.toLowerCase();
    if (r.startsWith('*.')) {
      const suffix = r.slice(2);
      if (bareHost === suffix) return true;
      if (bareHost.endsWith(`.${suffix}`)) return true;
    } else if (r === host || r === bareHost) {
      return true;
    }
  }
  return false;
}

/**
 * Union `allowedOrigins` across a list of Skills (typically the subset
 * the plan is using, picked by `pickSkillsUsedByPlan`). Empty result
 * means "no Skill used or none declared an origin allowlist" — the
 * driver treats empty as unrestricted. Deduped; order-preserving.
 */
function unionAllowedOrigins(catalogue: SkillCatalogueEntry[]): readonly string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of catalogue) {
    for (const origin of entry.allowedOrigins ?? []) {
      if (seen.has(origin)) continue;
      seen.add(origin);
      out.push(origin);
    }
  }
  return out;
}

export const __tasksInternals = {
  assertManualSkillSelectionEnabled,
  buildPlannerIntent,
  buildPlannerSkillCatalogue,
  resolveTaskDispatchSkillId,
  resolveTaskSkillContext,
};
