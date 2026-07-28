/**
 * Pure metadata helpers for the video confirm/generation path.
 *   - deriveVideoType: stamp the 成片 task with its type (enables per-tab
 *     history isolation + hiding 图片版 for IP, both batch-2 frontend).
 *   - mapVideoFailureReason: turn a lane error into a SAFE user-facing
 *     Chinese reason — reads err name/kind/status/detail ONLY to route,
 *     never echoes internal message / detail / stack / file ids.
 */

export type VideoType = 'normal' | 'pet' | 'ip_person';

export const VIDEO_QUALITY_GATE_VERSION = 'video-final-v3';

export interface VideoQualityVerificationCoverage {
  playableVideo: 'verified';
  sampledFrames: 'verified';
  audibleAudio: 'verified' | 'not_verified';
  audiovisualSync: 'not_verified' | 'not_applicable';
  lipSyncProcessing: 'completed' | 'not_applicable';
}

export type VideoAudioVerificationCoverage =
  | {
      audibleAudio: 'verified';
      audiovisualSync: 'not_verified';
      lipSyncProcessing: 'completed';
    }
  | {
      audibleAudio: 'not_verified';
      audiovisualSync: 'not_applicable';
      lipSyncProcessing: 'not_applicable';
    };

export function videoAudioVerificationCoverage(input?: {
  audibleAudioVerified?: boolean;
  lipSyncProcessingCompleted?: boolean;
}): VideoAudioVerificationCoverage {
  if (input?.audibleAudioVerified && input.lipSyncProcessingCompleted) {
    return {
      audibleAudio: 'verified',
      audiovisualSync: 'not_verified',
      lipSyncProcessing: 'completed',
    };
  }
  return {
    audibleAudio: 'not_verified',
    audiovisualSync: 'not_applicable',
    lipSyncProcessing: 'not_applicable',
  };
}

export function videoQualityVerificationMetadata(
  verifiedAt = new Date(),
  audioCoverage: VideoAudioVerificationCoverage = videoAudioVerificationCoverage(),
): {
  qualityVerification: {
    status: 'passed';
    gateVersion: typeof VIDEO_QUALITY_GATE_VERSION;
    verifiedAt: string;
    coverage: VideoQualityVerificationCoverage;
  };
} {
  return {
    qualityVerification: {
      status: 'passed',
      gateVersion: VIDEO_QUALITY_GATE_VERSION,
      verifiedAt: verifiedAt.toISOString(),
      coverage: {
        playableVideo: 'verified',
        sampledFrames: 'verified',
        ...audioCoverage,
      },
    },
  };
}

type QualityErrorRecord = {
  name?: unknown;
  kind?: unknown;
  failedChecks?: unknown;
};

const SAFE_QUALITY_CHECK_RE = /^[a-z][a-z0-9_]{0,63}$/;
const MAX_QUALITY_CHECKS = 12;

function qualityErrorRecord(err: unknown): QualityErrorRecord | null {
  return err && typeof err === 'object' ? (err as QualityErrorRecord) : null;
}

function safeQualityChecks(err: unknown): string[] {
  const checks = qualityErrorRecord(err)?.failedChecks;
  if (!Array.isArray(checks)) return [];
  return [
    ...new Set(
      checks.filter(
        (check): check is string =>
          typeof check === 'string' && SAFE_QUALITY_CHECK_RE.test(check),
      ),
    ),
  ].slice(0, MAX_QUALITY_CHECKS);
}

function qualityCheckDetail(check: string): string {
  if (/duration|length|too_short/.test(check)) return '成片时长未达到生成要求';
  if (/hand|finger|limb|arm|body|anatom|melt|fused|extra/.test(check)) {
    return '成片手部或肢体结构异常';
  }
  if (/action|motion|movement|sequence|stage/.test(check)) return '要求的动作或阶段未完整呈现';
  if (/audio|voice|sound|volume|silent/.test(check)) return '成片缺少可听声音';
  if (/subtitle|text|brand|logo|watermark|copy/.test(check)) {
    return '成片文字或品牌标识未准确呈现';
  }
  if (/face|identity|subject|frame|composition|scene|drift|containment/.test(check)) {
    return '人物或主体跨帧不一致';
  }
  if (/inconclusive|unavailable|service/.test(check)) return '自动质检未能得出结论';
  return '成片自动质检未通过';
}

export function videoQualityFailureOutcome(
  err: unknown,
  verifiedAt = new Date(),
): {
  verificationPassed?: false;
  failedChecks?: Array<{ type: string; detail: string }>;
  metadata?: {
    qualityVerification: {
      status: 'failed' | 'unknown';
      gateVersion: typeof VIDEO_QUALITY_GATE_VERSION;
      verifiedAt: string;
      failedChecks: string[];
    };
  };
} {
  const record = qualityErrorRecord(err);
  const name = typeof record?.name === 'string' ? record.name : '';
  const kind = typeof record?.kind === 'string' ? record.kind : '';
  if (
    (name !== 'SimpleVideoError' && name !== 'IpVideoError') ||
    (kind !== 'quality' && kind !== 'quality_unavailable')
  ) {
    return {};
  }

  const failedChecks = safeQualityChecks(err);
  return {
    ...(kind === 'quality' ? { verificationPassed: false as const } : {}),
    ...(failedChecks.length > 0
      ? {
          failedChecks: failedChecks.map((type) => ({
            type,
            detail: qualityCheckDetail(type),
          })),
        }
      : {}),
    metadata: {
      qualityVerification: {
        status: kind === 'quality' ? 'failed' : 'unknown',
        gateVersion: VIDEO_QUALITY_GATE_VERSION,
        verifiedAt: verifiedAt.toISOString(),
        failedChecks,
      },
    },
  };
}

export function deriveVideoType(input: {
  isPet: boolean;
  isIp: boolean;
  tab?: VideoType;
}): VideoType {
  if (input.tab === 'pet' || input.isPet) return 'pet';
  if (input.tab === 'ip_person' || input.isIp) return 'ip_person';
  return 'normal';
}

export function videoVerifierPreflightIssue(input: {
  choice: 'video' | 'image';
  hasVerifier: boolean;
}): string | null {
  if ((input.choice === 'video' || input.choice === 'image') && !input.hasVerifier) {
    return '成片质检服务暂不可用，尚未开始制作，请稍后重试。';
  }
  return null;
}

export async function claimVideoConfirmAfterVerifierPreflight(
  input: { choice: 'video' | 'image'; hasVerifier: boolean },
  consume: () => Promise<boolean>,
): Promise<{ issue: string | null; claimed: boolean }> {
  const issue = videoVerifierPreflightIssue(input);
  if (issue) return { issue, claimed: false };
  return { issue: null, claimed: await consume() };
}

/** Whitelisted, user-safe failure copy. NEVER include raw error text. */
export const VIDEO_FAILURE_REASONS = {
  busy: '服务繁忙，请稍后再试。',
  face: '出镜底版检测不到清晰人脸，请换一段正脸清晰的视频后重试。',
  tooLong: '文案过长，请缩短后重试。',
  ipAssets: 'IP 素材或授权缺失，请重新完成「IP 人物」三步素材准备后重试。',
  invalidOptions: '所选画质与时长不兼容，请返回修改参数后重试。',
  providerQuota:
    '当前视频模型暂时不可用，本次未生成成片。请切换其他模型，或稍后重试。',
  cloneProviderUnavailable:
    '当前复刻视频模型暂时不可用，本次未开始生成成片。请稍后重试。',
  cloneIncompatible:
    '主角照片与参考视频不适配，本次未开始付费生成。当前仅支持单人换单人，请使用清晰单人照片，并选择人物取景和身体比例相近的参考视频。',
  cloneCompatibilityUnavailable:
    '暂时无法确认主角照片与参考视频是否适配，本次未开始付费生成。请稍后重试。',
  quality:
    '成片自动质检未通过（检测到时长不足、动作未完成、异常肢体、画面偏离或文字/品牌不准确），问题视频未交付，请重试。',
  qualityDuration: '成片时长未达到生成要求，问题视频未交付，请重试。',
  qualityAnatomy: '成片检测到人物或肢体结构异常，问题视频未交付，请重试。',
  qualityAction: '成片未完整呈现要求的动作或阶段，问题视频未交付，请重试。',
  qualityAudio: '成片缺少可听声音或没有保留原片音频，问题视频未交付，请重试。',
  qualityText: '成片文字或品牌标识未准确呈现，问题视频未交付，请重试。',
  qualityConsistency: '成片人物、主体或画面稳定性未通过，问题视频未交付，请重试。',
  qualityUnavailable: '成片自动质检暂时未得出结论，问题视频未交付，请稍后重试。',
  generic: '视频生成失败，请稍后重试。',
} as const;

/**
 * Map a lane error → a safe Chinese reason. The returned string is ALWAYS one
 * of VIDEO_FAILURE_REASONS — err.message / err.detail / stack / urls / file
 * ids are read for routing but never returned, so nothing internal leaks.
 * Unknown / unmatched → generic (the previous behaviour).
 */
export function mapVideoFailureReason(err: unknown): string {
  const e =
    err && typeof err === 'object'
      ? (err as {
          name?: unknown;
          kind?: unknown;
          status?: unknown;
          code?: unknown;
          detail?: unknown;
          message?: unknown;
          failedChecks?: unknown;
        })
      : null;
  if (!e) return VIDEO_FAILURE_REASONS.generic;
  const name = typeof e.name === 'string' ? e.name : '';
  const kind = typeof e.kind === 'string' ? e.kind : '';

  if (name === 'FalLipSyncError') {
    if (kind === 'exhausted_balance') return VIDEO_FAILURE_REASONS.busy;
    // Face-detection 422: route on status + a detail substring, but the
    // detail (which carries the input URL / file id) is NEVER returned.
    if (
      e.status === 422 &&
      typeof e.detail === 'string' &&
      /face[_\s-]?detection|no face/i.test(e.detail)
    ) {
      return VIDEO_FAILURE_REASONS.face;
    }
    if (kind === 'timeout' || kind === 'network' || kind === 'job_failed') {
      return VIDEO_FAILURE_REASONS.busy;
    }
    return VIDEO_FAILURE_REASONS.generic;
  }
  if ((name === 'SimpleVideoError' || name === 'IpVideoError') && kind === 'quality') {
    const checks = safeQualityChecks(err);
    if (checks.some((check) => /duration|length|too_short/.test(check))) {
      return VIDEO_FAILURE_REASONS.qualityDuration;
    }
    if (checks.some((check) => /hand|finger|limb|arm|body|anatom|melt|fused|extra/.test(check))) {
      return VIDEO_FAILURE_REASONS.qualityAnatomy;
    }
    if (checks.some((check) => /action|motion|movement|sequence|stage/.test(check))) {
      return VIDEO_FAILURE_REASONS.qualityAction;
    }
    if (checks.some((check) => /audio|voice|sound|volume|silent/.test(check))) {
      return VIDEO_FAILURE_REASONS.qualityAudio;
    }
    if (checks.some((check) => /subtitle|text|brand|logo|watermark|copy/.test(check))) {
      return VIDEO_FAILURE_REASONS.qualityText;
    }
    if (
      checks.some((check) =>
        /face|identity|subject|frame|composition|scene|drift|containment/.test(check),
      )
    ) {
      return VIDEO_FAILURE_REASONS.qualityConsistency;
    }
    return VIDEO_FAILURE_REASONS.quality;
  }
  if ((name === 'SimpleVideoError' || name === 'IpVideoError') && kind === 'quality_unavailable') {
    return VIDEO_FAILURE_REASONS.qualityUnavailable;
  }
  if (name === 'SimpleVideoError' && kind === 'clone_incompatible') {
    return VIDEO_FAILURE_REASONS.cloneIncompatible;
  }
  if (name === 'SimpleVideoError' && kind === 'clone_compatibility_unavailable') {
    return VIDEO_FAILURE_REASONS.cloneCompatibilityUnavailable;
  }
  if (name === 'IpVideoError') {
    if (kind === 'too_long') return VIDEO_FAILURE_REASONS.tooLong;
    if (kind === 'config') return VIDEO_FAILURE_REASONS.ipAssets;
    return VIDEO_FAILURE_REASONS.generic;
  }
  if (
    (name === 'SimpleVideoError' && kind === 'invalid_options') ||
    (name === 'VeoError' && kind === 'invalid_argument')
  ) {
    return VIDEO_FAILURE_REASONS.invalidOptions;
  }
  if (
    name === 'VeoError' &&
    (kind === 'quota_exhausted' ||
      (e.status === 429 &&
        typeof e.detail === 'string' &&
        /(?:exceeded\s+your\s+current\s+quota|check\s+your\s+plan\s+and\s+billing)/i.test(
          e.detail,
        )))
  ) {
    return VIDEO_FAILURE_REASONS.providerQuota;
  }
  if (
    name === 'WanxiangError' &&
    (e.status === 429 ||
      (typeof e.detail === 'string' &&
        /(?:\bArrearage\b|overdue[\s-]*payment|account\s+is\s+not\s+in\s+good\s+standing|insufficient\s+(?:account\s+)?balance|quota\s+(?:is\s+)?(?:exhausted|exceeded))/i.test(
          e.detail,
        )))
  ) {
    return VIDEO_FAILURE_REASONS.providerQuota;
  }
  if (
    name === 'WanAnimateMixError' &&
    (e.status === 429 ||
      (typeof e.code === 'string' &&
        /^(?:Arrearage|QuotaExceeded|InsufficientBalance)$/i.test(e.code)) ||
      (typeof e.message === 'string' &&
        /(?:overdue[\s-]*payment|account\s+is\s+not\s+in\s+good\s+standing|insufficient\s+(?:account\s+)?balance|quota\s+(?:is\s+)?(?:exhausted|exceeded))/i.test(
          e.message,
        )))
  ) {
    return VIDEO_FAILURE_REASONS.cloneProviderUnavailable;
  }
  // SimpleVideoError (config/compose) + anything else → don't expose details.
  return VIDEO_FAILURE_REASONS.generic;
}
