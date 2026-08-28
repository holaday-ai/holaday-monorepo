import {
  type VideoEditingClient,
  VideoEditingPanel,
} from '@/features/video-editing/VideoEditingPanel';
import type { VideoEditingProjectData } from '@/features/video-editing/video-editing-state';
import type { VideoEditorAdapter } from '@/features/video-editing/video-editor-adapter';
import { CheckCircle2, ShieldCheck } from 'lucide-react';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import '@/index.css';

const SOURCE_URL = 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4';
const ACCEPTANCE_CASES = [
  '裁剪片段',
  '双片段排序',
  '字幕 + 9:16 导出',
  '片段重生成默认关闭',
  '原片保留与版本恢复',
  '鉴权成品下载',
  '无报价与扣费副作用',
  '渲染与撤回证据',
];

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
  editor: { license: 'qa-browser-license' },
  capabilities: { sceneRegeneration: false },
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
    throw new Error('scene regeneration is intentionally unavailable in this POC');
  },
  async consumePaidOperation() {
    throw new Error('scene regeneration is intentionally unavailable in this POC');
  },
  async initializeSdkDocument({ sdkDocument }) {
    return { version: { ...project.currentVersion, sdkDocument } };
  },
  async saveSdkDocument() {
    return { version: project.currentVersion };
  },
  async restoreVersion() {
    return {
      version: { ...project.currentVersion, id: 'vedv_restored', revision: 4 },
    };
  },
  async beginExport() {
    return {
      status: 'ready',
      renderAttemptId: 'vedr_qa',
      uploadUrl: 'https://qa-upload.invalid/video',
      requiredHeaders: { 'Content-Type': 'video/mp4' },
      expiresAt: new Date(Date.now() + 600_000),
    };
  },
  async completeClientExport() {
    return {
      status: 'completed',
      file: {
        fileId: 'file_qa_output',
        filename: 'holaday-edited.mp4',
        size: 24,
        downloadUrl: 'data:video/mp4;base64,cWEtdmlkZW8=',
      },
    };
  },
  async failExport() {
    return { status: 'failed' };
  },
};

const qaAdapter: VideoEditorAdapter = {
  async mount({ container, sourceUrl }) {
    const video = document.createElement('video');
    video.src = sourceUrl;
    video.controls = true;
    video.playsInline = true;
    video.muted = true;
    video.autoplay = true;
    video.loop = true;
    video.preload = 'metadata';
    video.className = 'h-full w-full object-contain';
    video.setAttribute('aria-label', 'QA 精细编辑器视频');
    container.replaceChildren(video);
    return {
      async exportMp4() {
        return new Blob(['qa-video'], { type: 'video/mp4' });
      },
      async serialize() {
        return 'qa-sdk-document';
      },
      async destroy() {
        video.remove();
      },
    };
  },
};

const originalFetch = window.fetch.bind(window);
window.fetch = (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (url === 'https://qa-upload.invalid/video') {
    return Promise.resolve(new Response(null, { status: 200 }));
  }
  return originalFetch(input, init);
};

const root = document.getElementById('root');
if (!root) throw new Error('QA root is missing');

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <BrowserRouter>
      <div className="min-h-screen bg-[linear-gradient(180deg,#FFF_0%,#FCFAFD_46%,#F8FBFD_100%)]">
        <section className="mx-auto -mb-10 w-full max-w-[1240px] px-4 pt-5 sm:px-6 md:px-8 min-[769px]:-mb-14">
          <div className="rounded-[22px] border border-[#E8DFE9] bg-white/90 p-4 shadow-[0_12px_34px_rgba(68,44,72,0.06)] backdrop-blur-sm">
            <div className="flex items-center gap-2 text-sm font-semibold text-[#382F3B]">
              <ShieldCheck className="h-4 w-4 text-[#B02E64]" aria-hidden="true" />
              八项安全验收夹具
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {ACCEPTANCE_CASES.map((item, index) => (
                <span
                  key={item}
                  className="inline-flex min-h-8 items-center gap-1.5 rounded-full border border-[#E8DFE9] bg-[#FCF9FC] px-3 text-[11px] font-medium text-[#695E6D]"
                >
                  <CheckCircle2 className="h-3.5 w-3.5 text-[#1A9A66]" aria-hidden="true" />
                  {index + 1}. {item}
                </span>
              ))}
            </div>
          </div>
        </section>
        <VideoEditingPanel projectId="vedp_qa" client={client} adapter={qaAdapter} />
      </div>
    </BrowserRouter>
  </React.StrictMode>,
);
