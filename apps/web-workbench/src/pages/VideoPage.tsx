import {
  AlertCircle,
  CheckCircle2,
  CircleSlash,
  Clapperboard,
  Clock,
  Download,
  Film,
  ImagePlus,
  Loader2,
  PawPrint,
  Sparkles,
  UserRound,
  X,
  XCircle,
} from 'lucide-react';
import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';
import { trpc } from '@/lib/trpc';
import { uploadFailureMessage, uploadFile } from '@/lib/upload-file';
import { cn } from '@/lib/utils';
import { PageContainer, PageHeader, Section } from '@/pages/PageShell';
import { useTaskStore } from '@/stores/task-store';
import {
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
 * 三类型 tab:普通(图文配音,本期可用)/ IP 人物换口型 / 宠物动起来
 * (后两者占位禁用,「即将上线」)。普通走既有两段式:提交 = tasks.create
 * (videoOptions 透传)→ awaiting_user video_quote 报价卡 → confirmVideo
 * 确认后才烧。本页只采集参数 + 实时估价 + 列历史,不直接计费。
 */

type VideoTab = 'normal' | 'ip' | 'pet';

const TABS: ReadonlyArray<{
  id: VideoTab;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  enabled: boolean;
}> = [
  { id: 'normal', label: '普通视频', icon: Film, enabled: true },
  { id: 'pet', label: '宠物动起来', icon: PawPrint, enabled: true },
  { id: 'ip', label: 'IP 人物换口型', icon: UserRound, enabled: false },
];

export function VideoPage(): JSX.Element {
  const [tab, setTab] = React.useState<VideoTab>('normal');
  return (
    <PageContainer width="form">
      <PageHeader
        title="视频任务"
        description="把一段文案变成竖屏短视频:AI 配画面 + 配音 + 字幕。先报价、确认后才生成。"
      />
      <div className="mb-6 flex flex-wrap gap-2" role="tablist" aria-label="视频类型">
        {TABS.map((t) => {
          const active = tab === t.id;
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={active}
              disabled={!t.enabled}
              onClick={() => t.enabled && setTab(t.id)}
              className={cn(
                'inline-flex items-center gap-2 rounded-full border px-4 py-2 text-[13px] font-medium transition-colors',
                active
                  ? 'border-[#EA1F59]/30 bg-[#EA1F59]/10 text-[#EA1F59]'
                  : 'border-[#DCDDDD] bg-white text-[#595757] hover:border-[#ADADAD] hover:text-[#EA1F59]',
                !t.enabled && 'cursor-not-allowed opacity-55 hover:border-[#DCDDDD] hover:text-[#595757]',
              )}
            >
              <Icon className="h-4 w-4" />
              {t.label}
              {!t.enabled && (
                <span className="rounded-full bg-[#EFEFEF] px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                  即将上线
                </span>
              )}
            </button>
          );
        })}
      </div>
      {tab === 'normal' ? (
        <NormalVideoForm />
      ) : tab === 'pet' ? (
        <PetVideoForm />
      ) : (
        <ComingSoon tab={tab} />
      )}
    </PageContainer>
  );
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
  { value: '16:9', label: '横屏 16:9' },
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

function NormalVideoForm(): JSX.Element {
  const navigate = useNavigate();
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
    const opts: VideoCreationOptions = { model, style, aspectRatio, resolution, durationSeconds };
    try {
      const res = await createTask(intent, undefined, undefined, undefined, undefined, undefined, opts);
      if ('error' in res) {
        toast.show(res.error || '提交失败,请重试', 'error');
        return;
      }
      toast.show('已提交,请在对话区确认报价后开始制作', 'info', 3500);
      // createTask 已选中新任务;显式导航到对话区,报价卡(video_quote)在那里确认。
      navigate(`/?task=${encodeURIComponent(res.taskId)}`);
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

      <Section title="价格预览" className="border-[#EA1F59]/20 bg-[#EA1F59]/[0.03]">
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

      <VideoHistory />
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

function PetVideoForm(): JSX.Element {
  const navigate = useNavigate();
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
      toast.show('已提交,请在对话区确认报价后开始制作', 'info', 3500);
      navigate(`/?task=${encodeURIComponent(res.taskId)}`);
    } catch (err) {
      toast.show(err instanceof Error ? err.message : '提交失败,请重试', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <Section title="宠物照片" description="上传一张清晰的宠物正面照,AI 会让它在画面里自然活动。">
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
              className="h-24 w-24 rounded-lg border border-[#DCDDDD] object-cover"
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
            className="flex w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-[#DCDDDD] py-10 text-muted-foreground transition-colors hover:border-[#EA1F59]/40 hover:text-[#EA1F59] disabled:opacity-60"
          >
            {uploading ? <Loader2 className="h-6 w-6 animate-spin" /> : <ImagePlus className="h-6 w-6" />}
            <span className="text-[13px]">{uploading ? '上传中…' : '点击上传宠物照片'}</span>
            <span className="text-[11px] text-muted-foreground">JPG / PNG / WebP</span>
          </button>
        )}
      </Section>

      <Section title="动作描述" description="想让宠物做什么动作或表情。">
        <Textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="例如:小猫歪头看镜头、慢慢眨眼,尾巴轻轻摆动"
          rows={3}
          className="resize-y"
        />
      </Section>

      <Section title="参数">
        <div className="space-y-5">
          <SegGroup label="模型" value={petModel} options={PET_MODEL_OPTIONS} onChange={setPetModel} />
          <SegGroup label="尺寸" value={aspectRatio} options={ASPECT_OPTIONS} onChange={setAspectRatio} />
          <SegGroup label="画质" value={resolution} options={RES_OPTIONS} onChange={setResolution} />
          <SegGroup label="时长" value={durationSeconds} options={PET_DURATION_OPTIONS} onChange={setDurationSeconds} />
        </div>
      </Section>

      <Section title="价格预览" className="border-[#EA1F59]/20 bg-[#EA1F59]/[0.03]">
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

      <VideoHistory />
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
      <div className="w-12 shrink-0 text-[13px] font-medium text-[#595757]">{label}</div>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => {
          const active = o.value === value;
          return (
            <button
              key={String(o.value)}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(o.value)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[13px] transition-colors',
                active
                  ? 'border-[#EA1F59]/40 bg-[#EA1F59]/10 text-[#EA1F59]'
                  : 'border-[#DCDDDD] bg-white text-[#595757] hover:border-[#ADADAD] hover:text-[#EA1F59]',
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

interface VideoResultMeta {
  lane?: string;
  visualMode?: string;
  attachments?: ReadonlyArray<{ downloadUrl?: string; filename?: string }>;
}
interface VideoRow {
  taskId: string;
  intent: string;
  title: string | null;
  status: string;
  createdAt: string | number | Date;
  download?: { url: string; filename: string };
}

function isVideoLane(lane: string | undefined): boolean {
  return typeof lane === 'string' && lane.startsWith('video_creation');
}

function toVideoRow(raw: unknown): VideoRow | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as {
    taskId?: string;
    intent?: string;
    title?: string | null;
    status?: string;
    createdAt?: string | number | Date;
    result?: { metadata?: VideoResultMeta } | null;
  };
  const meta = r.result?.metadata;
  if (!isVideoLane(meta?.lane)) return null;
  if (!r.taskId || !r.status) return null;
  const att = meta?.attachments?.find((a) => a.downloadUrl);
  return {
    taskId: r.taskId,
    intent: r.intent ?? '',
    title: r.title ?? null,
    status: r.status,
    createdAt: r.createdAt ?? Date.now(),
    ...(att?.downloadUrl ? { download: { url: att.downloadUrl, filename: att.filename ?? 'video.mp4' } } : {}),
  };
}

function VideoHistory(): JSX.Element {
  const navigate = useNavigate();
  const [rows, setRows] = React.useState<VideoRow[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const mountedRef = React.useRef(true);

  const load = React.useCallback(async () => {
    setError(null);
    try {
      const res = await trpc.tasks.list.query({ limit: 50 });
      if (!mountedRef.current) return;
      const list = (res?.tasks ?? []).map(toVideoRow).filter((v): v is VideoRow => v != null);
      setRows(list);
    } catch {
      if (!mountedRef.current) return;
      setError('历史加载失败,请稍后重试');
      setRows([]);
    }
  }, []);

  React.useEffect(() => {
    mountedRef.current = true;
    void load();
    return () => {
      mountedRef.current = false;
    };
  }, [load]);

  return (
    <Section title="生成历史" description="你提交过的视频任务">
      {rows === null ? (
        <div className="flex items-center gap-2 py-6 text-[13px] text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          加载中…
        </div>
      ) : error ? (
        <div className="flex flex-col items-start gap-2 py-4 text-[13px] text-muted-foreground">
          <span>{error}</span>
          <Button variant="outline" size="sm" onClick={() => void load()}>
            重试
          </Button>
        </div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-10 text-center">
          <Clapperboard className="h-8 w-8 text-muted-foreground/40" />
          <div className="text-[13px] font-medium text-foreground/80">还没有视频任务</div>
          <div className="text-[12px] text-muted-foreground">在上方写文案、选参数,点「生成视频」开始。</div>
        </div>
      ) : (
        <div className="divide-y divide-[#EFEFEF]">
          {rows.map((t) => (
            <div key={t.taskId} className="group flex items-center gap-3 py-3">
              <VideoStatusIcon status={t.status} />
              <button
                type="button"
                onClick={() => navigate(`/?task=${encodeURIComponent(t.taskId)}`)}
                className="min-w-0 flex-1 text-left"
              >
                <div className="truncate text-[13px] text-foreground group-hover:text-[#EA1F59]">
                  {t.title?.trim() || t.intent || '视频任务'}
                </div>
                <div className="mt-0.5 text-[11px] text-muted-foreground">
                  {videoStatusLabel(t.status)} · {formatTime(t.createdAt)}
                </div>
              </button>
              {t.download && (
                <a
                  href={t.download.url}
                  download={t.download.filename}
                  onClick={(e) => e.stopPropagation()}
                  className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[#DCDDDD] bg-white px-2.5 text-[12px] text-[#595757] transition-colors hover:border-[#ADADAD] hover:text-[#EA1F59]"
                >
                  <Download className="h-3.5 w-3.5" />
                  下载
                </a>
              )}
            </div>
          ))}
        </div>
      )}
    </Section>
  );
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

function formatTime(value: string | number | Date): string {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const mm = `${d.getMonth() + 1}`.padStart(2, '0');
  const dd = `${d.getDate()}`.padStart(2, '0');
  const hh = `${d.getHours()}`.padStart(2, '0');
  const mi = `${d.getMinutes()}`.padStart(2, '0');
  return `${mm}-${dd} ${hh}:${mi}`;
}

// ---------------------------------------------------------------------------
// 占位:IP 人物 / 宠物
// ---------------------------------------------------------------------------

function ComingSoon({ tab }: { tab: VideoTab }): JSX.Element {
  const copy =
    tab === 'ip'
      ? {
          icon: UserRound,
          title: 'IP 人物换口型',
          desc: '上传你的出镜底版,用你本人的声音 + 口型,把文案讲出来。正在接入,敬请期待。',
        }
      : {
          icon: PawPrint,
          title: '宠物动起来',
          desc: '上传一张宠物照片,让它在画面里自然活动。正在接入,敬请期待。',
        };
  const Icon = copy.icon;
  return (
    <Section>
      <div className="flex flex-col items-center gap-3 py-12 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#EA1F59]/10 text-[#EA1F59]">
          <Icon className="h-6 w-6" />
        </span>
        <div className="text-base font-semibold text-foreground">{copy.title}</div>
        <p className="max-w-sm text-[13px] leading-relaxed text-muted-foreground">{copy.desc}</p>
        <span className="rounded-full bg-[#EFEFEF] px-3 py-1 text-[12px] font-medium text-muted-foreground">
          即将上线
        </span>
      </div>
    </Section>
  );
}

export default VideoPage;
