import { LogOut, Settings as SettingsIcon } from 'lucide-react';
import * as React from 'react';
import { cn } from '@/lib/utils';

interface Props {
  displayName: string;
  email: string | null;
  plan: string;
  onLogout(): void;
  onOpenSettings?(): void;
}

/**
 * Sidebar footer chip + popover. Click the chip → popover pins to the
 * bottom-left. Menu items mirror Claude's sidebar: 设置 / 登出. Closes
 * on outside click + Escape + route change (naturally, because we
 * unmount when parent does).
 */
export function UserMenu({
  displayName,
  email,
  plan,
  onLogout,
  onOpenSettings,
}: Props): JSX.Element {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

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
        className={cn(
          'flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-white/70',
          open && 'bg-white/80',
        )}
      >
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-400 to-pink-400 text-sm font-semibold text-white">
          {initial}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{displayName || email || '未命名'}</div>
          <div className="truncate text-[11px] text-muted-foreground">{planLabel}</div>
        </div>
      </button>
      {open && (
        <div
          role="menu"
          className="absolute bottom-full left-0 right-0 mb-2 rounded-lg border border-black/[0.08] bg-white/98 p-1 shadow-lg backdrop-blur-md animate-fade-in"
        >
          {email && (
            <div className="truncate border-b border-black/[0.05] px-3 py-2 text-[11px] text-muted-foreground">
              {email}
            </div>
          )}
          {onOpenSettings && (
            <MenuItem
              icon={<SettingsIcon className="h-3.5 w-3.5" />}
              onClick={() => {
                setOpen(false);
                onOpenSettings();
              }}
            >
              设置
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
      )}
    </div>
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
        destructive ? 'text-red-600 hover:bg-red-50' : 'text-foreground hover:bg-black/5',
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
