import { Button } from '@/components/ui/button';
import { Check, Sparkles } from 'lucide-react';
import * as React from 'react';
import type { EnergyNeed, ExperiencePhase } from '../energy-types';

interface RechargeExperienceProps {
  need: EnergyNeed;
  phase: ExperiencePhase;
  onPhaseChange: (phase: ExperiencePhase) => void;
  onComplete: (need: EnergyNeed) => void;
}

const CONTENT: Record<
  EnergyNeed,
  { label: string; steps: readonly [string, string, string]; action: string }
> = {
  focus: {
    label: '专注',
    steps: ['把通知放到一边', '只看眼前这一小步', '把第一分钟交给它'],
    action: '写下唯一要完成的小目标，然后先做一分钟。',
  },
  relax: {
    label: '放松',
    steps: ['先慢慢松开', '把呼吸放长一点', '把空白留给自己'],
    action: '先喝一口水，再回到最需要处理的一件事。',
  },
  confidence: {
    label: '自信',
    steps: ['看见已经完成的部分', '想起一次做成的经验', '允许自己先迈一小步'],
    action: '选一个五分钟内能完成的动作，用结果替代怀疑。',
  },
  uplift: {
    label: '好心情',
    steps: ['找到一件值得期待的小事', '让表情和肩膀都松一点', '把轻盈带回今天'],
    action: '给自己一个小奖励，再带着好状态继续今天。',
  },
};

export function RechargeExperience({
  need,
  phase,
  onPhaseChange,
  onComplete,
}: RechargeExperienceProps): JSX.Element {
  const [step, setStep] = React.useState(0);
  const content = CONTENT[need];

  const complete = React.useCallback(() => {
    onComplete(need);
    onPhaseChange('result');
  }, [need, onComplete, onPhaseChange]);

  const advance = React.useCallback(() => {
    if (step >= content.steps.length - 1) {
      complete();
      return;
    }
    setStep((current) => current + 1);
  }, [complete, content.steps.length, step]);

  React.useEffect(() => {
    if (phase !== 'active') return;
    const timer = window.setTimeout(advance, 10_000);
    return () => window.clearTimeout(timer);
  }, [advance, phase]);

  React.useEffect(() => {
    if (phase === 'active') setStep(0);
  }, [phase]);

  if (phase === 'result') {
    return (
      <div className="energy-recharge-result" aria-live="polite">
        <span className="energy-recharge-result__icon" aria-hidden="true">
          <Check />
        </span>
        <h3>{content.label}能量已点亮</h3>
        <p>{content.action}</p>
      </div>
    );
  }

  return (
    <div className="energy-recharge-flow">
      <div className="energy-recharge-orb" aria-hidden="true">
        <Sparkles />
      </div>
      <p className="energy-kicker">第 {step + 1} / 3 步</p>
      <h3 aria-live="polite">{content.steps[step]}</h3>
      <p>跟着光点停留十秒，也可以按自己的节奏继续。</p>
      <ol className="energy-recharge-steps" aria-label="补给进度">
        {content.steps.map((label, index) => (
          <li key={label} data-active={index <= step ? 'true' : 'false'}>
            <Sparkles aria-hidden="true" />
            <span className="sr-only">{label}</span>
          </li>
        ))}
      </ol>
      <div className="energy-recharge-actions">
        <Button type="button" onClick={advance}>
          {step === content.steps.length - 1 ? '完成这次补给' : '点亮下一步'}
        </Button>
        <Button type="button" variant="ghost" onClick={complete}>
          立即完成
        </Button>
      </div>
    </div>
  );
}
