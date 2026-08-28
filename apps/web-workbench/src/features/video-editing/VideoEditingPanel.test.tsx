// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type VideoEditingClient, VideoEditingPanel } from './VideoEditingPanel';
import type {
  VideoEditingPlan,
  VideoEditingProjectData,
  VideoEditingVersion,
} from './video-editing-state';
import type { VideoEditorAdapter } from './video-editor-adapter';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const PROJECT: VideoEditingProjectData = {
  project: {
    id: 'vedp_project',
    sourceKind: 'generated',
    provider: 'cesdk',
    status: 'active',
  },
  currentVersion: {
    id: 'vedv_1',
    revision: 1,
    document: {
      aspectRatio: '16:9',
      scenes: [
        {
          id: 'scene_1',
          sourceFileId: 'file_video',
          sourceStartMs: 0,
          sourceEndMs: 4_000,
          order: 0,
          caption: '原字幕',
          audioGain: 1,
          generationContext: { sourceTaskId: 'tsk_video' },
        },
      ],
    },
    sdkDocument: 'UBQ2-existing',
    renderStatus: 'idle',
  },
  versions: [],
  preview: { url: '/video.mp4' },
  editor: { license: 'browser-license' },
  capabilities: { sceneRegeneration: false },
};

const NEXT_VERSION: VideoEditingVersion = {
  ...PROJECT.currentVersion,
  id: 'vedv_2',
  revision: 2,
};

function client(plan: VideoEditingPlan): VideoEditingClient {
  return {
    getProject: vi.fn(async () => PROJECT),
    planInstruction: vi.fn(async () => ({ status: 'ready' as const, plan })),
    applyFreeOperations: vi.fn(async () => ({ version: NEXT_VERSION })),
    quotePaidOperation: vi.fn(async () => ({
      status: 'quoted' as const,
      quote: { id: 'vedq_exact', costUnits: 12, expiresAt: new Date() },
    })),
    consumePaidOperation: vi.fn(async () => ({ status: 'started' as const, taskId: 'tsk_regen' })),
    initializeSdkDocument: vi.fn(async (input) => ({
      version: { ...PROJECT.currentVersion, sdkDocument: input.sdkDocument },
    })),
    saveSdkDocument: vi.fn(async () => ({ version: NEXT_VERSION })),
    restoreVersion: vi.fn(async () => ({ version: NEXT_VERSION })),
    beginExport: vi.fn(async () => ({
      status: 'ready' as const,
      renderAttemptId: 'vedr_attempt',
      uploadUrl: 'https://upload.example/video',
      requiredHeaders: { 'Content-Type': 'video/mp4' },
      expiresAt: new Date(),
    })),
    completeClientExport: vi.fn(async () => ({
      status: 'completed' as const,
      file: {
        fileId: 'file_output',
        filename: 'holaday-edited.mp4',
        size: 12,
        downloadUrl: '/api/files/file_output/download',
      },
    })),
    failExport: vi.fn(async () => ({ status: 'failed' as const })),
  };
}

function adapter(overrides: Partial<VideoEditorAdapter> = {}): VideoEditorAdapter {
  return {
    mount: vi.fn(async () => ({
      exportMp4: vi.fn(),
      serialize: vi.fn(async () => 'sdk-document'),
      destroy: vi.fn(async () => undefined),
    })),
    ...overrides,
  };
}

function renderPanel(editingClient: VideoEditingClient, editorAdapter: VideoEditorAdapter) {
  return render(
    <MemoryRouter>
      <VideoEditingPanel projectId="vedp_project" client={editingClient} adapter={editorAdapter} />
    </MemoryRouter>,
  );
}

describe('VideoEditingPanel', () => {
  it('opens around the current video and mounts the editor after project data exists', async () => {
    const editingClient = client({
      summary: '更新字幕',
      affectedSceneIds: ['scene_1'],
      operations: [{ kind: 'caption', sceneId: 'scene_1', text: '新字幕' }],
      requiresQuote: false,
    });
    const editorAdapter = adapter();
    renderPanel(editingClient, editorAdapter);

    expect(await screen.findByRole('heading', { name: 'AI 帮你剪辑' })).toBeTruthy();
    expect(screen.getByText('当前视频')).toBeTruthy();
    expect(await screen.findByRole('button', { name: '选择第 1 段' })).toBeTruthy();
    await waitFor(() => expect(editorAdapter.mount).toHaveBeenCalledTimes(1));
    expect(editorAdapter.mount).toHaveBeenCalledWith(
      expect.objectContaining({
        license: 'browser-license',
        document: PROJECT.currentVersion.document,
        sourceUrls: { file_video: '/video.mp4' },
      }),
    );
  });

  it('persists a newly compiled CE.SDK scene on the same revision before enabling export', async () => {
    const editingClient = client({
      summary: '更新字幕',
      affectedSceneIds: [],
      operations: [],
      requiresQuote: false,
    });
    editingClient.getProject = vi.fn(async () => ({
      ...PROJECT,
      currentVersion: { ...PROJECT.currentVersion, sdkDocument: null },
    }));
    const editorAdapter = adapter();

    renderPanel(editingClient, editorAdapter);

    await waitFor(() => expect(editingClient.initializeSdkDocument).toHaveBeenCalledTimes(1));
    expect(editingClient.initializeSdkDocument).toHaveBeenCalledWith({
      projectId: 'vedp_project',
      baseVersionId: 'vedv_1',
      sdkDocument: 'sdk-document',
    });
    await waitFor(() => expect(editorAdapter.mount).toHaveBeenCalledTimes(2));
    expect(editorAdapter.mount).toHaveBeenLastCalledWith(
      expect.objectContaining({ sceneDocument: 'sdk-document' }),
    );
    expect(screen.getByRole('button', { name: '导出 MP4' }).hasAttribute('disabled')).toBe(false);
  });

  it('previews affected scenes and applies a free plan once', async () => {
    const plan: VideoEditingPlan = {
      summary: '改成竖版并更新第一段字幕',
      affectedSceneIds: ['scene_1'],
      operations: [
        { kind: 'aspect_ratio', value: '9:16' },
        { kind: 'caption', sceneId: 'scene_1', text: '新字幕' },
      ],
      requiresQuote: false,
    };
    const editingClient = client(plan);
    renderPanel(editingClient, adapter());
    await screen.findByRole('heading', { name: 'AI 帮你剪辑' });

    fireEvent.change(screen.getByLabelText('告诉 AI 想怎么剪'), {
      target: { value: '改成竖版并更新第一段字幕' },
    });
    fireEvent.click(screen.getByRole('button', { name: '预览修改' }));
    expect(await screen.findByText('将被修改')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '应用这 2 项修改' }));

    await waitFor(() => expect(editingClient.applyFreeOperations).toHaveBeenCalledTimes(1));
  });

  it('sends the selected scene with a selection-relative instruction', async () => {
    const editingClient = client({
      summary: '裁掉当前片段开头',
      affectedSceneIds: ['scene_1'],
      operations: [{ kind: 'trim', sceneId: 'scene_1', startMs: 500, endMs: 4_000 }],
      requiresQuote: false,
    });
    renderPanel(editingClient, adapter());
    await screen.findByRole('heading', { name: 'AI 帮你剪辑' });

    fireEvent.click(await screen.findByRole('button', { name: '选择第 1 段' }));
    fireEvent.change(screen.getByLabelText('告诉 AI 想怎么剪'), {
      target: { value: '裁掉这一段开头半秒' },
    });
    fireEvent.click(screen.getByRole('button', { name: '预览修改' }));

    await waitFor(() =>
      expect(editingClient.planInstruction).toHaveBeenCalledWith({
        projectId: 'vedp_project',
        instruction: '裁掉这一段开头半秒',
        selectedSceneId: 'scene_1',
      }),
    );
  });

  it('uses the exact server quote once for a paid scene regeneration', async () => {
    const plan: VideoEditingPlan = {
      summary: '重新生成第一段',
      affectedSceneIds: ['scene_1'],
      operations: [{ kind: 'regenerate_scene', sceneId: 'scene_1', prompt: '改成清晨' }],
      requiresQuote: true,
    };
    const editingClient = client(plan);
    editingClient.getProject = vi.fn(async () => ({
      ...PROJECT,
      capabilities: { sceneRegeneration: true },
    }));
    renderPanel(editingClient, adapter());
    await screen.findByRole('heading', { name: 'AI 帮你剪辑' });

    fireEvent.change(screen.getByLabelText('告诉 AI 想怎么剪'), {
      target: { value: '重新生成第一段' },
    });
    fireEvent.click(screen.getByRole('button', { name: '预览修改' }));
    const paidAction = await screen.findByRole('button', {
      name: '重新生成这一段 ◈ 12',
    });
    fireEvent.click(paidAction);
    fireEvent.click(paidAction);

    await waitFor(() => expect(editingClient.consumePaidOperation).toHaveBeenCalledTimes(1));
    expect(editingClient.consumePaidOperation).toHaveBeenCalledWith(
      expect.objectContaining({ quoteId: 'vedq_exact' }),
    );
  });

  it('does not create a quote or charge when scene regeneration is not available', async () => {
    const plan: VideoEditingPlan = {
      summary: '重新生成第一段',
      affectedSceneIds: ['scene_1'],
      operations: [{ kind: 'regenerate_scene', sceneId: 'scene_1', prompt: '改成清晨' }],
      requiresQuote: true,
    };
    const editingClient = client(plan);
    renderPanel(editingClient, adapter());
    await screen.findByRole('heading', { name: 'AI 帮你剪辑' });

    fireEvent.change(screen.getByLabelText('告诉 AI 想怎么剪'), {
      target: { value: '重新生成第一段' },
    });
    fireEvent.click(screen.getByRole('button', { name: '预览修改' }));

    expect(await screen.findByText(/片段重新生成还未开放/)).toBeTruthy();
    expect(editingClient.quotePaidOperation).not.toHaveBeenCalled();
    expect(editingClient.consumePaidOperation).not.toHaveBeenCalled();
  });

  it('keeps the source preview usable when the fine editor cannot load', async () => {
    const editingClient = client({
      summary: '更新字幕',
      affectedSceneIds: [],
      operations: [],
      requiresQuote: false,
    });
    renderPanel(editingClient, {
      mount: vi.fn(async () => Promise.reject(new Error('sdk failed'))),
    });

    expect(await screen.findByText(/精细时间线暂不可用/)).toBeTruthy();
    expect(screen.getByLabelText('当前视频预览')).toBeTruthy();
  });

  it('fails closed instead of mounting a second scene with the wrong source URL', async () => {
    const editingClient = client({
      summary: '交换片段',
      affectedSceneIds: [],
      operations: [],
      requiresQuote: false,
    });
    const firstScene = PROJECT.currentVersion.document.scenes[0];
    if (!firstScene) throw new Error('expected scene fixture');
    editingClient.getProject = vi.fn(async () => ({
      ...PROJECT,
      currentVersion: {
        ...PROJECT.currentVersion,
        document: {
          ...PROJECT.currentVersion.document,
          scenes: [
            firstScene,
            { ...firstScene, id: 'scene_2', sourceFileId: 'file_missing', order: 1 },
          ],
        },
      },
      scenePreviews: { file_video: { url: '/video.mp4' } },
    }));
    const editorAdapter = adapter();

    renderPanel(editingClient, editorAdapter);

    expect(await screen.findByText(/精细时间线暂不可用/)).toBeTruthy();
    expect(editorAdapter.mount).not.toHaveBeenCalled();
    expect(screen.getByLabelText('当前视频预览')).toBeTruthy();
  });

  it('renders clarification-only plans without an invalid zero-operation apply action', async () => {
    const editingClient = client({
      summary: '请告诉我想调整哪一段。',
      affectedSceneIds: [],
      operations: [],
      requiresQuote: false,
    });
    renderPanel(editingClient, adapter());
    await screen.findByRole('heading', { name: 'AI 帮你剪辑' });

    fireEvent.change(screen.getByLabelText('告诉 AI 想怎么剪'), {
      target: { value: '帮我优化一下' },
    });
    fireEvent.click(screen.getByRole('button', { name: '预览修改' }));

    expect(await screen.findByText('请告诉我想调整哪一段。')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /应用这 0 项修改/ })).toBeNull();
  });

  it('exports once through a server-bound upload target and shows the retained file', async () => {
    const editingClient = client({
      summary: '更新字幕',
      affectedSceneIds: [],
      operations: [],
      requiresQuote: false,
    });
    const exportMp4 = vi.fn(async () => new Blob(['edited-video'], { type: 'video/mp4' }));
    const editorAdapter = adapter({
      mount: vi.fn(async () => ({
        exportMp4,
        serialize: vi.fn(async () => 'sdk-document'),
        destroy: vi.fn(async () => undefined),
      })),
    });
    const upload = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', upload);
    renderPanel(editingClient, editorAdapter);
    await waitFor(() => expect(editorAdapter.mount).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('button', { name: '导出 MP4' }));

    await waitFor(() => expect(editingClient.completeClientExport).toHaveBeenCalledTimes(1));
    expect(exportMp4).toHaveBeenCalledTimes(1);
    expect(upload).toHaveBeenCalledWith(
      'https://upload.example/video',
      expect.objectContaining({
        method: 'PUT',
        headers: { 'Content-Type': 'video/mp4' },
      }),
    );
    expect(await screen.findByText('holaday-edited.mp4')).toBeTruthy();
  });

  it('recovers a completed export when the completion response is lost', async () => {
    const editingClient = client({
      summary: '更新字幕',
      affectedSceneIds: [],
      operations: [],
      requiresQuote: false,
    });
    editingClient.completeClientExport = vi.fn(async () => {
      throw new Error('response lost');
    });
    editingClient.failExport = vi.fn(async () => ({
      status: 'completed' as const,
      file: {
        fileId: 'file_output',
        filename: 'holaday-edited.mp4',
        size: 12,
        downloadUrl: '/api/files/file_output/download',
      },
    }));
    const exportMp4 = vi.fn(async () => new Blob(['edited-video'], { type: 'video/mp4' }));
    const editorAdapter = adapter({
      mount: vi.fn(async () => ({
        exportMp4,
        serialize: vi.fn(async () => 'sdk-document'),
        destroy: vi.fn(async () => undefined),
      })),
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 200 })),
    );
    renderPanel(editingClient, editorAdapter);
    await waitFor(() => expect(editorAdapter.mount).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('button', { name: '导出 MP4' }));

    expect(await screen.findByRole('heading', { name: '导出完成' })).toBeTruthy();
    expect(editingClient.failExport).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/本次生成没有完成/)).toBeNull();
  });

  it('shows a retained current-version export after reopening the project', async () => {
    const editingClient = client({
      summary: '更新字幕',
      affectedSceneIds: [],
      operations: [],
      requiresQuote: false,
    });
    editingClient.getProject = vi.fn(async () => ({
      ...PROJECT,
      currentVersion: { ...PROJECT.currentVersion, renderStatus: 'completed' as const },
      output: {
        fileId: 'file_output',
        filename: 'holaday-edited.mp4',
        size: 12,
        downloadUrl: '/api/files/file_output/download',
      },
    }));

    renderPanel(editingClient, adapter());

    expect(await screen.findByText('holaday-edited.mp4')).toBeTruthy();
    expect(screen.getByRole('button', { name: '导出 MP4' }).hasAttribute('disabled')).toBe(true);
  });
});
