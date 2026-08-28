import { ImageBriefComposer } from '@/components/image/ImageBriefComposer';
import { ImageGenerationSettings } from '@/components/image/ImageGenerationSettings';
import { ImageGoalPicker } from '@/components/image/ImageGoalPicker';
import { ImageHistory } from '@/components/image/ImageHistory';
import { ImageResultPanel } from '@/components/image/ImageResultPanel';
import {
  buildImageCreationOptions,
  buildImageFileOrder,
  buildImageIntentForSubmit,
} from '@/components/image/image-studio-options';
import {
  type ImageContinuationAction,
  type ImageStudioDraft,
  type ImageStudioSettingKey,
  continuationDraftFromImageTask,
  createImageStudioDraft,
  setImageStudioSetting,
  switchImageCreationGoal,
} from '@/components/image/image-studio-state';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { revokeCreativePreviewUrls } from '@/lib/creative-preview-urls';
import { type ImageHistoryRow, toImageHistoryRow } from '@/lib/image-history-row';
import { createMediaActionGuard } from '@/lib/media-action-guard';
import { trpc } from '@/lib/trpc';
import { uploadFailureMessage, uploadFile } from '@/lib/upload-file';
import { useTaskStore } from '@/stores/task-store';
import type { CommercialImageUse, ImageChangeTarget } from '@/types/image';
import { ArrowRight, Loader2, Settings2, Sparkles } from 'lucide-react';
import * as React from 'react';
import { useNavigate } from 'react-router-dom';

export function ImagePage(): JSX.Element {
  const navigate = useNavigate();
  const toast = useToast();
  const createTask = useTaskStore((state) => state.createTask);
  const tasks = useTaskStore((state) => state.tasks) ?? [];
  const selectedTaskId = useTaskStore((state) => state.selectedTaskId);
  const refreshTasks = useTaskStore((state) => state.refreshTasks);
  const [draft, setDraft] = React.useState(() => createImageStudioDraft('inspiration'));
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [uploading, setUploading] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [inlineError, setInlineError] = React.useState<string | null>(null);
  const [submitGuard] = React.useState(createMediaActionGuard);
  const settingsTriggerRef = React.useRef<HTMLButtonElement>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const attachmentCounterRef = React.useRef(0);
  const attachmentsRef = React.useRef(draft.attachments);
  const composerRef = React.useRef<HTMLDivElement>(null);

  const queryTaskId =
    typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('task');
  const currentTaskId = queryTaskId ?? selectedTaskId;
  const currentTask = currentTaskId
    ? tasks.find((task) => task.taskId === currentTaskId)
    : undefined;
  const currentResult = currentTask ? toImageHistoryRow(currentTask) : null;

  attachmentsRef.current = draft.attachments;

  React.useEffect(() => () => revokeCreativePreviewUrls(attachmentsRef.current), []);

  React.useEffect(() => {
    if (
      !currentTask ||
      ['completed', 'partial_success', 'failed', 'cancelled'].includes(currentTask.status)
    ) {
      return;
    }
    const timer = window.setInterval(() => {
      void refreshTasks?.();
    }, 4_000);
    return () => window.clearInterval(timer);
  }, [currentTask, refreshTasks]);

  function switchGoal(goal: ImageStudioDraft['goal']): void {
    setDraft((current) => switchImageCreationGoal(current, goal));
  }

  function switchCommercialUse(use: CommercialImageUse): void {
    setDraft((current) => switchImageCreationGoal(current, 'commercial', use));
  }

  function toggleChangeTarget(target: ImageChangeTarget): void {
    setDraft((current) => ({
      ...current,
      changeTargets: current.changeTargets.includes(target)
        ? current.changeTargets.filter((value) => value !== target)
        : [...current.changeTargets, target],
    }));
  }

  function changeSetting<K extends ImageStudioSettingKey>(
    key: K,
    value: ImageStudioDraft[K],
  ): void {
    setDraft((current) => setImageStudioSetting(current, key, value));
  }

  function updateAttachment(
    clientId: string,
    update: (
      attachment: ImageStudioDraft['attachments'][number],
    ) => ImageStudioDraft['attachments'][number],
  ): void {
    setDraft((current) => ({
      ...current,
      attachments: current.attachments.map((attachment) =>
        attachment.clientId === clientId ? update(attachment) : attachment,
      ),
    }));
  }

  async function handleFilesSelected(event: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const availableSlots = Math.max(0, 5 - attachmentsRef.current.length);
    const selected = Array.from(event.target.files ?? []).slice(0, availableSlots);
    event.target.value = '';
    if (selected.length === 0) {
      setInlineError('每个图片任务最多添加 5 张图片');
      return;
    }
    const valid = selected.filter((file) => /^image\/(png|jpe?g|webp)$/i.test(file.type));
    if (valid.length !== selected.length) {
      setInlineError('请上传 JPG、PNG 或 WebP 图片');
    } else {
      setInlineError(null);
    }
    if (valid.length === 0) return;

    const pending = valid.map((file) => {
      const clientId = `image_${Date.now().toString(36)}_${++attachmentCounterRef.current}`;
      return {
        clientId,
        file,
        attachment: {
          clientId,
          fileId: '',
          filename: file.name,
          mimetype: file.type,
          size: file.size,
          status: 'uploading' as const,
          previewDataUrl: URL.createObjectURL(file),
        },
      };
    });

    setDraft((current) => ({
      ...current,
      attachments: [...current.attachments, ...pending.map(({ attachment }) => attachment)].slice(
        0,
        5,
      ),
      subjectAttachmentClientId:
        current.goal === 'lock_subject' && !current.subjectAttachmentClientId
          ? (pending[0]?.clientId ?? null)
          : current.subjectAttachmentClientId,
    }));
    setUploading(true);
    await Promise.all(
      pending.map(async ({ clientId, file }) => {
        try {
          const uploaded = await uploadFile(file);
          updateAttachment(clientId, (attachment) => ({
            ...attachment,
            fileId: uploaded.fileId,
            filename: uploaded.filename,
            mimetype: uploaded.mimetype,
            size: uploaded.size,
            status: 'ready',
            errorMessage: undefined,
          }));
        } catch (error) {
          const message = uploadFailureMessage(error);
          updateAttachment(clientId, (attachment) => ({
            ...attachment,
            status: 'error',
            errorMessage: message,
          }));
          setInlineError(message);
        }
      }),
    );
    setUploading(false);
  }

  function removeAttachment(clientId: string): void {
    setDraft((current) => {
      const removed = current.attachments.find(
        (attachment) => (attachment.clientId ?? attachment.fileId) === clientId,
      );
      if (removed?.previewDataUrl?.startsWith('blob:')) {
        URL.revokeObjectURL(removed.previewDataUrl);
      }
      const attachments = current.attachments.filter(
        (attachment) => (attachment.clientId ?? attachment.fileId) !== clientId,
      );
      const nextSubject =
        current.subjectAttachmentClientId === clientId
          ? (attachments.find(
              (attachment) =>
                attachment.status === 'ready' && attachment.mimetype.startsWith('image/'),
            )?.clientId ?? null)
          : current.subjectAttachmentClientId;
      return { ...current, attachments, subjectAttachmentClientId: nextSubject };
    });
  }

  function readySubject(
    current: ImageStudioDraft,
  ): ImageStudioDraft['attachments'][number] | undefined {
    return current.attachments.find(
      (attachment) =>
        attachment.clientId === current.subjectAttachmentClientId &&
        attachment.status === 'ready' &&
        Boolean(attachment.fileId) &&
        attachment.mimetype.startsWith('image/'),
    );
  }

  const validationMessage = (() => {
    if (draft.prompt.trim().length < 4) return '请至少用 4 个字描述最终画面';
    if (uploading || draft.attachments.some((attachment) => attachment.status === 'uploading')) {
      return '图片上传完成后即可生成';
    }
    if (draft.goal === 'lock_subject' && !readySubject(draft)) {
      return '请先添加一张清晰的主角图';
    }
    return null;
  })();

  async function handleSubmit(): Promise<void> {
    if (validationMessage || submitting || !submitGuard.acquire()) return;
    setSubmitting(true);
    setInlineError(null);
    try {
      const subject = readySubject(draft);
      const mode = draft.goal === 'lock_subject' ? 'lock_subject' : 'free';
      const fileIds = buildImageFileOrder(draft.attachments, mode, draft.subjectAttachmentClientId);
      const result = await createTask(
        `生成图片：${buildImageIntentForSubmit(draft)}`,
        fileIds.length > 0 ? fileIds : undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        buildImageCreationOptions(draft, subject?.fileId),
      );
      if ('error' in result) {
        setInlineError(result.error || '提交失败，请重试');
        return;
      }
      revokeCreativePreviewUrls(draft.attachments);
      setDraft((current) => ({
        ...current,
        prompt: '',
        attachments: [],
        subjectAttachmentClientId: null,
      }));
      toast.show('图片任务已提交', 'info', 2_500);
      navigate(`/image?task=${encodeURIComponent(result.taskId)}`);
    } catch (error) {
      setInlineError(error instanceof Error ? error.message : '提交失败，请重试');
    } finally {
      submitGuard.release();
      setSubmitting(false);
    }
  }

  async function continueFromResult(
    action: ImageContinuationAction,
    row: ImageHistoryRow,
    selectedFileId?: string,
  ): Promise<void> {
    if (action === 'keep_subject') {
      const subjectFileId = row.imageOptions.subjectFileId;
      if (!subjectFileId) return;
      try {
        const result = await trpc.files.availability.query({ fileIds: [subjectFileId] });
        if (result.items[0]?.available !== true) {
          setDraft(createImageStudioDraft('lock_subject'));
          setInlineError('原主角图已失效，请重新上传主角');
          composerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          return;
        }
      } catch {
        setInlineError('暂时无法核对主角图，请稍后重试');
        return;
      }
    }
    setDraft(continuationDraftFromImageTask(row, action, selectedFileId));
    setInlineError(null);
    composerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  return (
    <main className="min-h-full bg-[#FBF8F3] px-4 py-7 text-[#342E39] sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-[1200px]">
        <div className="rounded-[30px] border border-[#E8E0E7] bg-[#FFFDF9] p-4 shadow-[0_18px_48px_rgba(62,48,69,0.06)] sm:p-6 lg:p-7">
          <ImageGoalPicker
            value={draft.goal}
            commercialUse={draft.commercialUse}
            onChange={switchGoal}
            onCommercialUseChange={switchCommercialUse}
          />

          <div ref={composerRef} className="mt-4">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/png,image/jpeg,image/webp"
              aria-label="添加图片"
              className="sr-only"
              onChange={(event) => void handleFilesSelected(event)}
            />
            <ImageBriefComposer
              draft={draft}
              uploading={uploading}
              inlineError={inlineError}
              onPromptChange={(prompt) => setDraft((current) => ({ ...current, prompt }))}
              onToggleChangeTarget={toggleChangeTarget}
              onChooseImages={() => fileInputRef.current?.click()}
              onRemoveAttachment={removeAttachment}
              onSetSubject={(clientId) =>
                setDraft((current) => ({ ...current, subjectAttachmentClientId: clientId }))
              }
            />
          </div>

          <div className="mt-4 flex flex-col gap-3 rounded-[22px] border border-[#E8E0E8] bg-white p-3 sm:flex-row sm:items-center sm:justify-between sm:p-4">
            <button
              ref={settingsTriggerRef}
              type="button"
              onClick={() => setSettingsOpen(true)}
              className="inline-flex min-h-11 items-center gap-3 rounded-xl px-2 text-left transition-colors hover:bg-[#F8F3F8] motion-reduce:transition-none"
            >
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#F0E9FA] text-[#73529B]">
                <Settings2 className="h-4 w-4" aria-hidden />
              </span>
              <span>
                <span className="block text-sm font-semibold text-[#423A46]">生成设置</span>
                <span className="mt-0.5 block text-xs text-[#7A707D]">{settingSummary(draft)}</span>
              </span>
            </button>

            <Button
              type="button"
              onClick={() => void handleSubmit()}
              disabled={Boolean(validationMessage) || submitting}
              className="min-h-12 rounded-xl bg-[#D62958] px-8 text-sm font-semibold text-white shadow-[0_10px_24px_rgba(214,41,88,0.2)] hover:bg-[#BE214B]"
            >
              {submitting ? (
                <Loader2
                  className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none"
                  aria-hidden
                />
              ) : (
                <Sparkles className="mr-2 h-4 w-4" aria-hidden />
              )}
              {submitting ? '提交中…' : '开始生成'}
            </Button>
          </div>

          <p className="mt-2 min-h-5 text-right text-xs text-[#7D737F]" aria-live="polite">
            {validationMessage ?? '设置已就绪，可以开始生成'}
          </p>

          {!currentTask ? (
            <section className="mt-4 flex flex-col gap-4 rounded-[22px] border border-[#E8E0E8] bg-[#FCFAFD] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-sm font-semibold text-[#433A47]">生成后可以继续修改</h2>
                <p className="mt-1 text-xs leading-5 text-[#7B717F]">
                  围绕同一张结果继续调整背景、风格、光线或构图，不必从头开始。
                </p>
              </div>
              <span className="inline-flex items-center gap-2 text-xs font-semibold text-[#755990]">
                继续改这张 · 保持主角 · 复用设置
                <ArrowRight className="h-4 w-4" aria-hidden />
              </span>
            </section>
          ) : null}
        </div>

        {currentTask ? (
          <div className="mt-6">
            <ImageResultPanel
              task={currentTask}
              row={currentResult ?? undefined}
              onContinue={continueFromResult}
            />
          </div>
        ) : null}

        <ImageHistory
          refreshKey={currentTask ? `${currentTask.taskId}:${currentTask.status}` : undefined}
          onContinue={continueFromResult}
        />
      </div>

      <ImageGenerationSettings
        open={settingsOpen}
        draft={draft}
        returnFocusRef={settingsTriggerRef}
        onOpenChange={setSettingsOpen}
        onSettingChange={changeSetting}
      />
    </main>
  );
}

function settingSummary(draft: ImageStudioDraft): string {
  const model = draft.model === 'nano_banana_pro' ? 'Nano Banana Pro' : 'Nano Banana 2';
  return `${model} · ${draft.aspectRatio} · ${draft.imageCount} 张`;
}

export default ImagePage;
