import { Button } from '@/components/ui/button';
import { CheckCircle2, Vote } from 'lucide-react';
import * as React from 'react';
import type { EnergyPollId } from '../energy-content-target';
import { readEnergyProgress, savePollSelection } from '../energy-progress';
import type { ExperiencePhase } from '../energy-types';
import { pollById } from './poll-content';

interface PollExperienceProps {
  initialPollId: EnergyPollId;
  profileStorageScope: string | null;
  phase: ExperiencePhase;
  onPhaseChange: (phase: ExperiencePhase) => void;
}

export function PollExperience({
  initialPollId,
  profileStorageScope,
  phase,
  onPhaseChange,
}: PollExperienceProps): JSX.Element {
  const poll = pollById(initialPollId);
  const [selectedId, setSelectedId] = React.useState<string | null>(
    () => readEnergyProgress(profileStorageScope).continuation.pollSelections[initialPollId] ?? null,
  );
  const [showResult, setShowResult] = React.useState(false);
  const resultRef = React.useRef<HTMLHeadingElement>(null);

  React.useEffect(() => {
    if (showResult) resultRef.current?.focus();
  }, [showResult]);

  React.useEffect(() => {
    if (phase === 'active') setShowResult(false);
  }, [initialPollId, phase]);

  const selected = poll.options.find((option) => option.id === selectedId) ?? null;

  if (showResult && selected) {
    return (
      <div className="mx-auto max-w-xl text-center">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[#e8f8ef] text-[#4f8c67]">
          <CheckCircle2 aria-hidden="true" />
        </span>
        <h3
          ref={resultRef}
          tabIndex={-1}
          className="mt-4 text-xl font-semibold text-[#342d38] outline-none"
        >
          你的选择，值得被照顾
        </h3>
        <p className="mt-3 text-sm leading-6 text-[#665d69]">{selected.interpretation}</p>
        <div className="mt-4 rounded-2xl bg-[#f8f1ff] p-4 text-left text-sm leading-6 text-[#5d4967]">
          <strong>现在可以做：</strong> {selected.suggestion}
        </div>
        <Button
          type="button"
          variant="outline"
          className="mt-5 min-h-11"
          onClick={() => {
            setShowResult(false);
            onPhaseChange('active');
          }}
        >
          重新选择
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl">
      <header className="text-center">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-[20px] bg-[#eaf7ff] text-[#4f7f9d]">
          <Vote aria-hidden="true" />
        </span>
        <p className="mt-4 text-xs font-semibold tracking-[0.08em] text-[#7a6592]">今日轻投票</p>
        <h3 className="mt-2 text-xl font-semibold text-[#342d38]">{poll.title}</h3>
        <p className="mt-2 text-sm leading-6 text-[#6f6572]">{poll.prompt}</p>
      </header>

      <fieldset className="mt-6 grid gap-3 border-0 p-0">
        <legend className="sr-only">{poll.prompt}</legend>
        {poll.options.map((option) => (
          <label
            key={option.id}
            className="flex min-h-11 cursor-pointer items-center gap-3 rounded-2xl border border-[#e6dfe8] bg-white px-4 py-3 text-sm text-[#443b48] transition focus-within:ring-2 focus-within:ring-[#8f6aad] has-[:checked]:border-[#ad88c2] has-[:checked]:bg-[#fbf5ff]"
          >
            <input
              type="radio"
              name={`energy-poll-${initialPollId}`}
              value={option.id}
              checked={selectedId === option.id}
              onChange={() => {
                setSelectedId(option.id);
                savePollSelection(profileStorageScope, initialPollId, option.id);
                setShowResult(true);
                onPhaseChange('result');
              }}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </fieldset>
      <p className="mt-4 text-center text-xs leading-5 text-[#8a7f8d]">
        选择只保存在当前设备，不显示未经统计的比例。
      </p>
    </div>
  );
}
