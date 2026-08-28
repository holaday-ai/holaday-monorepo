import { Clapperboard, FileVideo2, Sparkles } from 'lucide-react';
import type { VideoEditingDocument } from './video-editing-state';

function durationLabel(startMs: number, endMs: number): string {
  const seconds = (endMs - startMs) / 1_000;
  return `${Number.isInteger(seconds) ? seconds.toFixed(0) : seconds.toFixed(1)} 秒`;
}

export function SceneStrip({
  scenes,
  previewUrl,
  selectedSceneId,
  affectedSceneIds = [],
  onSelect,
}: {
  scenes: VideoEditingDocument['scenes'];
  previewUrl: string;
  selectedSceneId: string | null;
  affectedSceneIds?: string[];
  onSelect(sceneId: string): void;
}): JSX.Element {
  const affected = new Set(affectedSceneIds);
  return (
    <section aria-labelledby="video-scenes-title" className="mt-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h2 id="video-scenes-title" className="text-[15px] font-semibold text-[#2F2B35]">
            当前片段
          </h2>
          <p className="mt-0.5 text-xs text-[#7A7480]">按顺序查看，选择后再告诉 AI 怎么改</p>
        </div>
        <span className="rounded-full bg-[#F5F1F7] px-2.5 py-1 text-[11px] font-medium text-[#746B78]">
          {scenes.length} 段
        </span>
      </div>

      <div className="-mx-1 flex snap-x snap-mandatory gap-3 overflow-x-auto px-1 pb-2 sm:mx-0 sm:grid sm:snap-none sm:grid-cols-2 sm:overflow-visible sm:px-0 sm:pb-0 xl:grid-cols-3">
        {scenes.map((scene, index) => {
          const selected = scene.id === selectedSceneId;
          const willChange = affected.has(scene.id);
          const generated = scene.generationContext !== null;
          const seekSeconds = Math.max(0.001, scene.sourceStartMs / 1_000);
          return (
            <button
              key={scene.id}
              type="button"
              aria-label={`选择第 ${index + 1} 段`}
              aria-pressed={selected}
              onClick={() => onSelect(scene.id)}
              className={`group min-w-[78vw] snap-start overflow-hidden rounded-[18px] border bg-white text-left transition duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#EA1F59]/35 sm:min-w-0 ${
                selected
                  ? 'border-[#EA1F59] shadow-[0_10px_28px_rgba(234,31,89,0.12)]'
                  : 'border-[#E8E2E9] shadow-[0_4px_16px_rgba(66,43,71,0.05)] hover:-translate-y-0.5 hover:border-[#D9C8DC]'
              }`}
            >
              <div className="relative aspect-video overflow-hidden bg-[#F7F3F8]">
                <video
                  aria-label={`第 ${index + 1} 段缩略预览`}
                  src={`${previewUrl}#t=${seekSeconds}`}
                  muted
                  playsInline
                  preload="metadata"
                  className="h-full w-full object-cover"
                />
                <span className="absolute left-2 top-2 rounded-full bg-black/65 px-2 py-1 text-[10px] font-semibold text-white backdrop-blur-sm">
                  {index + 1}
                </span>
                <span className="absolute bottom-2 right-2 rounded-full bg-white/90 px-2 py-1 text-[10px] font-medium text-[#4A424D] shadow-sm backdrop-blur-sm">
                  {durationLabel(scene.sourceStartMs, scene.sourceEndMs)}
                </span>
              </div>
              <div className="p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1 text-[11px] font-medium text-[#776D7A]">
                    {generated ? (
                      <Sparkles className="h-3 w-3 text-[#B75AA0]" aria-hidden="true" />
                    ) : (
                      <FileVideo2 className="h-3 w-3 text-[#7A82A6]" aria-hidden="true" />
                    )}
                    {generated ? '生成片段' : '原片素材'}
                  </span>
                  {willChange && (
                    <span className="rounded-full bg-[#FFF0F5] px-2 py-0.5 text-[10px] font-semibold text-[#D91D53]">
                      将被修改
                    </span>
                  )}
                </div>
                <p className="mt-2 line-clamp-2 min-h-8 text-xs leading-4 text-[#514A54]">
                  {scene.caption || '暂无字幕'}
                </p>
                <div className="mt-2 flex items-center gap-1 text-[10px] text-[#99919C]">
                  <Clapperboard className="h-3 w-3" aria-hidden="true" />
                  场景 {index + 1}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
