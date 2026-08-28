import { AttachmentChip } from '@/components/AttachmentChip';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import type { ImageChangeTarget } from '@/types/image';
import {
  Crop,
  ImagePlus,
  Palette,
  PersonStanding,
  Sparkles,
  SunMedium,
  Wallpaper,
  X,
} from 'lucide-react';
import type { ReactNode } from 'react';
import type { ImageStudioDraft } from './image-studio-state';

const CHANGE_TARGET_OPTIONS: ReadonlyArray<{
  value: ImageChangeTarget;
  label: string;
  icon: typeof Wallpaper;
}> = [
  { value: 'background', label: '背景', icon: Wallpaper },
  { value: 'style', label: '风格', icon: Palette },
  { value: 'lighting', label: '光线', icon: SunMedium },
  { value: 'action', label: '动作', icon: PersonStanding },
  { value: 'composition', label: '构图', icon: Crop },
];

export interface ImageBriefComposerProps {
  draft: ImageStudioDraft;
  uploading: boolean;
  disabled?: boolean;
  inlineError: string | null;
  actions?: ReactNode;
  onPromptChange(value: string): void;
  onToggleChangeTarget(value: ImageChangeTarget): void;
  onChooseImages(): void;
  onRemoveAttachment(clientId: string): void;
  onSetSubject(clientId: string): void;
}

export function ImageBriefComposer({
  draft,
  uploading,
  disabled = uploading,
  inlineError,
  actions,
  onPromptChange,
  onToggleChangeTarget,
  onChooseImages,
  onRemoveAttachment,
  onSetSubject,
}: ImageBriefComposerProps): JSX.Element {
  const lockSubject = draft.goal === 'lock_subject';
  const subject = draft.attachments.find(
    (attachment) => attachment.clientId === draft.subjectAttachmentClientId,
  );
  const references = draft.attachments.filter(
    (attachment) => attachment.clientId !== subject?.clientId,
  );

  return (
    <section
      aria-label="图片创作区"
      className={cn(
        'grid overflow-hidden rounded-[22px] border border-[#E6DFE6] bg-white shadow-[0_8px_24px_rgba(62,50,68,0.04)]',
        lockSubject ? 'lg:grid-cols-[minmax(220px,270px)_minmax(0,1fr)]' : 'grid-cols-1',
      )}
    >
      {lockSubject ? (
        <div className="border-b border-[#E7DFE8] bg-[#FBFCFF] p-4 lg:border-b-0 lg:border-r">
          <div className="text-sm font-semibold text-[#342E39]">添加主角图</div>
          <p className="mt-1 text-xs leading-5 text-[#7B717F]">
            人物、宠物、商品或 IP；建议主体清晰。
          </p>
          {subject?.previewDataUrl ? (
            <div className="relative mt-4 overflow-hidden rounded-[16px] border border-[#DED5E1] bg-white p-2 shadow-[0_8px_18px_rgba(62,50,68,0.08)]">
              <div className="relative overflow-hidden rounded-xl bg-[#F3EFF5]">
                <img
                  src={subject.previewDataUrl}
                  alt="主角图预览"
                  draggable={false}
                  className="h-[174px] w-full object-cover"
                />
                <span className="absolute left-2.5 top-2.5 rounded-full bg-white/95 px-2.5 py-1 text-[10px] font-semibold text-[#5F4771] shadow-sm backdrop-blur">
                  主角
                </span>
                <button
                  type="button"
                  aria-label="移除主角图"
                  title="移除主角图"
                  onClick={() => onRemoveAttachment(subject.clientId ?? subject.fileId)}
                  disabled={disabled}
                  className="absolute right-2.5 top-2.5 flex h-8 w-8 items-center justify-center rounded-full bg-white/95 text-[#6C626F] shadow-sm transition-colors hover:bg-[#FFF0F3] hover:text-[#B51E49] disabled:cursor-wait disabled:opacity-60 motion-reduce:transition-none"
                >
                  <X className="h-4 w-4" aria-hidden />
                </button>
              </div>
              <div className="flex min-w-0 items-center justify-between gap-2 px-1 pb-0.5 pt-2.5">
                <span className="truncate text-[11px] text-[#766C79]">{subject.filename}</span>
                <button
                  type="button"
                  aria-label="更换主角图"
                  title="更换主角图"
                  onClick={onChooseImages}
                  disabled={disabled}
                  className="inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold text-[#66516F] transition-colors hover:bg-[#F4EEF7] disabled:cursor-wait disabled:opacity-60 motion-reduce:transition-none"
                >
                  <ImagePlus className="h-3.5 w-3.5" aria-hidden />
                  {uploading ? '正在更换…' : '更换图片'}
                </button>
              </div>
            </div>
          ) : subject ? (
            <div className="mt-4 space-y-2.5">
              <AttachmentChip
                attachment={subject}
                badge="主角"
                disabled={disabled}
                onRemove={() => onRemoveAttachment(subject.clientId ?? subject.fileId)}
              />
              <button
                type="button"
                aria-label="更换主角图"
                title="更换主角图"
                onClick={onChooseImages}
                disabled={disabled}
                className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-[#DED5E1] bg-white px-3 text-xs font-semibold text-[#66516F] transition-colors hover:bg-[#F4EEF7] disabled:cursor-wait disabled:opacity-60 motion-reduce:transition-none"
              >
                <ImagePlus className="h-3.5 w-3.5" aria-hidden />
                {uploading ? '正在更换…' : '更换图片'}
              </button>
            </div>
          ) : (
            <button
              type="button"
              aria-label="添加主角图"
              title="添加主角图"
              onClick={onChooseImages}
              disabled={disabled}
              className="mt-3 flex min-h-[142px] w-full flex-col items-center justify-center rounded-[16px] border border-dashed border-[#CFC3D2] bg-[#FDF9FF] px-4 text-center text-[#675B6D] transition-colors hover:border-[#9C87AA] hover:bg-[#FAF3FF] disabled:cursor-wait disabled:opacity-60 motion-reduce:transition-none"
            >
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#EEE6FF] text-[#7252A0]">
                <ImagePlus className="h-5 w-5" aria-hidden />
              </span>
              <span className="mt-3 text-sm font-semibold">
                {uploading ? '正在上传…' : '添加主角图'}
              </span>
              <span className="mt-1 text-[11px] text-[#8A7E8D]">JPG / PNG / WebP</span>
            </button>
          )}
        </div>
      ) : null}

      <div className="p-4 sm:p-[18px]">
        {lockSubject ? (
          <fieldset aria-label="想改什么" className="min-w-0 border-0 p-0">
            <legend className="text-sm font-semibold text-[#342E39]">想改什么？</legend>
            <div className="mt-2.5 flex flex-wrap gap-2">
              {CHANGE_TARGET_OPTIONS.map((option) => {
                const selected = draft.changeTargets.includes(option.value);
                const Icon = option.icon;
                return (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={selected}
                    disabled={disabled}
                    onClick={() => onToggleChangeTarget(option.value)}
                    className={cn(
                      'inline-flex min-h-10 items-center gap-2 rounded-xl border px-3.5 text-sm font-medium transition-colors disabled:cursor-wait disabled:opacity-60 motion-reduce:transition-none',
                      selected
                        ? 'border-[#9B84BE] bg-[#F2ECFF] text-[#604582]'
                        : 'border-transparent bg-[#F6F2F6] text-[#5F5663] hover:border-[#D9CEDC] hover:bg-white',
                    )}
                  >
                    <Icon className="h-4 w-4" aria-hidden />
                    {option.label}
                  </button>
                );
              })}
            </div>
          </fieldset>
        ) : null}

        <label htmlFor="image-studio-prompt" className={cn('block', lockSubject && 'mt-4')}>
          <span className="flex items-center gap-2 text-sm font-semibold text-[#342E39]">
            <Sparkles className="h-4 w-4 text-[#D62958]" aria-hidden />
            描述你想要的最终画面
          </span>
        </label>
        <Textarea
          id="image-studio-prompt"
          aria-label="描述你想要的最终画面"
          value={draft.prompt}
          maxLength={4_000}
          disabled={disabled}
          onChange={(event) => onPromptChange(event.target.value)}
          placeholder={
            lockSubject
              ? '例如：保持主角不变，把背景换成傍晚海边，柔和逆光，半身构图'
              : draft.goal === 'commercial'
                ? '例如：为新品香水制作一张夏日海报，留出标题空间，画面明亮精致'
                : '例如：一间洒满午后阳光的治愈系客厅，奶油色沙发和绿植'
          }
          className="mt-2.5 min-h-[132px] resize-y rounded-[16px] border-[#DED4DF] bg-white px-4 py-3 text-[15px] leading-7 text-[#342E39] shadow-none placeholder:text-[#A399A6] focus-visible:ring-[#D62958]/20"
        />
        <div className="mt-2 flex items-start justify-between gap-3 text-xs text-[#887D8B]">
          <span>把重点说清楚即可，生成后还可以继续调整。</span>
          <span className="shrink-0">{draft.prompt.length} / 4000</span>
        </div>

        {!lockSubject ? (
          <button
            type="button"
            onClick={onChooseImages}
            disabled={disabled}
            className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl border border-[#D8CFDA] bg-white px-4 text-sm font-semibold text-[#625666] transition-colors hover:border-[#AF9AB5] hover:bg-[#FBF8FC] disabled:opacity-60 motion-reduce:transition-none"
          >
            <ImagePlus className="h-4 w-4" aria-hidden />
            {uploading ? '正在上传…' : '添加参考图'}
          </button>
        ) : null}

        {references.length > 0 ? (
          <div className="mt-4 flex flex-wrap gap-2" aria-label="参考图">
            {references.map((attachment) => (
              <AttachmentChip
                key={attachment.clientId ?? attachment.fileId}
                attachment={attachment}
                disabled={disabled}
                actionLabel={lockSubject && attachment.status === 'ready' ? '设为主角' : undefined}
                onAction={
                  lockSubject && attachment.status === 'ready'
                    ? () => onSetSubject(attachment.clientId ?? attachment.fileId)
                    : undefined
                }
                onRemove={() => onRemoveAttachment(attachment.clientId ?? attachment.fileId)}
              />
            ))}
          </div>
        ) : null}

        {inlineError ? (
          <p role="alert" className="mt-3 rounded-xl bg-[#FFF0F3] px-3 py-2 text-sm text-[#B51E49]">
            {inlineError}
          </p>
        ) : null}

        {actions ? <div className="mt-4 border-t border-[#EEE8EE] pt-4">{actions}</div> : null}
      </div>
    </section>
  );
}
