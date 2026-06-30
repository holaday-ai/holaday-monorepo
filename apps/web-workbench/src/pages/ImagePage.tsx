import {
  Image as ImageIcon,
  ImagePlus,
  Loader2,
  WandSparkles,
  X,
} from 'lucide-react';
import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { FileDownloadCard, type FileDownloadPayload } from '@/components/FileDownloadCard';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';
import { uploadFailureMessage, uploadFile } from '@/lib/upload-file';
import { PageContainer, PageHeader, Section } from '@/pages/PageShell';
import { useTaskStore } from '@/stores/task-store';
import type { UiTask, UiTerminalAttachment } from '@/types/task';

type ReferenceImage = {
  fileId: string;
  name: string;
  previewUrl: string;
};

interface ImageRow {
  taskId: string;
  title: string;
  intent: string;
  createdAt: Date;
  download: FileDownloadPayload;
}

const PROMPT_EXAMPLES = [
  '做一张小红书风格护肤品种草封面，干净明亮，留白放标题',
  '生成一张 SaaS 产品发布海报，科技感，深色背景，突出“AI Workflow”',
  '画一张猫咪在咖啡馆窗边睡觉的插画，温暖手绘风',
  '把参考图改成极简电商主图，白底，高级感，突出产品质感',
];

export function ImagePage(): JSX.Element {
  const navigate = useNavigate();
  const toast = useToast();
  const createTask = useTaskStore((s) => s.createTask);
  const refreshTasks = useTaskStore((s) => s.refreshTasks);
  const tasks = useTaskStore((s) => s.tasks);
  const [prompt, setPrompt] = React.useState('');
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

  const imageRows = React.useMemo(() => tasks.map(toImageRow).filter((row): row is ImageRow => row !== null), [tasks]);

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
        ? `基于上传的参考图片进行图生图或图片编辑：${trimmed}`
        : `生成一张图片：${trimmed}`;
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
    <PageContainer width="form">
      <PageHeader
        title="图片任务"
        description="生成海报、封面、主图、插画或头像；也可以上传参考图做图生图和局部风格修改。"
      />

      <div className="space-y-6">
        <Section title="图片描述" description="写清主体、风格、用途、画面比例和是否包含文字。">
          <Textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="例如：做一张小红书护肤品种草封面，白底，高级感，标题留在上方"
            rows={5}
            className="resize-y"
          />
          <div className="mt-3 flex flex-wrap gap-2">
            {PROMPT_EXAMPLES.map((example) => (
              <button
                key={example}
                type="button"
                onClick={() => setPrompt(example)}
                className="rounded-[8px] border border-[#E1E3E8] bg-white px-3 py-1.5 text-left text-[12px] text-[#595757] transition hover:border-[#EA1F59]/30 hover:bg-[#FFF7FA] hover:text-[#EA1F59]"
              >
                {example}
              </button>
            ))}
          </div>
        </Section>

        <Section title="参考图" description="可选。上传后会作为图生图或编辑输入，不上传则走文生图。">
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
                    className="inline-flex h-8 items-center gap-1 rounded-[8px] px-2 text-[12px] text-muted-foreground hover:text-[#EA1F59]"
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
              className="flex w-full flex-col items-center justify-center gap-2 rounded-[8px] border border-dashed border-[#DCDDDD] py-10 text-muted-foreground transition-colors hover:border-[#EA1F59]/40 hover:text-[#EA1F59] disabled:opacity-60"
            >
              {uploading ? <Loader2 className="h-6 w-6 animate-spin" aria-hidden /> : <ImagePlus className="h-6 w-6" aria-hidden />}
              <span className="text-[13px]">{uploading ? '上传中…' : '上传参考图'}</span>
              <span className="text-[11px] text-muted-foreground">JPG / PNG / WebP</span>
            </button>
          )}
        </Section>

        <div className="flex items-center justify-end gap-3">
          <span className="text-[12px] text-muted-foreground">生成结果会保存到任务产物和文件库</span>
          <Button type="button" onClick={() => void handleSubmit()} disabled={submitting || uploading} className="min-w-[128px]">
            {submitting ? (
              <>
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />
                提交中…
              </>
            ) : (
              <>
                <WandSparkles className="mr-1.5 h-4 w-4" aria-hidden />
                生成图片
              </>
            )}
          </Button>
        </div>

        <ImageHistory rows={imageRows} />
      </div>
    </PageContainer>
  );
}

function ImageHistory({ rows }: { rows: ImageRow[] }): JSX.Element {
  const navigate = useNavigate();
  return (
    <Section title="生成历史" description="这里只展示已完成且带图片产物的任务。">
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
                  <div className="truncate text-[13px] font-semibold text-foreground hover:text-[#EA1F59]">
                    {row.title || row.intent || '图片任务'}
                  </div>
                  <div className="mt-0.5 text-[11px] text-muted-foreground">{formatTime(row.createdAt)}</div>
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

function toImageRow(task: UiTask): ImageRow | null {
  if (task.status !== 'completed') return null;
  const imageAttachment = task.attachments?.find(isImageAttachment);
  if (!imageAttachment) return null;
  const looksLikeImageLane =
    task.executionMode === 'image' ||
    task.intent.includes('生成一张图片') ||
    task.intent.includes('图生图') ||
    task.intent.includes('图片编辑');
  if (!looksLikeImageLane) return null;
  return {
    taskId: task.taskId,
    title: task.title ?? '',
    intent: task.intent,
    createdAt: task.createdAt,
    download: {
      fileId: imageAttachment.fileId,
      downloadUrl: imageAttachment.downloadUrl,
      filename: imageAttachment.filename,
      size: imageAttachment.sizeBytes,
    },
  };
}

function isImageAttachment(attachment: UiTerminalAttachment): boolean {
  return attachment.mimetype.startsWith('image/') || /\.(png|jpe?g|webp|gif)$/i.test(attachment.filename);
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
