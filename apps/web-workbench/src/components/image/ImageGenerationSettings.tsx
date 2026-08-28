import * as Dialog from '@radix-ui/react-dialog';
import { Check, SlidersHorizontal, X } from 'lucide-react';
import type * as React from 'react';
import { cn } from '@/lib/utils';
import {
  IMAGE_ASPECT_OPTIONS,
  IMAGE_MODEL_OPTIONS,
  IMAGE_STYLE_OPTIONS,
} from './image-studio-options';
import type { ImageStudioDraft, ImageStudioSettingKey } from './image-studio-state';

interface ImageGenerationSettingsProps {
  open: boolean;
  draft: ImageStudioDraft;
  returnFocusRef: React.RefObject<HTMLButtonElement>;
  onOpenChange(open: boolean): void;
  onSettingChange<K extends ImageStudioSettingKey>(key: K, value: ImageStudioDraft[K]): void;
}

export function ImageGenerationSettings({
  open,
  draft,
  returnFocusRef,
  onOpenChange,
  onSettingChange,
}: ImageGenerationSettingsProps): JSX.Element {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[90] bg-[#3D3645]/25 backdrop-blur-[2px] data-[state=open]:animate-fade-in motion-reduce:animate-none" />
        <Dialog.Content
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            returnFocusRef.current?.focus();
          }}
          className="fixed z-[91] overflow-y-auto border border-[#E7DEE7] bg-[#FFFDF8] p-5 text-[#342E39] shadow-[0_28px_80px_rgba(52,38,59,0.18)] outline-none motion-reduce:transform-none motion-reduce:transition-none max-md:inset-x-0 max-md:bottom-0 max-md:max-h-[92vh] max-md:w-full max-md:rounded-t-[28px] max-md:rounded-b-none max-md:border-x-0 max-md:border-b-0 md:left-1/2 md:top-1/2 md:max-h-[88vh] md:w-[min(960px,calc(100vw-24px))] md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-[28px] md:p-7"
        >
          <div className="flex items-start justify-between gap-4 pr-12">
            <div>
              <Dialog.Title className="flex items-center gap-2 text-xl font-semibold tracking-[-0.02em]">
                <SlidersHorizontal className="h-5 w-5 text-[#D62958]" aria-hidden />
                生成设置
              </Dialog.Title>
              <Dialog.Description className="mt-1.5 text-sm leading-6 text-[#766C79]">
                推荐值已经配好；只有需要时再调整。
              </Dialog.Description>
            </div>
          </div>
          <Dialog.Close asChild>
            <button
              type="button"
              aria-label="关闭生成设置"
              title="关闭生成设置"
              className="absolute right-5 top-5 flex h-11 w-11 items-center justify-center rounded-full border border-[#E3D9E4] bg-white text-[#716675] transition-colors hover:bg-[#F8F2F7] motion-reduce:transition-none"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </Dialog.Close>

          <div className="mt-7 space-y-7">
            <SettingGroup label="模型">
              <div className="grid gap-3 sm:grid-cols-2">
                {IMAGE_MODEL_OPTIONS.map((option) => {
                  const selected = draft.model === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => onSettingChange('model', option.value)}
                      className={cn(
                        'min-h-[112px] rounded-[18px] border bg-white p-4 text-left transition-colors motion-reduce:transition-none',
                        selected
                          ? 'border-[#4B8EEA] ring-2 ring-[#4B8EEA]/10'
                          : 'border-[#E5DDE6] hover:border-[#BFB1C3]',
                      )}
                    >
                      <span className="flex items-center justify-between gap-3">
                        <span className="font-semibold">
                          {option.name} {option.version}
                        </span>
                        {selected ? <Check className="h-4 w-4 text-[#347AD6]" aria-hidden /> : null}
                      </span>
                      <span className="mt-2 block text-xs leading-5 text-[#776D7A]">
                        {option.description}
                      </span>
                      <span className="mt-2 flex flex-wrap gap-1.5">
                        {option.badges.map((badge) => (
                          <span
                            key={badge}
                            className="rounded-full bg-[#EEF5FF] px-2 py-1 text-[10px] font-semibold text-[#3E6EAA]"
                          >
                            {badge}
                          </span>
                        ))}
                      </span>
                    </button>
                  );
                })}
              </div>
            </SettingGroup>

            <SettingGroup label="风格">
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 lg:grid-cols-8">
                {IMAGE_STYLE_OPTIONS.map((option) => {
                  const selected = draft.style === option.key;
                  return (
                    <button
                      key={option.key}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => onSettingChange('style', option.key)}
                      className={cn(
                        'relative overflow-hidden rounded-[16px] border bg-white text-left transition-colors motion-reduce:transition-none',
                        selected
                          ? 'border-[#8C6DB4] ring-2 ring-[#8C6DB4]/15'
                          : 'border-[#E5DDE6] hover:border-[#BDAFC1]',
                      )}
                    >
                      <img
                        src={`/image-style-previews/${option.key}.png`}
                        alt=""
                        aria-hidden
                        className="aspect-[4/3] w-full bg-[#F7F3F5] object-contain p-1"
                      />
                      <span className="flex min-h-11 items-center justify-between gap-1 px-2 py-1.5 text-[11px] font-semibold text-[#504755]">
                        {option.label}
                        {selected ? (
                          <Check className="h-3.5 w-3.5 shrink-0 text-[#7953A5]" aria-hidden />
                        ) : null}
                      </span>
                    </button>
                  );
                })}
              </div>
            </SettingGroup>

            <div className="grid gap-6 md:grid-cols-2">
              <SettingGroup label="比例">
                <div className="flex flex-wrap gap-2">
                  {IMAGE_ASPECT_OPTIONS.map((option) => (
                    <ChoiceButton
                      key={option.value}
                      selected={draft.aspectRatio === option.value}
                      onClick={() => onSettingChange('aspectRatio', option.value)}
                    >
                      {option.label}
                    </ChoiceButton>
                  ))}
                </div>
              </SettingGroup>
              <SettingGroup label="生成数量">
                <div className="flex flex-wrap gap-2">
                  {([1, 2, 3, 4] as const).map((count) => (
                    <ChoiceButton
                      key={count}
                      selected={draft.imageCount === count}
                      onClick={() => onSettingChange('imageCount', count)}
                    >
                      {count} 张
                    </ChoiceButton>
                  ))}
                </div>
              </SettingGroup>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function SettingGroup({
  label,
  children,
}: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <fieldset aria-label={label} className="min-w-0">
      <legend className="mb-3 text-sm font-semibold text-[#423A46]">{label}</legend>
      {children}
    </fieldset>
  );
}

function ChoiceButton({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick(): void;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        'min-h-11 min-w-16 rounded-xl border px-4 text-sm font-semibold transition-colors motion-reduce:transition-none',
        selected
          ? 'border-[#4B8EEA] bg-[#EEF5FF] text-[#316BAF]'
          : 'border-[#DED5E0] bg-white text-[#625967] hover:border-[#B9AABB]',
      )}
    >
      {children}
    </button>
  );
}
