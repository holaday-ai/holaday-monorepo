import type { ImageHistoryRow } from '@/lib/image-history-row';
import { describe, expect, it } from 'vitest';
import {
  continuationDraftFromImageTask,
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

  it('builds the three exact continuation drafts without leaking hidden task text', () => {
    const row: ImageHistoryRow = {
      taskId: 'tsk_image',
      title: null,
      intent: '生成图片：内部路由文本不应进入编辑器',
      status: 'completed',
      createdAt: new Date('2026-08-28T00:00:00.000Z'),
      starred: false,
      starredAt: null,
      imageOptions: {
        goal: 'lock_subject',
        mode: 'lock_subject',
        model: 'nano_banana_pro',
        style: 'vibrant',
        aspectRatio: '3:4',
        imageCount: 2,
        subjectFileId: 'file_subject',
        changeTargets: ['background'],
        visiblePrompt: '把背景换成海边',
      },
      downloads: [
        {
          fileId: 'file_result',
          filename: 'result.png',
          downloadUrl: '/api/files/file_result/download',
          size: 123,
          expiresAt: '2026-09-01T00:00:00.000Z',
        },
      ],
    };

    expect(continuationDraftFromImageTask(row, 'continue_edit', 'file_result')).toMatchObject({
      goal: 'lock_subject',
      prompt: '把背景换成海边',
      attachments: [
        { fileId: 'file_result', status: 'ready' },
        { fileId: 'file_subject', status: 'ready' },
      ],
      subjectAttachmentClientId: 'continued_file_subject',
    });
    expect(continuationDraftFromImageTask(row, 'keep_subject')).toMatchObject({
      prompt: '',
      attachments: [{ fileId: 'file_subject' }],
      subjectAttachmentClientId: 'continued_file_subject',
    });
    expect(continuationDraftFromImageTask(row, 'reuse_settings')).toMatchObject({
      prompt: '',
      attachments: [],
      subjectAttachmentClientId: null,
      model: 'nano_banana_pro',
      style: 'vibrant',
      aspectRatio: '3:4',
      imageCount: 2,
    });
  });
});
