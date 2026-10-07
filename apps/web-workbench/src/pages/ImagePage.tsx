import { useCreativeProject } from '@/components/CreativeProjectPicker';
import { CreativeReferenceLibrary } from '@/components/CreativeReferenceLibrary';
import { CreativeInspiration } from '@/components/CreativeInspiration';
import { ImageBriefComposer } from '@/components/image/ImageBriefComposer';
import { ImageGenerationSettings } from '@/components/image/ImageGenerationSettings';
import { ImageGoalPicker } from '@/components/image/ImageGoalPicker';
import { ImageHistory } from '@/components/image/ImageHistory';
import { ImageResultPanel } from '@/components/image/ImageResultPanel';
import {
  availableImageModelOptions,
  buildImageCreationOptions,
  buildImageFileOrder,
  buildImageIntentForSubmit,
  usableImageModel,
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
import { useMediaModels } from '@/lib/media-models';
import { trpc } from '@/lib/trpc';
import { uploadFailureMessage, uploadFile } from '@/lib/upload-file';
import { useTaskStore } from '@/stores/task-store';
import { type CommercialImageUse, type ImageChangeTarget, imageModelLabel } from '@/types/image';
import { Loader2, Settings2, Sparkles, Files, ChevronDown } from 'lucide-react';
import * as React from 'react';
import { useNavigate } from 'react-router-dom';

export function ImagePage(): JSX.Element {
  const project = useCreativeProject();
  const navigate = useNavigate();
  const toast = useToast();
  const createTask = useTaskStore((state) => state.createTask);
  const tasks = useTaskStore((state) => state.tasks) ?? [];
  const selectedTaskId = useTaskStore((state) => state.selectedTaskId);
  const refreshTasks = useTaskStore((state) => state.refreshTasks);
  const [draft, setDraft] = React.useState(() => createImageStudioDraft('inspiration'));
  const mediaModels = useMediaModels();
  const imageModelOptions = React.useMemo(
    () => availableImageModelOptions(mediaModels?.image),
    [mediaModels],
  );
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [libraryOpen, setLibraryOpen] = React.useState(false);
  const libraryAnchor = React.useRef<HTMLButtonElement | null>(null);
  const [settingsMode, setSettingsMode] = React.useState<'models' | 'specs'>('specs');
  const [uploading, setUploading] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [inlineError, setInlineError] = React.useState<string | null>(null);
  const [submitGuard] = React.useState(createMediaActionGuard);
  const settingsTriggerRef = React.useRef<HTMLButtonElement | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const attachmentCounterRef = React.useRef(0);
  const uploadInFlightRef = React.useRef(false);
  const submitInFlightRef = React.useRef(false);
  const continuationRequestRef = React.useRef(0);
  const attachmentsRef = React.useRef(draft.attachments);
  const composerRef = React.useRef<HTMLDivElement>(null);

  const queryTaskId =
    typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('task');
  const currentTaskId = queryTaskId ?? selectedTaskId;
  const currentTask = currentTaskId
    ? tasks.find((task) => task.taskId === currentTaskId)
    : undefined;
  const currentTaskStatus = currentTask?.status;
  const currentResult = currentTask ? toImageHistoryRow(currentTask) : null;
  const currentTaskNeedsResultSync =
    Boolean(currentTask) &&
    (currentTaskStatus === 'completed' || currentTaskStatus === 'partial_success') &&
    currentResult === null;

  attachmentsRef.current = draft.attachments;

  React.useEffect(() => () => revokeCreativePreviewUrls(attachmentsRef.current), []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: task id must restart result sync when two tasks share the same status.
  React.useEffect(() => {
    if (
      !currentTaskStatus ||
      (['completed', 'partial_success', 'failed', 'cancelled'].includes(currentTaskStatus) &&
        !currentTaskNeedsResultSync)
    ) {
      return;
    }
    if (currentTaskNeedsResultSync) {
      void refreshTasks?.();
      return;
    }
    const timer = window.setInterval(() => {
      void refreshTasks?.();
    }, 4_000);
    return () => window.clearInterval(timer);
  }, [currentTaskId, currentTaskNeedsResultSync, currentTaskStatus, refreshTasks]);

  function invalidatePendingContinuation(): void {
    continuationRequestRef.current += 1;
  }

  function draftIsLocked(): boolean {
    return uploadInFlightRef.current || submitInFlightRef.current;
  }

  function switchGoal(goal: ImageStudioDraft['goal']): void {
    if (draftIsLocked()) return;
    invalidatePendingContinuation();
    setDraft((current) => switchImageCreationGoal(current, goal));
  }

  function switchCommercialUse(use: CommercialImageUse): void {
    if (draftIsLocked()) return;
    invalidatePendingContinuation();
    setDraft((current) => switchImageCreationGoal(current, 'commercial', use));
  }

  function toggleChangeTarget(target: ImageChangeTarget): void {
    if (draftIsLocked()) return;
    invalidatePendingContinuation();
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
    if (draftIsLocked()) return;
    invalidatePendingContinuation();
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
    if (draftIsLocked()) {
      event.target.value = '';
      return;
    }
    const replacingSubjectId =
      draft.goal === 'lock_subject' ? draft.subjectAttachmentClientId : null;
    const availableSlots = Math.max(
      0,
      5 - attachmentsRef.current.length + (replacingSubjectId ? 1 : 0),
    );
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
    invalidatePendingContinuation();

    const replacedSubject = replacingSubjectId
      ? attachmentsRef.current.find(
          (attachment) => (attachment.clientId ?? attachment.fileId) === replacingSubjectId,
        )
      : undefined;

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
      attachments: [...current.attachments, ...pending.map(({ attachment }) => attachment)],
      subjectAttachmentClientId:
        current.goal === 'lock_subject'
          ? (pending[0]?.clientId ?? null)
          : current.subjectAttachmentClientId,
    }));
    uploadInFlightRef.current = true;
    setUploading(true);
    try {
      await Promise.all(
        pending.map(async ({ clientId, file }) => {
          const replacingSubject = Boolean(replacingSubjectId) && clientId === pending[0]?.clientId;
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
            if (replacingSubject) {
              setDraft((current) => ({
                ...current,
                attachments: current.attachments.filter(
                  (attachment) => (attachment.clientId ?? attachment.fileId) !== replacingSubjectId,
                ),
              }));
              if (replacedSubject?.previewDataUrl?.startsWith('blob:')) {
                URL.revokeObjectURL(replacedSubject.previewDataUrl);
              }
            }
          } catch (error) {
            const message = uploadFailureMessage(error);
            if (replacingSubject) {
              const replacement = pending[0]?.attachment;
              setDraft((current) => ({
                ...current,
                attachments: current.attachments.filter(
                  (attachment) => (attachment.clientId ?? attachment.fileId) !== clientId,
                ),
                subjectAttachmentClientId: replacingSubjectId,
              }));
              if (replacement?.previewDataUrl?.startsWith('blob:')) {
                URL.revokeObjectURL(replacement.previewDataUrl);
              }
            } else {
              updateAttachment(clientId, (attachment) => ({
                ...attachment,
                status: 'error',
                errorMessage: message,
              }));
            }
            setInlineError(message);
          }
        }),
      );
    } finally {
      uploadInFlightRef.current = false;
      setUploading(false);
    }
  }

  function removeAttachment(clientId: string): void {
    if (draftIsLocked()) return;
    invalidatePendingContinuation();
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
    invalidatePendingContinuation();
    submitInFlightRef.current = true;
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
        buildImageCreationOptions(
          { ...draft, model: usableImageModel(draft.model, mediaModels?.image) },
          subject?.fileId,
        ),
      );
      if ('error' in result) {
        setInlineError(result.error || '提交失败，请重试');
        return;
      }
      await project.associate(result.taskId);
      const submittedAttachments = attachmentsRef.current;
      attachmentsRef.current = [];
      revokeCreativePreviewUrls(submittedAttachments);
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
      submitInFlightRef.current = false;
      submitGuard.release();
      setSubmitting(false);
    }
  }

  async function continueFromResult(
    action: ImageContinuationAction,
    row: ImageHistoryRow,
    selectedFileId?: string,
  ): Promise<void> {
    if (draftIsLocked()) return;
    const requestId = ++continuationRequestRef.current;
    if (action === 'keep_subject') {
      const subjectFileId = row.imageOptions.subjectFileId;
      if (!subjectFileId) return;
      try {
        const result = await trpc.files.availability.query({ fileIds: [subjectFileId] });
        if (draftIsLocked() || requestId !== continuationRequestRef.current) return;
        if (result.items[0]?.available !== true) {
          replaceDraft(createImageStudioDraft('lock_subject'));
          setInlineError('原主角图已失效，请重新上传主角');
          composerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          return;
        }
      } catch {
        if (requestId !== continuationRequestRef.current) return;
        setInlineError('暂时无法核对主角图，请稍后重试');
        return;
      }
    }
    if (draftIsLocked() || requestId !== continuationRequestRef.current) return;
    replaceDraft(continuationDraftFromImageTask(row, action, selectedFileId));
    setInlineError(null);
    composerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function replaceDraft(nextDraft: ImageStudioDraft): void {
    const previousAttachments = attachmentsRef.current;
    attachmentsRef.current = nextDraft.attachments;
    revokeCreativePreviewUrls(previousAttachments);
    setDraft(nextDraft);
  }

  const draftLocked = uploading || submitting;

  return (
    <main className="hd-creative-page hd-image-page min-h-full bg-[var(--creative-surface,#FBFAF7)] px-4 py-5 text-[var(--creative-ink,#342E39)] sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-[1220px]">
        <header className="hd-creative-heading"><span>HOLADAY IMAGE</span><h1>让想象，有了模样。</h1><p>从一段灵感出发，或让熟悉的主角走进新画面。</p></header>

        <div className="hd-image-workspace rounded-[26px] border border-[var(--creative-line,#E8E1E7)] bg-[var(--creative-surface,#fff)] p-4 shadow-[0_14px_38px_rgba(62,48,69,0.05)] sm:p-5 lg:p-7">
          <ImageGoalPicker
            value={draft.goal}
            commercialUse={draft.commercialUse}
            disabled={draftLocked}
            onChange={switchGoal}
            onCommercialUseChange={switchCommercialUse}
          />

          {draft.goal === 'inspiration' && <CreativeInspiration kind="image" disabled={draftLocked} onPick={idea => { if (draftIsLocked()) return; invalidatePendingContinuation(); setDraft(current => ({ ...current, prompt: idea.prompt, aspectRatio: idea.aspectRatio, style: idea.style ?? current.style })); }} />}

          <div ref={composerRef} id="image-creative-stage" className="hd-image-stage" role="tabpanel">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/png,image/jpeg,image/webp"
              aria-label="添加图片"
              disabled={draftLocked}
              className="sr-only"
              onChange={(event) => void handleFilesSelected(event)}
            />
            {project.notice}
            <ImageBriefComposer settings={<div className="hd-composer-meta"><button ref={settingsTriggerRef} type="button" className="hd-glass-pill" title="选择图片模型" aria-label="选择图片模型" disabled={draftLocked} onClick={event => { settingsTriggerRef.current = event.currentTarget; setSettingsMode('models'); setSettingsOpen(open => settingsMode === 'models' ? !open : true); }}><Settings2 className="h-4 w-4" />{imageModelLabel(usableImageModel(draft.model, mediaModels?.image))}<ChevronDown className="h-3 w-3" /></button><button type="button" className="hd-glass-pill" title="生成设置" aria-label="生成设置" onClick={event => { settingsTriggerRef.current = event.currentTarget; setSettingsMode('specs'); setSettingsOpen(open => settingsMode === 'specs' ? !open : true); }} disabled={draftLocked}>{settingSummary({ ...draft, model: usableImageModel(draft.model, mediaModels?.image) })}</button></div>} referenceAction={<><button ref={libraryAnchor} type="button" title="添加参考资料" disabled={draftLocked} onClick={() => setLibraryOpen(open => !open)}><Files className="h-4 w-4" />参考资料</button>{project.renderPicker(draftLocked)}</>}
              draft={draft}
              uploading={uploading}
              disabled={draftLocked}
              inlineError={inlineError}
              actions={
                <>
                  <div className="hd-creative-generation-actions">

                    <Button
                      type="button"
                      onClick={() => void handleSubmit()}
                      disabled={Boolean(validationMessage) || submitting}
                      className="hd-generate min-h-12 rounded-xl bg-[#D62958] px-8 text-sm font-semibold text-white shadow-[0_10px_24px_rgba(214,41,88,0.2)] hover:bg-[#BE214B] sm:w-[48%]"
                    >
                      {submitting ? (
                        <Loader2
                          className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none"
                          aria-hidden
                        />
                      ) : (
                        <Sparkles className="mr-2 h-4 w-4" aria-hidden />
                      )}
                      {submitting ? '提交中…' : '准备生成'}
                    </Button>
                  </div>
                  <p className="mt-2 min-h-5 text-right text-xs text-[var(--creative-muted,#7D737F)]" aria-live="polite">
                    {validationMessage ?? '设置已就绪，可以开始生成'}
                  </p>
                </>
              }
              onPromptChange={(prompt) => {
                if (draftIsLocked()) return;
                invalidatePendingContinuation();
                setDraft((current) => ({ ...current, prompt }));
              }}
              onToggleChangeTarget={toggleChangeTarget}
              onChooseImages={() => fileInputRef.current?.click()}
              onRemoveAttachment={removeAttachment}
              onSetSubject={(clientId) => {
                if (draftIsLocked()) return;
                invalidatePendingContinuation();
                setDraft((current) => ({ ...current, subjectAttachmentClientId: clientId }));
              }}
            />
          </div>


        </div>

        {currentTask ? (
          <div className="mt-6">
            <ImageResultPanel
              task={currentTask}
              row={currentResult ?? undefined}
              continuationDisabled={draftLocked}
              onContinue={continueFromResult}
            />
          </div>
        ) : null}

        <ImageHistory
          refreshKey={currentTask ? `${currentTask.taskId}:${currentTask.status}` : undefined}
          continuationDisabled={draftLocked}
          onContinue={continueFromResult}
        />
      </div>

      <CreativeReferenceLibrary open={libraryOpen} onOpenChange={setLibraryOpen} anchorRef={libraryAnchor} disabled={draftLocked || draft.attachments.length >= 5} selectedFileIds={draft.attachments.map(file => file.fileId)} onChooseLocal={() => fileInputRef.current?.click()} onPick={file => { if (draftIsLocked()) return; setDraft(current => current.attachments.some(item => item.fileId === file.fileId) || current.attachments.length >= 5 ? current : { ...current, attachments: [...current.attachments, file] }); }} />
      <ImageGenerationSettings
        open={settingsOpen}
        mode={settingsMode}
        draft={{ ...draft, model: usableImageModel(draft.model, mediaModels?.image) }}
        returnFocusRef={settingsTriggerRef}
        modelOptions={imageModelOptions}
        onOpenChange={setSettingsOpen}
        onSettingChange={changeSetting}
      />
    </main>
  );
}

function settingSummary(draft: ImageStudioDraft): string {
  return `${draft.aspectRatio} · ${draft.imageCount} 张`;
}

export default ImagePage;
