import { Layers, Loader2, X } from 'lucide-react';
import * as React from 'react';
import { useToast } from '@/components/ui/toast';
import { trpc } from '@/lib/trpc';

/**
 * Phase 5b — create-batch modal.
 *
 * Two ways to submit:
 *   1. Paste a list — one prompt per non-empty line. We split on
 *      newlines, trim, drop empties.
 *   2. Click "添加一项" to add an explicit row (handy for prompts
 *      that span multiple paragraphs).
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
  const [pasteText, setPasteText] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setName('');
    setPasteText(initialPrompts && initialPrompts.length > 0 ? initialPrompts.join('\n') : '');
    setSubmitting(false);
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

  const prompts = pasteText
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const submit = async (): Promise<void> => {
    if (prompts.length === 0) {
      toast.show('请至少输入一项任务', 'error');
      return;
    }
    if (prompts.length > MAX_ITEMS) {
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
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm animate-fade-in"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-xl overflow-hidden rounded-2xl border border-border bg-card shadow-xl"
      >
        <header className="flex items-center justify-between border-b border-border px-5 py-3">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Layers className="h-4 w-4 text-primary" />
            新建批量任务
          </div>
          <button
            type="button"
            onClick={requestClose}
            disabled={submitting}
            aria-label="关闭"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
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
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：10 个竞品最新动态"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground/70 focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
            />
          </div>
          <div>
            <label className="mb-1 flex items-center justify-between text-xs font-medium text-foreground/80">
              <span>任务列表（每行一项）</span>
              <span className="text-muted-foreground">
                {prompts.length} / {MAX_ITEMS}
              </span>
            </label>
            <textarea
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              rows={8}
              placeholder={[
                '帮我查一下 Anthropic 最新动态',
                '帮我查一下 OpenAI 最新动态',
                '帮我查一下 Google DeepMind 最新动态',
              ].join('\n')}
              className="w-full resize-y rounded-md border border-border bg-background px-3 py-2 font-mono text-sm placeholder:text-muted-foreground/70 focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
            />
          </div>
          <p className="text-[11px] text-muted-foreground">
            批量任务会按你的套餐并发执行：免费 1 个、基础 3 个、专业 5 个。
            每一项都是一个独立的任务，部分失败不会影响其他任务。
          </p>
        </div>
        <footer className="flex items-center justify-end gap-2 border-t border-border bg-muted/30 px-5 py-3">
          <button
            type="button"
            onClick={requestClose}
            disabled={submitting}
            className="rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={submitting || prompts.length === 0}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground shadow-sm transition hover:opacity-90 disabled:opacity-60"
          >
            {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            创建并开始
          </button>
        </footer>
      </div>
    </div>
  );
}
