import { Check, Clock3, RotateCcw } from 'lucide-react';
import * as React from 'react';
import type { VideoEditingVersion } from './video-editing-state';

function versionDescription(version: VideoEditingVersion): string {
  const operationCount = version.operations?.length ?? 0;
  if (version.revision === 1) return '导入的原始版本';
  if (operationCount > 0) return `${operationCount} 项修改`;
  return version.sdkDocument ? '精细时间线修改' : '从历史版本恢复';
}

export function VersionHistory({
  versions,
  currentVersionId,
  busy,
  onRestore,
}: {
  versions: VideoEditingVersion[];
  currentVersionId: string;
  busy: boolean;
  onRestore(versionId: string): void;
}): JSX.Element {
  const [pendingRestoreId, setPendingRestoreId] = React.useState<string | null>(null);
  return (
    <section aria-labelledby="version-history-title">
      <div className="mb-3 flex items-center gap-2">
        <span className="grid h-8 w-8 place-items-center rounded-[10px] bg-[#F3EEFA] text-[#7C5AA6]">
          <Clock3 className="h-4 w-4" aria-hidden="true" />
        </span>
        <div>
          <h2 id="version-history-title" className="text-sm font-semibold text-[#302B34]">
            版本记录
          </h2>
          <p className="text-[11px] text-[#8A828D]">原片与每次修改都会保留</p>
        </div>
      </div>

      <div className="space-y-2">
        {versions.map((version) => {
          const current = version.id === currentVersionId;
          const pending = version.id === pendingRestoreId;
          return (
            <div key={version.id} className="rounded-[14px] border border-[#E9E3EA] bg-white p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-[#423A45]">
                      版本 {version.revision}
                    </span>
                    {current && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-[#ECF9F2] px-2 py-0.5 text-[10px] font-semibold text-[#168958]">
                        <Check className="h-3 w-3" aria-hidden="true" />
                        当前
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-[11px] text-[#8A828D]">{versionDescription(version)}</p>
                </div>
                {!current && !pending && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setPendingRestoreId(version.id)}
                    aria-label={`恢复版本 ${version.revision}`}
                    className="inline-flex h-9 items-center gap-1.5 rounded-[8px] border border-[#DED6E0] px-3 text-[11px] font-medium text-[#655B69] transition hover:border-[#CBB9CF] hover:bg-[#FAF7FB] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <RotateCcw className="h-3 w-3" aria-hidden="true" />
                    恢复
                  </button>
                )}
              </div>
              {pending && (
                <div className="mt-3 rounded-[10px] bg-[#FFF8ED] p-2.5 text-[11px] leading-4 text-[#72592F]">
                  <p>恢复会创建一个新版本，原片与现有版本都会保留。</p>
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      aria-label={`确认恢复版本 ${version.revision}`}
                      onClick={() => {
                        setPendingRestoreId(null);
                        onRestore(version.id);
                      }}
                      className="rounded-[8px] bg-[#EA1F59] px-2.5 py-1.5 font-semibold text-white disabled:opacity-50"
                    >
                      确认恢复
                    </button>
                    <button
                      type="button"
                      onClick={() => setPendingRestoreId(null)}
                      className="rounded-[8px] px-2.5 py-1.5 font-medium text-[#6E626F] hover:bg-white"
                    >
                      取消
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
