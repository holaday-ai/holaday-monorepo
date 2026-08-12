import { Button } from '@/components/ui/button';
import { Wind } from 'lucide-react';
import * as React from 'react';

interface BreathRhythmGameProps {
  onComplete: () => void;
  reducedMotion: boolean;
}

export function BreathRhythmGame({
  onComplete,
  reducedMotion,
}: BreathRhythmGameProps): JSX.Element {
  const [step, setStep] = React.useState(0);
  const round = Math.floor(step / 2) + 1;
  const inhaling = step % 2 === 0;

  return (
    <div className="mx-auto max-w-xl text-center">
      <div
        className="mx-auto flex h-40 w-40 items-center justify-center rounded-full bg-[#e8f7ff] text-[#527f9e]"
        data-testid="breath-stage"
        data-motion={reducedMotion ? 'static' : inhaling ? 'expand' : 'settle'}
      >
        <Wind className="h-12 w-12" aria-hidden="true" />
      </div>
      <p className="mt-5 text-xs font-semibold tracking-[0.08em] text-[#7b6692]">
        第 {round} / 4 轮
      </p>
      <h3 className="mt-2 text-xl font-semibold text-[#342d38]" aria-live="polite">
        {inhaling ? '舒服地吸气' : '慢慢地呼气'}
      </h3>
      <p className="mt-2 text-sm leading-6 text-[#6f6572]">
        不用跟动画计时，准备好时按自己的节奏继续。
      </p>
      <Button
        type="button"
        className="mt-6 min-h-11 bg-[#765184] text-white hover:bg-[#664574]"
        onClick={() => {
          if (step === 7) {
            onComplete();
            return;
          }
          setStep((current) => current + 1);
        }}
      >
        {inhaling ? '继续到呼气' : `完成第 ${round} 轮`}
      </Button>
    </div>
  );
}
