import { describe, expect, it } from 'vitest';
import {
  type OwnedVideoSource,
  type VideoSourceImportDependencies,
  type VideoSourceImportError,
  importVideoSource,
} from './source-import.js';

const NOW = new Date('2026-08-28T01:00:00Z');

function source(overrides: Partial<OwnedVideoSource> = {}): OwnedVideoSource {
  return {
    internalFileId: 31,
    fileId: 'file_owned_video',
    userId: 7,
    taskId: null,
    taskExternalId: null,
    filename: 'clip.mp4',
    mimetype: 'video/mp4',
    status: 'active',
    expiresAt: null,
    taskStatus: null,
    taskResult: null,
    ...overrides,
  };
}

function dependencies(
  loaded: OwnedVideoSource | null,
  overrides: Partial<VideoSourceImportDependencies> = {},
): VideoSourceImportDependencies {
  return {
    loadOwnedSource: async () => loaded,
    getScopedPreview: async () => ({
      url: '/api/files/file_owned_video/download',
      expiresAt: new Date('2026-08-28T01:15:00Z'),
    }),
    probeDurationMs: async () => 8_000,
    ...overrides,
  };
}

function importOwned(
  loaded: OwnedVideoSource | null,
  overrides: Partial<VideoSourceImportDependencies> = {},
  input: Partial<Parameters<typeof importVideoSource>[0]> = {},
) {
  return importVideoSource(
    { userId: 7, sourceFileId: 'file_owned_video', now: NOW, ...input },
    dependencies(loaded, overrides),
  );
}

describe('video source import', () => {
  it('does not reveal a missing or foreign source file', async () => {
    await expect(importOwned(null)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(importOwned(source({ userId: 8 }))).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it.each([
    {
      label: 'expired file',
      loaded: source({ expiresAt: new Date('2026-08-28T00:59:59Z') }),
      reason: 'expired',
    },
    {
      label: 'inactive file',
      loaded: source({ status: 'expired' }),
      reason: 'inactive',
    },
    {
      label: 'non-video file',
      loaded: source({ mimetype: 'image/png' }),
      reason: 'not_video',
    },
    {
      label: 'unfinished task attachment',
      loaded: source({
        taskId: 42,
        taskExternalId: 'tsk_owned',
        taskStatus: 'executing',
      }),
      reason: 'task_unavailable',
    },
  ] as const)('rejects an unavailable $label with a typed reason', async ({ loaded, reason }) => {
    await expect(importOwned(loaded)).rejects.toMatchObject({
      code: 'SOURCE_UNAVAILABLE',
      reason,
    } satisfies Partial<VideoSourceImportError>);
  });

  it('treats a requested task/file attachment mismatch as not found', async () => {
    await expect(
      importOwned(
        source({ taskId: null, taskExternalId: null }),
        {},
        { sourceTaskId: 'tsk_owned' },
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('rejects a generated IP-person source without locked-subject provenance', async () => {
    await expect(
      importOwned(
        source({
          taskId: 42,
          taskExternalId: 'tsk_owned',
          taskStatus: 'completed',
          taskResult: {
            metadata: {
              lane: 'video_creation',
              videoType: 'ip_person',
              videoEditingSource: {
                aspectRatio: '9:16',
                scenes: [
                  {
                    id: 'scene_1',
                    sourceFileId: 'file_owned_video',
                    sourceStartMs: 0,
                    sourceEndMs: 8_000,
                    caption: '开场',
                    generationContext: { sourceTaskId: 'tsk_owned' },
                  },
                ],
              },
            },
          },
        }),
      ),
    ).rejects.toMatchObject({
      code: 'SOURCE_UNAVAILABLE',
      reason: 'missing_locked_subject',
    });
  });

  it('imports owned structured generation metadata without persisting its preview URL', async () => {
    const loaded = source({
      taskId: 42,
      taskExternalId: 'tsk_owned',
      taskStatus: 'completed',
      taskResult: {
        metadata: {
          lane: 'video_creation',
          videoType: 'normal',
          videoEditingSource: {
            aspectRatio: '16:9',
            scenes: [
              {
                id: 'scene_intro',
                sourceFileId: 'file_owned_video',
                sourceStartMs: 0,
                sourceEndMs: 4_000,
                caption: '开场',
                generationContext: {
                  sourceTaskId: 'tsk_owned',
                  prompt: '清晨城市开场',
                  referenceFileIds: ['file_reference'],
                },
              },
              {
                id: 'scene_end',
                sourceFileId: 'file_owned_video',
                sourceStartMs: 4_000,
                sourceEndMs: 8_000,
                caption: '收尾',
                generationContext: {
                  sourceTaskId: 'tsk_owned',
                  prompt: '品牌收尾',
                },
              },
            ],
          },
        },
      },
    });

    const imported = await importOwned(loaded);

    expect(imported).toMatchObject({
      sourceKind: 'generated',
      sourceTaskId: 42,
      sourceFileId: 31,
      document: {
        aspectRatio: '16:9',
        scenes: [
          {
            id: 'scene_intro',
            order: 0,
            generationContext: { sourceTaskId: 'tsk_owned' },
          },
          {
            id: 'scene_end',
            order: 1,
            generationContext: { sourceTaskId: 'tsk_owned' },
          },
        ],
      },
      capabilities: { sceneRegeneration: true },
      preview: { url: '/api/files/file_owned_video/download' },
    });
    expect(JSON.stringify(imported.document)).not.toContain('/api/files/');
  });

  it('rejects regeneration provenance that points at another task', async () => {
    await expect(
      importOwned(
        source({
          taskId: 42,
          taskExternalId: 'tsk_owned',
          taskStatus: 'completed',
          taskResult: {
            metadata: {
              lane: 'video_creation',
              videoType: 'normal',
              videoEditingSource: {
                aspectRatio: '16:9',
                scenes: [
                  {
                    id: 'scene_1',
                    sourceFileId: 'file_owned_video',
                    sourceStartMs: 0,
                    sourceEndMs: 8_000,
                    generationContext: { sourceTaskId: 'tsk_other' },
                  },
                ],
              },
            },
          },
        }),
      ),
    ).rejects.toMatchObject({ code: 'SOURCE_UNAVAILABLE', reason: 'invalid_metadata' });
  });

  it('imports a final-only MP4 as one non-regenerable scene', async () => {
    const imported = await importOwned(source(), { probeDurationMs: async () => 12_500 });

    expect(imported).toMatchObject({
      sourceKind: 'upload',
      document: {
        aspectRatio: '16:9',
        scenes: [
          {
            sourceFileId: 'file_owned_video',
            sourceStartMs: 0,
            sourceEndMs: 12_500,
            order: 0,
            generationContext: null,
          },
        ],
      },
      capabilities: { sceneRegeneration: false },
    });
  });

  it('fails closed when the backing object can no longer produce a preview', async () => {
    await expect(
      importOwned(source(), { getScopedPreview: async () => null }),
    ).rejects.toMatchObject({ code: 'SOURCE_UNAVAILABLE', reason: 'backing_object_missing' });
  });
});
