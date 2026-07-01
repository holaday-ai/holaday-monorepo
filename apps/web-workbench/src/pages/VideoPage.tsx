import {
  AlertCircle,
  ArrowUp,
  ChevronDown,
  Check,
  CheckCircle2,
  CircleSlash,
  Clapperboard,
  Clock,
  Film,
  ImagePlus,
  Loader2,
  Lock,
  Mic,
  Paperclip,
  PawPrint,
  ShieldCheck,
  Sparkles,
  Trash2,
  UserRound,
  Video as VideoIcon,
  X,
  XCircle,
} from 'lucide-react';
import * as React from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AttachmentChip, type DraftAttachment } from '@/components/AttachmentChip';
import { FileDownloadCard } from '@/components/FileDownloadCard';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';
import { trpc } from '@/lib/trpc';
import { uploadFailureMessage, uploadFile, uploadMediaFile } from '@/lib/upload-file';
import { cn } from '@/lib/utils';
import { selectStepsFor, shouldRefreshForTask } from '@/lib/video-task-selectors';
import { showImageOption, toImageRow, toVideoRow, type VideoRow, type VideoType } from '@/lib/video-history-row';
import { ipRenderingHint } from '@/lib/video-ip-estimate';
import { LazyPosterImg } from '@/components/LazyPosterImg';
import { PageContainer, Section } from '@/pages/PageShell';
import { useTaskStore } from '@/stores/task-store';
import type { UiTask } from '@/types/task';
import {
  estimateIpVideo,
  estimatePerSegmentCny,
  estimatePetCny,
  type PetDuration,
  type PetModel,
  type VideoAspect,
  type VideoCreationOptions,
  type VideoDuration,
  type VideoModel,
  type VideoResolution,
  type VideoStyleOption,
} from '@/types/video';

/**
 * 视频任务 — Phase 2 第一期独立视频界面(骨架 + 普通可用)。
 *
 * 三类型 tab:普通视频 / 宠物动起来 / IP 人物换口型。
 * 普通走既有两段式:提交 = tasks.create
 * (videoOptions 透传)→ awaiting_user video_quote 报价卡 → confirmVideo
 * 确认后才烧。本页只采集参数 + 实时估价 + 列历史,不直接计费。
 */

type CreativeMode = 'video' | 'image';
type VideoTab = 'normal' | 'pet' | 'ip';
type HistoryFilter = 'all' | 'recent' | 'favorite';

const CREATIVE_ACCEPT_FILES = '.csv,.xlsx,.xls,.docx,.pdf,.txt,.json,.md';
const CREATIVE_ACCEPT_IMAGES = '.png,.jpg,.jpeg,.webp,.gif,image/*';
const CREATIVE_MAX_ATTACHMENTS = 5;
const CREATIVE_SECTION_CLASS = 'rounded-[22px] border-[#EFEFEF] bg-white shadow-[0_14px_34px_rgba(17,24,39,0.04)]';
const CREATIVE_PRICE_SECTION_CLASS = 'rounded-[22px] border-[#EFEFEF] bg-white shadow-[0_14px_34px_rgba(17,24,39,0.04)]';
const CREATIVE_ASPECT_OPTIONS: ReadonlyArray<{ value: VideoAspect; label: string }> = [
  { value: '1:1', label: '1:1' },
  { value: '16:9', label: '16:9' },
  { value: '9:16', label: '9:16' },
  { value: '4:3', label: '4:3' },
  { value: '3:4', label: '3:4' },
];

const VIDEO_TABS: ReadonlyArray<{
  id: VideoTab;
  label: string;
  icon: typeof Film;
}> = [
  { id: 'normal', label: '普通视频', icon: Film },
  { id: 'pet', label: '宠物动起来', icon: PawPrint },
  { id: 'ip', label: 'IP 人物换口型', icon: UserRound },
];

interface VideoPageProps {
  mode?: CreativeMode;
}

export function VideoPage({ mode = 'video' }: VideoPageProps): JSX.Element {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const tasks = useTaskStore((s) => s.tasks);
  const refreshTasks = useTaskStore((s) => s.refreshTasks);
  const [videoTab, setVideoTab] = React.useState<VideoTab>('normal');
  const taskId = searchParams.get('task');
  const currentTask = taskId ? tasks.find((task) => task.taskId === taskId) ?? null : null;
  const handleTaskCreated = React.useCallback(
    (createdTaskId: string) => {
      navigate(`/${mode}?task=${encodeURIComponent(createdTaskId)}`);
    },
    [mode, navigate],
  );

  // Deep-linked `?task=` whose row isn't in the store yet → fetch the
  // list ONCE. The ref guard stops the effect feeding itself (refresh →
  // store change → re-render → refresh …); without it a row that the
  // list never returns would loop.
  const refreshedTaskIds = React.useRef<Set<string>>(new Set());
  React.useEffect(() => {
    const already = taskId ? refreshedTaskIds.current.has(taskId) : false;
    if (!shouldRefreshForTask({ taskId, hasTask: Boolean(currentTask), already })) return;
    if (taskId) refreshedTaskIds.current.add(taskId);
    void refreshTasks();
  }, [currentTask, refreshTasks, taskId]);

  React.useEffect(() => {
    if (!taskId) return;
    const status = currentTask?.status;
    if (status && !['queued', 'executing', 'awaiting_user'].includes(status)) return;
    const timer = window.setInterval(() => {
      void refreshTasks();
    }, 4000);
    return () => window.clearInterval(timer);
  }, [currentTask?.status, refreshTasks, taskId]);

  return (
    <CreativeStudioPage
      mode={mode}
      videoTab={mode === 'video' ? videoTab : undefined}
      onVideoTabChange={
        mode === 'video'
          ? (nextTab) => {
              setVideoTab(nextTab);
              if (taskId) navigate('/video');
            }
          : undefined
      }
      onTaskCreated={handleTaskCreated}
      historyRefreshKey={currentTask ? `${currentTask.taskId}:${currentTask.status}` : taskId ?? ''}
      currentTaskPanel={
        taskId ? (
          <CurrentVideoTaskPanel
            taskId={taskId}
            task={currentTask}
            preferredConfirm={mode === 'image' ? 'image' : 'video'}
          />
        ) : null
      }
    />
  );
}

function CreativeStudioPage({
  mode,
  videoTab = 'normal',
  onVideoTabChange,
  onTaskCreated,
  historyRefreshKey,
  currentTaskPanel,
}: {
  mode: CreativeMode;
  videoTab?: VideoTab;
  onVideoTabChange?(tab: VideoTab): void;
  onTaskCreated(taskId: string): void;
  historyRefreshKey?: string;
  currentTaskPanel: React.ReactNode;
}): JSX.Element {
  const toast = useToast();
  const createTask = useTaskStore((s) => s.createTask);
  const [prompt, setPrompt] = React.useState('');
  const [model, setModel] = React.useState<VideoModel>('veo_fast');
  const [style, setStyle] = React.useState<VideoStyleOption>('auto');
  const [durationSeconds, setDurationSeconds] = React.useState<VideoDuration>(6);
  const [aspectRatio, setAspectRatio] = React.useState<VideoAspect>(mode === 'image' ? '1:1' : '16:9');
  const [resolution, setResolution] = React.useState<VideoResolution>('1080p');
  const [imageCount, setImageCount] = React.useState(2);
  const [attachments, setAttachments] = React.useState<DraftAttachment[]>([]);
  const [submitting, setSubmitting] = React.useState(false);
  const imageInputRef = React.useRef<HTMLInputElement>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const isImage = mode === 'image';
  const accent = isImage ? '#42C0EF' : '#EA1F59';
  const softBg = isImage ? 'bg-[#42C0EF]/10' : 'bg-[#EA1F59]/10';
  const title = isImage ? '用AI创作图片' : '用AI创作视频';
  const placeholder = isImage
    ? '描述你想让 HOLA DAY 创作的图片内容 ...'
    : '描述你想让 HOLA DAY 创作的视频内容 ...';
  const submitLabel = isImage ? '生成图片' : '生成视频';

  React.useEffect(() => {
    setAspectRatio(isImage ? '1:1' : '16:9');
  }, [isImage]);

  async function ingestCreativeFiles(files: FileList | File[], imageOnly = false): Promise<void> {
    const list = Array.from(files);
    if (list.length === 0) return;
    if (attachments.length + list.length > CREATIVE_MAX_ATTACHMENTS) {
      toast.show(`最多附 ${CREATIVE_MAX_ATTACHMENTS} 个文件`);
      return;
    }
    for (const file of list) {
      if (imageOnly && !/^image\/(png|jpe?g|webp|gif)$/i.test(file.type)) {
        toast.show('请上传 PNG / JPG / WebP / GIF 图片', 'error');
        continue;
      }
      const clientId =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const previewDataUrl = file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined;
      const draft: DraftAttachment = {
        clientId,
        fileId: '',
        filename: file.name,
        mimetype: file.type || 'application/octet-stream',
        size: file.size,
        status: 'uploading',
        ...(previewDataUrl ? { previewDataUrl } : {}),
      };
      setAttachments((prev) => [...prev, draft]);
      try {
        const meta = await uploadFile(file);
        setAttachments((prev) =>
          prev.map((attachment) =>
            attachment.clientId === clientId
              ? { ...attachment, fileId: meta.fileId, status: 'ready' as const }
              : attachment,
          ),
        );
      } catch (err) {
        const message = uploadFailureMessage(err);
        setAttachments((prev) =>
          prev.map((attachment) =>
            attachment.clientId === clientId
              ? { ...attachment, status: 'error' as const, errorMessage: message }
              : attachment,
          ),
        );
        toast.show(message, 'error');
      }
    }
  }

  function removeCreativeAttachment(clientId: string | undefined, index: number): void {
    setAttachments((prev) => {
      const target = clientId
        ? prev.find((attachment) => attachment.clientId === clientId)
        : prev[index];
      if (target?.previewDataUrl?.startsWith('blob:')) URL.revokeObjectURL(target.previewDataUrl);
      return clientId
        ? prev.filter((attachment) => attachment.clientId !== clientId)
        : prev.filter((_, i) => i !== index);
    });
  }

  async function handleSubmit(): Promise<void> {
    const intent = prompt.trim();
    if (intent.length < 4) {
      toast.show(isImage ? '请先描述想生成的图片内容' : '请先描述想生成的视频内容', 'error');
      return;
    }
    if (submitting) return;
    if (attachments.some((attachment) => attachment.status === 'uploading')) {
      toast.show('文件上传中，请稍候');
      return;
    }
    setSubmitting(true);
    const fileIds = attachments
      .filter((attachment) => attachment.status === 'ready' && attachment.fileId)
      .map((attachment) => attachment.fileId);
    const finalIntent = isImage
      ? `生成图片：${intent}${imageCount > 1 ? `。请生成 ${imageCount} 张可选方案。` : ''}`
      : intent;
    try {
      const res = isImage
        ? await createTask(finalIntent, fileIds)
        : await createTask(finalIntent, fileIds, undefined, undefined, undefined, undefined, {
            tab: 'normal',
            model,
            style,
            aspectRatio,
            resolution,
            durationSeconds,
          });
      if ('error' in res) {
        toast.show(res.error || '提交失败，请重试', 'error');
        return;
      }
      if (isImage) {
        for (const attachment of attachments) {
          if (attachment.previewDataUrl?.startsWith('blob:')) URL.revokeObjectURL(attachment.previewDataUrl);
        }
        setAttachments([]);
        setPrompt('');
      }
      toast.show(isImage ? '已提交，图片生成中' : '已提交，请确认报价后开始制作', 'info', 3000);
      onTaskCreated(res.taskId);
    } catch (err) {
      toast.show(err instanceof Error ? err.message : '提交失败，请重试', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-full bg-white">
      <PageContainer width="wide" className="max-w-[1220px] pb-14 pt-10 md:px-12 md:pt-12">
        <div className="relative overflow-hidden rounded-none">
          <div className="pointer-events-none absolute right-20 top-5 hidden h-32 w-[320px] items-center justify-center opacity-80 md:flex">
            <div className={cn('flex h-20 w-20 rotate-[-10deg] items-center justify-center rounded-[24px] bg-white shadow-[0_18px_42px_rgba(17,24,39,0.08)]', isImage && 'text-[#42C0EF]', !isImage && 'text-[#EA1F59]')}>
              {isImage ? <ImagePlus className="h-12 w-12" /> : <Clapperboard className="h-12 w-12" />}
            </div>
            <div className="ml-4 flex h-[72px] w-[72px] rotate-[8deg] items-center justify-center rounded-[22px] bg-[#EA1F59]/10 text-[#EA1F59] shadow-[0_14px_32px_rgba(234,31,89,0.10)]">
              <Sparkles className="h-8 w-8" />
            </div>
            <div className={cn('ml-3 flex h-14 w-14 rotate-[14deg] items-center justify-center rounded-[18px] bg-white shadow-[0_14px_30px_rgba(17,24,39,0.06)]', isImage ? 'text-[#42C0EF]' : 'text-[#EA1F59]')}>
              {isImage ? <VideoIcon className="h-8 w-8" /> : <ImagePlus className="h-8 w-8" />}
            </div>
          </div>
          <header className="relative z-10 mb-5">
            <h1 className="text-[30px] font-semibold leading-tight tracking-normal text-[#111827] md:text-[34px]">
              {title}
              <Sparkles
                className={cn(
                  'ml-2 inline h-5 w-5 align-super',
                  isImage ? 'text-[#42C0EF]' : 'text-[#EA1F59]',
                )}
              />
            </h1>
          </header>

          {!isImage && onVideoTabChange && (
            <CreativeTypeTabs
              value={videoTab}
              onChange={onVideoTabChange}
              accent={accent}
            />
          )}

          {!isImage && videoTab !== 'normal' ? (
            <>
              <div className="relative z-10 mt-5 rounded-[26px] border border-[#EFEFEF] bg-white p-5 shadow-[0_16px_42px_rgba(17,24,39,0.05)]">
                {videoTab === 'pet' ? (
                  <PetVideoForm onTaskCreated={onTaskCreated} />
                ) : (
                  <IpOnboardingWizard onTaskCreated={onTaskCreated} />
                )}
                {currentTaskPanel ? <div className="mt-6">{currentTaskPanel}</div> : null}
              </div>
              <CreativeHistory
                mode="video"
                accent={accent}
                softBg={softBg}
                videoType={videoTab === 'pet' ? 'pet' : 'ip_person'}
                refreshKey={historyRefreshKey}
              />
            </>
          ) : (
            <>

          <div className="relative z-10 mt-5 rounded-[22px] border border-[#EFEFEF] bg-white px-5 py-4 shadow-[0_16px_42px_rgba(17,24,39,0.05)]">
            <div
              className={cn(
                'grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4 2xl:items-end',
                isImage
                  ? '2xl:grid-cols-[150px_190px_230px_190px]'
                  : '2xl:grid-cols-[180px_230px_150px_210px_190px]',
              )}
            >
              <CreativeSelect
                label="AI 模型"
                value={isImage ? 'auto' : videoModelLabel(model)}
                options={isImage ? ['Auto'] : ['Veo Fast', 'Veo 高质量', '快马 i2v']}
                onPick={(value) => {
                  if (value === 'Veo 高质量') setModel('veo_standard');
                  else if (value === '快马 i2v') setModel('happyhorse');
                  else setModel('veo_fast');
                }}
              />
              {isImage ? (
                <CreativeSelect
                  label="风格样式"
                  value={imageStyleLabel(style)}
                  options={['Dynamic', 'Lighting', 'Color']}
                  onPick={(value) => setStyle(imageStyleFromLabel(value))}
                />
              ) : (
                <CreativeSegment
                  label="风格样式"
                  value={style}
                  options={[
                    { value: 'auto', label: '默认' },
                    { value: 'realistic', label: '光感' },
                    { value: 'atmospheric', label: '色彩' },
                  ]}
                  onChange={(value) => setStyle(value as VideoStyleOption)}
                  accent={accent}
                />
              )}
              {!isImage && (
                <CreativeSegment
                  label="时长"
                  value={durationSeconds}
                  options={[
                    { value: 6, label: '6s' },
                    { value: 8, label: '8s' },
                  ]}
                  onChange={(value) => setDurationSeconds(value as VideoDuration)}
                  accent={accent}
                  compact
                />
              )}
              <CreativeSegment
                label="比例"
                value={aspectRatio}
                options={CREATIVE_ASPECT_OPTIONS}
                onChange={(value) => setAspectRatio(value as VideoAspect)}
                accent={accent}
                compact
                className="md:col-span-2 2xl:col-span-1"
              />
              {isImage ? (
                <CreativeSegment
                  label="生成数量"
                  value={imageCount}
                  options={[
                    { value: 1, label: '1' },
                    { value: 2, label: '2' },
                    { value: 3, label: '3' },
                    { value: 4, label: '4' },
                  ]}
                  onChange={(value) => setImageCount(Number(value))}
                  accent={accent}
                  compact
                />
              ) : (
                <CreativeSelect
                  label="画质"
                  value={resolution === '1080p' ? '1080p 高清' : '720p 省钱'}
                  options={['1080p 高清', '720p 省钱']}
                  onPick={(value) => setResolution(value.includes('720') ? '720p' : '1080p')}
                />
              )}
            </div>
          </div>

          <div className="relative z-10 mt-5 rounded-[24px] border border-[#EFEFEF] bg-white p-6 shadow-[0_16px_42px_rgba(17,24,39,0.05)]">
            <Textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder={placeholder}
              rows={6}
              className="min-h-[168px] resize-none border-0 bg-transparent p-0 text-[16px] font-semibold leading-7 text-[#111827] placeholder:text-[#DCDDDD] focus-visible:ring-0"
            />
            {attachments.length > 0 ? (
              <div className="mt-5 flex flex-wrap gap-2 border-t border-[#EFEFEF] pt-4">
                {attachments.map((attachment, index) => (
                  <AttachmentChip
                    key={attachment.clientId ?? `${attachment.filename}-${index}`}
                    attachment={attachment}
                    onRemove={() => removeCreativeAttachment(attachment.clientId, index)}
                  />
                ))}
              </div>
            ) : null}
            <div className="mt-5 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3 text-[#ADADAD]">
                <button
                  type="button"
                  title="添加参考图"
                  aria-label="添加参考图"
                  onClick={() => imageInputRef.current?.click()}
                  className="rounded-[8px] p-1.5 hover:bg-[#EFEFEF] hover:text-[#595757]"
                >
                  <ImagePlus className="h-5 w-5" />
                </button>
                <button
                  type="button"
                  title="添加资料文件"
                  aria-label="添加资料文件"
                  onClick={() => fileInputRef.current?.click()}
                  className="rounded-[8px] p-1.5 hover:bg-[#EFEFEF] hover:text-[#595757]"
                >
                  <Paperclip className="h-5 w-5" />
                </button>
                <input
                  ref={imageInputRef}
                  type="file"
                  accept={CREATIVE_ACCEPT_IMAGES}
                  multiple
                  className="hidden"
                  onChange={(event) => {
                    if (event.target.files) void ingestCreativeFiles(event.target.files, true);
                    event.target.value = '';
                  }}
                />
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={CREATIVE_ACCEPT_FILES}
                  multiple
                  className="hidden"
                  onChange={(event) => {
                    if (event.target.files) void ingestCreativeFiles(event.target.files);
                    event.target.value = '';
                  }}
                />
              </div>
              <button
                type="button"
                onClick={() => void handleSubmit()}
                disabled={submitting}
                className={cn(
                  'inline-flex h-[46px] min-h-[46px] items-center gap-2 rounded-full border px-4 py-2 text-[15px] font-semibold text-white shadow-[0_12px_26px_rgba(87,71,156,0.15)] transition-all disabled:cursor-not-allowed disabled:opacity-60',
                  isImage
                    ? 'border-[#42C0EF] bg-[#42C0EF] hover:bg-[#42C0EF]/90'
                    : 'border-[#EA1F59] bg-[#EA1F59] hover:bg-[#EA1F59]/90',
                )}
              >
                {submitting ? '提交中…' : submitLabel}
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/18">
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-5 w-5" />}
                </span>
              </button>
            </div>
          </div>

          {currentTaskPanel ? <div className="relative z-10 mt-6">{currentTaskPanel}</div> : null}
          <CreativeHistory mode={mode} accent={accent} softBg={softBg} refreshKey={historyRefreshKey} />
            </>
          )}
        </div>
      </PageContainer>
    </div>
  );
}

function CreativeTypeTabs({
  value,
  onChange,
  accent,
}: {
  value: VideoTab;
  onChange(tab: VideoTab): void;
  accent: string;
}): JSX.Element {
  return (
    <div className="relative z-10 flex flex-wrap gap-2" role="tablist" aria-label="视频类型">
      {VIDEO_TABS.map((tab) => {
        const Icon = tab.icon;
        const active = tab.id === value;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(tab.id)}
            className={cn(
              'inline-flex h-10 items-center gap-2 rounded-full border px-4 text-[13px] font-semibold transition-colors',
              active
                ? 'bg-white shadow-[0_8px_18px_rgba(17,24,39,0.07)]'
                : 'border-[#DCDDDD] bg-white text-[#595757] hover:border-[#ADADAD] hover:text-[#111827]',
            )}
            style={
              active
                ? { borderColor: `${accent}55`, color: accent }
                : undefined
            }
          >
            <Icon className="h-4 w-4" />
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

function videoModelLabel(model: VideoModel): string {
  if (model === 'veo_standard') return 'Veo 高质量';
  if (model === 'happyhorse') return '快马 i2v';
  return 'Veo Fast';
}

function imageStyleLabel(style: VideoStyleOption): string {
  if (style === 'realistic') return 'Lighting';
  if (style === 'atmospheric') return 'Color';
  return 'Dynamic';
}

function imageStyleFromLabel(label: string): VideoStyleOption {
  if (label === 'Lighting') return 'realistic';
  if (label === 'Color') return 'atmospheric';
  return 'auto';
}

function CreativeSelect({
  label,
  value,
  options,
  onPick,
}: {
  label: string;
  value: string;
  options: readonly string[];
  onPick(value: string): void;
}): JSX.Element {
  return (
    <label className="block">
      <span className="mb-2 block text-[13px] font-semibold text-[#ADADAD]">{label}</span>
      <span className="relative block">
        <select
          value={value === 'auto' ? 'Auto' : value}
          onChange={(event) => onPick(event.target.value)}
          className="h-11 w-full appearance-none rounded-[10px] border border-[#DCDDDD] bg-white px-4 pr-9 text-[14px] font-semibold text-[#111827] outline-none transition-colors hover:border-[#ADADAD] focus:border-[#EA1F59]"
        >
          {options.map((option) => (
            <option key={option}>{option}</option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#595757]" />
      </span>
    </label>
  );
}

function CreativeSegment<T extends string | number>({
  label,
  value,
  options,
  onChange,
  accent,
  compact = false,
  className,
}: {
  label: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange(value: T): void;
  accent: string;
  compact?: boolean;
  className?: string;
}): JSX.Element {
  return (
    <div className={className}>
      <div className="mb-2 text-[13px] font-semibold text-[#ADADAD]">{label}</div>
      <div className="flex h-11 w-full items-center gap-1 overflow-hidden rounded-[10px] bg-[#EFEFEF]/70 p-1">
        {options.map((option) => {
          const active = option.value === value;
          return (
            <button
              key={String(option.value)}
              type="button"
              onClick={() => onChange(option.value)}
              className={cn(
                'flex h-9 min-w-0 flex-1 items-center justify-center whitespace-nowrap rounded-[8px] px-3 text-[14px] font-semibold leading-none transition-colors',
                compact && 'px-3',
                active ? 'bg-white shadow-[0_1px_4px_rgba(15,23,42,0.08)]' : 'text-[#111827] hover:bg-white/60',
              )}
              style={active ? { color: accent } : undefined}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function CreativeHistory({
  mode,
  accent,
  softBg,
  videoType = 'normal',
  refreshKey,
}: {
  mode: CreativeMode;
  accent: string;
  softBg: string;
  videoType?: VideoType;
  refreshKey?: string;
}): JSX.Element {
  const navigate = useNavigate();
  const [rows, setRows] = React.useState<VideoRow[] | null>(null);
  const [filter, setFilter] = React.useState<HistoryFilter>('all');
  const mountedRef = React.useRef(true);

  React.useEffect(() => {
    mountedRef.current = true;
    void trpc.tasks.list.query({ limit: 30 }).then((res) => {
      if (!mountedRef.current) return;
      const mapper = mode === 'image' ? toImageRow : toVideoRow;
      const list = (res?.tasks ?? []).map(mapper).filter((v): v is VideoRow => v != null);
      setRows(list);
    }).catch(() => {
      if (mountedRef.current) setRows([]);
    });
    return () => {
      mountedRef.current = false;
    };
  }, [mode, refreshKey]);

  const visible = React.useMemo(() => {
    if (!rows) return rows;
    const scopedRows = rows.filter((row) => {
      const filename = row.download?.filename ?? '';
      const imageFile = /\.(png|jpe?g|webp)$/i.test(filename);
      return mode === 'image'
        ? imageFile
        : !imageFile && (row.videoType ?? 'normal') === videoType;
    });
    if (filter === 'recent') return scopedRows.filter((row) => isRecentHistoryRow(row.createdAt));
    if (filter === 'favorite') return [];
    return scopedRows;
  }, [filter, mode, rows, videoType]);

  const emptyCopy =
    filter === 'favorite'
      ? `暂无收藏${mode === 'image' ? '图片' : '视频'}作品。`
      : filter === 'recent'
        ? `最近 7 天暂无${mode === 'image' ? '图片' : '视频'}作品。`
        : `暂无${mode === 'image' ? '图片' : '视频'}作品，先在上方创建一个。`;

  return (
    <section className="relative z-10 mt-10 rounded-[28px] border border-[#EFEFEF] bg-white p-5 shadow-[0_16px_40px_rgba(17,24,39,0.04)]">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex items-center gap-2 text-[15px] font-semibold text-[#111827]">
          <span
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: accent }}
            aria-hidden
          />
          历史生成
        </div>
        <div className="flex gap-5 text-[14px] font-semibold">
          {[
            { id: 'all' as const, label: '全部' },
            { id: 'recent' as const, label: '最近' },
            { id: 'favorite' as const, label: '收藏' },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setFilter(tab.id)}
              className={cn('pb-2 text-[#ADADAD] transition-colors hover:text-[#595757]', filter === tab.id && 'border-b-2')}
              style={filter === tab.id ? { color: accent, borderColor: accent } : undefined}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>
      {visible === null ? (
        <div className="flex min-h-[260px] items-center justify-center rounded-[24px] border border-dashed border-[#DCDDDD] bg-white p-8 text-[13px] text-muted-foreground">
          历史加载中…
        </div>
      ) : visible.length === 0 ? (
        <div className="flex min-h-[260px] items-center justify-center rounded-[24px] border border-dashed border-[#DCDDDD] bg-white p-10 text-center text-[13px] text-muted-foreground">
          {emptyCopy}
        </div>
      ) : (
        <div className="space-y-5">
          {visible.slice(0, 4).map((row) => {
            const download = row.download;
            if (!download) return null;
            return (
            <article
              key={row.taskId}
              className="grid gap-5 rounded-[26px] bg-white p-4 shadow-[0_16px_40px_rgba(89,87,87,0.06)] md:grid-cols-[minmax(260px,520px)_1fr]"
            >
              <button
                type="button"
                onClick={() => navigate(`/${mode}?task=${encodeURIComponent(row.taskId)}`)}
                className={cn('relative min-h-[210px] overflow-hidden rounded-[22px] text-left', softBg)}
              >
                {row.posterUrl ? (
                  <LazyPosterImg
                    posterUrl={row.posterUrl}
                    alt={row.title?.trim() || row.intent || '作品缩略图'}
                    className="h-full w-full rounded-[22px] object-cover"
                  />
                ) : (
                  <div className="flex h-full min-h-[210px] items-center justify-center text-[#ADADAD]">
                    {mode === 'image' ? <ImagePlus className="h-10 w-10" /> : <Clapperboard className="h-10 w-10" />}
                  </div>
                )}
              </button>
              <div className="flex min-w-0 flex-col justify-between py-3 pr-3">
                <div>
                  <div className="mb-5 text-right text-[13px] font-semibold text-[#ADADAD]">
                    {formatDateOnly(row.createdAt)}
                  </div>
                  <h2 className="line-clamp-3 text-[15px] font-semibold leading-7 text-[#8B93A6]">
                    {row.title?.trim() || row.intent || (mode === 'image' ? '图片作品' : '视频作品')}
                  </h2>
                  <div className="mt-5 flex flex-wrap gap-2">
                    {mode === 'video' && row.videoType ? (
                      <span className="rounded-full bg-[#EA1F59]/10 px-3 py-1 text-[11px] font-medium text-[#595757]">
                        {videoTypeLabel(row.videoType)}
                      </span>
                    ) : null}
                    {download.filename ? (
                      <span className="rounded-full px-3 py-1 text-[11px] font-medium text-[#595757]" style={{ backgroundColor: `${accent}1A` }}>
                        {fileKindLabel(download.filename)}
                      </span>
                    ) : null}
                  </div>
                </div>
                <div className="mt-5">
                  <FileDownloadCard payload={download} />
                </div>
              </div>
            </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

function CurrentVideoTaskPanel({
  taskId,
  task,
  preferredConfirm = 'video',
}: {
  taskId: string;
  task: UiTask | null;
  preferredConfirm?: 'video' | 'image';
}): JSX.Element {
  const navigate = useNavigate();
  const toast = useToast();
  const refreshTasks = useTaskStore((s) => s.refreshTasks);
  const progress = useTaskStore((s) => s.progressByTask[taskId]);
  const subStatus = useTaskStore((s) => s.subStatusByTask[taskId]?.subStatus);
  const streamingText = useTaskStore((s) => s.streamingByTask[taskId]);
  const awaiting = useTaskStore((s) => s.awaitingUserByTask[taskId]);
  const steps = useTaskStore(selectStepsFor(taskId));
  const abortTask = useTaskStore((s) => s.abortTask);
  const [confirming, setConfirming] = React.useState<string | null>(null);
  const latestStep = steps[steps.length - 1];
  const liveText =
    awaiting?.question ||
    videoSubStatusCopy(subStatus) ||
    progress ||
    streamingText ||
    latestStep?.actionSummary ||
    task?.resultText ||
    '';

  async function confirmVideo(choice: 'confirm_video' | 'confirm_image' | 'cancel'): Promise<void> {
    if (confirming) return;
    setConfirming(choice);
    try {
      const result = await trpc.tasks.confirmVideo.mutate({ taskId, choice });
      await refreshTasks().catch(() => undefined);
      if (choice === 'cancel') {
        toast.show('已取消，未产生费用', 'info', 2000);
      } else {
        toast.show('已确认，开始制作', 'info', 2000);
        navigate(`/video?task=${encodeURIComponent(result.taskId)}`);
      }
    } catch (err) {
      toast.show(err instanceof Error ? err.message : '操作失败，请重试', 'error');
    } finally {
      setConfirming(null);
    }
  }

  async function cancelTask(): Promise<void> {
    if (confirming) return;
    setConfirming('abort');
    try {
      const res = await abortTask(taskId);
      if ('error' in res) {
        toast.show(res.error, 'error');
      } else {
        toast.show('已取消任务', 'info', 2000);
      }
      await refreshTasks().catch(() => undefined);
    } finally {
      setConfirming(null);
    }
  }

  // A2 retry — re-open the form to re-submit. NOTE: a failed 成片 task does NOT
  // persist its original videoOptions (model/style/aspect) or the pet photo
  // fileId, so a one-click "same-params re-burn" isn't reconstructable from the
  // task alone. We send the user back to the form (cleared ?task=) where the
  // 报价卡→确认制作 flow is the inherent spend confirmation (防误点).
  function retryFailed(): void {
    navigate('/video');
  }

  return (
    <Section
      title="当前制作"
      description="报价确认、制作进度和最终文件都留在本页，不需要跳回任务界面。"
      className="mb-6 rounded-[22px] border-[#EFEFEF] bg-white shadow-[0_14px_34px_rgba(17,24,39,0.04)]"
    >
      {!task ? (
        <div className="flex items-center gap-2 py-2 text-[13px] text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          正在同步视频任务…
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <VideoStatusIcon status={task.status} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[14px] font-medium text-foreground">
                  {task.title?.trim() || task.intent || '视频任务'}
                </span>
                <span className="rounded-full border border-[#DCDDDD] bg-white px-2 py-0.5 text-[11px] text-muted-foreground">
                  {videoStatusLabel(task.status)}
                </span>
              </div>
              {liveText && (
                <p className="mt-2 whitespace-pre-wrap text-[13px] leading-relaxed text-[#595757]">
                  {liveText}
                </p>
              )}
              {/* A1 — IP 换口型慢，给等待预期（仅 ip_person 生成中）。 */}
              {task.videoType === 'ip_person' &&
                (task.status === 'executing' || task.status === 'queued') && (
                  <p className="mt-2 flex items-start gap-1.5 text-[12px] leading-relaxed text-[#8A6A00]">
                    <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    {ipRenderingHint(task.intent)}
                  </p>
                )}
            </div>
          </div>

          {task.status === 'awaiting_user' && task.awaitingKind === 'video_quote' && (
            <div className="flex flex-wrap items-center gap-2 rounded-[8px] border border-[#FFC910]/55 bg-white px-3 py-3 text-[12px]">
              <span className="mr-auto text-muted-foreground">确认后才会开始制作并消耗额度。</span>
              <Button
                type="button"
                size="sm"
                onClick={() => void confirmVideo(preferredConfirm === 'image' ? 'confirm_image' : 'confirm_video')}
                disabled={confirming !== null}
              >
                {confirming === 'confirm_video' || confirming === 'confirm_image'
                  ? '提交中…'
                  : preferredConfirm === 'image'
                    ? '确认生成图片'
                    : '确认制作'}
              </Button>
              {/* B2 — 真人换口型没法降级成静图，ip_person 不出「图片版」。 */}
              {preferredConfirm !== 'image' && showImageOption(task.videoType) && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void confirmVideo('confirm_image')}
                  disabled={confirming !== null}
                >
                  {confirming === 'confirm_image' ? '提交中…' : '图片版'}
                </Button>
              )}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void confirmVideo('cancel')}
                disabled={confirming !== null}
              >
                {confirming === 'cancel' ? '取消中…' : '取消'}
              </Button>
            </div>
          )}

          {(task.status === 'queued' || task.status === 'executing' || task.status === 'awaiting_user') &&
            task.awaitingKind !== 'video_quote' && (
              <div className="flex justify-end">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void cancelTask()}
                  disabled={confirming !== null}
                >
                  {confirming === 'abort' ? '取消中…' : '取消任务'}
                </Button>
              </div>
            )}

          {/* A2 — 失败态：透传后端白名单友好 reason（在 task.resultText 里）+ 重试入口。 */}
          {task.status === 'failed' && (
            <div className="rounded-[8px] border border-[#EA1F59]/30 bg-[#EA1F59]/5 px-3 py-3 text-[12px]">
              <div className="text-[13px] font-medium text-[#EA1F59]">生成失败</div>
              <p className="mt-1 whitespace-pre-wrap leading-relaxed text-[#595757]">
                {task.resultText?.trim() || '生成失败，请重试。'}
              </p>
              <div className="mt-2.5">
                <Button type="button" variant="outline" size="sm" onClick={() => retryFailed()}>
                  重新制作
                </Button>
              </div>
            </div>
          )}

          {task.attachments && task.attachments.length > 0 && (
            <div className="space-y-2 border-t border-[#DCDDDD]/70 pt-3">
              <div className="text-[11px] font-medium text-muted-foreground">产出文件</div>
              {task.attachments.map((attachment) => (
                <FileDownloadCard
                  key={attachment.fileId}
                  payload={{
                    fileId: attachment.fileId,
                    filename: attachment.filename,
                    size: attachment.sizeBytes,
                    downloadUrl: attachment.downloadUrl,
                  }}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </Section>
  );
}

function videoSubStatusCopy(subStatus: string | undefined): string {
  switch (subStatus) {
    case 'queued':
      return '已进入制作队列。';
    case 'generating':
      return '正在生成视频…';
    case 'verifying':
      return '正在整理结果…';
    case 'awaiting_user':
      return '等待你确认下一步。';
    default:
      return '';
  }
}

// ---------------------------------------------------------------------------
// 普通视频表单
// ---------------------------------------------------------------------------

const MODEL_OPTIONS: ReadonlyArray<{ value: VideoModel; label: string; hint?: string }> = [
  { value: 'veo_fast', label: 'Veo Fast', hint: '推荐 · 性价比' },
  { value: 'happyhorse', label: '快马 HappyHorse', hint: '自带音效' },
  { value: 'veo_standard', label: 'Veo 高质量', hint: '最贵' },
];
const STYLE_OPTIONS: ReadonlyArray<{ value: VideoStyleOption; label: string }> = [
  { value: 'auto', label: '自动' },
  { value: 'realistic', label: '写实' },
  { value: 'atmospheric', label: '氛围感' },
  { value: 'science', label: '科普清晰' },
];
const ASPECT_OPTIONS: ReadonlyArray<{ value: VideoAspect; label: string }> = [
  { value: '9:16', label: '竖屏 9:16' },
  { value: '3:4', label: '竖屏 3:4' },
  { value: '16:9', label: '横屏 16:9' },
  { value: '4:3', label: '横屏 4:3' },
  { value: '1:1', label: '方形 1:1' },
];
const RES_OPTIONS: ReadonlyArray<{ value: VideoResolution; label: string }> = [
  { value: '1080p', label: '1080P 高清' },
  { value: '720p', label: '720P 省钱' },
];
const DURATION_OPTIONS: ReadonlyArray<{ value: VideoDuration; label: string }> = [
  { value: 8, label: '8 秒/段' },
  { value: 6, label: '6 秒/段' },
];

/** 估算段数(真实段数由后端 optimize 决定,这里仅用于价格预览). */
const SEG_ESTIMATE = 5;
const NB_USD_PER_IMG = 0.067;
const USD_TO_CNY = 7.3;

export function NormalVideoForm({ onTaskCreated }: { onTaskCreated: (taskId: string) => void }): JSX.Element {
  const toast = useToast();
  const createTask = useTaskStore((s) => s.createTask);

  const [prompt, setPrompt] = React.useState('');
  const [model, setModel] = React.useState<VideoModel>('veo_fast');
  const [style, setStyle] = React.useState<VideoStyleOption>('auto');
  const [aspectRatio, setAspectRatio] = React.useState<VideoAspect>('9:16');
  const [resolution, setResolution] = React.useState<VideoResolution>('1080p');
  const [durationSeconds, setDurationSeconds] = React.useState<VideoDuration>(8);
  const [submitting, setSubmitting] = React.useState(false);

  const perSegCny = estimatePerSegmentCny({ model, resolution, durationSeconds });
  const estVideoCny = perSegCny * SEG_ESTIMATE;
  const estImageCny = Math.ceil(SEG_ESTIMATE * NB_USD_PER_IMG * USD_TO_CNY);

  async function handleSubmit(): Promise<void> {
    const intent = prompt.trim();
    if (intent.length < 4) {
      toast.show('请先写一段文案或想法(至少 4 个字)', 'error');
      return;
    }
    if (submitting) return;
    setSubmitting(true);
    const opts: VideoCreationOptions = { tab: 'normal', model, style, aspectRatio, resolution, durationSeconds };
    try {
      const res = await createTask(intent, undefined, undefined, undefined, undefined, undefined, opts);
      if ('error' in res) {
        toast.show(res.error || '提交失败,请重试', 'error');
        return;
      }
      toast.show('已提交,请在本页确认报价后开始制作', 'info', 3500);
      onTaskCreated(res.taskId);
    } catch (err) {
      toast.show(err instanceof Error ? err.message : '提交失败,请重试', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <Section title="文案" description="写你想讲的内容,AI 会忠于原意优化、配画面与配音。">
        <Textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="例如:夏天紫外线很强,出门前 20 分钟涂够量,每两小时补涂一次……"
          rows={5}
          className="resize-y"
        />
        <p className="mt-2 text-[11px] text-muted-foreground">
          仅编排你本人的内容,不模仿/冒充他人。最终成片带 HOLA DAY 水印。
        </p>
      </Section>

      <Section title="参数">
        <div className="space-y-5">
          <SegGroup label="模型" value={model} options={MODEL_OPTIONS} onChange={setModel} />
          <SegGroup label="风格" value={style} options={STYLE_OPTIONS} onChange={setStyle} />
          <SegGroup label="尺寸" value={aspectRatio} options={ASPECT_OPTIONS} onChange={setAspectRatio} />
          <SegGroup label="画质" value={resolution} options={RES_OPTIONS} onChange={setResolution} />
          <SegGroup label="时长" value={durationSeconds} options={DURATION_OPTIONS} onChange={setDurationSeconds} />
        </div>
      </Section>

      <Section title="价格预览" className={CREATIVE_PRICE_SECTION_CLASS}>
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
          <div>
            <span className="text-2xl font-semibold text-[#EA1F59]">约 ¥{estVideoCny}</span>
            <span className="ml-2 text-[13px] text-muted-foreground">
              视频版 · 每段约 ¥{perSegCny} × {SEG_ESTIMATE} 段(估算)
            </span>
          </div>
          <div className="text-[13px] text-muted-foreground">
            图片版约 ¥{estImageCny}(静态图,更省)
          </div>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          按 {SEG_ESTIMATE} 段估算,实际段数由 AI 拆分文案决定;
          <span className="font-medium text-[#595757]"> 提交后会先给精确报价,确认后才扣费。</span>
        </p>
      </Section>

      <div className="flex items-center justify-end gap-3">
        <span className="text-[12px] text-muted-foreground">提交后先报价,不会立即扣费</span>
        <Button type="button" onClick={() => void handleSubmit()} disabled={submitting} className="min-w-[120px]">
          {submitting ? (
            <>
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              提交中…
            </>
          ) : (
            <>
              <Sparkles className="mr-1.5 h-4 w-4" />
              生成视频
            </>
          )}
        </Button>
      </div>

      <VideoHistory videoType="normal" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// 宠物视频 i2v 表单 (Phase 2 第二期)
// ---------------------------------------------------------------------------

const PET_MODEL_OPTIONS: ReadonlyArray<{ value: PetModel; label: string; hint?: string }> = [
  { value: 'wan_i2v', label: '万相 i2v', hint: '推荐 · 省钱' },
  { value: 'happyhorse_i2v', label: '快马 i2v', hint: '高质量 · 偏贵' },
];
const PET_DURATION_OPTIONS: ReadonlyArray<{ value: PetDuration; label: string }> = [
  { value: 5, label: '5 秒' },
  { value: 3, label: '3 秒' },
];

export function PetVideoForm({ onTaskCreated }: { onTaskCreated: (taskId: string) => void }): JSX.Element {
  const toast = useToast();
  const createTask = useTaskStore((s) => s.createTask);

  const [prompt, setPrompt] = React.useState('');
  const [petModel, setPetModel] = React.useState<PetModel>('wan_i2v');
  const [aspectRatio, setAspectRatio] = React.useState<VideoAspect>('9:16');
  const [resolution, setResolution] = React.useState<VideoResolution>('1080p');
  const [durationSeconds, setDurationSeconds] = React.useState<PetDuration>(5);
  const [photo, setPhoto] = React.useState<{ fileId: string; name: string; previewUrl: string } | null>(null);
  const [uploading, setUploading] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement>(null);

  const estCny = estimatePetCny({ petModel, resolution, durationSeconds });

  React.useEffect(() => {
    const url = photo?.previewUrl;
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [photo?.previewUrl]);

  async function handlePick(e: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!/^image\/(png|jpe?g|webp)$/i.test(file.type)) {
      toast.show('请上传 JPG / PNG / WebP 图片', 'error');
      return;
    }
    setUploading(true);
    try {
      const res = await uploadFile(file);
      setPhoto((prev) => {
        if (prev?.previewUrl) URL.revokeObjectURL(prev.previewUrl);
        return { fileId: res.fileId, name: res.filename, previewUrl: URL.createObjectURL(file) };
      });
    } catch (err) {
      toast.show(uploadFailureMessage(err), 'error');
    } finally {
      setUploading(false);
    }
  }

  function removePhoto(): void {
    setPhoto((prev) => {
      if (prev?.previewUrl) URL.revokeObjectURL(prev.previewUrl);
      return null;
    });
  }

  async function handleSubmit(): Promise<void> {
    if (!photo) {
      toast.show('请先上传一张宠物照片', 'error');
      return;
    }
    const intent = prompt.trim();
    if (intent.length < 2) {
      toast.show('请描述要宠物做什么(如:歪头看镜头、眨眨眼)', 'error');
      return;
    }
    if (submitting) return;
    setSubmitting(true);
    const opts: VideoCreationOptions = {
      tab: 'pet',
      petImageFileId: photo.fileId,
      petModel,
      aspectRatio,
      resolution,
      durationSeconds,
    };
    try {
      const res = await createTask(intent, undefined, undefined, undefined, undefined, undefined, opts);
      if ('error' in res) {
        toast.show(res.error || '提交失败,请重试', 'error');
        return;
      }
      toast.show('已提交,请在本页确认报价后开始制作', 'info', 3500);
      onTaskCreated(res.taskId);
    } catch (err) {
      toast.show(err instanceof Error ? err.message : '提交失败,请重试', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <Section
        title="宠物照片"
        description="上传一张清晰的宠物正面照,AI 会让它在画面里自然活动。"
        className={CREATIVE_SECTION_CLASS}
      >
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={(e) => void handlePick(e)}
        />
        {photo ? (
          <div className="flex items-center gap-4">
            <img
              src={photo.previewUrl}
              alt="宠物照片预览"
              className="h-24 w-24 rounded-[18px] border border-[#DCDDDD] object-cover"
            />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] text-foreground">{photo.name}</div>
              <div className="mt-1 flex gap-2">
                <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={uploading}>
                  {uploading ? '上传中…' : '换一张'}
                </Button>
                <button
                  type="button"
                  onClick={removePhoto}
                  className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-[12px] text-muted-foreground hover:text-[#EA1F59]"
                >
                  <X className="h-3.5 w-3.5" />
                  移除
                </button>
              </div>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="flex w-full flex-col items-center justify-center gap-2 rounded-[20px] border border-dashed border-[#DCDDDD] bg-white py-10 text-muted-foreground transition-colors hover:border-[#EA1F59]/40 hover:text-[#EA1F59] disabled:opacity-60"
          >
            {uploading ? <Loader2 className="h-6 w-6 animate-spin" /> : <ImagePlus className="h-6 w-6" />}
            <span className="text-[13px]">{uploading ? '上传中…' : '点击上传宠物照片'}</span>
            <span className="text-[11px] text-muted-foreground">JPG / PNG / WebP</span>
          </button>
        )}
      </Section>

      <Section title="动作描述" description="想让宠物做什么动作或表情。" className={CREATIVE_SECTION_CLASS}>
        <Textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="例如:小猫歪头看镜头、慢慢眨眼,尾巴轻轻摆动"
          rows={3}
          className="min-h-[128px] resize-y rounded-[18px] border-[#EFEFEF] bg-white text-[15px] leading-7"
        />
      </Section>

      <Section title="参数" className={CREATIVE_SECTION_CLASS}>
        <div className="space-y-5">
          <SegGroup label="模型" value={petModel} options={PET_MODEL_OPTIONS} onChange={setPetModel} />
          <SegGroup label="尺寸" value={aspectRatio} options={ASPECT_OPTIONS} onChange={setAspectRatio} />
          <SegGroup label="画质" value={resolution} options={RES_OPTIONS} onChange={setResolution} />
          <SegGroup label="时长" value={durationSeconds} options={PET_DURATION_OPTIONS} onChange={setDurationSeconds} />
        </div>
      </Section>

      <Section title="价格预览" className={CREATIVE_PRICE_SECTION_CLASS}>
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
          <span className="text-2xl font-semibold text-[#EA1F59]">约 ¥{estCny}</span>
          <span className="text-[13px] text-muted-foreground">
            {petModel === 'wan_i2v' ? '万相 i2v' : '快马 i2v'} · {resolution} · {durationSeconds} 秒
          </span>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          单图生成一条短视频,无配音/字幕;
          <span className="font-medium text-[#595757]"> 提交后会先给精确报价,确认后才扣费。</span>
        </p>
      </Section>

      <div className="flex items-center justify-end gap-3">
        <span className="text-[12px] text-muted-foreground">提交后先报价,不会立即扣费</span>
        <Button type="button" onClick={() => void handleSubmit()} disabled={submitting} className="min-w-[120px]">
          {submitting ? (
            <>
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              提交中…
            </>
          ) : (
            <>
              <PawPrint className="mr-1.5 h-4 w-4" />
              生成视频
            </>
          )}
        </Button>
      </div>
    </div>
  );
}

/** 通用分段单选控件(标签 + 一排按钮). */
function SegGroup<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string; hint?: string }>;
  onChange: (v: T) => void;
}): JSX.Element {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
      <div className="w-12 shrink-0 text-[13px] font-semibold text-[#8B93A6]">{label}</div>
      <div className="flex flex-wrap gap-1 rounded-[10px] bg-[#EFEFEF]/70 p-1">
        {options.map((o) => {
          const active = o.value === value;
          return (
            <button
              key={String(o.value)}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(o.value)}
              className={cn(
                'inline-flex min-h-9 items-center justify-center gap-1.5 whitespace-nowrap rounded-[8px] border border-transparent px-3 text-[13px] font-semibold transition-colors',
                active
                  ? 'bg-white text-[#EA1F59] shadow-[0_1px_4px_rgba(15,23,42,0.08)]'
                  : 'text-[#111827] hover:bg-white/60 hover:text-[#EA1F59]',
              )}
            >
              {o.label}
              {o.hint && (
                <span
                  className={cn(
                    'text-[11px]',
                    active ? 'text-[#EA1F59]/70' : 'text-muted-foreground',
                  )}
                >
                  {o.hint}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 生成历史
// ---------------------------------------------------------------------------

// VideoResultMeta / VideoRow / isVideoLane / toVideoRow moved to
// '@/lib/video-history-row' so the "only successful 成片" filter is
// unit-testable. toVideoRow now drops failed / cancelled / awaiting
// (报价 stub) / executing rows — 生成历史 only lists completed 成片.

function VideoHistory({ videoType }: { videoType: VideoType }): JSX.Element {
  return (
    <CreativeHistory
      mode="video"
      accent="#EA1F59"
      softBg="bg-[#EA1F59]/10"
      videoType={videoType}
    />
  );
}

/** Render-only type chip (A5). Legacy 成片 (no videoType) → 「视频」. */
function videoTypeLabel(videoType: VideoType | undefined): string {
  switch (videoType) {
    case 'ip_person':
      return '真人换口型';
    case 'pet':
      return '宠物动画';
    case 'normal':
      return '文本视频';
    default:
      return '视频';
  }
}

function videoStatusLabel(status: string): string {
  switch (status) {
    case 'awaiting_user':
      return '待确认报价';
    case 'executing':
    case 'queued':
      return '生成中';
    case 'completed':
      return '已完成';
    case 'partial_success':
      return '部分完成';
    case 'failed':
      return '失败';
    case 'cancelled':
      return '已取消';
    default:
      return status;
  }
}

function VideoStatusIcon({ status }: { status: string }): JSX.Element {
  const base = 'flex h-7 w-7 shrink-0 items-center justify-center rounded-md border';
  if (status === 'awaiting_user') {
    return (
      <span className={cn(base, 'border-[#FFC910]/55 bg-[#FFC910]/15 text-[#8A6A00]')}>
        <AlertCircle className="h-3.5 w-3.5" />
      </span>
    );
  }
  if (status === 'failed') {
    return (
      <span className={cn(base, 'border-[#EA1F59]/45 bg-[#EA1F59]/10 text-[#EA1F59]')}>
        <XCircle className="h-3.5 w-3.5" />
      </span>
    );
  }
  if (status === 'cancelled') {
    return (
      <span className={cn(base, 'border-[#DCDDDD] bg-[#EFEFEF]/45 text-muted-foreground')}>
        <CircleSlash className="h-3.5 w-3.5" />
      </span>
    );
  }
  if (status === 'completed' || status === 'partial_success') {
    return (
      <span className={cn(base, 'border-[#DCDDDD] bg-white text-[#EA1F59]')}>
        <CheckCircle2 className="h-3.5 w-3.5" />
      </span>
    );
  }
  return (
    <span className={cn(base, 'border-[#DCDDDD] bg-white text-[#595757]')}>
      <Clock className="h-3.5 w-3.5" />
    </span>
  );
}

function formatDateOnly(value: string | number | Date): string {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const yyyy = d.getFullYear();
  const mm = `${d.getMonth() + 1}`.padStart(2, '0');
  const dd = `${d.getDate()}`.padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function isRecentHistoryRow(value: string | number | Date): boolean {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return false;
  return Date.now() - d.getTime() <= 7 * 24 * 60 * 60 * 1000;
}

function fileKindLabel(filename: string): string {
  const match = filename.match(/\.([a-z0-9]+)$/i);
  if (!match) return '产物文件';
  return `${match[1].toUpperCase()} 文件`;
}

// ---------------------------------------------------------------------------
// IP 人物换口型 — onboarding 向导 (Phase 2 第三期 阶段2)
// 三步:本人授权 → 传声音(克隆)→ 传出镜底版。素材就绪后才能生成(生成留阶段3)。
// ---------------------------------------------------------------------------

interface OnboardingStatus {
  hasVoice: boolean;
  hasBaseVideo: boolean;
  authorized: boolean;
}

export function IpOnboardingWizard({ onTaskCreated }: { onTaskCreated: (taskId: string) => void }): JSX.Element {
  const toast = useToast();
  const [status, setStatus] = React.useState<OnboardingStatus | null>(null);
  const [loadError, setLoadError] = React.useState(false);
  const [consent, setConsent] = React.useState(false);
  const [authorizing, setAuthorizing] = React.useState(false);
  const [uploadingVoice, setUploadingVoice] = React.useState(false);
  const [uploadingVideo, setUploadingVideo] = React.useState(false);
  const [clearing, setClearing] = React.useState(false);
  const voiceRef = React.useRef<HTMLInputElement>(null);
  const videoRef = React.useRef<HTMLInputElement>(null);
  const mountedRef = React.useRef(true);

  const load = React.useCallback(async () => {
    setLoadError(false);
    try {
      const s = await trpc.videoOnboarding.status.query();
      if (!mountedRef.current) return;
      setStatus({ hasVoice: s.hasVoice, hasBaseVideo: s.hasBaseVideo, authorized: s.authorized });
    } catch {
      if (!mountedRef.current) return;
      setLoadError(true);
    }
  }, []);

  React.useEffect(() => {
    mountedRef.current = true;
    void load();
    return () => {
      mountedRef.current = false;
    };
  }, [load]);

  async function handleAuthorize(): Promise<void> {
    if (!consent || authorizing) return;
    setAuthorizing(true);
    try {
      await trpc.videoOnboarding.authorize.mutate();
      await load();
      toast.show('已签署本人授权声明', 'info', 2000);
    } catch (err) {
      toast.show(err instanceof Error ? err.message : '提交失败,请重试', 'error');
    } finally {
      setAuthorizing(false);
    }
  }

  async function handleVoice(e: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!/\.(wav|mp3|m4a)$/i.test(file.name) && !/^audio\/(wav|mpeg|mp4|x-m4a)$/i.test(file.type)) {
      toast.show('声音样本请用 WAV / MP3 / M4A', 'error');
      return;
    }
    setUploadingVoice(true);
    try {
      const up = await uploadMediaFile(file);
      await trpc.videoOnboarding.enrollVoice.mutate({ audioFileId: up.fileId });
      await load();
      toast.show('声音已就绪', 'info', 2000);
    } catch (err) {
      toast.show(uploadFailureMessage(err), 'error');
    } finally {
      setUploadingVoice(false);
    }
  }

  async function handleVideo(e: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!/\.(mp4|mov)$/i.test(file.name) && !/^video\/(mp4|quicktime)$/i.test(file.type)) {
      toast.show('出镜底版请用 MP4 / MOV', 'error');
      return;
    }
    setUploadingVideo(true);
    try {
      const up = await uploadMediaFile(file);
      await trpc.videoOnboarding.setBaseVideo.mutate({ videoFileId: up.fileId });
      await load();
      toast.show('底版已就绪', 'info', 2000);
    } catch (err) {
      toast.show(uploadFailureMessage(err), 'error');
    } finally {
      setUploadingVideo(false);
    }
  }

  async function handleClear(): Promise<void> {
    if (clearing) return;
    setClearing(true);
    try {
      await trpc.videoOnboarding.deleteAssets.mutate();
      setConsent(false);
      await load();
      toast.show('已清除全部 IP 素材', 'info', 2000);
    } catch (err) {
      toast.show(err instanceof Error ? err.message : '清除失败,请重试', 'error');
    } finally {
      setClearing(false);
    }
  }

  if (status === null) {
    return (
      <Section className={CREATIVE_SECTION_CLASS}>
        {loadError ? (
          <div className="flex flex-col items-start gap-2 py-4 text-[13px] text-muted-foreground">
            <span>加载失败,请稍后重试</span>
            <Button variant="outline" size="sm" onClick={() => void load()}>
              重试
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-2 py-6 text-[13px] text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            加载中…
          </div>
        )}
      </Section>
    );
  }

  const ready = status.authorized && status.hasVoice && status.hasBaseVideo;
  const anyAsset = status.authorized || status.hasVoice || status.hasBaseVideo;

  return (
    <div className="space-y-6">
      <input ref={voiceRef} type="file" accept=".wav,.mp3,.m4a,audio/wav,audio/mpeg,audio/mp4" className="hidden" onChange={(e) => void handleVoice(e)} />
      <input ref={videoRef} type="file" accept=".mp4,.mov,video/mp4,video/quicktime" className="hidden" onChange={(e) => void handleVideo(e)} />

      <Section
        title="开通「IP 人物换口型」"
        description="用你本人的声音 + 出镜底版,把文案讲出来。先完成三步素材准备。"
        className={CREATIVE_SECTION_CLASS}
      >
        <div className="space-y-4">
          {/* Step 1 — 授权 */}
          <WizardStep
            index={1}
            done={status.authorized}
            icon={ShieldCheck}
            title="本人授权声明"
            locked={false}
          >
            {status.authorized ? (
              <div className="text-[13px] text-muted-foreground">已签署 —— 仅用于你本人、可随时删除。</div>
            ) : (
              <div className="space-y-3">
                <label className="flex cursor-pointer items-start gap-2 text-[13px] text-foreground">
                  <input
                    type="checkbox"
                    checked={consent}
                    onChange={(e) => setConsent(e.target.checked)}
                    className="mt-0.5 h-4 w-4 accent-[#EA1F59]"
                  />
                  <span>我确认:上传的声音与出镜视频<strong>均为本人</strong>,仅用于生成<strong>本人</strong>的视频,且我可随时删除这些素材。</span>
                </label>
                <Button type="button" size="sm" onClick={() => void handleAuthorize()} disabled={!consent || authorizing}>
                  {authorizing ? '提交中…' : '同意并继续'}
                </Button>
              </div>
            )}
          </WizardStep>

          {/* Step 2 — 声音 */}
          <WizardStep
            index={2}
            done={status.hasVoice}
            icon={Mic}
            title="本人声音(克隆)"
            locked={!status.authorized}
          >
            <div className="space-y-2">
              {status.hasVoice ? (
                <div className="flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground">
                  <span>声音已就绪 ✓</span>
                  <Button variant="outline" size="sm" onClick={() => voiceRef.current?.click()} disabled={uploadingVoice}>
                    {uploadingVoice ? '上传中…' : '重新上传'}
                  </Button>
                </div>
              ) : (
                <Button type="button" size="sm" onClick={() => voiceRef.current?.click()} disabled={!status.authorized || uploadingVoice}>
                  {uploadingVoice ? (
                    <>
                      <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                      上传并克隆…
                    </>
                  ) : (
                    '上传声音样本'
                  )}
                </Button>
              )}
              <p className="text-[11px] text-muted-foreground">
                WAV / MP3 / M4A,10-20 秒清晰人声(安静环境、连续说话);用完即弃,只保留声纹。
              </p>
            </div>
          </WizardStep>

          {/* Step 3 — 底版 */}
          <WizardStep
            index={3}
            done={status.hasBaseVideo}
            icon={VideoIcon}
            title="本人出镜底版"
            locked={!status.authorized}
          >
            <div className="space-y-2">
              {status.hasBaseVideo ? (
                <div className="flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground">
                  <span>底版已就绪 ✓</span>
                  <Button variant="outline" size="sm" onClick={() => videoRef.current?.click()} disabled={uploadingVideo}>
                    {uploadingVideo ? '上传中…' : '重新上传'}
                  </Button>
                </div>
              ) : (
                <Button type="button" size="sm" onClick={() => videoRef.current?.click()} disabled={!status.authorized || uploadingVideo}>
                  {uploadingVideo ? (
                    <>
                      <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                      上传中…
                    </>
                  ) : (
                    '上传出镜视频'
                  )}
                </Button>
              )}
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                MP4 / MOV,10-60 秒竖屏口播。<span className="font-medium text-[#595757]">为保证换口型质量:正脸面对镜头、光线均匀打亮脸部、画面只有你一人、对焦清晰、安静环境、嘴部不被遮挡。</span>侧脸/逆光/模糊会明显变差。
              </p>
            </div>
          </WizardStep>
        </div>
      </Section>

      {/* 就绪 → 生成表单;未就绪 → 引导 */}
      {ready ? (
        <IpGenerateForm onTaskCreated={onTaskCreated} />
      ) : (
        <Section className={CREATIVE_SECTION_CLASS}>
          <div className="flex items-center justify-between gap-3">
            <span className="text-[13px] text-muted-foreground">完成上面三步,即可解锁「IP 人物」视频生成。</span>
            <Button type="button" disabled className="min-w-[140px]">
              <Lock className="mr-1.5 h-4 w-4" />
              生成(未就绪)
            </Button>
          </div>
        </Section>
      )}

      {/* 隐私 + 清除 */}
      <Section title="隐私与素材管理" className={CREATIVE_SECTION_CLASS}>
        <ul className="mb-3 space-y-1 text-[12px] leading-relaxed text-muted-foreground">
          <li>· 声音样本在克隆出声纹后<span className="font-medium text-[#595757]">即刻删除</span>,我们只保留声纹用于合成。</li>
          <li>· 出镜底版加密存储、仅用于你本人的视频,可随时删除/重传。</li>
          <li>· 一键清除会删掉云端声纹 + 出镜底版 + 授权记录。</li>
        </ul>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void handleClear()}
          disabled={!anyAsset || clearing}
          className="border-[#DCDDDD] text-[#595757] hover:border-[#EA1F59]/40 hover:text-[#EA1F59]"
        >
          {clearing ? (
            <>
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              清除中…
            </>
          ) : (
            <>
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              清除全部 IP 素材
            </>
          )}
        </Button>
      </Section>
    </div>
  );
}

function IpGenerateForm({ onTaskCreated }: { onTaskCreated: (taskId: string) => void }): JSX.Element {
  const toast = useToast();
  const createTask = useTaskStore((s) => s.createTask);
  const [copy, setCopy] = React.useState('');
  const [aspectRatio, setAspectRatio] = React.useState<VideoAspect>('9:16');
  const [submitting, setSubmitting] = React.useState(false);
  // ① 合规闸 — per-generate 授权确认。与 onboarding 的一次性 consent 双保险:
  // 每次生成都要重新勾(默认 false),不勾禁止提交。
  const [consent, setConsent] = React.useState(false);

  const est = estimateIpVideo(copy);

  async function handleSubmit(): Promise<void> {
    const intent = copy.trim();
    if (intent.length < 4) {
      toast.show('请先写一段要口播的文案(至少 4 个字)', 'error');
      return;
    }
    if (!consent) {
      toast.show('请先勾选「本人肖像、已获授权」确认', 'error');
      return;
    }
    if (submitting) return;
    setSubmitting(true);
    const opts: VideoCreationOptions = { tab: 'ip_person', aspectRatio };
    try {
      const res = await createTask(intent, undefined, undefined, undefined, undefined, undefined, opts);
      if ('error' in res) {
        toast.show(res.error || '提交失败,请重试', 'error');
        return;
      }
      toast.show('已提交,请在本页确认报价后开始制作', 'info', 3500);
      onTaskCreated(res.taskId);
    } catch (err) {
      toast.show(err instanceof Error ? err.message : '提交失败,请重试', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
    <Section
      title="生成视频"
      description="素材已就绪 —— 用你本人的声音 + 出镜底版,把文案口播出来。"
      className={CREATIVE_SECTION_CLASS}
    >
      <div className="space-y-5">
        <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
          <CheckCircle2 className="h-4 w-4 text-[#EA1F59]" />
          使用你已上传的本人声音 + 出镜底版(可在上方重传/清除)。
        </div>
        <Textarea
          value={copy}
          onChange={(e) => setCopy(e.target.value)}
          placeholder="写你要口播的文案,会用你本人的声音讲出来(单条 ≤40 秒,约 160 字内)。"
          rows={4}
          className="min-h-[150px] resize-y rounded-[18px] border-[#EFEFEF] bg-white text-[15px] leading-7"
        />
        <SegGroup label="尺寸" value={aspectRatio} options={ASPECT_OPTIONS} onChange={setAspectRatio} />
        <div className="rounded-[18px] border border-[#EFEFEF] bg-white px-4 py-3">
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <span className="text-xl font-semibold text-[#EA1F59]">约 ¥{est.videoCny}</span>
            <span className="text-[13px] text-muted-foreground">真人换口型 · 单条 ≤40 秒(约 {est.chars} 字)</span>
          </div>
          {est.maybeTooLong && (
            <p className="mt-1 text-[11px] text-[#B45309]">⚠️ 文案偏长,可能超过 40 秒上限;过长会被拒,请适当截短。</p>
          )}
          <p className="mt-1 text-[11px] text-muted-foreground">提交后会先给精确报价,确认后才扣费。</p>
        </div>
        {/* ① per-generate 授权确认 + ② 条款链接(复用现有 /terms /privacy)。 */}
        <label className="flex cursor-pointer items-start gap-2 text-[12px] leading-relaxed text-foreground">
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 accent-[#EA1F59]"
          />
          <span>
            我承诺:口播所用的声音与出镜底版<strong>均为本人</strong>、已获授权;勾选即表示同意
            <Link to="/terms" target="_blank" className="text-[#EA1F59] underline">
              《服务条款》
            </Link>
            与
            <Link to="/privacy" target="_blank" className="text-[#EA1F59] underline">
              《隐私政策》
            </Link>
            。
          </span>
        </label>
        <div className="flex items-center justify-end gap-3">
          <span className="text-[12px] text-muted-foreground">提交后先报价,不会立即扣费</span>
          <Button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={submitting || !consent}
            className="min-w-[120px]"
          >
            {submitting ? (
              <>
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                提交中…
              </>
            ) : (
              <>
                <Sparkles className="mr-1.5 h-4 w-4" />
                生成视频
              </>
            )}
          </Button>
        </div>
      </div>
    </Section>
    </div>
  );
}

function WizardStep({
  index,
  done,
  locked,
  icon: Icon,
  title,
  children,
}: {
  index: number;
  done: boolean;
  locked: boolean;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div className={cn('flex gap-3 rounded-[18px] border bg-white p-4', done ? 'border-[#EA1F59]/30' : 'border-[#DCDDDD]', locked && 'opacity-60')}>
      <span
        className={cn(
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[13px] font-medium',
          done ? 'bg-[#EA1F59] text-white' : 'bg-[#EFEFEF] text-[#595757]',
        )}
      >
        {done ? <Check className="h-4 w-4" /> : index}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-[14px] font-medium text-foreground">
          <Icon className="h-4 w-4 text-[#EA1F59]" />
          {title}
          {locked && <Lock className="h-3 w-3 text-muted-foreground" />}
        </div>
        <div className="mt-2">{children}</div>
      </div>
    </div>
  );
}

export default VideoPage;
