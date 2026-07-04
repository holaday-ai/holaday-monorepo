import {
  Image as ImageIcon,
  ImagePlus,
  Loader2,
  Paperclip,
  Sparkles,
  X,
} from 'lucide-react';
import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { FileDownloadCard } from '@/components/FileDownloadCard';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';
import { toImageHistoryRow, type ImageHistoryRow } from '@/lib/image-history-row';
import { uploadFailureMessage, uploadFile } from '@/lib/upload-file';
import { cn } from '@/lib/utils';
import { PageContainer, Section } from '@/pages/PageShell';
import { useTaskStore } from '@/stores/task-store';

type ReferenceImage = {
  fileId: string;
  name: string;
  previewUrl: string;
};

type ImageModel = 'auto' | 'quality' | 'fast';
type ImageStyle = 'dynamic' | 'realistic' | 'poster' | 'minimal';
type ImageAspect = '2:3' | '1:1' | '16:9';
type ImageCount = 1 | 2 | 3 | 4;

const IMAGE_MODEL_OPTIONS: ReadonlyArray<{ value: ImageModel; label: string }> = [
  { value: 'auto', label: 'Auto' },
  { value: 'quality', label: 'High Quality' },
  { value: 'fast', label: 'Fast' },
];
const IMAGE_STYLE_OPTIONS: ReadonlyArray<{ value: ImageStyle; label: string }> = [
  { value: 'dynamic', label: 'Dynamic' },
  { value: 'realistic', label: 'Realistic' },
  { value: 'poster', label: 'Poster' },
  { value: 'minimal', label: 'Minimal' },
];
const IMAGE_ASPECT_OPTIONS: ReadonlyArray<{ value: ImageAspect; label: string }> = [
  { value: '2:3', label: '2:3' },
  { value: '1:1', label: '1:1' },
  { value: '16:9', label: '16:9' },
];
const IMAGE_COUNT_OPTIONS: ReadonlyArray<{ value: ImageCount; label: string }> = [
  { value: 1, label: '1' },
  { value: 2, label: '2' },
  { value: 3, label: '3' },
  { value: 4, label: '4' },
];

export function ImagePage(): JSX.Element {
  const navigate = useNavigate();
  const toast = useToast();
  const createTask = useTaskStore((s) => s.createTask);
  const refreshTasks = useTaskStore((s) => s.refreshTasks);
  const tasks = useTaskStore((s) => s.tasks);
  const [prompt, setPrompt] = React.useState('');
  const [model, setModel] = React.useState<ImageModel>('auto');
  const [style, setStyle] = React.useState<ImageStyle>('dynamic');
  const [aspect, setAspect] = React.useState<ImageAspect>('1:1');
  const [count, setCount] = React.useState<ImageCount>(2);
  const [reference, setReference] = React.useState<ReferenceImage | null>(null);
  const [uploading, setUploading] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    void refreshTasks();
  }, [refreshTasks]);

  React.useEffect(() => {
    const url = reference?.previewUrl;
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [reference?.previewUrl]);

  const imageRows = React.useMemo(
    () =>
      tasks
        .map(toImageHistoryRow)
        .filter((row): row is ImageHistoryRow => row !== null),
    [tasks],
  );

  async function handlePick(event: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!/^image\/(png|jpe?g|webp)$/i.test(file.type)) {
      toast.show('请上传 JPG / PNG / WebP 图片', 'error');
      return;
    }
    setUploading(true);
    try {
      const uploaded = await uploadFile(file);
      setReference((prev) => {
        if (prev?.previewUrl) URL.revokeObjectURL(prev.previewUrl);
        return {
          fileId: uploaded.fileId,
          name: uploaded.filename,
          previewUrl: URL.createObjectURL(file),
        };
      });
    } catch (err) {
      toast.show(uploadFailureMessage(err), 'error');
    } finally {
      setUploading(false);
    }
  }

  function removeReference(): void {
    setReference((prev) => {
      if (prev?.previewUrl) URL.revokeObjectURL(prev.previewUrl);
      return null;
    });
  }

  async function handleSubmit(): Promise<void> {
    const trimmed = prompt.trim();
    if (trimmed.length < 4) {
      toast.show('请先描述你想生成的图片，至少 4 个字', 'error');
      return;
    }
    if (submitting || uploading) return;
    setSubmitting(true);
    try {
      const intent = reference
        ? `基于上传的参考图片进行图生图或图片编辑：${trimmed}。图片设置：模型 ${imageModelLabel(model)}，风格 ${imageStyleLabel(style)}，比例 ${aspect}，生成 ${count} 张。`
        : `生成一张图片：${trimmed}。图片设置：模型 ${imageModelLabel(model)}，风格 ${imageStyleLabel(style)}，比例 ${aspect}，生成 ${count} 张。`;
      const result = await createTask(intent, reference ? [reference.fileId] : undefined);
      if ('error' in result) {
        toast.show(result.error || '提交失败，请重试', 'error');
        return;
      }
      toast.show('图片任务已提交', 'info', 2500);
      navigate(`/?task=${encodeURIComponent(result.taskId)}`);
    } catch (err) {
      toast.show(err instanceof Error ? err.message : '提交失败，请重试', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <PageContainer width="wide" className="max-w-none px-0 py-0">
      <ImageHero />

      <div className="mx-auto -mt-7 w-full max-w-[1080px] space-y-5 px-6">
        <Section className="relative z-10 rounded-[20px] border-transparent bg-white px-6 py-5 shadow-[0_16px_38px_rgba(89,87,87,0.08)]">
          <div className="grid gap-5 lg:grid-cols-[180px_180px_300px_260px] lg:items-end">
            <ImageOptionSelect<ImageModel> label="AI 模型" value={model} options={IMAGE_MODEL_OPTIONS} onChange={setModel} />
            <ImageOptionSelect<ImageStyle> label="风格样式" value={style} options={IMAGE_STYLE_OPTIONS} onChange={setStyle} />
            <ImageSegment<ImageAspect> label="比例" value={aspect} options={IMAGE_ASPECT_OPTIONS} onChange={setAspect} />
            <ImageSegment<ImageCount> label="生成数量" value={count} options={IMAGE_COUNT_OPTIONS} onChange={setCount} />
          </div>
        </Section>

        <section className="relative rounded-[20px] bg-white px-6 py-6 shadow-[0_16px_38px_rgba(89,87,87,0.08)]">
          <Textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="描述你想让 HOLA DAY 创作的图片内容 ..."
            rows={5}
            className="min-h-[252px] resize-none border-0 bg-transparent px-0 text-[18px] font-medium shadow-none placeholder:text-[#DCDDDD] focus-visible:ring-0"
          />
          <div className="absolute bottom-9 left-8 flex items-center gap-3 text-[#9AA1AE]">
            <ImagePlus className="h-5 w-5" aria-hidden />
            <Paperclip className="h-5 w-5" aria-hidden />
          </div>
          <Button type="button" onClick={() => void handleSubmit()} disabled={submitting || uploading} className="absolute bottom-7 right-7 h-[46px] min-w-[132px] overflow-hidden rounded-full border border-[#42C0EF] bg-[#42C0EF]/12 px-0 pl-5 text-[16px] text-[#1688AA] shadow-[0_10px_24px_rgba(66,192,239,0.16)] hover:bg-[#42C0EF]/18">
            {submitting ? (
              <>
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />
                提交中…
              </>
            ) : (
              <>
                <span className="pr-3">生成图片</span>
                <span className="flex h-[46px] w-[46px] items-center justify-center rounded-full bg-[#42C0EF] text-white shadow-[-6px_0_14px_rgba(89,87,87,0.08)]">
                  <Sparkles className="h-4 w-4" aria-hidden />
                </span>
              </>
            )}
          </Button>
        </section>

        <Section title="参考图" description="可选。上传后会作为图生图或编辑输入，不上传则走文生图。" className="border-transparent bg-white shadow-[0_12px_32px_rgba(89,87,87,0.06)]">
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(event) => void handlePick(event)}
          />
          {reference ? (
            <div className="flex items-center gap-4">
              <img
                src={reference.previewUrl}
                alt="参考图预览"
                className="h-24 w-24 rounded-[8px] border border-[#DCDDDD] object-cover"
              />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] text-foreground">{reference.name}</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={uploading}>
                    {uploading ? '上传中…' : '换一张'}
                  </Button>
                  <button
                    type="button"
                    onClick={removeReference}
                    className="inline-flex h-8 items-center gap-1 rounded-[8px] px-2 text-[12px] text-muted-foreground hover:text-[#42C0EF]"
                  >
                    <X className="h-3.5 w-3.5" aria-hidden />
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
              className="flex w-full flex-col items-center justify-center gap-2 rounded-[8px] border border-dashed border-[#DCDDDD] py-10 text-muted-foreground transition-colors hover:border-[#42C0EF]/45 hover:text-[#42C0EF] disabled:opacity-60"
            >
              {uploading ? <Loader2 className="h-6 w-6 animate-spin" aria-hidden /> : <ImagePlus className="h-6 w-6" aria-hidden />}
              <span className="text-[13px]">{uploading ? '上传中…' : '上传参考图'}</span>
              <span className="text-[11px] text-muted-foreground">JPG / PNG / WebP</span>
            </button>
          )}
        </Section>

        <div className="flex items-center justify-end gap-3">
          <span className="text-[12px] text-muted-foreground">生成结果会保存到任务产物和文件库</span>
        </div>

        <ImageHistory rows={imageRows} />
      </div>
    </PageContainer>
  );
}

function ImageHistory({ rows }: { rows: ImageHistoryRow[] }): JSX.Element {
  const navigate = useNavigate();
  return (
    <Section title="生成历史" description="这里只展示已完成或需复核且带图片产物的任务。">
      {rows.length === 0 ? (
        <div className="rounded-[8px] border border-dashed border-[#DCDDDD] px-4 py-8 text-center">
          <ImageIcon className="mx-auto h-8 w-8 text-muted-foreground/50" aria-hidden />
          <div className="mt-3 text-[13px] font-medium text-foreground/80">还没有图片任务</div>
          <div className="mt-1 text-[12px] text-muted-foreground">在上方写描述，点「生成图片」开始。</div>
        </div>
      ) : (
        <div className="grid gap-3">
          {rows.map((row) => (
            <article key={row.taskId} className="rounded-[8px] border border-[#E1E3E8] bg-[#FCFCFD] p-3">
              <div className="mb-3 flex items-start justify-between gap-3">
                <button
                  type="button"
                  onClick={() => navigate(`/?task=${encodeURIComponent(row.taskId)}`)}
                  className="min-w-0 text-left"
                >
                  <div className="truncate text-[13px] font-semibold text-foreground hover:text-[#1688AA]">
                    {row.title || row.intent || '图片任务'}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                    <span>{formatTime(row.createdAt)}</span>
                    {row.status === 'partial_success' ? (
                      <span className="rounded-full bg-[#FFC910]/15 px-2 py-0.5 text-[#8A6A00]">
                        需复核
                      </span>
                    ) : null}
                  </div>
                </button>
                <Button variant="outline" size="sm" onClick={() => navigate(`/?task=${encodeURIComponent(row.taskId)}`)}>
                  打开任务
                </Button>
              </div>
              <FileDownloadCard payload={row.download} />
            </article>
          ))}
        </div>
      )}
    </Section>
  );
}

function ImageHero(): JSX.Element {
  return (
    <header className="relative mb-0 h-[370px] overflow-hidden bg-[#42C0EF]/10 px-6">
      <div className="mx-auto flex h-full w-full max-w-[1080px] items-start pt-[108px]">
        <h1 className="relative z-10 text-[36px] font-semibold leading-tight tracking-tight text-foreground">
          用AI创作图片
          <Sparkles className="ml-2 inline h-5 w-5 align-super text-[#42C0EF]" aria-hidden />
        </h1>
        <img
          src="/design-ref/image-hero.png"
          alt=""
          aria-hidden
          className="pointer-events-none absolute right-0 top-0 h-full w-[58%] object-cover object-right-top"
        />
      </div>
    </header>
  );
}

function ImageOptionSelect<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange(value: T): void;
}): JSX.Element {
  return (
    <label className="block min-w-0">
      <span className="mb-2 block text-[12px] font-semibold text-[#ADADAD]">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value as T)}
        className="h-10 w-full rounded-[10px] border border-[#DCDDDD] bg-white px-4 text-[14px] font-semibold text-foreground outline-none transition focus:border-[#42C0EF]/60 focus:ring-2 focus:ring-[#42C0EF]/10"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function ImageSegment<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange(value: T): void;
}): JSX.Element {
  return (
    <div className="min-w-0">
      <div className="mb-2 text-[12px] font-semibold text-[#ADADAD]">{label}</div>
      <div className="flex flex-wrap gap-2 rounded-[10px] bg-[#EFEFEF]/60 p-1">
        {options.map((option) => {
          const active = option.value === value;
          return (
            <button
              key={String(option.value)}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(option.value)}
              className={cn(
                'h-10 min-w-12 rounded-[10px] px-4 text-[14px] font-semibold transition-colors',
                active
                  ? 'border border-[#42C0EF]/45 bg-white text-[#42C0EF] shadow-[0_1px_2px_rgba(17,24,39,0.05)]'
                  : 'text-[#595757] hover:bg-white/70 hover:text-[#1688AA]',
              )}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function imageModelLabel(model: ImageModel): string {
  if (model === 'quality') return 'High Quality';
  if (model === 'fast') return 'Fast';
  return 'Auto';
}

function imageStyleLabel(style: ImageStyle): string {
  if (style === 'realistic') return 'Realistic';
  if (style === 'poster') return 'Poster';
  if (style === 'minimal') return 'Minimal';
  return 'Dynamic';
}

function formatTime(value: Date): string {
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(value);
}

export default ImagePage;
