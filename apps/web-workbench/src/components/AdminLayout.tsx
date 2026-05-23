/**
 * Phase 27 — admin shell.
 *
 * Wraps /admin/* routes with its own auth + role gate and a
 * dedicated left nav (NOT the main AppShell's task-list sidebar).
 * Why separate: the admin surface has a different mental model —
 * the user is looking at OTHER users' data — so reusing the
 * workbench sidebar (which lists "your tasks") would mislead.
 *
 * Flow:
 *   - no token → /login
 *   - me.query rejects auth → /login
 *   - me.role !== 'admin' → /
 *   - admin → renders nav + <Outlet />
 *
 * The auth.me round-trip happens once per admin-shell mount; child
 * pages get the resolved `me` via `useOutletContext`.
 */

import { LayoutDashboard, LogOut, Users, BarChart3, GraduationCap, type LucideIcon } from 'lucide-react';
import * as React from 'react';
import { Link, Navigate, Outlet, useLocation } from 'react-router-dom';
import { BrandIcon, BrandWordmark } from '@/components/BrandLogo';
import { getAccessToken, clearAccessToken } from '@/lib/auth';
import { trpc } from '@/lib/trpc';
import { cn } from '@/lib/utils';

interface AdminMe {
  userId: string;
  email: string | null;
  displayName: string | null;
  role: 'user' | 'admin';
}

interface AdminOutletContext {
  me: AdminMe;
}

type GateState =
  | { status: 'checking' }
  | { status: 'no-auth' }
  | { status: 'forbidden' }
  | { status: 'ok'; me: AdminMe };

export function AdminLayout(): JSX.Element {
  const [gate, setGate] = React.useState<GateState>({ status: 'checking' });

  React.useEffect(() => {
    let cancelled = false;
    if (!getAccessToken()) {
      setGate({ status: 'no-auth' });
      return;
    }
    trpc.auth.me
      .query()
      .then((res) => {
        if (cancelled) return;
        const role = (res as { role?: 'user' | 'admin' }).role === 'admin' ? 'admin' : 'user';
        if (role !== 'admin') {
          setGate({ status: 'forbidden' });
          return;
        }
        setGate({
          status: 'ok',
          me: {
            userId: res.userId,
            email: res.email,
            displayName: res.displayName,
            role,
          },
        });
      })
      .catch(() => {
        if (!cancelled) setGate({ status: 'no-auth' });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (gate.status === 'checking') {
    return (
      <div className="flex h-svh items-center justify-center bg-background">
        <div className="text-sm text-muted-foreground">加载中…</div>
      </div>
    );
  }
  if (gate.status === 'no-auth') {
    return <Navigate to="/login" replace />;
  }
  if (gate.status === 'forbidden') {
    return <Navigate to="/" replace />;
  }

  const ctx: AdminOutletContext = { me: gate.me };

  return (
    <div className="flex h-svh bg-background text-foreground">
      <AdminSideNav me={gate.me} />
      <main className="flex-1 overflow-y-auto">
        <Outlet context={ctx} />
      </main>
    </div>
  );
}

function AdminSideNav({ me }: { me: AdminMe }): JSX.Element {
  const location = useLocation();
  const pathname = location.pathname;

  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-border bg-sidebar text-sidebar-foreground">
      <div className="px-5 pt-5 pb-4">
        <Link to="/admin" className="block space-y-1.5">
          <div className="flex items-center gap-2">
            <BrandIcon />
            <BrandWordmark className="h-3" />
          </div>
          <div className="text-xs font-medium text-foreground/80">
            管理后台
          </div>
          <div className="mt-0.5 text-[11px] text-muted-foreground">经营驾驶舱</div>
        </Link>
      </div>
      <nav className="flex-1 px-2">
        <AdminNavItem
          icon={LayoutDashboard}
          label="仪表盘"
          to="/admin"
          active={pathname === '/admin'}
        />
        <AdminNavItem
          icon={Users}
          label="用户管理"
          to="/admin/users"
          active={pathname.startsWith('/admin/users')}
        />
        <AdminNavItem
          icon={BarChart3}
          label="营收与成本"
          to="/admin/finance"
          active={pathname.startsWith('/admin/finance')}
        />
        <AdminNavItem
          icon={GraduationCap}
          label="学习引擎"
          to="/admin/learning"
          active={pathname.startsWith('/admin/learning')}
        />
      </nav>
      <div className="border-t border-border/60 px-3 py-3">
        <div className="truncate px-2 text-[12px] font-medium text-foreground">
          {me.displayName ?? '管理员'}
        </div>
        <div className="truncate px-2 text-[11px] text-muted-foreground">
          {me.email ?? '—'}
        </div>
        <Link
          to="/"
          className="mt-2 flex items-center gap-2 rounded-md px-2 py-1.5 text-[12px] text-muted-foreground transition-colors hover:bg-foreground/[0.04] hover:text-foreground"
        >
          <LogOut className="h-3.5 w-3.5" aria-hidden />
          返回工作台
        </Link>
      </div>
    </aside>
  );
}

function AdminNavItem({
  icon: Icon,
  label,
  to,
  active,
  disabled,
  hint,
}: {
  icon: LucideIcon;
  label: string;
  to?: string;
  active?: boolean;
  disabled?: boolean;
  hint?: string;
}): JSX.Element {
  const cls = cn(
    'flex items-center gap-2 rounded-md px-3 py-2 text-[13px] font-medium transition-colors',
    active
      ? 'bg-[rgba(234,31,89,0.10)] text-[#EA1F59]'
      : 'text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground',
    disabled && 'cursor-not-allowed opacity-50 hover:bg-transparent hover:text-muted-foreground',
  );
  if (disabled || !to) {
    return (
      <div className={cls} aria-disabled="true" title={hint ? `${label} · ${hint}` : undefined}>
        <Icon className="h-4 w-4" aria-hidden />
        <span className="flex-1">{label}</span>
        {hint && (
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground/70">
            {hint}
          </span>
        )}
      </div>
    );
  }
  return (
    <Link to={to} className={cls}>
      <Icon className="h-4 w-4" aria-hidden />
      <span>{label}</span>
    </Link>
  );
}

/** Hook for admin pages to read the resolved `me` from the layout. */
// Re-exported through useOutletContext at page level (saves a hook
// indirection — pages can do `useOutletContext<AdminOutletContext>()`).
export type { AdminOutletContext };

// Logout helper for any admin page that wants it.
export function logoutAndGoHome(): void {
  clearAccessToken();
  window.location.href = '/login';
}
