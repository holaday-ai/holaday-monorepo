import { describe, expect, it, vi } from 'vitest';
import { VideoEditRepositoryError } from '../../video-editing/project-repository.js';
import { VideoSourceImportError } from '../../video-editing/source-import.js';
import type { VideoEditDocument, VideoEditVersionRecord } from '../../video-editing/types.js';
import {
  type VideoEditingRouterDependencies,
  type VideoEditingRuntime,
  applyVideoEditOperations,
  createVideoEditingRouter,
} from './video-editing.js';

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
      generationContext: { sourceTaskId: 'tsk_video', prompt: '开场' },
    },
    {
      id: 'scene_2',
      sourceFileId: 'file_video',
      sourceStartMs: 4_000,
      sourceEndMs: 8_000,
      order: 1,
      caption: '',
      audioGain: 1,
      generationContext: { sourceTaskId: 'tsk_video', prompt: '结尾' },
    },
  ],
};

const CURRENT_VERSION: VideoEditVersionRecord = {
  id: 51,
  externalId: 'vedv_current',
  projectId: 41,
  parentVersionId: null,
  revision: 1,
  documentJson: DOCUMENT,
  operationJson: null,
  sdkDocument: null,
  outputFileId: null,
  renderStatus: 'idle',
  createdAt: new Date('2026-08-28T00:00:00Z'),
};

function runtime(overrides: Partial<VideoEditingRuntime> = {}): VideoEditingRuntime {
  return {
    repository: {
      createFromSource: vi.fn(async () => ({
        project: {
          id: 41,
          externalId: 'vedp_project',
          userId: 7,
          sourceTaskId: 21,
          sourceFileId: 31,
          sourceKind: 'generated' as const,
          provider: 'cesdk' as const,
          status: 'active' as const,
          currentVersionId: 51,
          createdAt: new Date('2026-08-28T00:00:00Z'),
          updatedAt: new Date('2026-08-28T00:00:00Z'),
        },
        currentVersion: CURRENT_VERSION,
      })),
      getOwnedProject: vi.fn(async () => ({
        project: {
          id: 41,
          externalId: 'vedp_project',
          userId: 7,
          sourceTaskId: 21,
          sourceFileId: 31,
          sourceKind: 'generated' as const,
          provider: 'cesdk' as const,
          status: 'active' as const,
          currentVersionId: 51,
          createdAt: new Date('2026-08-28T00:00:00Z'),
          updatedAt: new Date('2026-08-28T00:00:00Z'),
        },
        currentVersion: CURRENT_VERSION,
      })),
      appendVersion: vi.fn(async (input) => ({
        ...CURRENT_VERSION,
        id: 52,
        externalId: 'vedv_next',
        parentVersionId: 51,
        revision: 2,
        documentJson: input.document,
        operationJson: input.operations,
      })),
      restoreVersion: vi.fn(async () => ({
        ...CURRENT_VERSION,
        id: 52,
        externalId: 'vedv_restored',
        parentVersionId: 51,
        revision: 2,
      })),
    },
    importSource: vi.fn(async () => ({
      sourceKind: 'upload' as const,
      sourceTaskId: null,
      sourceFileId: 31,
      document: DOCUMENT,
      capabilities: { sceneRegeneration: false },
      preview: {
        url: '/api/files/file_video/download',
        expiresAt: new Date('2026-08-28T00:15:00Z'),
      },
    })),
    getProjectPreview: vi.fn(async () => ({
      url: '/api/files/file_video/download',
      expiresAt: new Date('2026-08-28T00:15:00Z'),
    })),
    planInstruction: vi.fn(async () => ({
      status: 'ready' as const,
      plan: {
        summary: '更新字幕',
        affectedSceneIds: ['scene_1'],
        operations: [{ kind: 'caption' as const, sceneId: 'scene_1', text: '开场' }],
        requiresQuote: false,
      },
    })),
    quoteService: {
      createQuote: vi.fn(async () => ({
        status: 'quoted' as const,
        quote: {
          id: 'vedq_quote',
          costUnits: 12,
          expiresAt: new Date('2026-08-28T00:10:00Z'),
        },
      })),
      consumeAndExecute: vi.fn(async () => ({
        status: 'started' as const,
        taskId: 'tsk_generation',
      })),
    },
    billing: { consume: vi.fn(), refund: vi.fn() },
    executePaidOperation: vi.fn(),
    ...overrides,
  };
}

function caller(
  input: {
    enabled?: boolean;
    allowlist?: string;
    runtime?: VideoEditingRuntime;
  } = {},
) {
  const editingRuntime = input.runtime ?? runtime();
  const dependencies: VideoEditingRouterDependencies = {
    featureConfig: {
      enabled: input.enabled ?? true,
      allowlist: input.allowlist ?? '',
    },
    resolveUser: vi.fn(async () => ({ id: 7, externalId: 'usr_one', plan: 'pro' as const })),
    createRuntime: vi.fn(() => editingRuntime),
  };
  return {
    caller: createVideoEditingRouter(dependencies).createCaller({ userId: 'usr_one' } as never),
    dependencies,
    runtime: editingRuntime,
  };
}

describe('video editing router', () => {
  it('reports capability without constructing runtime or revealing gate details', async () => {
    const fixture = caller({ enabled: false, allowlist: 'usr_canary' });
    await expect(fixture.caller.capability()).resolves.toEqual({ enabled: false });
    expect(fixture.dependencies.createRuntime).not.toHaveBeenCalled();
  });

  it('denies every mutation while the feature is off', async () => {
    const fixture = caller({ enabled: false });
    await expect(
      fixture.caller.createProject({ sourceFileId: 'file_video' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(fixture.runtime.importSource).not.toHaveBeenCalled();
  });

  it('maps a foreign source file to NOT_FOUND without leaking its existence', async () => {
    const editingRuntime = runtime({
      importSource: vi.fn(async () => {
        throw new VideoSourceImportError('NOT_FOUND', null, '视频不存在');
      }),
    });
    const fixture = caller({ runtime: editingRuntime });

    await expect(
      fixture.caller.createProject({ sourceFileId: 'file_foreign' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', message: '视频不存在' });
  });

  it('maps a foreign project to NOT_FOUND without leaking ownership', async () => {
    const editingRuntime = runtime({
      repository: {
        ...runtime().repository,
        getOwnedProject: vi.fn(async () => {
          throw new VideoEditRepositoryError('NOT_FOUND', '视频剪辑项目不存在');
        }),
      },
    });
    const fixture = caller({ runtime: editingRuntime });

    await expect(fixture.caller.getProject({ projectId: 'vedp_foreign' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: '视频剪辑项目不存在',
    });
  });

  it('returns only external project/version data plus a fresh preview', async () => {
    const fixture = caller();
    const result = await fixture.caller.getProject({ projectId: 'vedp_project' });

    expect(result).toMatchObject({
      project: { id: 'vedp_project', sourceKind: 'generated', status: 'active' },
      currentVersion: { id: 'vedv_current', revision: 1, document: DOCUMENT },
      preview: { url: '/api/files/file_video/download' },
    });
    expect(JSON.stringify(result)).not.toContain('"id":41');
    expect(JSON.stringify(result)).not.toContain('"projectId":41');
  });

  it('applies free operations against the exact current base version', async () => {
    const editingRuntime = runtime();
    const fixture = caller({ runtime: editingRuntime });

    await expect(
      fixture.caller.applyFreeOperations({
        projectId: 'vedp_project',
        baseVersionId: 'vedv_current',
        summary: '改成竖版并更新字幕',
        operations: [
          { kind: 'aspect_ratio', value: '9:16' },
          { kind: 'caption', sceneId: 'scene_1', text: '开场' },
        ],
      }),
    ).resolves.toMatchObject({ version: { id: 'vedv_next', revision: 2 } });
    expect(editingRuntime.repository.appendVersion).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 7,
        projectId: 'vedp_project',
        baseVersionId: 'vedv_current',
        document: expect.objectContaining({ aspectRatio: '9:16' }),
      }),
    );
  });

  it('surfaces a stale base as CONFLICT and does not silently retry', async () => {
    const editingRuntime = runtime({
      repository: {
        ...runtime().repository,
        appendVersion: vi.fn(async () => {
          throw new VideoEditRepositoryError('CONFLICT', '视频版本刚刚发生变化，请刷新后重试');
        }),
      },
    });
    const fixture = caller({ runtime: editingRuntime });

    await expect(
      fixture.caller.saveSdkDocument({
        projectId: 'vedp_project',
        baseVersionId: 'vedv_stale',
        sdkDocument: 'UBQ2-scene',
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('requires a quote for regeneration instead of applying it as a free edit', async () => {
    const fixture = caller();
    await expect(
      fixture.caller.applyFreeOperations({
        projectId: 'vedp_project',
        baseVersionId: 'vedv_current',
        summary: '重新生成第一段',
        operations: [{ kind: 'regenerate_scene', sceneId: 'scene_1', prompt: '改成清晨' }],
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });
});

describe('applyVideoEditOperations', () => {
  it('trims, reorders, captions, and reframes without mutating the base document', () => {
    const base = structuredClone(DOCUMENT);
    const result = applyVideoEditOperations(base, [
      { kind: 'trim', sceneId: 'scene_1', startMs: 500, endMs: 3_000 },
      { kind: 'caption', sceneId: 'scene_1', text: '新开场' },
      { kind: 'reorder', sceneIds: ['scene_2', 'scene_1'] },
      { kind: 'aspect_ratio', value: '9:16' },
    ]);

    expect(result).toMatchObject({
      aspectRatio: '9:16',
      scenes: [
        { id: 'scene_2', order: 0 },
        {
          id: 'scene_1',
          order: 1,
          sourceStartMs: 500,
          sourceEndMs: 3_000,
          caption: '新开场',
        },
      ],
    });
    expect(base).toEqual(DOCUMENT);
  });
});
