import { Button } from '@/components/ui/button';
import { Check, ChevronLeft, ChevronRight, Sparkles } from 'lucide-react';
import * as React from 'react';
import type { EnergyPracticeId } from '../energy-content-target';
import { recordPracticeCompletion } from '../energy-progress';
import type { ExperiencePhase } from '../energy-types';
import { practiceById } from './practice-content';

interface PracticeExperienceProps {
  initialPracticeId: EnergyPracticeId;
  profileStorageScope: string | null;
  phase: ExperiencePhase;
  onPhaseChange: (phase: ExperiencePhase) => void;
  onComplete: () => void;
}

export function PracticeExperience({
  initialPracticeId,
  profileStorageScope,
  phase,
  onPhaseChange,
  onComplete,
}: PracticeExperienceProps): JSX.Element {
  const practice = practiceById(initialPracticeId);
  const [stepIndex, setStepIndex] = React.useState(0);

  React.useEffect(() => {
    if (phase === 'active') setStepIndex(0);
  }, [initialPracticeId, phase]);

  const complete = (): void => {
    recordPracticeCompletion(profileStorageScope, initialPracticeId);
    onComplete();
    onPhaseChange('result');
  };

  if (phase === 'result') {
    return (
      <div className="mx-auto max-w-xl text-center" aria-live="polite">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[#e9f8ef] text-[#4f8a68]">
          <Check aria-hidden="true" />
        </span>
        <h3 className="mt-4 text-xl font-semibold text-[#342d38]">{practice.completionTitle}</h3>
        <p className="mt-2 text-sm leading-6 text-[#6f6572]">{practice.completionAction}</p>
      </div>
    );
  }

  const step = practice.steps[stepIndex] ?? practice.steps[0];
  if (!step) throw new Error(`Practice ${practice.id} has no steps`);
  const isLast = stepIndex === practice.steps.length - 1;

  return (
    <div className="mx-auto max-w-xl" data-practice-tone={practice.tone}>
      <header className="text-center">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-[20px] bg-[#f1e9ff] text-[#7655a5]">
          <Sparkles aria-hidden="true" />
        </span>
        <p className="mt-4 text-xs font-semibold tracking-[0.08em] text-[#8d6c9f]">
          {practice.title} · 约 {practice.estimatedSeconds} 秒
        </p>
        <h3 className="mt-2 text-xl font-semibold text-[#342d38]" aria-live="polite">
          {step.title}
        </h3>
        <p className="mt-2 text-sm leading-6 text-[#6f6572]">{step.body}</p>
      </header>

      <progress
        className="mt-6 h-2 w-full accent-[#8f6aad]"
        aria-label="练习进度"
        value={stepIndex + 1}
        max={practice.steps.length}
        aria-valuenow={stepIndex + 1}
      />
      <p className="mt-2 text-center text-xs text-[#8a7d8c]">
        第 {stepIndex + 1} / {practice.steps.length} 步 · 按自己的节奏继续
      </p>

      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <Button
          type="button"
          variant="outline"
          className="min-h-11"
          disabled={stepIndex === 0}
          onClick={() => setStepIndex((current) => Math.max(0, current - 1))}
        >
          <ChevronLeft aria-hidden="true" />
          上一步
        </Button>
        <Button
          type="button"
          className="min-h-11 bg-[#765184] text-white hover:bg-[#664574]"
          onClick={() => (isLast ? complete() : setStepIndex((current) => current + 1))}
        >
          {isLast ? '完成练习' : '下一步'}
          {!isLast ? <ChevronRight aria-hidden="true" /> : null}
        </Button>
        <Button type="button" variant="ghost" className="min-h-11" onClick={complete}>
          立即完成
        </Button>
      </div>
    </div>
  );
}
