import { ChevronDown, Copy, Layers, Loader2, Plus, Trash2, X } from 'lucide-react';
import * as React from 'react';
import {
  batchActiveIndexAfterRemove,
  batchCreateButtonLabel,
  batchCreateDisabled,
  batchPromptCountCopy,
} from '@/components/batch-dialog-state';
import { useToast } from '@/components/ui/toast';
import {
  batchTaskDraftHasReusableDetail,
  batchTaskDraftMissingGoal,
  batchTaskDraftFromPrompt,
  batchTaskDraftProgress,
  composeBatchTaskPrompt,
  EMPTY_BATCH_TASK_DRAFT,
  firstBatchTaskDraftMissingGoal,
  type BatchTaskDraft,
} from '@/lib/batch-task-draft';
import { parseBatchPromptItems } from '@/lib/batch-prompts';
import { trpc } from '@/lib/trpc';
import { cn } from '@/lib/utils';

/**
 * Phase 5b — create-batch modal.
 *
 * Users add one task card at a time. Each card can include a goal,
 * inputs, and step-by-step instructions; cards are submitted as
 * independent prompts so one task's steps never bleed into another.
 *
 * The server caps to 50 items and applies the per-plan concurrency
 * automatically; this dialog doesn't let the user pick concurrency
 * — that would be a confusing knob and lets users feel like they're
 * raising their own quota.
 */
interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: (batchId: string) => void;
  /** Pre-fill the list (e.g. from the composer multiline-detect flow). */
  initialPrompts?: string[];
}

const MAX_ITEMS = 50;

export function BatchTaskDialog({
  open,
  onClose,
  onCreated,
  initialPrompts,
}: Props): JSX.Element | null {
  const toast = useToast();
  const [name, setName] = React.useState('');
  const [items, setItems] = React.useState<BatchTaskDraft[]>([
    { ...EMPTY_BATCH_TASK_DRAFT },
  ]);
  const [activeIndex, setActiveIndex] = React.useState(0);
  const [submitting, setSubmitting] = React.useState(false);
  const goalRefs = React.useRef<Array<HTMLInputElement | null>>([]);

  React.useEffect(() => {
    if (!open) return;
    setName('');
    setItems(
      initialPrompts && initialPrompts.length > 0
        ? initialPrompts.map(batchTaskDraftFromPrompt)
        : [{ ...EMPTY_BATCH_TASK_DRAFT }],
    );
    setActiveIndex(0);
    setSubmitting(false);
    const id = window.setTimeout(() => goalRefs.current[0]?.focus(), 0);
    return () => window.clearTimeout(id);
  }, [open, initialPrompts]);

  const requestClose = React.useCallback(() => {
    if (submitting) return;
    onClose();
  }, [onClose, submitting]);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') requestClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, requestClose]);

  if (!open) return null;

  const invalidGoalIndex = firstBatchTaskDraftMissingGoal(items);
  const composedItems = items
    .filter((item) => item.goal.trim().length > 0)
    .map(composeBatchTaskPrompt);
  const parsedPrompts = parseBatchPromptItems(composedItems, MAX_ITEMS);
  const prompts = parsedPrompts.prompts;
  const submitDisabled = batchCreateDisabled({
    submitting,
    promptCount: prompts.length,
    overLimit: parsedPrompts.overLimit,
  });

  const updateItem = (
    index: number,
    field: keyof BatchTaskDraft,
    value: string,
  ): void => {
    setItems((prev) =>
      prev.map((item, idx) => (idx === index ? { ...item, [field]: value } : item)),
    );
  };

  const addItem = (): void => {
    if (items.length >= MAX_ITEMS || submitting) return;
    const nextIndex = items.length;
    setItems((prev) => [...prev, { ...EMPTY_BATCH_TASK_DRAFT }]);
    setActiveIndex(nextIndex);
    window.setTimeout(() => goalRefs.current[nextIndex]?.focus(), 0);
  };

  const removeItem = (index: number): void => {
    if (submitting) return;
    setItems((prev) => {
      const next = prev.filter((_, idx) => idx !== index);
      return next.length > 0 ? next : [{ ...EMPTY_BATCH_TASK_DRAFT }];
    });
    setActiveIndex((current) => {
      return batchActiveIndexAfterRemove({
        activeIndex: current,
        removedIndex: index,
        itemCount: items.length,
      });
    });
  };

  const reuseItemDetail = (index: number): void => {
    if (items.length >= MAX_ITEMS || submitting) return;
    const source = items[index];
    if (!batchTaskDraftHasReusableDetail(source)) return;
    const nextIndex = index + 1;
    setItems((prev) => [
      ...prev.slice(0, nextIndex),
      { goal: '', steps: source.steps, output: source.output },
      ...prev.slice(nextIndex),
    ]);
    setActiveIndex(nextIndex);
    window.setTimeout(() => goalRefs.current[nextIndex]?.focus(), 0);
  };

  const submit = async (): Promise<void> => {
    if (submitting) return;
    if (invalidGoalIndex != null) {
      toast.show(`请先填写任务 ${invalidGoalIndex + 1} 的目标`, 'error');
      setActiveIndex(invalidGoalIndex);
      window.setTimeout(() => goalRefs.current[invalidGoalIndex]?.focus(), 0);
      return;
    }
    if (prompts.length === 0) {
      toast.show('请至少输入一项任务', 'error');
      return;
    }
    if (parsedPrompts.overLimit) {
      toast.show(`一次最多 ${MAX_ITEMS} 项`, 'error');
      return;
    }
    setSubmitting(true);
    try {
      const trimmedName = name.trim();
      const result = await trpc.batchTasks.create.mutate({
        ...(trimmedName ? { name: trimmedName } : {}),
        prompts,
      });
      toast.show(`已创建批量任务（${result.itemsTotal} 项 · 并发 ${result.concurrency}）`);
      onCreated(result.batchId);
    } catch (err) {
      toast.show(err instanceof Error ? err.message : '创建失败', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={requestClose}
      className="fixed inset-0 z-[95] flex items-start justify-center overflow-y-auto bg-black/35 p-3 py-6 backdrop-blur-sm animate-fade-in sm:items-center sm:p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl overflow-hidden rounded-lg border border-[#DCDDDD] bg-white shadow-[0_16px_48px_rgba(17,24,39,0.16)] dark:border-white/10 dark:bg-card"
      >
        <header className="flex items-center justify-between border-b border-[#DCDDDD]/80 px-5 py-3 dark:border-white/10">
          <div className="flex items-center gap-2 text-sm font-semibold text-[#2F2F2F] dark:text-foreground">
            <Layers className="h-4 w-4 text-[#EA1F59]" />
            新建批量任务
          </div>
          <button
            type="button"
            onClick={requestClose}
            disabled={submitting}
            aria-label="关闭"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-[#EFEFEF]/70 hover:text-foreground dark:hover:bg-white/10"
          >
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className="space-y-4 p-5">
          <div>
            <label className="mb-1 block text-xs font-medium text-foreground/80">
              批量名称 <span className="text-muted-foreground">(可选)</span>
            </label>
            <input
              type="text"
              value={name}
              maxLength={200}
              disabled={submitting}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：10 个竞品最新动态"
              className="w-full rounded-md border border-[#DCDDDD] bg-white px-3 py-2 text-sm placeholder:text-muted-foreground/55 focus-visible:border-[#EA1F59]/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#EA1F59]/10 dark:border-white/10 dark:bg-card"
            />
          </div>
          <div>
            <div className="mb-2 flex items-start justify-between gap-3">
              <div>
                <label className="block text-xs font-medium text-foreground/80">
                  任务列表
                </label>
                <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
                  一个卡片就是一个独立任务。每张卡里写清目标、执行步骤和输出要求。
                </p>
              </div>
              <span
                className={cn(
                  'shrink-0 rounded-md border px-2 py-1 text-[11px]',
                  parsedPrompts.overLimit
                    ? 'border-[#EA1F59]/30 bg-[#EA1F59]/10 text-[#EA1F59]'
                    : 'border-[#DCDDDD] bg-white text-muted-foreground dark:border-white/10 dark:bg-card',
                )}
              >
                {batchPromptCountCopy({
                  promptCount: prompts.length,
                  maxItems: MAX_ITEMS,
                  duplicateCount: parsedPrompts.duplicateCount,
                  overLimit: parsedPrompts.overLimit,
                })}
              </span>
            </div>
            <div className="space-y-3">
              {items.map((item, index) => {
                const isActive = activeIndex === index;
                const missingGoal = batchTaskDraftMissingGoal(item);
                const canReuseDetail = batchTaskDraftHasReusableDetail(item);
                return (
                  <div
                    key={index}
                    className={cn(
                      'rounded-[8px] border bg-white p-3 shadow-[0_1px_2px_rgba(15,23,42,0.03)] transition-colors dark:bg-card/85',
                      missingGoal
                        ? 'border-[#EA1F59]/40'
                        : isActive
                          ? 'border-[#EA1F59]/25'
                          : 'border-[#DCDDDD] dark:border-white/10',
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => setActiveIndex(index)}
                        disabled={submitting}
                        aria-expanded={isActive}
                        className="min-w-0 flex-1 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-[#EA1F59]/15 disabled:pointer-events-none"
                      >
                        <div className="flex items-center gap-2">
                          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-[#EA1F59] text-[11px] font-semibold text-white">
                            {index + 1}
                          </span>
                          <span className="truncate text-xs font-medium text-[#2F2F2F] dark:text-foreground">
                            任务 {index + 1}
                          </span>
                          <TaskDraftProgressPill draft={item} />
                          <ChevronDown
                            className={cn(
                              'ml-auto h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform',
                              isActive ? 'rotate-180' : 'rotate-0',
                            )}
                          />
                        </div>
                        {!isActive && <TaskDraftSummary draft={item} />}
                      </button>
                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          type="button"
                          onClick={() => reuseItemDetail(index)}
                          disabled={
                            submitting || items.length >= MAX_ITEMS || !canReuseDetail
                          }
                          title={
                            canReuseDetail
                              ? `复用任务 ${index + 1} 的步骤和输出`
                              : '先写步骤或输出后再复用'
                          }
                          aria-label={`复用任务 ${index + 1} 的步骤和输出`}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-[#57479C]/10 hover:text-[#57479C] disabled:pointer-events-none disabled:opacity-35"
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => removeItem(index)}
                          disabled={submitting || items.length === 1}
                          aria-label={`删除任务 ${index + 1}`}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-[#EA1F59]/10 hover:text-[#EA1F59] disabled:pointer-events-none disabled:opacity-40"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                    {isActive && (
                      <div className="mt-3 grid gap-2">
                        <label className="grid gap-1">
                          <span className="text-[11px] font-medium text-[#595757]">
                            目标
                          </span>
                          <input
                            ref={(node) => {
                              goalRefs.current[index] = node;
                            }}
                            value={item.goal}
                            disabled={submitting}
                            onChange={(e) => updateItem(index, 'goal', e.target.value)}
                            placeholder="例如：查 OpenAI 最新动态"
                            className={cn(
                              'w-full rounded-md border bg-white px-3 py-2 text-sm placeholder:text-muted-foreground/55 focus-visible:border-[#EA1F59]/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#EA1F59]/10 dark:bg-card',
                              missingGoal
                                ? 'border-[#EA1F59]/45'
                                : 'border-[#DCDDDD] dark:border-white/10',
                            )}
                          />
                          {missingGoal && (
                            <span className="text-[11px] leading-4 text-[#EA1F59]">
                              这张任务卡已经填写了步骤或输出，请补充目标。
                            </span>
                          )}
                        </label>
                        <label className="grid gap-1">
                          <span className="text-[11px] font-medium text-[#595757]">
                            步骤
                          </span>
                          <textarea
                            value={item.steps}
                            disabled={submitting}
                            onChange={(e) => updateItem(index, 'steps', e.target.value)}
                            rows={3}
                            placeholder={[
                              '1. 搜近期新闻',
                              '2. 找官方来源',
                              '3. 总结成三条',
                            ].join('\n')}
                            className="w-full resize-y rounded-md border border-[#DCDDDD] bg-white px-3 py-2 text-sm leading-6 placeholder:text-muted-foreground/55 focus-visible:border-[#EA1F59]/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#EA1F59]/10 dark:border-white/10 dark:bg-card"
                          />
                        </label>
                        <label className="grid gap-1">
                          <span className="text-[11px] font-medium text-[#595757]">
                            输出要求
                          </span>
                          <input
                            value={item.output}
                            disabled={submitting}
                            onChange={(e) => updateItem(index, 'output', e.target.value)}
                            placeholder="例如：给出链接、三条摘要和判断"
                            className="w-full rounded-md border border-[#DCDDDD] bg-white px-3 py-2 text-sm placeholder:text-muted-foreground/55 focus-visible:border-[#EA1F59]/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#EA1F59]/10 dark:border-white/10 dark:bg-card"
                          />
                        </label>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <button
              type="button"
              onClick={addItem}
              disabled={submitting || items.length >= MAX_ITEMS}
              className="mt-3 inline-flex h-8 items-center gap-1.5 rounded-md border border-[#DCDDDD] bg-white px-3 text-xs font-medium text-[#595757] transition-colors hover:border-[#ADADAD] hover:bg-[#EFEFEF]/55 disabled:pointer-events-none disabled:opacity-50 dark:border-white/10 dark:bg-card dark:text-foreground dark:hover:bg-white/10"
            >
              <Plus className="h-3.5 w-3.5" />
              添加一个任务
            </button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            批量任务会按你的套餐并发执行：免费 1 个、基础 3 个、专业 5 个。
            每一项都是一个独立的任务，部分失败不会影响其他任务。
          </p>
        </div>
        <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-[#DCDDDD]/80 bg-white px-5 py-3 dark:border-white/10 dark:bg-card">
          <button
            type="button"
            onClick={requestClose}
            disabled={submitting}
            className="rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-[#EFEFEF]/70 hover:text-foreground dark:hover:bg-white/10"
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={submitDisabled}
            className="inline-flex items-center gap-1.5 rounded-md bg-[#EA1F59] px-3 py-1.5 text-sm font-medium text-white shadow-[0_4px_12px_rgba(234,31,89,0.16)] transition hover:bg-[#EA1F59]/90 disabled:opacity-60"
          >
            {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {batchCreateButtonLabel(submitting)}
          </button>
        </footer>
      </div>
    </div>
  );
}

function TaskDraftProgressPill({ draft }: { draft: BatchTaskDraft }): JSX.Element {
  const progress = batchTaskDraftProgress(draft);
  const ready = progress.count === 3;
  const missingGoal = batchTaskDraftMissingGoal(draft);
  return (
    <span
      className={cn(
        'rounded-full border px-1.5 py-0.5 text-[10px] font-medium',
        missingGoal
          ? 'border-[#EA1F59]/35 bg-[#EA1F59]/10 text-[#EA1F59]'
          : ready
          ? 'border-[#42C0EF]/35 bg-[#42C0EF]/10 text-[#1688AA]'
          : progress.count > 0
            ? 'border-[#FFC910]/55 bg-[#FFC910]/12 text-[#8A6A00]'
            : 'border-[#DCDDDD] bg-white text-[#595757]',
      )}
    >
      {missingGoal
        ? '缺目标'
        : ready
          ? '已完整'
          : progress.count > 0
            ? `${progress.count}/3`
            : '未填写'}
    </span>
  );
}

function TaskDraftSummary({ draft }: { draft: BatchTaskDraft }): JSX.Element {
  const title = draft.goal.trim() || '还没有目标';
  const details = [
    draft.steps.trim() ? '已写步骤' : null,
    draft.output.trim() ? '有输出要求' : null,
  ].filter(Boolean);

  return (
    <div className="mt-2 min-w-0 pl-7">
      <p
        className={cn(
          'truncate text-xs',
          draft.goal.trim()
            ? 'text-[#2F2F2F] dark:text-foreground'
            : 'text-muted-foreground',
        )}
      >
        {title}
      </p>
      <p className="mt-1 truncate text-[11px] text-muted-foreground">
        {details.length > 0 ? details.join(' · ') : '点击展开后填写目标、步骤和输出。'}
      </p>
    </div>
  );
}
