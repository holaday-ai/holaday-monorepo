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
    sdkDocument: null,
    renderStatus: 'idle',
  },
  versions: [],
  preview: { url: '/video.mp4' },
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

  it('uses the exact server quote once for a paid scene regeneration', async () => {
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
