import { Sparkles, X } from 'lucide-react';
import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';

interface Props {
  plan: string;
  selectedRoles: readonly string[] | null | undefined;
}

const DISMISS_KEY = 'holaday.roleNudgeDismissedDate';

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Onboarding nudge for Basic-plan users who haven't picked their 5
 * roles yet. The role permission gate downgrades to `roleId='none'`
 * when `selected_roles` is empty, which means a Basic user pays for
 * 33 personas but uses zero of them — defeats the upsell. This
 * banner pushes them to `/settings/roles` on first sight.
 *
 * Visibility:
 *   - Hidden when plan != 'basic'.
 *   - Hidden when selected_roles has at least one entry.
 *   - Hidden when the user dismissed it earlier today (per local
 *     date — dismiss state expires at midnight so a stubborn user
 *     who still hasn't picked sees it again the next session, as
 *     spec'd by BOSS).
 *
 * Pro plan: gets all roles automatically; no nudge needed.
 * Free plan: has no role permissions to begin with; nudging would
 * just be noise.
 */
export function RoleNudgeBanner({ plan, selectedRoles }: Props): JSX.Element | null {
  const navigate = useNavigate();
  const [dismissed, setDismissed] = React.useState(false);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const stored = window.localStorage.getItem(DISMISS_KEY);
      setDismissed(stored === todayKey());
    } catch {
      // Private mode etc. — never dismissed.
    }
  }, []);

  if (plan !== 'basic') return null;
  // Treat null + empty array the same: no roles picked yet.
  if (selectedRoles && selectedRoles.length > 0) return null;
  if (dismissed) return null;

  const handleDismiss = (): void => {
    setDismissed(true);
    try {
      window.localStorage.setItem(DISMISS_KEY, todayKey());
    } catch {
      // best-effort
    }
  };

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pt-4 sm:px-6">
      <div
        className={cn(
          'flex flex-col gap-2 rounded-[8px] border border-[#DCDDDD]/75 bg-white/65 px-3 py-2.5 shadow-[0_1px_1px_rgba(17,24,39,0.02)] sm:flex-row sm:items-center sm:justify-between dark:border-white/10 dark:bg-white/5',
        )}
      >
        <div className="flex min-w-0 items-start gap-2.5 text-sm">
          <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-[6px] bg-[#EA1F59]/7 text-[#EA1F59]">
            <Sparkles className="h-3 w-3" />
          </span>
          <div className="min-w-0 leading-snug">
            <span className="font-medium text-foreground">
              你还没有选择专业角色
            </span>
            <span className="ml-1.5 text-[#595757] dark:text-foreground/70">
              选择后任务执行质量会更好
            </span>
          </div>
        </div>
        <div className="flex shrink-0 items-center justify-end gap-1">
          <button
            type="button"
            onClick={() => navigate('/settings/roles')}
            className="rounded-[6px] border border-[#EA1F59]/25 bg-[#EA1F59]/5 px-3 py-1.5 text-xs font-medium text-[#EA1F59] transition-colors hover:border-[#EA1F59]/40 hover:bg-[#EA1F59]/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#EA1F59]/20"
          >
            去选择
          </button>
          <button
            type="button"
            onClick={handleDismiss}
            aria-label="关闭角色引导"
            title="关闭"
            className="inline-flex h-7 w-7 items-center justify-center rounded-[6px] text-[#ADADAD] transition-colors hover:bg-[#EFEFEF]/70 hover:text-[#595757] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#57479C]/20 dark:hover:bg-white/10 dark:hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
