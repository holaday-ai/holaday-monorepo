import { describe, expect, it, vi } from 'vitest';
import { type VideoEditPlannerClient, planVideoEditInstruction } from './instruction-planner.js';
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
      generationContext: { sourceTaskId: 'tsk_video', prompt: '结尾' },
    },
  ],
};

function client(result: unknown): VideoEditPlannerClient {
  return { plan: vi.fn(async () => result) };
}

function planWith(instruction: string, plannerClient: VideoEditPlannerClient) {
  return planVideoEditInstruction({
    instruction,
    document: DOCUMENT,
    sourceKind: 'generated',
    client: plannerClient,
  });
}

describe('video edit instruction planner', () => {
  it('plans a bounded trim against the named scene', async () => {
    const plannerClient = client({
      summary: '删掉第 2 段开头 1 秒',
      operations: [{ kind: 'trim', sceneId: 'scene_2', startMs: 1_000, endMs: 4_000 }],
    });

    await expect(planWith('删掉第 2 段开头 1 秒', plannerClient)).resolves.toMatchObject({
      status: 'ready',
      plan: {
        affectedSceneIds: ['scene_2'],
        operations: [{ kind: 'trim', sceneId: 'scene_2', startMs: 1_000, endMs: 4_000 }],
        requiresQuote: false,
      },
    });
  });

  it('requires an exact full-scene reorder', async () => {
    const plannerClient = client({
      summary: '把第 3 段放到最前面',
      operations: [{ kind: 'reorder', sceneIds: ['scene_3', 'scene_1', 'scene_2'] }],
    });

    await expect(planWith('把第 3 段放到最前面', plannerClient)).resolves.toMatchObject({
      status: 'ready',
      plan: {
        affectedSceneIds: ['scene_1', 'scene_2', 'scene_3'],
        operations: [{ kind: 'reorder', sceneIds: ['scene_3', 'scene_1', 'scene_2'] }],
      },
    });
  });

  it('combines aspect-ratio and caption changes in one preview', async () => {
    const plannerClient = client({
      summary: '改成竖版并更新第一段字幕',
      operations: [
        { kind: 'aspect_ratio', value: '9:16' },
        { kind: 'caption', sceneId: 'scene_1', text: '开场' },
      ],
    });

    await expect(planWith('改成竖版并把第 1 段字幕改为开场', plannerClient)).resolves.toMatchObject(
      {
        status: 'ready',
        plan: {
          affectedSceneIds: ['scene_1', 'scene_2', 'scene_3'],
          requiresQuote: false,
        },
      },
    );
  });

  it('returns a preview-only clarification for ambiguous intent without calling the model', async () => {
    const plannerClient = client({ summary: '不应调用', operations: [] });

    await expect(planWith('帮我优化一下', plannerClient)).resolves.toEqual({
      status: 'suggestion',
      plan: {
        summary: '请告诉我想调整哪一段，以及要裁剪、排序、改字幕、改画幅或重新生成什么。',
        affectedSceneIds: [],
        operations: [],
        requiresQuote: false,
      },
    });
    expect(plannerClient.plan).not.toHaveBeenCalled();
  });

  it('reports planner_unavailable on timeout and never invents operations', async () => {
    const plannerClient: VideoEditPlannerClient = {
      plan: vi.fn(async () => {
        const error = new Error('request timed out');
        error.name = 'AbortError';
        throw error;
      }),
    };

    await expect(planWith('删掉第 2 段开头 1 秒', plannerClient)).resolves.toEqual({
      status: 'planner_unavailable',
    });
  });
});
