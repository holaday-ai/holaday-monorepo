import { FileDownloadCard, type FileDownloadPayload } from '@/components/FileDownloadCard';
import { trpc } from '@/lib/trpc';
import { PageContainer } from '@/pages/PageShell';
import {
  AlertCircle,
  ArrowLeft,
  Check,
  ChevronDown,
  Download,
  History,
  LoaderCircle,
  Save,
  Sparkles,
  WandSparkles,
} from 'lucide-react';
import * as React from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { SceneStrip } from './SceneStrip';
import { VersionHistory } from './VersionHistory';
import { cesdkVideoEditorAdapter } from './cesdk-video-editor-adapter';
import {
  type VideoEditingFailure,
  type VideoEditingPlan,
  type VideoEditingProjectData,
  type VideoEditingVersion,
  initialVideoEditingState,
  isVideoEditingBusy,
  videoEditingReducer,
} from './video-editing-state';
import type { VideoEditorAdapter } from './video-editor-adapter';
import type { MountedVideoEditor } from './video-editor-adapter';

type PlanningResult =
  | { status: 'ready' | 'suggestion'; plan: VideoEditingPlan }
  | { status: 'planner_unavailable' };

type QuoteResult =
  | { status: 'free' }
  | {
      status: 'quoted';
      quote: { id: string; costUnits: number; expiresAt: Date | string };
    };

type ConsumeResult =
  | { status: 'started'; taskId: string }
  | {
      status:
        | 'insufficient_balance'
        | 'downstream_failed'
        | 'not_found'
        | 'expired'
        | 'already_consumed'
        | 'mismatch'
        | 'stale_base';
    };

type BeginExportResult =
  | {
      status: 'ready';
      renderAttemptId: string;
      uploadUrl: string;
      requiredHeaders: Record<string, string>;
      expiresAt: Date | string;
    }
  | {
      status:
        | 'not_found'
        | 'stale_version'
        | 'version_not_ready'
        | 'already_rendering'
        | 'upload_unavailable';
    };

type CompleteExportResult =
  | { status: 'completed'; file: FileDownloadPayload }
  | { status: 'not_found' | 'stale_version' | 'expired' | 'failed' | 'invalid_output' };

export interface VideoEditingClient {
  getProject(input: { projectId: string }): Promise<VideoEditingProjectData>;
  planInstruction(input: {
    projectId: string;
    instruction: string;
    selectedSceneId?: string;
  }): Promise<PlanningResult>;
  applyFreeOperations(input: {
    projectId: string;
    baseVersionId: string;
    summary: string;
    operations: VideoEditingPlan['operations'];
  }): Promise<{ version: VideoEditingVersion }>;
  quotePaidOperation(input: {
    projectId: string;
    baseVersionId: string;
    summary: string;
    operations: VideoEditingPlan['operations'];
  }): Promise<QuoteResult>;
  consumePaidOperation(input: {
    projectId: string;
    baseVersionId: string;
    quoteId: string;
    operations: VideoEditingPlan['operations'];
  }): Promise<ConsumeResult>;
  initializeSdkDocument(input: {
    projectId: string;
    baseVersionId: string;
    sdkDocument: string;
  }): Promise<{ version: VideoEditingVersion }>;
  saveSdkDocument(input: {
    projectId: string;
    baseVersionId: string;
    sdkDocument: string;
  }): Promise<{ version: VideoEditingVersion }>;
  restoreVersion(input: {
    projectId: string;
    baseVersionId: string;
    targetVersionId: string;
  }): Promise<{ version: VideoEditingVersion }>;
  beginExport(input: { projectId: string; versionId: string }): Promise<BeginExportResult>;
  completeClientExport(input: {
    projectId: string;
    versionId: string;
    renderAttemptId: string;
  }): Promise<CompleteExportResult>;
  failExport(input: {
    projectId: string;
    versionId: string;
    renderAttemptId: string;
  }): Promise<
    { status: 'failed' | 'not_found' } | { status: 'completed'; file: FileDownloadPayload }
  >;
}

export function VideoEditingRoute(): JSX.Element {
  return <VideoEditingPanel />;
}

const defaultClient: VideoEditingClient = {
  getProject: (input) =>
    trpc.videoEditing.getProject.query(input) as unknown as Promise<VideoEditingProjectData>,
  planInstruction: (input) =>
    trpc.videoEditing.planInstruction.mutate(input) as unknown as Promise<PlanningResult>,
  applyFreeOperations: (input) =>
    trpc.videoEditing.applyFreeOperations.mutate(input) as unknown as Promise<{
      version: VideoEditingVersion;
    }>,
  quotePaidOperation: (input) =>
    trpc.videoEditing.quotePaidOperation.mutate(input) as unknown as Promise<QuoteResult>,
  consumePaidOperation: (input) =>
    trpc.videoEditing.consumePaidOperation.mutate(input) as unknown as Promise<ConsumeResult>,
  initializeSdkDocument: (input) =>
    trpc.videoEditing.initializeSdkDocument.mutate(input) as unknown as Promise<{
      version: VideoEditingVersion;
    }>,
  saveSdkDocument: (input) =>
    trpc.videoEditing.saveSdkDocument.mutate(input) as unknown as Promise<{
      version: VideoEditingVersion;
    }>,
  restoreVersion: (input) =>
    trpc.videoEditing.restoreVersion.mutate(input) as unknown as Promise<{
      version: VideoEditingVersion;
    }>,
  beginExport: (input) =>
    trpc.videoEditing.beginExport.mutate(input) as unknown as Promise<BeginExportResult>,
  completeClientExport: (input) =>
    trpc.videoEditing.completeClientExport.mutate(
      input,
    ) as unknown as Promise<CompleteExportResult>,
  failExport: (input) =>
    trpc.videoEditing.failExport.mutate(input) as unknown as Promise<
      | {
          status: 'failed' | 'not_found';
        }
      | { status: 'completed'; file: FileDownloadPayload }
    >,
};

const FAILURE_COPY: Record<VideoEditingFailure, string> = {
  planner_unavailable: 'AI 暂时没有给出可靠的修改方案。原版本未变，请稍后重试。',
  stale_version: '这个项目刚刚产生了新版本。请刷新后再应用修改。',
  insufficient_balance: '当前额度不足，未开始重新生成。',
  scene_regeneration_unavailable:
    '片段重新生成还未开放，不会创建报价或扣除额度。其他剪辑功能可正常使用。',
  render_failed: '本次生成没有完成，原版本仍然可用。',
  source_unavailable: '原视频暂时不可用，无法继续剪辑。',
};

const SUGGESTIONS = ['改成 9:16 竖版', '压缩开头节奏', '更新第一段字幕'];

function sourceLabel(sourceKind: VideoEditingProjectData['project']['sourceKind']): string {
  if (sourceKind === 'upload') return '你上传的视频';
  if (sourceKind === 'ip_person') return '锁定主角视频';
  if (sourceKind === 'clone') return '复刻生成视频';
  return 'Holaday 生成视频';
}

function operationLabel(operation: VideoEditingPlan['operations'][number]): string {
  if (operation.kind === 'aspect_ratio') return `画幅调整为 ${operation.value}`;
  if (operation.kind === 'caption') return '更新场景字幕';
  if (operation.kind === 'trim') return '裁剪场景时长';
  if (operation.kind === 'reorder') return '重新排列片段';
  if (operation.kind === 'remove_silence') return '移除停顿区间';
  return '重新生成指定片段';
}

function webVttTime(milliseconds: number): string {
  const totalSeconds = Math.max(0, milliseconds) / 1_000;
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = (totalSeconds % 60).toFixed(3).padStart(6, '0');
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${seconds}`;
}

function captionTrackUrl(data: VideoEditingProjectData): string {
  let cursorMs = 0;
  const cues: string[] = [];
  for (const scene of data.currentVersion.document.scenes) {
    const durationMs = scene.sourceEndMs - scene.sourceStartMs;
    if (scene.caption.trim()) {
      cues.push(
        `${webVttTime(cursorMs)} --> ${webVttTime(cursorMs + durationMs)}\n${scene.caption.trim()}`,
      );
    }
    cursorMs += durationMs;
  }
  return `data:text/vtt;charset=utf-8,${encodeURIComponent(`WEBVTT\n\n${cues.join('\n\n')}`)}`;
}

function failureFrom(error: unknown): VideoEditingFailure {
  const candidate = error as { data?: { code?: string }; message?: string };
  if (candidate.data?.code === 'CONFLICT') return 'stale_version';
  if (candidate.data?.code === 'NOT_FOUND' || candidate.data?.code === 'PRECONDITION_FAILED') {
    return 'source_unavailable';
  }
  if (candidate.message?.includes('余额') || candidate.message?.includes('额度')) {
    return 'insufficient_balance';
  }
  return 'render_failed';
}

export function VideoEditingPanel({
  projectId: explicitProjectId,
  client = defaultClient,
  adapter = cesdkVideoEditorAdapter,
}: {
  projectId?: string;
  client?: VideoEditingClient;
  adapter?: VideoEditorAdapter;
}): JSX.Element {
  const params = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const projectId = explicitProjectId ?? params.projectId ?? '';
  const [state, dispatch] = React.useReducer(videoEditingReducer, initialVideoEditingState);
  const [instruction, setInstruction] = React.useState('');
  const [selectedSceneId, setSelectedSceneId] = React.useState<string | null>(null);
  const [quote, setQuote] = React.useState<
    Extract<QuoteResult, { status: 'quoted' }>['quote'] | null
  >(null);
  const [editorUnavailable, setEditorUnavailable] = React.useState(false);
  const [editorReady, setEditorReady] = React.useState(false);
  const [draftSdkDocument, setDraftSdkDocument] = React.useState<string | null>(null);
  const [exportedFile, setExportedFile] = React.useState<FileDownloadPayload | null>(null);
  const editorHostRef = React.useRef<HTMLDivElement | null>(null);
  const editorRef = React.useRef<MountedVideoEditor | null>(null);
  const initializedVersionIdsRef = React.useRef(new Set<string>());
  const requestIdRef = React.useRef(0);
  const actionLockRef = React.useRef(false);
  const busy = isVideoEditingBusy(state);
  const data = state.data;

  const nextRequestId = React.useCallback(() => {
    requestIdRef.current += 1;
    return requestIdRef.current;
  }, []);

  React.useEffect(() => {
    if (!projectId) return;
    const requestId = nextRequestId();
    let active = true;
    dispatch({ type: 'load_started', requestId });
    void client.getProject({ projectId }).then(
      (project) => {
        if (!active) return;
        dispatch({ type: 'load_succeeded', requestId, data: project });
        setExportedFile(project.output ?? null);
        setSelectedSceneId(project.currentVersion.document.scenes[0]?.id ?? null);
      },
      (error: unknown) => {
        if (!active) return;
        dispatch({ type: 'request_failed', requestId, error: failureFrom(error) });
      },
    );
    return () => {
      active = false;
    };
  }, [client, nextRequestId, projectId]);

  React.useEffect(() => {
    const host = editorHostRef.current;
    if (!host || !data) return;
    let active = true;
    let mounted: Awaited<ReturnType<VideoEditorAdapter['mount']>> | null = null;
    setEditorReady(false);
    setEditorUnavailable(false);
    void (async () => {
      try {
        const sourceFileIds = new Set(
          data.currentVersion.document.scenes.map((scene) => scene.sourceFileId),
        );
        const sourceUrls = Object.fromEntries(
          [...sourceFileIds].map((sourceFileId) => {
            const scopedUrl = data.scenePreviews?.[sourceFileId]?.url;
            if (scopedUrl) return [sourceFileId, scopedUrl];
            if (sourceFileIds.size === 1) return [sourceFileId, data.preview.url];
            throw new Error(`Missing scoped preview for source ${sourceFileId}`);
          }),
        );
        const editor = await adapter.mount({
          container: host,
          license: data.editor.license,
          sceneDocument: data.currentVersion.sdkDocument,
          sourceUrl: data.preview.url,
          sourceUrls,
          document: data.currentVersion.document,
          locale: 'zh-CN',
          onDocumentChanged: (document) => {
            if (active) setDraftSdkDocument(document);
          },
        });
        if (!active) {
          void editor.destroy();
          return;
        }
        mounted = editor;
        if (data.currentVersion.sdkDocument === null) {
          if (initializedVersionIdsRef.current.has(data.currentVersion.id)) {
            throw new Error('CE.SDK scene initialization did not persist');
          }
          initializedVersionIdsRef.current.add(data.currentVersion.id);
          const sdkDocument = await editor.serialize();
          if (!active) return;
          const requestId = nextRequestId();
          dispatch({ type: 'request_started', requestId, status: 'applying' });
          const result = await client.initializeSdkDocument({
            projectId,
            baseVersionId: data.currentVersion.id,
            sdkDocument,
          });
          if (!active) return;
          dispatch({ type: 'version_succeeded', requestId, version: result.version });
          return;
        }
        editorRef.current = editor;
        setEditorReady(true);
      } catch (error) {
        if (!active) return;
        setEditorUnavailable(true);
        if (data.currentVersion.sdkDocument === null) {
          const requestId = nextRequestId();
          dispatch({ type: 'request_failed', requestId, error: failureFrom(error) });
        }
      }
    })();
    return () => {
      active = false;
      editorRef.current = null;
      if (mounted) void mounted.destroy();
    };
  }, [adapter, client, data, nextRequestId, projectId]);

  async function planInstruction(): Promise<void> {
    if (!data || !instruction.trim() || actionLockRef.current || busy) return;
    actionLockRef.current = true;
    const requestId = nextRequestId();
    dispatch({ type: 'request_started', requestId, status: 'planning' });
    setQuote(null);
    try {
      const result = await client.planInstruction({
        projectId,
        instruction: instruction.trim(),
        ...(selectedSceneId ? { selectedSceneId } : {}),
      });
      if (result.status === 'planner_unavailable') {
        dispatch({ type: 'request_failed', requestId, error: 'planner_unavailable' });
        return;
      }
      if (result.plan.requiresQuote) {
        if (!data.capabilities.sceneRegeneration) {
          dispatch({
            type: 'request_failed',
            requestId,
            error: 'scene_regeneration_unavailable',
          });
          return;
        }
        const quoted = await client.quotePaidOperation({
          projectId,
          baseVersionId: data.currentVersion.id,
          summary: result.plan.summary,
          operations: result.plan.operations,
        });
        if (quoted.status !== 'quoted') {
          dispatch({ type: 'request_failed', requestId, error: 'render_failed' });
          return;
        }
        setQuote(quoted.quote);
      }
      dispatch({ type: 'plan_succeeded', requestId, plan: result.plan });
    } catch (error) {
      dispatch({ type: 'request_failed', requestId, error: failureFrom(error) });
    } finally {
      actionLockRef.current = false;
    }
  }

  async function applyPlan(): Promise<void> {
    if (!data || !state.plan || actionLockRef.current || busy) return;
    actionLockRef.current = true;
    const requestId = nextRequestId();
    dispatch({
      type: 'request_started',
      requestId,
      status: state.plan.requiresQuote ? 'rendering' : 'applying',
    });
    try {
      if (state.plan.requiresQuote) {
        if (!quote) throw new Error('missing quote');
        const result = await client.consumePaidOperation({
          projectId,
          baseVersionId: data.currentVersion.id,
          quoteId: quote.id,
          operations: state.plan.operations,
        });
        if (result.status === 'started') return;
        dispatch({
          type: 'request_failed',
          requestId,
          error:
            result.status === 'insufficient_balance'
              ? 'insufficient_balance'
              : result.status === 'stale_base'
                ? 'stale_version'
                : 'render_failed',
        });
        return;
      }
      const result = await client.applyFreeOperations({
        projectId,
        baseVersionId: data.currentVersion.id,
        summary: state.plan.summary,
        operations: state.plan.operations,
      });
      setExportedFile(null);
      dispatch({ type: 'version_succeeded', requestId, version: result.version });
      setQuote(null);
    } catch (error) {
      dispatch({ type: 'request_failed', requestId, error: failureFrom(error) });
    } finally {
      actionLockRef.current = false;
    }
  }

  async function saveEditorDocument(): Promise<void> {
    if (!data || !draftSdkDocument || actionLockRef.current || busy) return;
    actionLockRef.current = true;
    const requestId = nextRequestId();
    dispatch({ type: 'request_started', requestId, status: 'applying' });
    try {
      const result = await client.saveSdkDocument({
        projectId,
        baseVersionId: data.currentVersion.id,
        sdkDocument: draftSdkDocument,
      });
      setDraftSdkDocument(null);
      setExportedFile(null);
      dispatch({ type: 'version_succeeded', requestId, version: result.version });
    } catch (error) {
      dispatch({ type: 'request_failed', requestId, error: failureFrom(error) });
    } finally {
      actionLockRef.current = false;
    }
  }

  async function restoreVersion(targetVersionId: string): Promise<void> {
    if (!data || actionLockRef.current || busy) return;
    actionLockRef.current = true;
    const requestId = nextRequestId();
    dispatch({ type: 'request_started', requestId, status: 'applying' });
    try {
      const result = await client.restoreVersion({
        projectId,
        baseVersionId: data.currentVersion.id,
        targetVersionId,
      });
      setExportedFile(null);
      dispatch({ type: 'version_succeeded', requestId, version: result.version });
    } catch (error) {
      dispatch({ type: 'request_failed', requestId, error: failureFrom(error) });
    } finally {
      actionLockRef.current = false;
    }
  }

  async function exportVideo(): Promise<void> {
    const editor = editorRef.current;
    if (!data || !editor || actionLockRef.current || busy) return;
    actionLockRef.current = true;
    const requestId = nextRequestId();
    const versionId = data.currentVersion.id;
    let renderAttemptId: string | null = null;
    dispatch({ type: 'request_started', requestId, status: 'rendering' });
    try {
      const started = await client.beginExport({ projectId, versionId });
      if (started.status !== 'ready') {
        throw new Error(
          started.status === 'stale_version' ? 'stale version' : 'export unavailable',
        );
      }
      renderAttemptId = started.renderAttemptId;
      const blob = await editor.exportMp4();
      const upload = await fetch(started.uploadUrl, {
        method: 'PUT',
        headers: started.requiredHeaders,
        body: blob,
      });
      if (!upload.ok) throw new Error('upload failed');
      const completed = await client.completeClientExport({
        projectId,
        versionId,
        renderAttemptId,
      });
      if (completed.status !== 'completed') throw new Error(completed.status);
      setExportedFile(completed.file);
      dispatch({
        type: 'version_succeeded',
        requestId,
        version: { ...data.currentVersion, renderStatus: 'completed' },
      });
    } catch (error) {
      let recoveredCompletion = false;
      if (renderAttemptId) {
        const recovery = await client
          .failExport({ projectId, versionId, renderAttemptId })
          .catch(() => undefined);
        if (recovery?.status === 'completed') {
          recoveredCompletion = true;
          setExportedFile(recovery.file);
          dispatch({
            type: 'version_succeeded',
            requestId,
            version: { ...data.currentVersion, renderStatus: 'completed' },
          });
        }
      }
      if (!recoveredCompletion) {
        dispatch({
          type: 'request_failed',
          requestId,
          error:
            error instanceof Error && error.message === 'stale version'
              ? 'stale_version'
              : 'render_failed',
        });
      }
    } finally {
      actionLockRef.current = false;
    }
  }

  if (!data) {
    return (
      <PageContainer width="wide">
        <div className="rounded-[28px] border border-[#E7DFE8] bg-white p-8 shadow-[0_18px_50px_rgba(69,45,74,0.08)]">
          {state.error ? (
            <div role="alert" className="flex items-start gap-3 text-sm text-[#5D505F]">
              <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-[#EA1F59]" />
              {FAILURE_COPY[state.error]}
            </div>
          ) : (
            <div className="flex items-center gap-3 text-sm text-[#625965]">
              <LoaderCircle className="h-5 w-5 animate-spin text-[#EA1F59]" />
              正在打开可编辑项目…
            </div>
          )}
        </div>
      </PageContainer>
    );
  }

  const versions = [
    data.currentVersion,
    ...data.versions.filter((version) => version.id !== data.currentVersion.id),
  ];
  const paidLabel = `重新生成这一段 ◈ ${quote?.costUnits ?? '—'}`;

  return (
    <PageContainer width="wide" className="max-w-[1240px]">
      <header className="mb-5 overflow-hidden rounded-[28px] border border-[#EADFEB] bg-[linear-gradient(120deg,#FFF7F9_0%,#FBF6FF_52%,#F1FBFF_100%)] px-5 py-5 shadow-[0_14px_40px_rgba(78,52,83,0.07)] sm:px-7">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <button
              type="button"
              aria-label="返回视频页"
              title="返回视频页"
              onClick={() => navigate('/video')}
              className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-[10px] border border-white/80 bg-white/80 text-[#6A5F6D] shadow-sm transition hover:bg-white"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            </button>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl font-semibold tracking-[-0.02em] text-[#2E2831]">
                  AI 帮你剪辑
                </h1>
                <span className="rounded-full bg-white/85 px-2.5 py-1 text-[10px] font-semibold text-[#7A657D] shadow-sm">
                  版本 {data.currentVersion.revision}
                </span>
              </div>
              <p className="mt-1 text-[13px] leading-5 text-[#746B77]">
                告诉 AI 想要的效果，确认受影响片段后再应用。原视频始终保留。
              </p>
            </div>
          </div>
          <div className="inline-flex w-fit items-center gap-2 rounded-full border border-white/90 bg-white/75 px-3 py-2 text-xs text-[#665B69] shadow-sm backdrop-blur-sm">
            <Check className="h-3.5 w-3.5 text-[#1A9A66]" aria-hidden="true" />
            已保存 · {sourceLabel(data.project.sourceKind)}
          </div>
        </div>
      </header>

      {state.error && (
        <div
          role="alert"
          className="mb-4 flex items-start justify-between gap-4 rounded-[16px] border border-[#F4CCD8] bg-[#FFF7FA] px-4 py-3 text-xs leading-5 text-[#76505B]"
        >
          <span className="flex items-start gap-2">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-[#EA1F59]" aria-hidden="true" />
            {FAILURE_COPY[state.error]}
          </span>
          <button
            type="button"
            onClick={() => dispatch({ type: 'dismiss_error' })}
            className="shrink-0 font-semibold text-[#C72B57]"
          >
            知道了
          </button>
        </div>
      )}

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.55fr)_minmax(330px,0.85fr)]">
        <main className="min-w-0 rounded-[28px] border border-[#E6DFE7] bg-white p-4 shadow-[0_18px_50px_rgba(68,44,72,0.07)] sm:p-5">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-[#332D35]">当前视频</div>
              <div className="mt-0.5 text-[11px] text-[#8A818C]">
                {data.currentVersion.document.aspectRatio} · 版本 {data.currentVersion.revision}
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              {draftSdkDocument && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void saveEditorDocument()}
                  className="inline-flex h-9 items-center gap-1.5 rounded-[9px] bg-[#EA1F59] px-3 text-xs font-semibold text-white shadow-[0_8px_20px_rgba(234,31,89,0.18)] disabled:opacity-50"
                >
                  <Save className="h-3.5 w-3.5" aria-hidden="true" />
                  保存精细修改
                </button>
              )}
              <button
                type="button"
                disabled={
                  busy ||
                  !editorReady ||
                  Boolean(draftSdkDocument) ||
                  data.currentVersion.renderStatus === 'completed'
                }
                onClick={() => void exportVideo()}
                aria-label="导出 MP4"
                title={draftSdkDocument ? '请先保存精细修改' : '导出当前版本为 MP4'}
                className="inline-flex h-9 items-center gap-1.5 rounded-[9px] border border-[#DDD4DF] bg-white px-3 text-xs font-semibold text-[#574D5B] shadow-sm transition hover:border-[#CDB8D0] hover:bg-[#FFF8FB] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {state.status === 'rendering' ? (
                  <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <Download className="h-3.5 w-3.5" aria-hidden="true" />
                )}
                {state.status === 'rendering'
                  ? '正在导出…'
                  : data.currentVersion.renderStatus === 'completed'
                    ? '已导出'
                    : '导出 MP4'}
              </button>
            </div>
          </div>

          <div className="relative aspect-video overflow-hidden rounded-[22px] bg-[#17131A] shadow-inner">
            <video
              aria-label="当前视频预览"
              src={data.preview.url}
              controls
              playsInline
              preload="metadata"
              className="absolute inset-0 h-full w-full object-contain"
            >
              <track
                kind="captions"
                src={captionTrackUrl(data)}
                srcLang="zh"
                label="中文字幕"
                default
              />
            </video>
            <div
              ref={editorHostRef}
              aria-label="精细视频编辑器"
              className={`absolute inset-0 overflow-hidden bg-[#17131A] transition-opacity ${editorReady ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
            />
            {!editorReady && !editorUnavailable && (
              <div className="pointer-events-none absolute left-3 top-3 inline-flex items-center gap-2 rounded-full bg-black/65 px-3 py-1.5 text-[11px] text-white backdrop-blur-sm">
                <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                正在准备精细时间线
              </div>
            )}
          </div>
          {editorUnavailable && (
            <div className="mt-3 flex items-center gap-2 rounded-[12px] bg-[#F7F4F8] px-3 py-2 text-xs text-[#716876]">
              <AlertCircle className="h-4 w-4 text-[#98799E]" aria-hidden="true" />
              精细时间线暂不可用，仍可使用下方片段和 AI 修改。
            </div>
          )}

          <SceneStrip
            scenes={data.currentVersion.document.scenes}
            previewUrl={data.preview.url}
            scenePreviews={data.scenePreviews}
            selectedSceneId={selectedSceneId}
            affectedSceneIds={state.plan?.affectedSceneIds}
            onSelect={setSelectedSceneId}
          />
          {exportedFile && (
            <section
              aria-labelledby="video-export-title"
              className="mt-5 rounded-[18px] border border-[#E7DFE8] bg-[#FCFAFC] p-4"
            >
              <div>
                <h2 id="video-export-title" className="text-sm font-semibold text-[#332D35]">
                  导出完成
                </h2>
                <p className="mt-0.5 text-[11px] leading-5 text-[#817784]">
                  成品已保留在文件中，可随时下载；原视频和历史版本不会被覆盖。
                </p>
              </div>
              <FileDownloadCard payload={exportedFile} showPreview={false} />
            </section>
          )}
        </main>

        <aside className="space-y-4 lg:sticky lg:top-20">
          <section className="rounded-[28px] border border-[#E7DFE8] bg-white p-5 shadow-[0_16px_44px_rgba(70,45,75,0.07)]">
            <div className="flex items-center gap-3">
              <span className="grid h-10 w-10 place-items-center rounded-[12px] bg-[linear-gradient(135deg,#FFE6EF,#EFE4FF)] text-[#C02B66]">
                <WandSparkles className="h-5 w-5" aria-hidden="true" />
              </span>
              <div>
                <h2 className="text-[15px] font-semibold text-[#302A33]">想怎么修改？</h2>
                <p className="mt-0.5 text-[11px] text-[#8B818E]">AI 只会改你确认的片段</p>
              </div>
            </div>

            <label htmlFor="video-edit-instruction" className="sr-only">
              告诉 AI 想怎么剪
            </label>
            <textarea
              id="video-edit-instruction"
              aria-label="告诉 AI 想怎么剪"
              value={instruction}
              disabled={busy}
              onChange={(event) => setInstruction(event.target.value)}
              placeholder="例如：删掉中间停顿，改成竖版并更新第一段字幕"
              rows={4}
              className="mt-4 w-full resize-none rounded-[16px] border border-[#DED5E0] bg-[#FCFAFC] px-3.5 py-3 text-sm leading-6 text-[#3E3741] outline-none transition placeholder:text-[#A49BA6] focus:border-[#D48AA6] focus:bg-white focus:ring-4 focus:ring-[#EA1F59]/[0.06] disabled:opacity-60"
            />

            <div className="mt-3 flex flex-wrap gap-2">
              {SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  disabled={busy}
                  onClick={() => setInstruction(suggestion)}
                  className="min-h-9 rounded-full border border-[#E7DFE8] bg-[#FBF9FC] px-3 py-1.5 text-[11px] font-medium text-[#716777] transition hover:border-[#DCCADB] hover:bg-[#FFF7FA] hover:text-[#B72D5C] disabled:opacity-50"
                >
                  {suggestion}
                </button>
              ))}
            </div>

            <button
              type="button"
              disabled={!instruction.trim() || busy}
              onClick={() => void planInstruction()}
              aria-label="预览修改"
              className="mt-4 inline-flex h-11 w-full items-center justify-center gap-2 rounded-[12px] bg-[#EA1F59] px-4 text-sm font-semibold text-white shadow-[0_10px_24px_rgba(234,31,89,0.2)] transition hover:bg-[#D91C52] disabled:cursor-not-allowed disabled:bg-[#E7DFE3] disabled:text-[#9C9299] disabled:shadow-none"
            >
              {state.status === 'planning' ? (
                <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Sparkles className="h-4 w-4" aria-hidden="true" />
              )}
              {state.status === 'planning' ? '正在理解修改…' : '预览修改'}
            </button>

            {state.plan && (
              <div className="mt-4 rounded-[18px] border border-[#E8DEE9] bg-[linear-gradient(145deg,#FFF9FB,#FAF7FF)] p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-xs font-semibold text-[#4A3F4D]">修改预览</div>
                  <span className="rounded-full bg-white px-2 py-1 text-[10px] font-semibold text-[#7B6B80] shadow-sm">
                    {state.plan.operations.length} 项
                  </span>
                </div>
                <p className="mt-2 text-xs leading-5 text-[#6C606F]">{state.plan.summary}</p>
                <ul className="mt-3 space-y-2">
                  {state.plan.operations.map((operation, index) => (
                    <li
                      key={`${operation.kind}-${index}`}
                      className="flex items-center gap-2 rounded-[10px] bg-white/85 px-2.5 py-2 text-[11px] text-[#655969]"
                    >
                      <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[#F4EAF3] text-[10px] font-bold text-[#A13E75]">
                        {index + 1}
                      </span>
                      {operationLabel(operation)}
                    </li>
                  ))}
                </ul>
                {state.plan.operations.length > 0 && (
                  <button
                    type="button"
                    disabled={busy || (state.plan.requiresQuote && !quote)}
                    onClick={() => void applyPlan()}
                    aria-label={
                      state.plan.requiresQuote
                        ? paidLabel
                        : `应用这 ${state.plan.operations.length} 项修改`
                    }
                    className="mt-3 inline-flex h-10 w-full items-center justify-center rounded-[10px] bg-[#EA1F59] px-3 text-xs font-semibold text-white shadow-[0_8px_20px_rgba(234,31,89,0.17)] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {state.plan.requiresQuote
                      ? paidLabel
                      : `应用这 ${state.plan.operations.length} 项修改`}
                  </button>
                )}
              </div>
            )}
          </section>

          <section className="rounded-[28px] border border-[#E7DFE8] bg-[#FCFAFC] p-5 shadow-[0_12px_36px_rgba(70,45,75,0.05)]">
            <VersionHistory
              versions={versions}
              currentVersionId={data.currentVersion.id}
              busy={busy}
              onRestore={(versionId) => void restoreVersion(versionId)}
            />
          </section>

          <button
            type="button"
            aria-label="查看版本说明"
            title="查看版本说明"
            className="flex min-h-9 w-full items-center justify-between rounded-[14px] px-3 py-2 text-left text-[11px] text-[#817686] transition hover:bg-white"
          >
            <span className="inline-flex items-center gap-2">
              <History className="h-3.5 w-3.5" aria-hidden="true" />
              每次修改都能恢复
            </span>
            <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </aside>
      </div>
    </PageContainer>
  );
}
