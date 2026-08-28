import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import {
  VideoEditingPanel,
  type VideoEditingClient,
} from '@/features/video-editing/VideoEditingPanel';
import type { VideoEditingProjectData } from '@/features/video-editing/video-editing-state';
import '@/index.css';

const SOURCE_URL = 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4';

const project: VideoEditingProjectData = {
  project: {
    id: 'vedp_qa',
    sourceKind: 'generated',
    provider: 'cesdk',
    status: 'active',
  },
  currentVersion: {
    id: 'vedv_3',
    revision: 3,
    document: {
      aspectRatio: '16:9',
      scenes: [
        {
          id: 'scene_1',
          sourceFileId: 'file_qa',
          sourceStartMs: 0,
          sourceEndMs: 4_000,
          order: 0,
          caption: '风吹过花瓣，镜头慢慢靠近。',
          audioGain: 1,
          generationContext: { sourceTaskId: 'tsk_qa', prompt: '清新花朵特写' },
        },
        {
          id: 'scene_2',
          sourceFileId: 'file_qa',
          sourceStartMs: 4_000,
          sourceEndMs: 7_500,
          order: 1,
          caption: '保留自然光与轻盈节奏。',
          audioGain: 1,
          generationContext: { sourceTaskId: 'tsk_qa', prompt: '自然光下的花园' },
        },
        {
          id: 'scene_3',
          sourceFileId: 'file_qa',
          sourceStartMs: 7_500,
          sourceEndMs: 10_000,
          order: 2,
          caption: '结尾淡出品牌文案。',
          audioGain: 1,
          generationContext: { sourceTaskId: 'tsk_qa', prompt: '柔和收尾' },
        },
      ],
    },
    operations: [{ kind: 'caption', sceneId: 'scene_1', text: '风吹过花瓣，镜头慢慢靠近。' }],
    sdkDocument: null,
    renderStatus: 'idle',
  },
  versions: [
    {
      id: 'vedv_3',
      revision: 3,
      document: { aspectRatio: '16:9', scenes: [] },
      operations: [{ kind: 'caption', sceneId: 'scene_1', text: '新字幕' }],
      sdkDocument: null,
      renderStatus: 'idle',
    },
    {
      id: 'vedv_2',
      revision: 2,
      document: { aspectRatio: '9:16', scenes: [] },
      operations: [{ kind: 'aspect_ratio', value: '9:16' }],
      sdkDocument: null,
      renderStatus: 'completed',
    },
    {
      id: 'vedv_1',
      revision: 1,
      document: { aspectRatio: '16:9', scenes: [] },
      operations: null,
      sdkDocument: null,
      renderStatus: 'completed',
    },
  ],
  preview: { url: SOURCE_URL },
};

const client: VideoEditingClient = {
  async getProject() {
    return structuredClone(project);
  },
  async planInstruction({ instruction }) {
    if (instruction.includes('重新生成')) {
      return {
        status: 'ready',
        plan: {
          summary: '只重新生成第 1 段，其他片段保持不变。',
          affectedSceneIds: ['scene_1'],
          operations: [{ kind: 'regenerate_scene', sceneId: 'scene_1', prompt: instruction }],
          requiresQuote: true,
        },
      };
    }
    return {
      status: 'ready',
      plan: {
        summary: '切换为竖版，并更新第 1 段字幕。',
        affectedSceneIds: ['scene_1', 'scene_2', 'scene_3'],
        operations: [
          { kind: 'aspect_ratio', value: '9:16' },
          { kind: 'caption', sceneId: 'scene_1', text: '花开正好，今天也要轻盈一点。' },
        ],
        requiresQuote: false,
      },
    };
  },
  async applyFreeOperations() {
    return {
      version: {
        ...project.currentVersion,
        id: 'vedv_4',
        revision: 4,
        document: { ...project.currentVersion.document, aspectRatio: '9:16' },
      },
    };
  },
  async quotePaidOperation() {
    return {
      status: 'quoted',
      quote: { id: 'vedq_qa', costUnits: 12, expiresAt: new Date(Date.now() + 600_000) },
    };
  },
  async consumePaidOperation() {
    return { status: 'started', taskId: 'tsk_qa_regeneration' };
  },
  async saveSdkDocument() {
    return { version: project.currentVersion };
  },
  async restoreVersion() {
    return {
      version: { ...project.currentVersion, id: 'vedv_restored', revision: 4 },
    };
  },
};

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <div className="min-h-screen bg-[linear-gradient(180deg,#FFF_0%,#FCFAFD_46%,#F8FBFD_100%)]">
        <VideoEditingPanel
          projectId="vedp_qa"
          client={client}
          adapter={{ mount: async () => Promise.reject(new Error('QA uses source preview')) }}
        />
      </div>
    </BrowserRouter>
  </React.StrictMode>,
);
