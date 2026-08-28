import { ArrowRight, Settings2, Sparkles } from 'lucide-react';
import * as React from 'react';
import { ImageBriefComposer } from '@/components/image/ImageBriefComposer';
import { ImageGenerationSettings } from '@/components/image/ImageGenerationSettings';
import { ImageGoalPicker } from '@/components/image/ImageGoalPicker';
import {
  createImageStudioDraft,
  setImageStudioSetting,
  switchImageCreationGoal,
  type ImageStudioDraft,
  type ImageStudioSettingKey,
} from '@/components/image/image-studio-state';
import { Button } from '@/components/ui/button';
import type { CommercialImageUse, ImageChangeTarget } from '@/types/image';

export function ImagePage(): JSX.Element {
  const [draft, setDraft] = React.useState(() => createImageStudioDraft('inspiration'));
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const settingsTriggerRef = React.useRef<HTMLButtonElement>(null);

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

          <div className="mt-4">
            <ImageBriefComposer
              draft={draft}
              uploading={false}
              inlineError={null}
              onPromptChange={(prompt) => setDraft((current) => ({ ...current, prompt }))}
              onToggleChangeTarget={toggleChangeTarget}
              onChooseImages={() => undefined}
              onRemoveAttachment={() => undefined}
              onSetSubject={() => undefined}
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
                <span className="mt-0.5 block text-xs text-[#7A707D]">
                  {settingSummary(draft)}
                </span>
              </span>
            </button>

            <Button
              type="button"
              className="min-h-12 rounded-xl bg-[#D62958] px-8 text-sm font-semibold text-white shadow-[0_10px_24px_rgba(214,41,88,0.2)] hover:bg-[#BE214B]"
            >
              <Sparkles className="mr-2 h-4 w-4" aria-hidden />
              开始生成
            </Button>
          </div>

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
        </div>
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
