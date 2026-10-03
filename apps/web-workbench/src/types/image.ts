import type { VideoAspect } from './video';

/**
 * 'auto' lets the backend route by task (poster/text → Qwen Image, edits /
 * locked subject → Wan 2.7 Image, otherwise the default). 'nano_banana_pro'
 * is legacy (old tasks only); it is no longer offered.
 */
export type ImageModel =
  | 'auto'
  | 'qwen_image'
  | 'wan_image'
  | 'nano_banana_2'
  | 'nano_banana_pro';

export const IMAGE_MODEL_VALUES: readonly ImageModel[] = [
  'auto',
  'qwen_image',
  'wan_image',
  'nano_banana_2',
  'nano_banana_pro',
];

export function imageModelLabel(model: ImageModel): string {
  switch (model) {
    case 'auto':
      return '智能选择';
    case 'qwen_image':
      return '千问 Qwen Image';
    case 'wan_image':
      return '万相 Wan 2.7 Image';
    case 'nano_banana_pro':
      return 'Nano Banana Pro';
    default:
      return 'Nano Banana 2';
  }
}

export type ImageStyleKey =
  | 'random'
  | 'cinematic'
  | 'creative'
  | 'dynamic'
  | 'fashion'
  | 'portrait'
  | 'stock_photo'
  | 'vibrant'
  | 'anime'
  | 'illustration'
  | 'logo'
  | 'watercolor'
  | 'line_art'
  | 'fantasy'
  | 'product'
  | 'three_d_render';

export type ImageCreationGoal = 'inspiration' | 'lock_subject' | 'commercial';

export type ImageChangeTarget =
  | 'background'
  | 'style'
  | 'lighting'
  | 'action'
  | 'composition';

export type CommercialImageUse = 'product' | 'poster' | 'social_cover';

export interface ImageCreationOptions {
  model: ImageModel;
  style?: ImageStyleKey;
  aspectRatio: VideoAspect;
  imageCount: 1 | 2 | 3 | 4;
  mode?: 'free' | 'lock_subject';
  /** Explicit identity anchor for lock_subject generation. */
  subjectFileId?: string;
  goal?: ImageCreationGoal;
  commercialUse?: CommercialImageUse;
  changeTargets?: ImageChangeTarget[];
  /** The user's own brief, retained for safe continuation and history display. */
  visiblePrompt?: string;
}
