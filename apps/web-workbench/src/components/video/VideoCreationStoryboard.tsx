import { ArrowRight, Info } from 'lucide-react';
import type { VideoCreationScenario } from './video-creation-scenarios';

export function VideoCreationStoryboard({
  scenario,
}: {
  scenario: VideoCreationScenario;
}): JSX.Element {
  return (
    <section aria-labelledby="video-storyboard-heading">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2
          id="video-storyboard-heading"
          className="text-[15px] font-semibold text-[#3C3440] sm:text-[16px]"
        >
          向 HOLA DAY 描述你的{scenario.title}
        </h2>
        <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-[#817783]">
          示例脚本
          <Info className="h-3.5 w-3.5" aria-hidden />
        </span>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        {scenario.storyboard.map((beat, index) => (
          <figure key={`${scenario.id}-${beat.label}`} className="min-w-0">
            <div className="group relative overflow-hidden rounded-[17px] bg-[#F4EFF3]">
              <img
                src={beat.image}
                alt={`${scenario.title}的${beat.label}镜头示意`}
                decoding="async"
                className="h-[196px] w-full object-cover transition duration-300 group-hover:scale-[1.025] motion-reduce:transform-none motion-reduce:transition-none"
                style={{ objectPosition: `${index === 0 ? 34 : index === 1 ? 52 : 70}% center` }}
              />
              {index < scenario.storyboard.length - 1 ? (
                <span className="absolute -right-3 top-1/2 z-10 hidden h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full border border-[#E6DEE5] bg-white text-[#877D89] shadow-sm sm:flex">
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                </span>
              ) : null}
            </div>
            <figcaption className="px-1 pt-3">
              <span className="inline-flex rounded-full bg-[#FCE7ED] px-2.5 py-1 text-[11px] font-semibold text-[#B22D52]">
                {beat.label}
              </span>
              <span className="mt-2 block text-[12px] font-medium leading-5 text-[#4B424E]">
                {beat.title}
              </span>
              <span className="mt-0.5 block text-[11px] text-[#8B818D]">{beat.duration}</span>
            </figcaption>
          </figure>
        ))}
      </div>

      <p className="mt-4 inline-flex items-center gap-2 rounded-full bg-[#F7F3F7] px-3 py-2 text-[11px] text-[#756B78]">
        <span className="h-1.5 w-1.5 rounded-full bg-[#D52C59]" aria-hidden />
        AI 会根据你的素材和重点调整镜头顺序
      </p>
    </section>
  );
}
