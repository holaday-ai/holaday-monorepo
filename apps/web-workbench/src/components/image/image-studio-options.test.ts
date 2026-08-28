import { describe, expect, it } from 'vitest';
import type { ImageStudioDraft } from './image-studio-state';
import {
  IMAGE_ASPECT_OPTIONS,
  IMAGE_MODEL_OPTIONS,
  IMAGE_STYLE_OPTIONS,
  buildImageCreationOptions,
  buildImageFileOrder,
  buildImageIntentForSubmit,
} from './image-studio-options';

function draft(overrides: Partial<ImageStudioDraft> = {}): ImageStudioDraft {
  return {
    goal: 'inspiration',
    prompt: '一只趴在窗边的橘猫',
    changeTargets: [],
    model: 'nano_banana_2',
    style: 'random',
    aspectRatio: '1:1',
    imageCount: 1,
    attachments: [],
    subjectAttachmentClientId: null,
    userOverriddenSettings: new Set(),
    ...overrides,
  };
}

describe('image studio options', () => {
  it('exposes only the image capabilities connected to the current provider', () => {
    expect(IMAGE_MODEL_OPTIONS.map((option) => option.value)).toEqual([
      'nano_banana_2',
      'nano_banana_pro',
    ]);
    expect(IMAGE_STYLE_OPTIONS).toHaveLength(16);
    expect(IMAGE_ASPECT_OPTIONS.map((option) => option.value)).toEqual([
      '1:1',
      '16:9',
      '9:16',
      '4:3',
      '3:4',
    ]);
  });

  it('builds bounded studio metadata without turning product context into hidden prompt text', () => {
    const commercialDraft = draft({
      goal: 'commercial',
      commercialUse: 'poster',
      prompt: '做一张夏日新品海报',
      changeTargets: ['background', 'lighting'],
      model: 'nano_banana_pro',
      style: 'vibrant',
      aspectRatio: '3:4',
      imageCount: 2,
    });

    expect(buildImageCreationOptions(commercialDraft)).toEqual({
      model: 'nano_banana_pro',
      style: 'vibrant',
      aspectRatio: '3:4',
      imageCount: 2,
      goal: 'commercial',
      commercialUse: 'poster',
      changeTargets: ['background', 'lighting'],
      visiblePrompt: '做一张夏日新品海报',
    });
    expect(buildImageIntentForSubmit(commercialDraft)).toBe(
      '做一张夏日新品海报\n\n图片风格要求：鲜艳明快，高饱和色彩，画面有活力，视觉冲击强。',
    );
  });

  it('adds the identity constraint only for lock-subject generation', () => {
    const lockDraft = draft({
      goal: 'lock_subject',
      style: 'portrait',
      changeTargets: ['background'],
    });

    expect(buildImageCreationOptions(lockDraft, 'file_subject')).toMatchObject({
      mode: 'lock_subject',
      subjectFileId: 'file_subject',
      goal: 'lock_subject',
    });
    expect(buildImageIntentForSubmit(lockDraft)).toContain(
      '请以用户上传的第一张图片作为锁定主角',
    );
    expect(buildImageIntentForSubmit(lockDraft)).not.toContain('background');
  });

  it('puts the explicitly selected ready image first and preserves every other ready file order', () => {
    expect(
      buildImageFileOrder(
        [
          { clientId: 'style', fileId: 'file_style', mimetype: 'image/png', status: 'ready' },
          { clientId: 'notes', fileId: 'file_notes', mimetype: 'text/plain', status: 'ready' },
          { clientId: 'subject', fileId: 'file_subject', mimetype: 'image/jpeg', status: 'ready' },
          { clientId: 'pending', fileId: '', mimetype: 'image/png', status: 'uploading' },
        ],
        'lock_subject',
        'subject',
      ),
    ).toEqual(['file_subject', 'file_style', 'file_notes']);
  });

  it('does not attach a subject id to free generation', () => {
    expect(buildImageCreationOptions(draft(), 'file_subject')).not.toHaveProperty('subjectFileId');
  });
});
