import {
  CreditCard,
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
  /** Count of failed tasks — shows/hides the 批量清除 menu item. */
  failedTaskCount?: number;
  /** Invoked when the user picks "清除所有失败任务". Caller confirms + deletes. */
  onClearFailedTasks?(): void;
  /**
   * Codex-rail layout — renders just the avatar (no name / plan text)
   * and anchors the popover to the avatar rather than the whole row.
   * Used inside the 64px-wide collapsed sidebar rail where the text
   * would overflow. Expanded sidebar uses compact=false (default).
   */
  compact?: boolean;
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
          'flex items-center rounded-[8px] border border-transparent transition-colors hover:border-[#EA1F59]/20 hover:bg-[#EA1F59]/5 dark:hover:border-[#EA1F59]/35 dark:hover:bg-[#EA1F59]/10',
          compact
            ? 'h-10 w-10 justify-center'
            : 'w-full gap-3 px-2 py-1.5 text-left',
          open && 'border-[#EA1F59]/25 bg-[#EA1F59]/5 dark:border-[#EA1F59]/35 dark:bg-[#EA1F59]/10',
        )}
      >
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] bg-[#EA1F59] text-sm font-semibold text-white shadow-[0_3px_10px_rgba(234,31,89,0.14)]">
          {initial}
        </div>
        {!compact && (
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{displayName || email || '未命名'}</div>
            <div className="truncate text-[11px] text-muted-foreground">{planLabel}</div>
          </div>
        )}
      </button>
      {open && (
        <div
          role="menu"
          className={cn(
            'absolute bottom-full z-50 rounded-[8px] border border-[#DCDDDD]/85 bg-white p-1 text-foreground shadow-[0_12px_32px_rgba(17,24,39,0.12)] animate-fade-in dark:border-white/10 dark:bg-card',
            compact ? 'left-full mb-0 ml-2 min-w-[220px]' : 'left-0 right-0 mb-2',
          )}
        >
          {email && (
            <div className="truncate border-b border-[#DCDDDD]/80 px-3 py-2 text-[11px] text-muted-foreground dark:border-white/10">
              {email}
            </div>
          )}
          <div className="border-b border-[#DCDDDD]/80 py-1 dark:border-white/10">
            <MenuItem icon={<UserIcon className="h-3.5 w-3.5" />} onClick={() => go('/profile')}>
              个人资料
            </MenuItem>
            <MenuItem
              icon={<SettingsIcon className="h-3.5 w-3.5" />}
              onClick={() => go('/settings')}
            >
              设置
            </MenuItem>
            <MenuItem
              icon={<CreditCard className="h-3.5 w-3.5" />}
              onClick={() => go('/plan')}
            >
              套餐与账单
            </MenuItem>
            <MenuItem
              icon={<History className="h-3.5 w-3.5" />}
              onClick={() => go('/history')}
            >
              任务历史
            </MenuItem>
          </div>
          <div className="px-2 pb-1 pt-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            外观
          </div>
          <ThemeSwitcher mode={mode} onChange={setMode} />
          <div className="mt-1 border-t border-[#DCDDDD]/80 pt-1 dark:border-white/10">
            {onClearFailedTasks && failedTaskCount > 0 && (
              <MenuItem
                icon={<Trash2 className="h-3.5 w-3.5" />}
                onClick={() => {
                  setOpen(false);
                  onClearFailedTasks();
                }}
              >
                清除失败任务（{failedTaskCount}）
              </MenuItem>
            )}
            {onOpenFeedback && (
              <MenuItem
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
}: {
  mode: ThemeMode;
  onChange(m: ThemeMode): void;
}): JSX.Element {
  return (
    <div className="grid grid-cols-3 gap-1 rounded-[8px] bg-[#EFEFEF]/60 p-0.5 dark:bg-white/10">
      <ThemeOption active={mode === 'light'} onClick={() => onChange('light')} label="浅色">
        <Sun className="h-3.5 w-3.5" />
      </ThemeOption>
      <ThemeOption active={mode === 'dark'} onClick={() => onChange('dark')} label="深色">
        <Moon className="h-3.5 w-3.5" />
      </ThemeOption>
      <ThemeOption active={mode === 'system'} onClick={() => onChange('system')} label="跟随系统">
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
}: {
  active: boolean;
  onClick(): void;
  label: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={label}
      className={cn(
        'flex flex-col items-center justify-center gap-0.5 rounded-[6px] px-1 py-1.5 text-[10px] transition-colors',
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
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
  onClick(): void;
  destructive?: boolean;
}): JSX.Element {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2 rounded-[6px] px-2.5 py-1.5 text-left text-sm transition-colors',
        destructive
          ? 'text-[#EA1F59] hover:bg-[#EA1F59]/10'
          : 'text-[#595757] hover:bg-[#EA1F59]/5 hover:text-[#EA1F59] dark:text-foreground/75 dark:hover:bg-white/10 dark:hover:text-foreground',
      )}
    >
      <span className="opacity-80">{icon}</span>
      <span>{children}</span>
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
