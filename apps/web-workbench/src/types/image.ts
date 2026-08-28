import type { VideoAspect } from './video';

export type ImageModel = 'nano_banana_2' | 'nano_banana_pro';

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
