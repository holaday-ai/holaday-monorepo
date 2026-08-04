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

import {
  AlertCircle,
  BarChart3,
  GraduationCap,
  LayoutDashboard,
  LogOut,
  RefreshCw,
  ShieldCheck,
  Users,
  type LucideIcon,
} from 'lucide-react';
import * as React from 'react';
import { Link, Navigate, Outlet, useLocation } from 'react-router-dom';
import { BrandIcon, BrandWordmark } from '@/components/BrandLogo';
import { Button } from '@/components/ui/button';
import { getAccessToken, clearAccessToken } from '@/lib/auth';
import {
  normalizeAuthMeProfile,
  preferredAuthDisplayName,
  type NormalizedAuthMeProfile,
} from '@/lib/auth-me-state';
import { authGateFailureStatus } from '@/lib/auth-session';
import { trpc } from '@/lib/trpc';
import { cn } from '@/lib/utils';

type AdminMe = Pick<
  NormalizedAuthMeProfile,
  'userId' | 'email' | 'phone' | 'displayName' | 'role'
>;

interface AdminOutletContext {
  me: AdminMe;
}

type GateState =
  | { status: 'checking' }
  | { status: 'no-auth' }
  | { status: 'forbidden' }
  | { status: 'error' }
  | { status: 'ok'; me: AdminMe };

export function AdminLayout(): JSX.Element {
  const [gate, setGate] = React.useState<GateState>({ status: 'checking' });
  const [attempt, setAttempt] = React.useState(0);

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
        const me = normalizeAuthMeProfile(res);
        if (me.role !== 'admin') {
          setGate({ status: 'forbidden' });
          return;
        }
        setGate({
          status: 'ok',
          me: {
            userId: me.userId,
            email: me.email,
            phone: me.phone,
            displayName: me.displayName,
            role: me.role,
          },
        });
      })
      .catch((err) => {
        if (cancelled) return;
        setGate({ status: authGateFailureStatus(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

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
  if (gate.status === 'error') {
    return (
      <div className="flex h-svh items-center justify-center bg-background px-5">
        <div className="w-full max-w-sm rounded-[8px] border border-[#DCDDDD] bg-white p-6 text-center shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
          <AlertCircle
            className="mx-auto h-5 w-5 text-[#EA1F59]"
            aria-hidden
          />
          <h1 className="mt-3 text-sm font-semibold text-foreground">
            管理后台暂时无法验证权限
          </h1>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            登录状态仍保留。请检查网络后重试。
          </p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="mt-4"
            onClick={() => {
              setGate({ status: 'checking' });
              setAttempt((value) => value + 1);
            }}
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
            重试
          </Button>
        </div>
      </div>
    );
  }

  const ctx: AdminOutletContext = { me: gate.me };

  return (
    <div className="flex h-svh bg-white text-foreground">
      <AdminSideNav me={gate.me} />
      <main className="min-w-0 flex-1 overflow-y-auto">
        <Outlet context={ctx} />
      </main>
    </div>
  );
}

function AdminSideNav({ me }: { me: AdminMe }): JSX.Element {
  const location = useLocation();
  const pathname = location.pathname;

  return (
    <aside className="flex w-16 shrink-0 flex-col border-r border-[#DCDDDD] bg-white text-sidebar-foreground sm:w-56">
      <div className="px-3 pt-5 pb-4 sm:px-5">
        <Link to="/admin" className="block space-y-1.5">
          <div className="flex items-center justify-center gap-2 sm:justify-start">
            <BrandIcon />
            <BrandWordmark className="hidden h-3 sm:block" />
          </div>
          <div className="hidden text-xs font-medium text-foreground/80 sm:block">
            管理后台
          </div>
          <div className="mt-0.5 hidden text-[11px] text-muted-foreground sm:block">经营驾驶舱</div>
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
          icon={ShieldCheck}
          label="合伙人审核"
          to="/admin/partners"
          active={pathname.startsWith('/admin/partners')}
        />
        <AdminNavItem
          icon={GraduationCap}
          label="学习引擎"
          to="/admin/learning"
          active={pathname.startsWith('/admin/learning')}
        />
      </nav>
      <div className="border-t border-[#EFEFEF] px-2 py-3 sm:px-3">
        <div className="hidden truncate px-2 text-[12px] font-medium text-foreground sm:block">
          {preferredAuthDisplayName(me)}
        </div>
        <div className="hidden truncate px-2 text-[11px] text-muted-foreground sm:block">
          {me.email ?? '—'}
        </div>
        <Link
          to="/"
          title="返回工作台"
          className="mt-2 flex items-center justify-center gap-2 rounded-[8px] px-2 py-1.5 text-[12px] text-muted-foreground transition-colors hover:bg-[#EFEFEF] hover:text-[#EA1F59] sm:justify-start"
        >
          <LogOut className="h-3.5 w-3.5" aria-hidden />
          <span className="hidden sm:inline">返回工作台</span>
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
    'flex items-center justify-center gap-2 rounded-[8px] px-3 py-2 text-[13px] font-medium transition-colors sm:justify-start',
    active
      ? 'bg-[rgba(234,31,89,0.10)] text-[#EA1F59]'
      : 'text-muted-foreground hover:bg-[#EFEFEF] hover:text-foreground',
    disabled && 'cursor-not-allowed opacity-50 hover:bg-transparent hover:text-muted-foreground',
  );
  if (disabled || !to) {
    return (
      <div className={cls} aria-disabled="true" title={hint ? `${label} · ${hint}` : undefined}>
        <Icon className="h-4 w-4" aria-hidden />
        <span className="hidden flex-1 sm:inline">{label}</span>
        {hint && (
          <span className="hidden text-[10px] uppercase tracking-wider text-muted-foreground/70 sm:inline">
            {hint}
          </span>
        )}
      </div>
    );
  }
  return (
    <Link to={to} className={cls} title={label}>
      <Icon className="h-4 w-4" aria-hidden />
      <span className="hidden sm:inline">{label}</span>
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
