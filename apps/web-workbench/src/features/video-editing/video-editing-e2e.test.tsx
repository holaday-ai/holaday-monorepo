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
  project: { id: 'vedp_qa', sourceKind: 'upload', provider: 'cesdk', status: 'active' },
  currentVersion: {
    id: 'vedv_3',
    revision: 3,
    document: {
      aspectRatio: '16:9',
      scenes: [
        {
          id: 'scene_a',
          sourceFileId: 'file_a',
          sourceStartMs: 0,
          sourceEndMs: 4_000,
          order: 0,
          caption: '原片 A',
          audioGain: 1,
          generationContext: null,
        },
        {
          id: 'scene_b',
          sourceFileId: 'file_b',
          sourceStartMs: 0,
          sourceEndMs: 5_000,
          order: 1,
          caption: '原片 B',
          audioGain: 1,
          generationContext: null,
        },
      ],
    },
    operations: null,
    sdkDocument: null,
    renderStatus: 'idle',
  },
  versions: [
    {
      id: 'vedv_1',
      revision: 1,
      document: { aspectRatio: '16:9', scenes: [] },
      operations: null,
      sdkDocument: null,
      renderStatus: 'completed',
    },
  ],
  preview: { url: '/file-a.mp4' },
  scenePreviews: {
    file_a: { url: '/file-a.mp4' },
    file_b: { url: '/file-b.mp4' },
  },
  output: null,
  editor: { license: 'browser-license' },
  capabilities: { sceneRegeneration: false },
};

function nextVersion(overrides: Partial<VideoEditingVersion> = {}): VideoEditingVersion {
  return { ...PROJECT.currentVersion, id: 'vedv_4', revision: 4, ...overrides };
}

function qaClient(plan: VideoEditingPlan): VideoEditingClient {
  return {
    getProject: vi.fn(async () => structuredClone(PROJECT)),
    planInstruction: vi.fn(async () => ({ status: 'ready' as const, plan })),
    applyFreeOperations: vi.fn(async () => ({
      version: nextVersion({
        document: {
          ...PROJECT.currentVersion.document,
          aspectRatio: plan.operations.some(
            (operation) => operation.kind === 'aspect_ratio' && operation.value === '9:16',
          )
            ? '9:16'
            : '16:9',
        },
        operations: plan.operations,
      }),
    })),
    quotePaidOperation: vi.fn(async () => ({
      status: 'quoted' as const,
      quote: { id: 'vedq_qa', costUnits: 12, expiresAt: new Date(Date.now() + 60_000) },
    })),
    consumePaidOperation: vi.fn(async () => ({ status: 'started' as const, taskId: 'tsk_regen' })),
    initializeSdkDocument: vi.fn(async (input) => ({
      version:
        input.baseVersionId === PROJECT.currentVersion.id
          ? { ...PROJECT.currentVersion, sdkDocument: input.sdkDocument }
          : nextVersion({ sdkDocument: input.sdkDocument }),
    })),
    saveSdkDocument: vi.fn(async () => ({ version: nextVersion() })),
    restoreVersion: vi.fn(async () => ({ version: nextVersion({ operations: null }) })),
    beginExport: vi.fn(async () => ({
      status: 'ready' as const,
      renderAttemptId: 'vedr_qa',
      uploadUrl: 'https://qa-upload.invalid/video',
      requiredHeaders: { 'Content-Type': 'video/mp4' },
      expiresAt: new Date(Date.now() + 60_000),
    })),
    completeClientExport: vi.fn(async () => ({
      status: 'completed' as const,
      file: {
        fileId: 'file_export',
        filename: 'holaday-edited.mp4',
        size: 24,
        downloadUrl: '/api/files/file_export/download',
      },
    })),
    failExport: vi.fn(async () => ({ status: 'failed' as const })),
  };
}

function qaAdapter(): VideoEditorAdapter {
  return {
    mount: vi.fn(async () => ({
      exportMp4: vi.fn(async () => new Blob(['qa-video'], { type: 'video/mp4' })),
      serialize: vi.fn(async () => 'qa-sdk-document'),
      destroy: vi.fn(async () => undefined),
    })),
  };
}

function open(client: VideoEditingClient, adapter = qaAdapter()) {
  return render(
    <MemoryRouter>
      <VideoEditingPanel projectId="vedp_qa" client={client} adapter={adapter} />
    </MemoryRouter>,
  );
}

async function previewInstruction(instruction: string): Promise<void> {
  await screen.findByRole('heading', { name: 'AI 帮你剪辑' });
  const instructionInput = screen.getByLabelText('告诉 AI 想怎么剪');
  await waitFor(() => expect(instructionInput.hasAttribute('disabled')).toBe(false));
  fireEvent.change(instructionInput, {
    target: { value: instruction },
  });
  const previewButton = screen.getByRole('button', { name: '预览修改' });
  await waitFor(() => expect(previewButton.hasAttribute('disabled')).toBe(false));
  fireEvent.click(previewButton);
}

describe('continue editing POC acceptance', () => {
  it('previews and applies an exact trim plus two-clip reorder without replacing the source', async () => {
    const plan: VideoEditingPlan = {
      summary: '裁掉第一段开头，并交换两个片段。',
      affectedSceneIds: ['scene_a', 'scene_b'],
      operations: [
        { kind: 'trim', sceneId: 'scene_a', startMs: 500, endMs: 3_500 },
        { kind: 'reorder', sceneIds: ['scene_b', 'scene_a'] },
      ],
      requiresQuote: false,
    };
    const client = qaClient(plan);
    open(client);
    await previewInstruction('裁掉开头半秒，再交换两段');

    expect(await screen.findByText('裁剪场景时长')).toBeTruthy();
    expect(screen.getByText('重新排列片段')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '应用这 2 项修改' }));
    await waitFor(() =>
      expect(client.applyFreeOperations).toHaveBeenCalledWith(
        expect.objectContaining({ baseVersionId: 'vedv_3', operations: plan.operations }),
      ),
    );
    expect(PROJECT.currentVersion.document.scenes.map((scene) => scene.sourceFileId)).toEqual([
      'file_a',
      'file_b',
    ]);
  });

  it('applies caption plus 9:16 and exposes the authenticated retained MP4 delivery', async () => {
    const plan: VideoEditingPlan = {
      summary: '改成竖版并更新字幕。',
      affectedSceneIds: ['scene_a', 'scene_b'],
      operations: [
        { kind: 'caption', sceneId: 'scene_a', text: '新字幕' },
        { kind: 'aspect_ratio', value: '9:16' },
      ],
      requiresQuote: false,
    };
    const client = qaClient(plan);
    const adapter = qaAdapter();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 200 })),
    );
    open(client, adapter);
    await previewInstruction('改成 9:16 并更新第一段字幕');
    fireEvent.click(await screen.findByRole('button', { name: '应用这 2 项修改' }));
    await waitFor(() => expect(client.applyFreeOperations).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(adapter.mount).toHaveBeenCalledTimes(4));
    expect(client.initializeSdkDocument).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole('button', { name: '导出 MP4' }));

    expect(await screen.findByText('holaday-edited.mp4')).toBeTruthy();
    expect(screen.getByRole('button', { name: /下载视频文件 holaday-edited\.mp4/ })).toBeTruthy();
    expect(client.completeClientExport).toHaveBeenCalledWith({
      projectId: 'vedp_qa',
      versionId: 'vedv_4',
      renderAttemptId: 'vedr_qa',
    });
  });

  it('keeps scene regeneration fail-closed without quoting or charging', async () => {
    const plan: VideoEditingPlan = {
      summary: '重新生成第一段。',
      affectedSceneIds: ['scene_a'],
      operations: [{ kind: 'regenerate_scene', sceneId: 'scene_a', prompt: '改成清晨' }],
      requiresQuote: true,
    };
    const client = qaClient(plan);
    open(client);
    await previewInstruction('重新生成第一段');

    expect(await screen.findByText(/片段重新生成还未开放/)).toBeTruthy();
    expect(screen.getAllByText('版本 3').length).toBeGreaterThan(0);
    expect(client.quotePaidOperation).not.toHaveBeenCalled();
    expect(client.consumePaidOperation).not.toHaveBeenCalled();
    expect(client.applyFreeOperations).not.toHaveBeenCalled();
  });

  it('restores by creating a new version and keeps visible cost, render, and undo evidence', async () => {
    const client = qaClient({
      summary: '更新字幕',
      affectedSceneIds: ['scene_a'],
      operations: [{ kind: 'caption', sceneId: 'scene_a', text: '新字幕' }],
      requiresQuote: false,
    });
    open(client);

    expect(await screen.findByText('原片与每次修改都会保留')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '恢复版本 1' }));
    expect(screen.getByText('恢复会创建一个新版本，原片与现有版本都会保留。')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '确认恢复版本 1' }));

    await waitFor(() =>
      expect(client.restoreVersion).toHaveBeenCalledWith({
        projectId: 'vedp_qa',
        baseVersionId: 'vedv_3',
        targetVersionId: 'vedv_1',
      }),
    );
    expect((await screen.findAllByText('版本 4')).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: '导出 MP4' })).toBeTruthy();
  });
});
