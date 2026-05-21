import { Globe } from 'lucide-react';
import type { SidePanelMode } from '@/types/side-panel';
import type { UiTask } from '@/types/task';
import { isTerminalStatus } from '@/types/task';
import { cn } from '@/lib/utils';

/**
 * Codex IA close-out: per-task toolbar pinned to the top-right of the
 * Main column. Hosts the browser-panel entry so the result card no
 * longer carries action surfaces of its own — the toolbar's job is
 * "what can I do with THIS task right now"; the result card stays
 * focused on the work product underneath.
 *
 *   Empty home           – nothing rendered.
 *   Generate / scrape    – nothing rendered (placeholder for future
 *                          stop / share affordances).
 *   Browser, live        – globe icon highlighted (panel auto-opens).
 *                          Click toggles the panel closed.
 *   Browser, terminal    – globe icon neutral. Click opens the
 *                          BrowserPanel which renders screenshot /
 *                          finalUrl-only fallback / missingEvidence.
 *   Browser, awaiting    – treated like live: highlighted.
 *
 * `browserLikely` mirrors the heuristic that used to live in the
 * result card: legacy rows whose executionMode column was never
 * populated still get the icon if the intent mentions a URL or one
 * of an explicit set of browser verbs.
 */
const BROWSER_VERBS = ['打开', '登录', '访问', '点击', '下载', '搜索'];
export function isBrowserLikely(task: UiTask): boolean {
  if (task.executionMode === 'browser') return true;
  const intent = task.intent ?? '';
  if (/https?:\/\//i.test(intent)) return true;
  return BROWSER_VERBS.some((v) => intent.includes(v));
}

export function browserToolbarLabel(
  task: UiTask,
  sidePanelMode: SidePanelMode,
): string {
  if (sidePanelMode === 'browser-live') return '浏览器进行中';
  if (sidePanelMode !== 'closed') return '关闭浏览器面板';
  return isTerminalStatus(task.status) ? '查看浏览器证据' : '查看浏览器';
}

interface Props {
  task: UiTask | null;
  sidePanelMode: SidePanelMode;
  onToggleSidePanel: () => void;
}

export function TaskToolbar({
  task,
  sidePanelMode,
  onToggleSidePanel,
}: Props): JSX.Element | null {
  if (!task) return null;
  if (!isBrowserLikely(task)) return null;
  const live = sidePanelMode === 'browser-live';
  const open = sidePanelMode !== 'closed';
  const label = browserToolbarLabel(task, sidePanelMode);
  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        onClick={onToggleSidePanel}
        aria-label={label}
        aria-pressed={open}
        title={label}
        className={cn(
          'inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-[11px] font-medium transition-colors',
          live
            ? 'border-primary/40 bg-primary/10 text-primary hover:bg-primary/15'
            : open
              ? 'border-foreground/20 bg-foreground/[0.04] text-foreground'
              : 'border-border bg-background text-muted-foreground hover:border-foreground/30 hover:text-foreground',
        )}
      >
        <Globe className="h-3.5 w-3.5" />
        <span>浏览器</span>
      </button>
    </div>
  );
}
