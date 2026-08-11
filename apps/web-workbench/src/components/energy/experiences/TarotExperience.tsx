import { Button } from '@/components/ui/button';
import { BriefcaseBusiness, CircleHelp, Heart, Sparkles, SunMedium, Wind } from 'lucide-react';
import * as React from 'react';
import type { ExperiencePhase } from '../energy-types';
import type { EnergyTarotReading, EnergyYesNoTarotReading } from '../useEnergyAstrology';

type TarotTheme = 'work' | 'relationship' | 'space';
type TarotMode = 'daily' | 'yes-no';
type TarotStage = 'mode' | 'theme' | 'drawn' | 'revealed' | 'yes-no-ready';

interface TarotExperienceProps {
  tarot: EnergyTarotReading;
  yesNoTarot: EnergyYesNoTarotReading | null;
  yesNoLoading: boolean;
  onDrawYesNo: () => Promise<void>;
  phase: ExperiencePhase;
  onPhaseChange: (phase: ExperiencePhase) => void;
  onComplete?: () => void;
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

const ANSWER_LABELS: Record<EnergyYesNoTarotReading['answer'], string> = {
  yes: 'YES',
  no: 'NO',
  maybe: 'WAIT',
};

export function TarotExperience({
  tarot,
  yesNoTarot,
  yesNoLoading,
  onDrawYesNo,
  phase,
  onPhaseChange,
  onComplete = () => undefined,
}: TarotExperienceProps): JSX.Element {
  const [mode, setMode] = React.useState<TarotMode | null>(null);
  const [theme, setTheme] = React.useState<TarotTheme | null>(null);
  const [stage, setStage] = React.useState<TarotStage>('mode');
  const previousPhase = React.useRef(phase);

  React.useEffect(() => {
    if (previousPhase.current === 'result' && phase === 'active') {
      setMode(null);
      setTheme(null);
      setStage('mode');
    }
    previousPhase.current = phase;
  }, [phase]);

  if (stage === 'mode') {
    return (
      <div className="energy-tarot-mode">
        <p className="energy-kicker">选择抽卡方式</p>
        <h3>今天想听哪一种回应？</h3>
        <div className="energy-tarot-mode__grid">
          <button
            type="button"
            aria-label="今日卡"
            title="今日卡"
            onClick={() => {
              setMode('daily');
              setStage('theme');
            }}
          >
            <SunMedium aria-hidden="true" />
            <strong>今日卡</strong>
            <span>围绕工作、关系或自己，得到一条轻提示</span>
          </button>
          <button
            type="button"
            aria-label="是 / 否卡"
            title="是 / 否卡"
            onClick={() => {
              setMode('yes-no');
              setStage('yes-no-ready');
            }}
          >
            <CircleHelp aria-hidden="true" />
            <strong>是 / 否卡</strong>
            <span>心里默念问题，抽一张回答卡</span>
          </button>
        </div>
      </div>
    );
  }

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
          }}
        >
          开始抽卡
        </Button>
      </div>
    );
  }

  if (stage === 'yes-no-ready') {
    return (
      <div className="energy-yes-no-ready">
        <img src="/energy/tarot-cards.jpg" alt="色彩明亮的三张塔罗牌" />
        <p className="energy-kicker">是 / 否回答卡</p>
        <h3>把问题留在心里</h3>
        <p>只需要在心里默念一个可以用“是”或“否”回应的问题。问题不会被输入或上传。</p>
        <Button
          type="button"
          disabled={yesNoLoading}
          onClick={async () => {
            await onDrawYesNo();
            setStage('revealed');
            onComplete();
            onPhaseChange('result');
          }}
        >
          {yesNoLoading ? '正在抽取…' : '抽取回答卡'}
        </Button>
      </div>
    );
  }

  if (stage === 'drawn') {
    return (
      <div className="energy-tarot-drawn">
        <img src="/energy/tarot-cards.jpg" alt="等待翻开的塔罗牌" />
        <p>卡已经来到你面前，准备好再翻开。</p>
        <Button
          type="button"
          onClick={() => {
            setStage('revealed');
            onComplete();
            onPhaseChange('result');
          }}
        >
          翻开这张卡
        </Button>
      </div>
    );
  }

  if (mode === 'yes-no') {
    const result = yesNoTarot ?? {
      answer: 'maybe' as const,
      card: 'Temperance',
      category: 'Major Arcana',
      result: '先给自己一点时间，补足关键信息后再决定。',
    };
    return (
      <div className="energy-yes-no-result" aria-live="polite">
        <span>{ANSWER_LABELS[result.answer]}</span>
        <p>{result.category}</p>
        <h3>{result.card}</h3>
        <p>{result.result}</p>
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
