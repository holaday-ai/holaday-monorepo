import { cn } from '@/lib/utils';
import { Check } from 'lucide-react';
import { VIDEO_CREATION_SCENARIOS, type VideoCreationScenarioId } from './video-creation-scenarios';

export function VideoCreationScenarioPicker({
  value,
  disabled = false,
  onChange,
}: {
  value: VideoCreationScenarioId;
  disabled?: boolean;
  onChange(value: VideoCreationScenarioId): void;
}): JSX.Element {
  return (
    <section aria-labelledby="video-scenario-heading">
      <h2
        id="video-scenario-heading"
        className="text-[22px] font-semibold tracking-[-0.025em] text-[#2C2530] sm:text-[25px]"
      >
        这次想完成哪种视频？
      </h2>
      <div className="mt-4 grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {VIDEO_CREATION_SCENARIOS.map((scenario) => {
          const selected = scenario.id === value;
          return (
            <button
              key={scenario.id}
              type="button"
              aria-pressed={selected}
              disabled={disabled}
              onClick={() => onChange(scenario.id)}
              className={cn(
                'group relative min-h-[218px] overflow-hidden rounded-[20px] border bg-white text-left shadow-[0_8px_22px_rgba(58,45,64,0.045)] outline-none transition duration-200 focus-visible:ring-2 focus-visible:ring-[#D62958]/25 disabled:cursor-wait disabled:opacity-60 motion-reduce:transform-none motion-reduce:transition-none',
                selected
                  ? 'border-[#DF315D] ring-2 ring-[#DF315D]/75'
                  : 'border-[#E9E1E8] hover:-translate-y-0.5 hover:border-[#CFC3D0] hover:shadow-[0_16px_34px_rgba(58,45,64,0.08)] motion-reduce:hover:translate-y-0',
              )}
            >
              <img
                src={scenario.image}
                alt=""
                aria-hidden
                decoding="async"
                className={cn('h-[132px] w-full object-cover', scenario.imagePosition)}
              />
              {selected ? (
                <span className="absolute right-3 top-3 inline-flex h-8 w-8 items-center justify-center rounded-full border-2 border-white bg-[#DF315D] text-white shadow-[0_4px_12px_rgba(64,34,50,0.24)]">
                  <Check className="h-4 w-4" aria-hidden />
                </span>
              ) : null}
              <span className="block px-4 py-3.5">
                <span className="mb-2 flex flex-wrap gap-1.5 text-[10px] font-semibold text-[#7C7380]">
                  <span className="rounded-full bg-[#F6F2F6] px-2 py-1">{scenario.aspect}</span>
                  <span className="rounded-full bg-[#F6F2F6] px-2 py-1">{scenario.duration}</span>
                </span>
                <span className="block text-[16px] font-semibold text-[#302936]">
                  {scenario.title}
                </span>
                <span className="mt-1 block text-xs leading-5 text-[#766D7B]">
                  {scenario.description}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
