import type { VideoAspect } from './video';

export type ImageModel = 'nano_banana_2' | 'nano_banana_pro';

export interface ImageCreationOptions {
  model: ImageModel;
  aspectRatio: VideoAspect;
  imageCount: 1 | 2 | 3 | 4;
  mode?: 'free' | 'lock_subject';
  /** Explicit identity anchor for lock_subject generation. */
  subjectFileId?: string;
}
