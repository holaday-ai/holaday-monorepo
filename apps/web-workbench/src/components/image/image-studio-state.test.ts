import { describe, expect, it } from 'vitest';
import {
  createImageStudioDraft,
  setImageStudioSetting,
  switchImageCreationGoal,
} from './image-studio-state';

describe('image studio draft state', () => {
  it('starts each goal with the approved provider-safe preset', () => {
    expect(createImageStudioDraft('inspiration')).toMatchObject({
      goal: 'inspiration',
      model: 'nano_banana_2',
      style: 'random',
      aspectRatio: '1:1',
      imageCount: 1,
      changeTargets: [],
    });
    expect(createImageStudioDraft('lock_subject')).toMatchObject({
      goal: 'lock_subject',
      imageCount: 2,
      subjectAttachmentClientId: null,
    });
    expect(createImageStudioDraft('commercial', 'poster')).toMatchObject({
      goal: 'commercial',
      commercialUse: 'poster',
      model: 'nano_banana_pro',
      aspectRatio: '3:4',
    });
  });

  it('preserves the brief, attachments and selected subject across goal changes', () => {
    const subject = {
      clientId: 'subject',
      fileId: 'file_subject',
      filename: 'hero.png',
      mimetype: 'image/png',
      size: 1024,
      status: 'ready' as const,
    };
    const initial = {
      ...createImageStudioDraft('lock_subject'),
      prompt: '主角不变，换到海边',
      attachments: [subject],
      subjectAttachmentClientId: 'subject',
    };

    const commercial = switchImageCreationGoal(initial, 'commercial', 'product');
    const restored = switchImageCreationGoal(commercial, 'lock_subject');

    expect(commercial.prompt).toBe('主角不变，换到海边');
    expect(commercial.attachments).toEqual([subject]);
    expect(restored.subjectAttachmentClientId).toBe('subject');
  });

  it('does not silently replace a manually overridden setting during the same draft', () => {
    const manuallyAdjusted = setImageStudioSetting(
      createImageStudioDraft('inspiration'),
      'aspectRatio',
      '16:9',
    );

    const poster = switchImageCreationGoal(manuallyAdjusted, 'commercial', 'poster');

    expect(poster.aspectRatio).toBe('16:9');
    expect(poster.model).toBe('nano_banana_pro');
    expect(poster.userOverriddenSettings.has('aspectRatio')).toBe(true);
  });

  it('clears an invalid subject selection while keeping the attachments', () => {
    const initial = {
      ...createImageStudioDraft('lock_subject'),
      attachments: [
        {
          clientId: 'subject',
          fileId: '',
          filename: 'hero.png',
          mimetype: 'image/png',
          size: 1024,
          status: 'error' as const,
        },
      ],
      subjectAttachmentClientId: 'subject',
    };

    const restored = switchImageCreationGoal(
      switchImageCreationGoal(initial, 'inspiration'),
      'lock_subject',
    );

    expect(restored.attachments).toHaveLength(1);
    expect(restored.subjectAttachmentClientId).toBeNull();
  });
});
