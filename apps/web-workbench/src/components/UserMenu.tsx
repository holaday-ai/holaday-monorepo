import {
  ChevronDown,
  ChevronRight,
  CreditCard,
  Crown,
  History,
  LogOut,
  MessageSquare,
  Monitor,
  Moon,
  Settings as SettingsIcon,
  Sun,
  Trash2,
  User as UserIcon,
} from 'lucide-react';
import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { type ThemeMode, useTheme } from '@/stores/theme-store';

interface Props {
  displayName: string;
  email: string | null;
  plan: string;
  onLogout(): void;
  onOpenFeedback?(): void;
  /** Count of failed or review-needed tasks — shows/hides the 批量清除 menu item. */
  failedTaskCount?: number;
  /** Invoked when the user picks "清除失败/需复核任务". Caller confirms + deletes. */
  onClearFailedTasks?(): void;
  /**
   * Codex-rail layout — renders just the avatar (no name / plan text)
   * and anchors the popover to the avatar rather than the whole row.
   * Used inside the 64px-wide collapsed sidebar rail where the text
   * would overflow. Expanded sidebar uses compact=false (default).
   */
  compact?: boolean;
  placement?: 'sidebar' | 'topbar';
}

/**
 * Sidebar footer chip + popover. Click → bottom-left popover with the
 * user's email, a theme selector (light / dark / system), a feedback
 * shortcut, and the logout action. Escape + outside click dismiss.
 */
export function UserMenu({
  displayName,
  email,
  plan,
  onLogout,
  onOpenFeedback,
  failedTaskCount = 0,
  onClearFailedTasks,
  compact = false,
  placement = 'sidebar',
}: Props): JSX.Element {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const { mode, setMode } = useTheme();

  const go = React.useCallback(
    (path: string) => {
      setOpen(false);
      navigate(path);
    },
    [navigate],
  );

  React.useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const initial = (displayName || email || '?').slice(0, 1).toUpperCase();
  const planLabel = friendlyPlan(plan);
  const topbar = placement === 'topbar';

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={compact ? `用户菜单：${displayName || email || ''}` : undefined}
        title={compact ? displayName || email || '用户' : undefined}
        className={cn(
          topbar
            ? 'flex h-11 items-center gap-2 rounded-full bg-transparent pl-0.5 pr-1 text-left transition-colors hover:bg-[#EFEFEF]/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#EA1F59]/25 dark:hover:bg-white/10'
            : 'flex items-center rounded-[10px] border border-[#DCDDDD]/60 bg-white/55 shadow-[0_4px_12px_rgba(17,24,39,0.035)] transition-colors hover:border-[#EA1F59]/20 hover:bg-[#EA1F59]/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#EA1F59]/20 dark:border-white/10 dark:bg-white/[0.04] dark:hover:border-[#EA1F59]/35 dark:hover:bg-[#EA1F59]/10',
          !topbar && (compact ? 'h-9 w-9 justify-center' : 'h-11 w-full gap-2.5 px-2.5 text-left'),
          !topbar &&
            open &&
            'border-[#EA1F59]/25 bg-[#EA1F59]/5 shadow-[0_10px_26px_rgba(234,31,89,0.08)] dark:border-[#EA1F59]/35 dark:bg-[#EA1F59]/10',
        )}
      >
        <div
          className={cn(
            'flex shrink-0 items-center justify-center bg-[#EA1F59] font-semibold text-white shadow-[0_3px_10px_rgba(234,31,89,0.14)]',
            topbar
              ? 'h-10 w-10 rounded-full ring-2 ring-white'
              : 'h-7 w-7 rounded-[9px] text-[13px]',
          )}
        >
          {initial}
        </div>
        {topbar ? (
          <ChevronDown
            className={cn(
              'h-4 w-4 text-[#EA1F59] transition-transform',
              open && 'rotate-180',
            )}
          />
        ) : !compact ? (
          <div className="min-w-0 flex-1">
            <div className="truncate text-[12px] font-semibold leading-4 text-[#595757] dark:text-foreground">
              {displayName || email || '未命名'}
            </div>
            <div className="truncate text-[10px] leading-4 text-[#8B93A6]">{planLabel}</div>
          </div>
        ) : null}
      </button>
      {open && (
        <div
          role="menu"
          className={cn(
            'absolute z-50 border border-[#DCDDDD]/85 bg-white text-foreground shadow-[0_12px_32px_rgba(17,24,39,0.12)] animate-fade-in dark:border-white/10 dark:bg-card',
            topbar
              ? 'right-0 top-full mt-3 w-[280px] rounded-[18px] p-3 shadow-[0_18px_45px_rgba(89,87,87,0.14)]'
              : cn(
                  'bottom-full rounded-[8px] p-1',
                  compact ? 'left-full mb-0 ml-2 min-w-[220px]' : 'left-0 right-0 mb-2',
                ),
          )}
        >
          {topbar ? (
            <div className="mb-3 flex items-center gap-3 px-1 pb-2">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#EA1F59] text-base font-semibold text-white ring-2 ring-[#F4D7E2]">
                {initial}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-[#111827]">
                  {displayName || email || '未命名'}
                </div>
                <div className="mt-1 inline-flex items-center gap-1 rounded-full border border-[#EA1F59]/15 bg-[#EA1F59]/10 px-2 py-0.5 text-[10px] font-semibold text-[#EA1F59]">
                  <Crown className="h-3 w-3" />
                  {planLabel}
                </div>
              </div>
            </div>
          ) : email ? (
            <div className="truncate border-b border-[#DCDDDD]/80 px-3 py-2 text-[11px] text-muted-foreground dark:border-white/10">
              {email}
            </div>
          ) : null}
          <div className={cn('border-b border-[#DCDDDD]/80 py-1 dark:border-white/10', topbar && 'space-y-1 pb-2')}>
            <MenuItem topbar={topbar} icon={<UserIcon className="h-3.5 w-3.5" />} onClick={() => go('/profile')}>
              个人资料
            </MenuItem>
            <MenuItem
              topbar={topbar}
              icon={<SettingsIcon className="h-3.5 w-3.5" />}
              onClick={() => go('/settings')}
            >
              设置
            </MenuItem>
            <MenuItem
              topbar={topbar}
              icon={<CreditCard className="h-3.5 w-3.5" />}
              onClick={() => go('/plan')}
            >
              套餐与账单
            </MenuItem>
            <MenuItem
              topbar={topbar}
              icon={<History className="h-3.5 w-3.5" />}
              onClick={() => go('/history')}
            >
              任务历史
            </MenuItem>
          </div>
          <div className={cn('px-2 pb-1 pt-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground', topbar && 'pt-3 text-[12px] normal-case tracking-normal')}>
            外观
          </div>
          <ThemeSwitcher mode={mode} onChange={setMode} topbar={topbar} />
          <div className={cn('mt-1 border-t border-[#DCDDDD]/80 pt-1 dark:border-white/10', topbar && 'mt-3 rounded-[14px] border bg-white p-1.5 shadow-[0_1px_3px_rgba(15,23,42,0.03)] dark:bg-transparent')}>
            {onClearFailedTasks && failedTaskCount > 0 && (
              <MenuItem
                topbar={topbar}
                icon={<Trash2 className="h-3.5 w-3.5" />}
                onClick={() => {
                  setOpen(false);
                  onClearFailedTasks();
                }}
              >
                清除失败/需复核任务（{failedTaskCount}）
              </MenuItem>
            )}
            {onOpenFeedback && (
              <MenuItem
                topbar={topbar}
                icon={<MessageSquare className="h-3.5 w-3.5" />}
                onClick={() => {
                  setOpen(false);
                  onOpenFeedback();
                }}
              >
                反馈
              </MenuItem>
            )}
            <MenuItem
              topbar={topbar}
              icon={<LogOut className="h-3.5 w-3.5" />}
              onClick={() => {
                setOpen(false);
                onLogout();
              }}
              destructive
            >
              登出
            </MenuItem>
          </div>
        </div>
      )}
    </div>
  );
}

function ThemeSwitcher({
  mode,
  onChange,
  topbar = false,
}: {
  mode: ThemeMode;
  onChange(m: ThemeMode): void;
  topbar?: boolean;
}): JSX.Element {
  return (
    <div className={cn('grid grid-cols-3 gap-1 bg-[#EFEFEF]/60 p-0.5 dark:bg-white/10', topbar ? 'rounded-full' : 'rounded-[8px]')}>
      <ThemeOption topbar={topbar} active={mode === 'light'} onClick={() => onChange('light')} label="浅色">
        <Sun className="h-3.5 w-3.5" />
      </ThemeOption>
      <ThemeOption topbar={topbar} active={mode === 'dark'} onClick={() => onChange('dark')} label="深色">
        <Moon className="h-3.5 w-3.5" />
      </ThemeOption>
      <ThemeOption topbar={topbar} active={mode === 'system'} onClick={() => onChange('system')} label="跟随系统">
        <Monitor className="h-3.5 w-3.5" />
      </ThemeOption>
    </div>
  );
}

function ThemeOption({
  active,
  onClick,
  label,
  children,
  topbar = false,
}: {
  active: boolean;
  onClick(): void;
  label: string;
  children: React.ReactNode;
  topbar?: boolean;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={label}
      className={cn(
        'flex items-center justify-center gap-1 px-1 text-[10px] transition-colors',
        topbar ? 'h-7 rounded-full font-semibold' : 'flex-col rounded-[6px] py-1.5',
        active
          ? 'bg-white text-[#EA1F59] shadow-[0_1px_2px_rgba(17,24,39,0.05)] dark:bg-card dark:text-foreground'
          : 'text-[#595757] hover:bg-white/65 hover:text-foreground dark:text-foreground/65 dark:hover:bg-white/10',
      )}
    >
      {children}
      <span>{label}</span>
    </button>
  );
}

function MenuItem({
  icon,
  children,
  onClick,
  destructive,
  topbar = false,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
  onClick(): void;
  destructive?: boolean;
  topbar?: boolean;
}): JSX.Element {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2 text-left transition-colors',
        topbar ? 'h-9 rounded-[10px] px-2.5 text-[12px] font-medium' : 'rounded-[6px] px-2.5 py-1.5 text-sm',
        destructive
          ? 'text-[#EA1F59] hover:bg-[#EA1F59]/10'
          : 'text-[#595757] hover:bg-[#EA1F59]/5 hover:text-[#EA1F59] dark:text-foreground/75 dark:hover:bg-white/10 dark:hover:text-foreground',
      )}
    >
      <span
        className={cn(
          'opacity-80',
          topbar && 'flex h-6 w-6 items-center justify-center rounded-[8px] bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]',
        )}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {topbar && !destructive && <ChevronRight className="h-3.5 w-3.5 text-[#595757]/60" />}
    </button>
  );
}

function friendlyPlan(plan: string): string {
  switch (plan) {
    case 'free':
      return 'Free · 试用版';
    case 'pro':
      return 'Pro';
    case 'team':
      return 'Team';
    default:
      return plan;
  }
}
