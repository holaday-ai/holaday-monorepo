import type { VideoSource } from './video-lane-simple.js';

export interface MediaProviderReadiness {
  hasDashscope: boolean;
  hasFal: boolean;
  /**
   * Dormant Google key. Kept for call-site compatibility; the production image
   * and Veo lanes no longer depend on it (Qwen/Wan via DashScope, NB2 + Veo 3.1 via fal).
   */
  hasGemini: boolean;
}

export type MediaCapabilityRequest =
  | { kind: 'image' }
  | {
      kind: 'video';
      tab: 'normal' | 'pet' | 'ip_person';
      model: VideoSource;
    }
  | { kind: 'video_confirmation'; choice: 'video' | 'image' };

/** Any production still-image provider (Qwen Image / Wan 2.7 Image / fal NB2). */
export function hasImageProvider(readiness: MediaProviderReadiness): boolean {
  return readiness.hasDashscope || readiness.hasFal;
}

export function mediaCapabilityIssue(
  request: MediaCapabilityRequest,
  readiness: MediaProviderReadiness,
): string | null {
  if (request.kind === 'image') {
    return hasImageProvider(readiness) ? null : '图片生成服务尚未就绪，未创建任务或扣除额度。';
  }

  if (request.kind === 'video_confirmation') {
    return request.choice === 'image' && !hasImageProvider(readiness)
      ? '视频图片版生成服务尚未就绪，未扣除额度。'
      : null;
  }

  if (request.tab === 'pet') {
    return readiness.hasDashscope && readiness.hasFal
      ? null
      : '复刻视频服务尚未就绪，未创建报价或扣除额度。';
  }

  if (request.tab === 'ip_person') {
    return readiness.hasDashscope && readiness.hasFal
      ? null
      : 'IP 人物视频服务尚未就绪，未创建报价或扣除额度。';
  }

  if (request.model === 'wanxiang' || request.model === 'happyhorse') {
    if (readiness.hasDashscope) return null;
    const label = request.model === 'happyhorse' ? 'Happy Horse' : 'Wan';
    return `${label} 视频服务尚未就绪，未创建报价或扣除额度。`;
  }

  // Veo 3.1 runs on fal; narration still needs DashScope TTS.
  return readiness.hasFal && readiness.hasDashscope
    ? null
    : 'Veo 视频服务尚未就绪，未创建报价或扣除额度。';
}
