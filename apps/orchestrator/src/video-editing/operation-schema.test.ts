import { describe, expect, it } from 'vitest';
import { type VideoEditPlanValidationError, validateVideoEditPlan } from './operation-schema.js';
import type { VideoEditDocument } from './types.js';

const DOCUMENT: VideoEditDocument = {
  aspectRatio: '16:9',
  scenes: [
    {
      id: 'scene_1',
      sourceFileId: 'file_video',
      sourceStartMs: 0,
      sourceEndMs: 4_000,
      order: 0,
      caption: '',
      audioGain: 1,
      generationContext: {
        sourceTaskId: 'tsk_video',
        prompt: '开场',
        lockedSubjectFileId: 'file_subject',
      },
    },
    {
      id: 'scene_2',
      sourceFileId: 'file_video',
      sourceStartMs: 4_000,
      sourceEndMs: 8_000,
      order: 1,
      caption: '',
      audioGain: 1,
      generationContext: { sourceTaskId: 'tsk_video', prompt: '中段' },
    },
    {
      id: 'scene_3',
      sourceFileId: 'file_video',
      sourceStartMs: 8_000,
      sourceEndMs: 12_000,
      order: 2,
      caption: '',
      audioGain: 1,
      generationContext: null,
    },
  ],
};

function plan(operations: unknown[]) {
  return { summary: '预览修改', operations };
}

describe('video edit operation schema', () => {
  it.each([
    ['unknown operation', plan([{ kind: 'delete_everything' }]), 'invalid_shape'],
    [
      'unknown scene',
      plan([{ kind: 'caption', sceneId: 'scene_missing', text: '标题' }]),
      'unknown_scene',
    ],
    [
      'negative trim',
      plan([{ kind: 'trim', sceneId: 'scene_1', startMs: -1, endMs: 2_000 }]),
      'invalid_shape',
    ],
    [
      'reversed trim',
      plan([{ kind: 'trim', sceneId: 'scene_1', startMs: 2_000, endMs: 1_000 }]),
      'invalid_trim',
    ],
    [
      'trim beyond scene',
      plan([{ kind: 'trim', sceneId: 'scene_1', startMs: 0, endMs: 5_000 }]),
      'invalid_trim',
    ],
    [
      'incomplete reorder',
      plan([{ kind: 'reorder', sceneIds: ['scene_1', 'scene_2'] }]),
      'invalid_reorder',
    ],
    [
      'duplicate reorder',
      plan([{ kind: 'reorder', sceneIds: ['scene_1', 'scene_1', 'scene_3'] }]),
      'invalid_reorder',
    ],
    [
      'long caption',
      plan([{ kind: 'caption', sceneId: 'scene_1', text: '字'.repeat(501) }]),
      'invalid_shape',
    ],
    [
      'empty regeneration prompt',
      plan([{ kind: 'regenerate_scene', sceneId: 'scene_1', prompt: '   ' }]),
      'invalid_shape',
    ],
    [
      'final-only scene regeneration',
      plan([{ kind: 'regenerate_scene', sceneId: 'scene_3', prompt: '改成夜景' }]),
      'regeneration_unavailable',
    ],
  ] as const)('rejects %s', (_label, raw, reason) => {
    expect(() =>
      validateVideoEditPlan(raw, { document: DOCUMENT, sourceKind: 'generated' }),
    ).toThrow(expect.objectContaining({ reason }) as VideoEditPlanValidationError);
  });

  it('derives affected scenes and paid-operation status on the server', () => {
    expect(
      validateVideoEditPlan(
        plan([
          { kind: 'caption', sceneId: 'scene_1', text: '新开场' },
          { kind: 'aspect_ratio', value: '9:16' },
          { kind: 'regenerate_scene', sceneId: 'scene_2', prompt: '改成清晨' },
        ]),
        { document: DOCUMENT, sourceKind: 'generated' },
      ),
    ).toEqual({
      summary: '预览修改',
      affectedSceneIds: ['scene_1', 'scene_2', 'scene_3'],
      operations: [
        { kind: 'caption', sceneId: 'scene_1', text: '新开场' },
        { kind: 'aspect_ratio', value: '9:16' },
        { kind: 'regenerate_scene', sceneId: 'scene_2', prompt: '改成清晨' },
      ],
      requiresQuote: true,
    });
  });

  it('keeps IP-person regeneration bound to the existing locked subject', () => {
    expect(
      validateVideoEditPlan(
        plan([{ kind: 'regenerate_scene', sceneId: 'scene_1', prompt: '改成清晨' }]),
        { document: DOCUMENT, sourceKind: 'ip_person' },
      ),
    ).toMatchObject({ requiresQuote: true, affectedSceneIds: ['scene_1'] });

    expect(() =>
      validateVideoEditPlan(
        plan([
          {
            kind: 'regenerate_scene',
            sceneId: 'scene_1',
            prompt: '改成清晨',
            lockedSubjectFileId: 'file_other',
          },
        ]),
        { document: DOCUMENT, sourceKind: 'ip_person' },
      ),
    ).toThrow(expect.objectContaining({ reason: 'invalid_shape' }) as VideoEditPlanValidationError);
  });

  it('never offers scene regeneration for an uploaded final MP4', () => {
    expect(() =>
      validateVideoEditPlan(
        plan([{ kind: 'regenerate_scene', sceneId: 'scene_1', prompt: '改成清晨' }]),
        { document: DOCUMENT, sourceKind: 'upload' },
      ),
    ).toThrow(
      expect.objectContaining({
        reason: 'regeneration_unavailable',
      }) as VideoEditPlanValidationError,
    );
  });
});
