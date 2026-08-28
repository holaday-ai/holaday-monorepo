import {
  Crop,
  ImagePlus,
  Palette,
  PersonStanding,
  Sparkles,
  SunMedium,
  Wallpaper,
} from 'lucide-react';
import { AttachmentChip } from '@/components/AttachmentChip';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import type { ImageChangeTarget } from '@/types/image';
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
  inlineError: string | null;
  onPromptChange(value: string): void;
  onToggleChangeTarget(value: ImageChangeTarget): void;
  onChooseImages(): void;
  onRemoveAttachment(clientId: string): void;
  onSetSubject(clientId: string): void;
}

export function ImageBriefComposer({
  draft,
  uploading,
  inlineError,
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
      className={cn(
        'grid gap-3',
        lockSubject ? 'lg:grid-cols-[minmax(220px,280px)_minmax(0,1fr)]' : 'grid-cols-1',
      )}
    >
      {lockSubject ? (
        <div className="rounded-[24px] border border-[#E7DFE8] bg-[#FFFEFB] p-4 shadow-[0_10px_24px_rgba(62,50,68,0.04)]">
          <div className="text-sm font-semibold text-[#342E39]">添加主角图</div>
          <p className="mt-1 text-xs leading-5 text-[#7B717F]">人物、宠物、商品或 IP；建议主体清晰。</p>
          {subject ? (
            <div className="mt-4">
              <AttachmentChip
                attachment={subject}
                badge="主角"
                onRemove={() => onRemoveAttachment(subject.clientId ?? subject.fileId)}
              />
            </div>
          ) : (
            <button
              type="button"
              aria-label="添加主角图"
              title="添加主角图"
              onClick={onChooseImages}
              disabled={uploading}
              className="mt-4 flex min-h-[150px] w-full flex-col items-center justify-center rounded-[18px] border border-dashed border-[#CFC3D2] bg-[#FDF9FF] px-4 text-center text-[#675B6D] transition-colors hover:border-[#9C87AA] hover:bg-[#FAF3FF] disabled:cursor-wait disabled:opacity-60 motion-reduce:transition-none"
            >
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#EEE6FF] text-[#7252A0]">
                <ImagePlus className="h-5 w-5" aria-hidden />
              </span>
              <span className="mt-3 text-sm font-semibold">{uploading ? '正在上传…' : '添加主角图'}</span>
              <span className="mt-1 text-[11px] text-[#8A7E8D]">JPG / PNG / WebP</span>
            </button>
          )}
        </div>
      ) : null}

      <div className="rounded-[24px] border border-[#E7DFE8] bg-[#FFFEFB] p-4 shadow-[0_10px_24px_rgba(62,50,68,0.04)] sm:p-5">
        {lockSubject ? (
          <div role="group" aria-label="想改什么">
            <div className="text-sm font-semibold text-[#342E39]">想改什么？</div>
            <div className="mt-3 flex flex-wrap gap-2">
              {CHANGE_TARGET_OPTIONS.map((option) => {
                const selected = draft.changeTargets.includes(option.value);
                const Icon = option.icon;
                return (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => onToggleChangeTarget(option.value)}
                    className={cn(
                      'inline-flex min-h-11 items-center gap-2 rounded-xl border px-3.5 text-sm font-medium transition-colors motion-reduce:transition-none',
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
          </div>
        ) : null}

        <label htmlFor="image-studio-prompt" className={cn('block', lockSubject && 'mt-5')}>
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
          onChange={(event) => onPromptChange(event.target.value)}
          placeholder={
            lockSubject
              ? '例如：保持主角不变，把背景换成傍晚海边，柔和逆光，半身构图'
              : draft.goal === 'commercial'
                ? '例如：为新品香水制作一张夏日海报，留出标题空间，画面明亮精致'
                : '例如：一间洒满午后阳光的治愈系客厅，奶油色沙发和绿植'
          }
          className="mt-3 min-h-[154px] resize-y rounded-[18px] border-[#DED4DF] bg-white px-4 py-3 text-[15px] leading-7 text-[#342E39] shadow-none placeholder:text-[#A399A6] focus-visible:ring-[#D62958]/20"
        />
        <div className="mt-2 flex items-start justify-between gap-3 text-xs text-[#887D8B]">
          <span>把重点说清楚即可，生成后还可以继续调整。</span>
          <span className="shrink-0">{draft.prompt.length} / 4000</span>
        </div>

        {!lockSubject ? (
          <button
            type="button"
            onClick={onChooseImages}
            disabled={uploading}
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
      </div>
    </section>
  );
}
