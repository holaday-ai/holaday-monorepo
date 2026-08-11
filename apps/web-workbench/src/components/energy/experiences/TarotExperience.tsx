import { Button } from '@/components/ui/button';
import { BriefcaseBusiness, Heart, Sparkles, Wind } from 'lucide-react';
import * as React from 'react';
import type { ExperiencePhase } from '../energy-types';
import type { EnergyTarotReading } from '../useEnergyAstrology';

type TarotTheme = 'work' | 'relationship' | 'space';
type TarotStage = 'theme' | 'drawn' | 'revealed';

interface TarotExperienceProps {
  tarot: EnergyTarotReading;
  phase: ExperiencePhase;
  onPhaseChange: (phase: ExperiencePhase) => void;
}

const THEMES: Array<{
  id: TarotTheme;
  label: string;
  body: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: 'work', label: '工作推进', body: '给卡住的一步一点提示', icon: BriefcaseBusiness },
  { id: 'relationship', label: '关系回应', body: '看看今天适合怎样表达', icon: Heart },
  { id: 'space', label: '给自己空间', body: '把注意力轻轻放回自己', icon: Wind },
];

const ACTIONS: Record<TarotTheme, string> = {
  work: '今天只推进一件最重要的小事，做到能看见变化就停一下。',
  relationship: '把想说的话缩成一句具体、柔和、容易回应的表达。',
  space: '留十分钟不接收新信息，让身体和注意力都慢下来。',
};

export function TarotExperience({
  tarot,
  phase,
  onPhaseChange,
}: TarotExperienceProps): JSX.Element {
  const [theme, setTheme] = React.useState<TarotTheme | null>(null);
  const [stage, setStage] = React.useState<TarotStage>('theme');
  const previousPhase = React.useRef(phase);

  React.useEffect(() => {
    if (previousPhase.current === 'result' && phase === 'active') {
      setTheme(null);
      setStage('theme');
    }
    previousPhase.current = phase;
  }, [phase]);

  if (stage === 'theme') {
    return (
      <div className="mx-auto max-w-xl text-center">
        <span className="mx-auto inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-[#f4e9f4] text-[#825c91]">
          <Sparkles className="h-5 w-5" aria-hidden="true" />
        </span>
        <h3 className="mt-4 text-xl font-semibold text-[#332c38]">这张卡想回应什么？</h3>
        <p className="mt-2 text-sm leading-6 text-[#756b78]">选一个最接近此刻的方向就好。</p>
        <fieldset className="mt-6 grid gap-3 border-0 p-0 sm:grid-cols-3" aria-label="抽卡主题">
          {THEMES.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                className="rounded-2xl border border-[#e4dce5] bg-white p-4 text-left transition hover:-translate-y-0.5 hover:border-[#bea8c7] hover:bg-[#fefbff] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8f6a9d] aria-pressed:border-[#8e679e] aria-pressed:bg-[#f8effb]"
                aria-pressed={theme === item.id}
                onClick={() => setTheme(item.id)}
              >
                <Icon className="h-5 w-5 text-[#825c91]" aria-hidden="true" />
                <strong className="mt-3 block text-sm text-[#3e3542]">{item.label}</strong>
                <span className="mt-1 block text-xs leading-5 text-[#7c7180]">{item.body}</span>
              </button>
            );
          })}
        </fieldset>
        <Button
          type="button"
          size="lg"
          className="mt-6 min-w-36 rounded-xl bg-[#765184] hover:bg-[#664574]"
          disabled={!theme}
          onClick={() => {
            if (!theme) return;
            setStage('drawn');
            onPhaseChange('active');
          }}
        >
          开始抽卡
        </Button>
      </div>
    );
  }

  if (stage === 'drawn') {
    return (
      <div className="flex min-h-[340px] flex-col items-center justify-center text-center">
        <div className="flex h-52 w-36 items-center justify-center rounded-[22px] border border-[#cdb8d5] bg-[radial-gradient(circle_at_top,#9673a5,#4d3858)] shadow-[0_22px_48px_rgba(70,48,81,0.28)] transition-transform duration-500 motion-reduce:transition-none">
          <span className="flex h-16 w-16 items-center justify-center rounded-full border border-white/35 text-white/90">
            <Sparkles className="h-7 w-7" aria-hidden="true" />
          </span>
        </div>
        <p className="mt-5 text-sm text-[#756a79]">卡已经来到你面前，准备好再翻开。</p>
        <Button
          type="button"
          className="mt-5 rounded-xl bg-[#765184] hover:bg-[#664574]"
          onClick={() => {
            setStage('revealed');
            onPhaseChange('result');
          }}
        >
          翻开这张卡
        </Button>
      </div>
    );
  }

  const selectedTheme = theme ?? 'space';
  return (
    <div className="mx-auto max-w-xl rounded-3xl border border-[#dfd0e4] bg-[linear-gradient(145deg,#fbf5fd,#fff)] p-6 text-center shadow-[0_16px_44px_rgba(75,52,86,0.12)]">
      <span className="text-xs font-semibold tracking-[0.12em] text-[#846092]">今日轻提示</span>
      <h3 className="mt-3 text-2xl font-semibold tracking-[-0.02em] text-[#352d39]">
        {tarot.title}
      </h3>
      <p className="mt-1 text-sm font-medium text-[#805c8e]">{tarot.subtitle}</p>
      <p className="mx-auto mt-4 max-w-md text-sm leading-7 text-[#655b69]">{tarot.body}</p>
      <div className="mt-5 rounded-2xl bg-white/80 p-4 text-left">
        <strong className="text-xs text-[#805c8e]">带回今天的行动</strong>
        <p className="mt-1 text-sm leading-6 text-[#5f5563]">{ACTIONS[selectedTheme]}</p>
      </div>
    </div>
  );
}
