/**
 * Phase 2 第三期 (IP人物 真人换口型) 阶段1 — onboarding 后端.
 *
 * Wires the dangling 0034/0035 columns (users.qwen_voice_id /
 * base_video_file_id / video_self_use_authorized_at) to a real flow so the
 * IP-person lip-sync lane (video-lane.ts, 阶段3) can read them:
 *
 *   - enrollVoice   : 读已上传音频 buffer → base64 → Qwen enrollVoice(免费)
 *                     → 存 qwen_voice_id → **样本即弃**(delete R2 + row).
 *   - setBaseVideo  : 记下用户出镜底版的 fileId(input 文件无 TTL = 长存).
 *   - authorize     : 写「本人授权声明」时间戳(合规闸,video-lane 硬要求).
 *   - status        : { hasVoice, hasBaseVideo, authorized } 供前端向导.
 *   - deleteAssets  : 清声纹(调 Qwen delete-voice 清云端)+ 删底版(R2)+ 清授权.
 *
 * Upload itself stays on the existing two-stage media endpoints
 * (/files/upload-url + confirm); this router takes the resulting fileIds.
 * NO generation here — zero fal/Veo/synthesis spend. tasks.ts is NOT
 * touched (the IP-person generate branch lands in 阶段3).
 */

import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { deleteVoice, enrollVoice } from '../../agent/video/qwen-voice-clone-client.js';
import { env as appEnv } from '../../config/env.js';
import { FileService } from '../../files/file-service.js';
import { users } from '../../db/schema/users.js';
import { protectedProcedure, router } from '../trpc.js';

const MAX_VOICE_SAMPLE_BYTES = 10 * 1024 * 1024; // Qwen enroll 上限 ≈10MB

interface OnboardingUserRow {
  id: number;
  qwenVoiceId: string | null;
  baseVideoFileId: string | null;
  videoSelfUseAuthorizedAt: Date | null;
}

async function requireOnboardingUser(ctx: {
  db: typeof import('../../db/client.js').db;
  userId: string;
}): Promise<OnboardingUserRow> {
  const [row] = await ctx.db
    .select({
      id: users.id,
      qwenVoiceId: users.qwenVoiceId,
      baseVideoFileId: users.baseVideoFileId,
      videoSelfUseAuthorizedAt: users.videoSelfUseAuthorizedAt,
    })
    .from(users)
    .where(eq(users.externalId, ctx.userId))
    .limit(1);
  if (!row) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'unknown user' });
  return row;
}

/**
 * Map an uploaded audio mimetype → the enroll mime Qwen accepts
 * (audio/wav | audio/mpeg | audio/mp4). Returns null for unsupported
 * types (aac/ogg/video) so the caller can 415 with a clear message.
 * Exported for unit testing.
 */
export function enrollMimeFor(uploadedMime: string): string | null {
  const m = uploadedMime.toLowerCase();
  if (m === 'audio/wav' || m === 'audio/x-wav' || m === 'audio/wave') return 'audio/wav';
  if (m === 'audio/mpeg' || m === 'audio/mp3') return 'audio/mpeg';
  if (m === 'audio/mp4' || m === 'audio/x-m4a' || m === 'audio/m4a') return 'audio/mp4';
  return null; // aac/ogg/video/etc — Qwen clone wants WAV/MP3/M4A
}

export const videoOnboardingRouter = router({
  /** 前端向导进度判断:三个资产各自就绪与否(不返回敏感值)。 */
  status: protectedProcedure.query(async ({ ctx }) => {
    const u = await requireOnboardingUser(ctx);
    return {
      hasVoice: !!u.qwenVoiceId,
      hasBaseVideo: !!u.baseVideoFileId,
      authorized: !!u.videoSelfUseAuthorizedAt,
      authorizedAt: u.videoSelfUseAuthorizedAt,
    };
  }),

  /** 写「本人授权声明」时间戳。幂等:已授权再点返回 alreadyAuthorized。 */
  authorize: protectedProcedure.mutation(async ({ ctx }) => {
    const u = await requireOnboardingUser(ctx);
    if (u.videoSelfUseAuthorizedAt) {
      return { ok: true as const, alreadyAuthorized: true, authorizedAt: u.videoSelfUseAuthorizedAt };
    }
    const now = new Date();
    await ctx.db.update(users).set({ videoSelfUseAuthorizedAt: now }).where(eq(users.id, u.id));
    return { ok: true as const, alreadyAuthorized: false, authorizedAt: now };
  }),

  /**
   * 读已上传的语音样本 → base64 → Qwen enrollVoice(免费)→ 存 voice_id →
   * **立刻删样本**(R2 + row)。enroll 失败:不写 voice_id、不删样本(可重试)。
   */
  enrollVoice: protectedProcedure
    .input(z.object({ audioFileId: z.string().min(1).max(64) }))
    .mutation(async ({ ctx, input }) => {
      if (!appEnv.DASHSCOPE_API_KEY) {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: '语音克隆未配置（DASHSCOPE_API_KEY）' });
      }
      const u = await requireOnboardingUser(ctx);
      const fileService = new FileService(ctx.db, ctx.logger);
      const loaded = await fileService.loadForUser(input.audioFileId, ctx.userId);
      if (!loaded) throw new TRPCError({ code: 'NOT_FOUND', message: '找不到上传的语音样本' });
      if (loaded.buffer.byteLength > MAX_VOICE_SAMPLE_BYTES) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: '语音样本过大（上限 10MB）' });
      }
      const enrollMime = enrollMimeFor(loaded.row.mimetype);
      if (!enrollMime) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: '语音样本格式需为 WAV / MP3 / M4A' });
      }
      let voiceId: string;
      try {
        const res = await enrollVoice({
          apiKey: appEnv.DASHSCOPE_API_KEY,
          baseUrl: appEnv.DASHSCOPE_BASE_URL,
          ...(appEnv.DASHSCOPE_WORKSPACE_ID ? { workspaceId: appEnv.DASHSCOPE_WORKSPACE_ID } : {}),
          audioBase64: loaded.buffer.toString('base64'),
          audioMime: enrollMime,
          targetModel: appEnv.QWEN_TTS_VC_MODEL,
        });
        voiceId = res.voiceId;
      } catch (err) {
        ctx.logger.error({ err, userId: ctx.userId }, 'video onboarding: enrollVoice failed');
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: '声音克隆失败，请换一段更清晰的录音重试' });
      }
      // 成功 → 存 voice_id;若已有旧 voice,先清云端旧声纹(避免泄漏积累)。
      if (u.qwenVoiceId && u.qwenVoiceId !== voiceId) {
        await deleteVoice({
          apiKey: appEnv.DASHSCOPE_API_KEY,
          baseUrl: appEnv.DASHSCOPE_BASE_URL,
          ...(appEnv.DASHSCOPE_WORKSPACE_ID ? { workspaceId: appEnv.DASHSCOPE_WORKSPACE_ID } : {}),
          voiceId: u.qwenVoiceId,
        }).catch((err) => ctx.logger.warn({ err, userId: ctx.userId }, 'video onboarding: old voice delete failed (non-fatal)'));
      }
      await ctx.db.update(users).set({ qwenVoiceId: voiceId }).where(eq(users.id, u.id));
      // 样本即弃 — voice_id 已是耐久产物,原始声纹样本不再保留。
      await fileService
        .deleteForUser(input.audioFileId, u.id)
        .catch((err) => ctx.logger.warn({ err, userId: ctx.userId }, 'video onboarding: sample cleanup failed (non-fatal)'));
      return { ok: true as const, hasVoice: true };
    }),

  /**
   * 记下用户出镜底版的 fileId（input 文件无 TTL = 长存,不进 24h 任务产物回收）。
   * 校验该文件归属当前用户且为视频类型。换底版:覆盖旧 fileId,删旧 R2 对象。
   */
  setBaseVideo: protectedProcedure
    .input(z.object({ videoFileId: z.string().min(1).max(64) }))
    .mutation(async ({ ctx, input }) => {
      const u = await requireOnboardingUser(ctx);
      const fileService = new FileService(ctx.db, ctx.logger);
      const loaded = await fileService.loadForUser(input.videoFileId, ctx.userId);
      if (!loaded) throw new TRPCError({ code: 'NOT_FOUND', message: '找不到上传的出镜视频' });
      if (!loaded.row.mimetype.startsWith('video/')) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: '出镜底版需为视频文件（MP4 / MOV）' });
      }
      const oldId = u.baseVideoFileId;
      await ctx.db.update(users).set({ baseVideoFileId: input.videoFileId }).where(eq(users.id, u.id));
      if (oldId && oldId !== input.videoFileId) {
        await fileService
          .deleteForUser(oldId, u.id)
          .catch((err) => ctx.logger.warn({ err, userId: ctx.userId }, 'video onboarding: old base video cleanup failed (non-fatal)'));
      }
      return { ok: true as const, hasBaseVideo: true };
    }),

  /**
   * 隐私:清空全部 IP 素材 —— 清云端声纹(Qwen delete-voice)+ 删底版(R2)+
   * 清 voice_id/base_video_file_id/授权时间。每步 best-effort,本地列必清。
   */
  deleteAssets: protectedProcedure.mutation(async ({ ctx }) => {
    const u = await requireOnboardingUser(ctx);
    const fileService = new FileService(ctx.db, ctx.logger);
    if (u.qwenVoiceId && appEnv.DASHSCOPE_API_KEY) {
      await deleteVoice({
        apiKey: appEnv.DASHSCOPE_API_KEY,
        baseUrl: appEnv.DASHSCOPE_BASE_URL,
        ...(appEnv.DASHSCOPE_WORKSPACE_ID ? { workspaceId: appEnv.DASHSCOPE_WORKSPACE_ID } : {}),
        voiceId: u.qwenVoiceId,
      }).catch((err) => ctx.logger.warn({ err, userId: ctx.userId }, 'video onboarding: cloud voice delete failed (non-fatal)'));
    }
    if (u.baseVideoFileId) {
      await fileService
        .deleteForUser(u.baseVideoFileId, u.id)
        .catch((err) => ctx.logger.warn({ err, userId: ctx.userId }, 'video onboarding: base video delete failed (non-fatal)'));
    }
    await ctx.db
      .update(users)
      .set({ qwenVoiceId: null, baseVideoFileId: null, videoSelfUseAuthorizedAt: null })
      .where(eq(users.id, u.id));
    return { ok: true as const };
  }),
});
