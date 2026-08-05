import type { VideoSource } from './video-lane-simple.js';

export interface MediaProviderReadiness {
  hasDashscope: boolean;
  hasFal: boolean;
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

export function mediaCapabilityIssue(
  request: MediaCapabilityRequest,
  readiness: MediaProviderReadiness,
): string | null {
  if (request.kind === 'image') {
    return readiness.hasGemini ? null : '图片生成服务尚未就绪，未创建任务或扣除额度。';
  }

  if (request.kind === 'video_confirmation') {
    return request.choice === 'image' && !readiness.hasGemini
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

  return readiness.hasGemini ? null : 'Veo 视频服务尚未就绪，未创建报价或扣除额度。';
}
