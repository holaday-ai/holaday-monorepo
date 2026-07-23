/**
 * Pure metadata helpers for the video confirm/generation path.
 *   - deriveVideoType: stamp the 成片 task with its type (enables per-tab
 *     history isolation + hiding 图片版 for IP, both batch-2 frontend).
 *   - mapVideoFailureReason: turn a lane error into a SAFE user-facing
 *     Chinese reason — reads err name/kind/status/detail ONLY to route,
 *     never echoes internal message / detail / stack / file ids.
 */

export type VideoType = 'normal' | 'pet' | 'ip_person';

export function deriveVideoType(input: {
  isPet: boolean;
  isIp: boolean;
  tab?: VideoType;
}): VideoType {
  if (input.tab === 'pet' || input.isPet) return 'pet';
  if (input.tab === 'ip_person' || input.isIp) return 'ip_person';
  return 'normal';
}

/** Whitelisted, user-safe failure copy. NEVER include raw error text. */
export const VIDEO_FAILURE_REASONS = {
  busy: '服务繁忙，请稍后再试。',
  face: '出镜底版检测不到清晰人脸，请换一段正脸清晰的视频后重试。',
  tooLong: '文案过长，请缩短后重试。',
  ipAssets: 'IP 素材或授权缺失，请重新完成「IP 人物」三步素材准备后重试。',
  invalidOptions: '所选画质与时长不兼容，请返回修改参数后重试。',
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
      ? (err as { name?: unknown; kind?: unknown; status?: unknown; detail?: unknown })
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
  // SimpleVideoError (config/compose) + anything else → don't expose details.
  return VIDEO_FAILURE_REASONS.generic;
}
