import { FileDownloadCard } from '@/components/FileDownloadCard';
import { downloadFileAvailability } from '@/lib/file-download-card-copy';
import {
  type ImageHistoryRow,
  imageHistoryDisplayTitle,
  imageResultActions,
} from '@/lib/image-history-row';
import { trpc } from '@/lib/trpc';
import type { UiTask } from '@/types/task';
import {
  Archive,
  Check,
  Clock3,
  Copy,
  ImageOff,
  Loader2,
  RefreshCcw,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import * as React from 'react';
import type { ImageContinuationAction } from './image-studio-state';

interface ImageResultPanelProps {
  task?: UiTask;
  row?: ImageHistoryRow;
  now?: number;
  compact?: boolean;
  onContinue(
    action: ImageContinuationAction,
    row: ImageHistoryRow,
    selectedFileId?: string,
  ): void | Promise<void>;
}

export function ImageResultPanel({
  task,
  row,
  now = Date.now(),
  compact = false,
  onContinue,
}: ImageResultPanelProps): JSX.Element | null {
  const [savedFiles, setSavedFiles] = React.useState<ReadonlySet<string>>(new Set());
  const [savingFileId, setSavingFileId] = React.useState<string | null>(null);
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const status = task?.status ?? row?.status;
  if (!status) return null;

  if (!row) {
    const state = liveState(status);
    return (
      <section
        aria-live="polite"
        className="rounded-[22px] border border-[#E8E0E8] bg-white px-5 py-5 shadow-[0_12px_32px_rgba(62,48,69,0.05)]"
      >
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#F0E9FA] text-[#73529B]">
            {state.spinning ? (
              <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />
            ) : (
              <ImageOff className="h-4 w-4" aria-hidden />
            )}
          </span>
          <div>
            <h2 className="text-sm font-semibold text-[#403743]">{state.title}</h2>
            <p className="mt-1 text-xs leading-5 text-[#7B717F]">{state.detail}</p>
          </div>
        </div>
      </section>
    );
  }

  const actions = imageResultActions(row, now);
  const consistency = row.subjectConsistency;
  const verified =
    consistency !== undefined &&
    consistency.checked > 0 &&
    consistency.passed > 0 &&
    consistency.failed === 0;
  const filteredCount = consistency?.failed ?? 0;

  async function saveOutput(fileId: string): Promise<void> {
    if (savingFileId || savedFiles.has(fileId)) return;
    setSavingFileId(fileId);
    setSaveError(null);
    try {
      await trpc.files.saveOutput.mutate({ fileId });
      setSavedFiles((current) => new Set([...current, fileId]));
    } catch {
      setSaveError('保存失败，文件可能已经失效，请重试');
    } finally {
      setSavingFileId(null);
    }
  }

  return (
    <section
      aria-live="polite"
      className={
        compact
          ? 'rounded-[20px] border border-[#E8E0E8] bg-[#FFFDF9] p-4'
          : 'rounded-[24px] border border-[#E8E0E8] bg-[#FFFDF9] p-5 shadow-[0_14px_36px_rgba(62,48,69,0.05)] sm:p-6'
      }
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold text-[#3E3542]">
              {imageHistoryDisplayTitle(row)}
            </h2>
            {row.status === 'partial_success' ? (
              <span className="rounded-full bg-[#FFF0D8] px-2.5 py-1 text-[11px] font-semibold text-[#9A6226]">
                部分完成
              </span>
            ) : (
              <span className="rounded-full bg-[#F0EBF9] px-2.5 py-1 text-[11px] font-semibold text-[#725495]">
                已完成
              </span>
            )}
            {verified ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-[#E9F8F1] px-2.5 py-1 text-[11px] font-semibold text-[#28745C]">
                <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
                已核对主角一致性
              </span>
            ) : null}
            {filteredCount > 0 ? (
              <span className="rounded-full bg-[#FFF0D8] px-2.5 py-1 text-[11px] font-semibold text-[#9A6226]">
                已筛除 {filteredCount} 张
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-xs text-[#837985]">
            实际生成 {row.downloads.length} 张 · {row.imageOptions.aspectRatio} ·{' '}
            {row.imageOptions.model === 'nano_banana_pro' ? 'Nano Banana Pro' : 'Nano Banana 2'}
          </p>
        </div>
      </div>

      <div className={compact ? 'mt-4 grid gap-3' : 'mt-5 grid gap-4 sm:grid-cols-2'}>
        {row.downloads.map((download) => {
          const expired =
            download.unavailable === true ||
            downloadFileAvailability(download.expiresAt, now) === 'expired';
          const saved = savedFiles.has(download.fileId);
          return (
            <div
              key={download.fileId}
              className="rounded-[18px] border border-[#E9E2E8] bg-white p-3"
            >
              {expired ? (
                <div className="flex min-h-24 items-center justify-center gap-2 rounded-[14px] bg-[#FFF5E8] px-4 text-sm font-medium text-[#93612D]">
                  <Clock3 className="h-4 w-4" aria-hidden />
                  成片已过期
                </div>
              ) : (
                <FileDownloadCard payload={download} showPreview />
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={!actions.continueEdit}
                  onClick={() => void onContinue('continue_edit', row, download.fileId)}
                  className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-[#DDCFE7] bg-[#F8F3FB] px-3 text-xs font-semibold text-[#6F4E8B] disabled:cursor-not-allowed disabled:opacity-45"
                >
                  <RefreshCcw className="h-3.5 w-3.5" aria-hidden />
                  继续改这张
                </button>
                <button
                  type="button"
                  disabled={!actions.saveToLibrary || savingFileId === download.fileId || saved}
                  aria-label={
                    saved
                      ? `${download.filename} 已保存到文件库`
                      : `保存 ${download.filename} 到文件库`
                  }
                  title={saved ? '已保存到文件库' : '保存到文件库'}
                  onClick={() => void saveOutput(download.fileId)}
                  className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-[#E4DFE4] bg-white px-3 text-xs font-semibold text-[#5F5762] disabled:cursor-not-allowed disabled:opacity-55"
                >
                  {saved ? (
                    <Check className="h-3.5 w-3.5" aria-hidden />
                  ) : (
                    <Archive className="h-3.5 w-3.5" aria-hidden />
                  )}
                  {saved ? '已保存到文件库' : '保存到文件库'}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-4 flex flex-wrap gap-2 border-t border-[#EEE7ED] pt-4">
        {actions.keepSubject ? (
          <button
            type="button"
            onClick={() => void onContinue('keep_subject', row)}
            className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-[#CDE9E0] bg-[#F0FBF7] px-3 text-xs font-semibold text-[#2A725D]"
          >
            <Sparkles className="h-3.5 w-3.5" aria-hidden />
            保持主角
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => void onContinue('reuse_settings', row)}
          className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-[#E4DFE4] bg-white px-3 text-xs font-semibold text-[#5F5762]"
        >
          <Copy className="h-3.5 w-3.5" aria-hidden />
          复用设置
        </button>
      </div>
      {saveError ? (
        <p role="alert" className="mt-3 text-xs text-[#B4234D]">
          {saveError}
        </p>
      ) : null}
    </section>
  );
}

function liveState(status: UiTask['status']): {
  title: string;
  detail: string;
  spinning: boolean;
} {
  if (status === 'queued') {
    return {
      title: '正在排队',
      detail: '轮到后会自动开始，不需要停留在当前页面。',
      spinning: true,
    };
  }
  if (status === 'pending' || status === 'planning') {
    return { title: '正在准备', detail: '正在整理图片与生成设置。', spinning: true };
  }
  if (status === 'executing') {
    return { title: '正在生成', detail: '完成后会在这里显示真实成片与可用操作。', spinning: true };
  }
  if (status === 'failed') {
    return {
      title: '生成失败',
      detail: '本次没有可用成片，草稿仍保留，可以调整后重试。',
      spinning: false,
    };
  }
  if (status === 'cancelled') {
    return { title: '生成已取消', detail: '本次任务没有继续执行。', spinning: false };
  }
  return { title: '正在核对结果', detail: '正在确认成片是否可用。', spinning: true };
}
