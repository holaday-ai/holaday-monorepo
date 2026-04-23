import { LogOut, MessageSquare, Monitor, Moon, Sun } from 'lucide-react';
import * as React from 'react';
import { cn } from '@/lib/utils';
import { type ThemeMode, useTheme } from '@/stores/theme-store';

interface Props {
  displayName: string;
  email: string | null;
  plan: string;
  onLogout(): void;
  onOpenFeedback?(): void;
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
  compact = false,
}: Props): JSX.Element {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);
  const { mode, setMode } = useTheme();

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
          'flex items-center rounded-md transition-colors hover:bg-foreground/5',
          compact
            ? 'h-10 w-10 justify-center'
            : 'w-full gap-3 px-2 py-1.5 text-left',
          open && 'bg-foreground/5',
        )}
      >
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-400 to-pink-400 text-sm font-semibold text-white">
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
            'absolute bottom-full z-50 rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-lg animate-fade-in',
            compact ? 'left-full mb-0 ml-2 min-w-[220px]' : 'left-0 right-0 mb-2',
          )}
        >
          {email && (
            <div className="truncate border-b border-border px-3 py-2 text-[11px] text-muted-foreground">
              {email}
            </div>
          )}
          <div className="px-2 pb-1 pt-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            外观
          </div>
          <ThemeSwitcher mode={mode} onChange={setMode} />
          <div className="mt-1 border-t border-border pt-1">
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
    <div className="grid grid-cols-3 gap-1 rounded-md bg-muted p-0.5">
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
        'flex flex-col items-center justify-center gap-0.5 rounded px-1 py-1.5 text-[10px] transition-colors',
        active
          ? 'bg-background text-foreground shadow-sm'
          : 'text-muted-foreground hover:text-foreground',
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
        'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors',
        destructive
          ? 'text-red-600 hover:bg-red-500/10 dark:text-red-400'
          : 'text-foreground hover:bg-foreground/5',
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
