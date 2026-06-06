/**
 * Phase 27 — admin user list.
 *
 * Search by name/email + sort by createdAt|taskCount|lastActive +
 * paginate (50/page). Server returns the matching rows + `total` so
 * we can render a "X 条 / 第 N 页" footer.
 *
 * Clicking a row routes to /admin/users/:id (the detail page).
 */

import { ChevronLeft, ChevronRight, Loader2, Search } from 'lucide-react';
import * as React from 'react';
import { Link } from 'react-router-dom';
import { pageErrorMessage } from '@/lib/page-error-copy';
import { trpc } from '@/lib/trpc';
import { cn } from '@/lib/utils';
import {
  adminLoadErrorCopy,
  asRecord,
  formatDate,
  formatDateTime,
  formatInteger,
  nullableFiniteNumber,
  optionalText,
  safeArray,
  safeText,
  truncate,
  useMountedRef,
} from './admin-shared';

type Sort = 'createdAt' | 'taskCount' | 'lastActive';
type Order = 'asc' | 'desc';
const PAGE_SIZE = 50;

type UserListResult = Awaited<ReturnType<typeof trpc.admin.userList.query>>;

export function AdminUsersPage(): JSX.Element {
  const mountedRef = useMountedRef();
  const requestIdRef = React.useRef(0);
  const [search, setSearch] = React.useState('');
  const [searchDebounced, setSearchDebounced] = React.useState('');
  const [sort, setSort] = React.useState<Sort>('createdAt');
  const [order, setOrder] = React.useState<Order>('desc');
  const [offset, setOffset] = React.useState(0);
  const [data, setData] = React.useState<UserListResult | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Debounce search input — 300 ms after the user stops typing,
  // commit the value to `searchDebounced` which is what actually
  // triggers the query effect below.
  React.useEffect(() => {
    const id = window.setTimeout(() => {
      setSearchDebounced(search);
      setOffset(0);
    }, 300);
    return () => window.clearTimeout(id);
  }, [search]);

  React.useEffect(() => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setLoading(true);
    setError(null);
    trpc.admin.userList
      .query({
        search: searchDebounced || undefined,
        sort,
        order,
        offset,
        limit: PAGE_SIZE,
      })
      .then((res) => {
        if (mountedRef.current && requestIdRef.current === requestId) setData(res);
      })
      .catch((err) => {
        if (mountedRef.current && requestIdRef.current === requestId) {
          setError(pageErrorMessage(err));
        }
      })
      .finally(() => {
        if (mountedRef.current && requestIdRef.current === requestId) setLoading(false);
      });
    return () => {
      requestIdRef.current += 1;
    };
  }, [mountedRef, searchDebounced, sort, order, offset]);

  const users = safeArray(data?.users).map(normalizeUserRow);
  const total = nullableFiniteNumber(data?.total) ?? users.length;
  const pageEnd = Math.min(offset + PAGE_SIZE, total);
  const hasPrev = offset > 0;
  const hasNext = offset + PAGE_SIZE < total;
  const errorCopy = adminLoadErrorCopy(error);

  function toggleSort(next: Sort) {
    if (sort === next) {
      setOrder((o) => (o === 'asc' ? 'desc' : 'asc'));
    } else {
      setSort(next);
      setOrder('desc');
    }
    setOffset(0);
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <header className="mb-6">
        <h1 className="text-xl font-semibold">用户管理</h1>
        <p className="mt-1 text-[13px] text-muted-foreground">
          全部注册用户 · 共 {formatInteger(total)} 人
        </p>
      </header>

      <div className="mb-4 flex items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索邮箱 / 名字…"
            className="w-full rounded-[8px] border border-[#DCDDDD] bg-white py-2 pl-9 pr-3 text-[13px] outline-none transition-colors focus:border-[#EA1F59] focus:ring-2 focus:ring-[#EA1F59]/15"
          />
        </div>
        <span className="text-[12px] text-muted-foreground">
          排序：
        </span>
        <SortPill
          label="注册日期"
          active={sort === 'createdAt'}
          order={sort === 'createdAt' ? order : null}
          onClick={() => toggleSort('createdAt')}
        />
        <SortPill
          label="本月任务数"
          active={sort === 'taskCount'}
          order={sort === 'taskCount' ? order : null}
          onClick={() => toggleSort('taskCount')}
        />
        <SortPill
          label="最后活跃"
          active={sort === 'lastActive'}
          order={sort === 'lastActive' ? order : null}
          onClick={() => toggleSort('lastActive')}
        />
      </div>

      <section className="rounded-[8px] border border-[#DCDDDD] bg-white p-0 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
        {error && (
          <div className="border-b border-[#EFEFEF] px-5 py-3 text-sm">
            <div className="font-medium text-[#EA1F59]">{errorCopy.title}</div>
            <div className="mt-1 text-xs text-[#595757]">{errorCopy.body}</div>
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-[#EFEFEF] text-left text-[11px] uppercase text-muted-foreground">
                <th className="px-5 py-3 font-medium">用户</th>
                <th className="px-3 py-3 font-medium">邮箱</th>
                <th className="px-3 py-3 font-medium">套餐</th>
                <th className="px-3 py-3 font-medium">注册日期</th>
                <th className="px-3 py-3 font-medium">最后活跃</th>
                <th className="px-3 py-3 font-medium text-right">本月任务</th>
                <th className="px-5 py-3 font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {loading && !data ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-muted-foreground">
                    <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
                    加载中…
                  </td>
                </tr>
              ) : !data || users.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-muted-foreground">
                    {searchDebounced ? '没有匹配的用户' : '暂无用户'}
                  </td>
                </tr>
              ) : (
                users.map((u, index) => (
                  <tr
                    key={u.userId || `unknown-${index}`}
                    className="border-b border-[#EFEFEF] last:border-b-0 hover:bg-[#EFEFEF]/35"
                  >
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2.5">
                        <Avatar url={u.avatarUrl} fallback={u.displayName ?? u.email ?? '?'} />
                        <div className="min-w-0">
                          <div className="truncate text-foreground">
                            {u.displayName ?? '—'}
                          </div>
                          {u.role === 'admin' && (
                            <span className="mt-0.5 inline-block rounded-full bg-[rgba(234,31,89,0.10)] px-1.5 py-0.5 text-[10px] font-medium uppercase text-[#EA1F59]">
                              admin
                            </span>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-muted-foreground">
                      {truncate(u.email ?? '—', 32)}
                    </td>
                    <td className="px-3 py-3 text-muted-foreground">{u.plan}</td>
                    <td className="px-3 py-3 text-muted-foreground">
                      {formatDate(u.createdAt)}
                    </td>
                    <td className="px-3 py-3 text-muted-foreground">
                      {u.lastActiveAt ? formatDateTime(u.lastActiveAt) : '—'}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-foreground">
                      {formatInteger(u.monthTaskCount)}
                    </td>
                    <td className="px-5 py-3">
                      {u.userId ? (
                        <Link
                          to={`/admin/users/${u.userId}`}
                          className="text-[#EA1F59] hover:underline"
                        >
                          查看详情
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {/* Pagination */}
        <div className="flex items-center justify-between border-t border-[#EFEFEF] px-5 py-3 text-[12px] text-muted-foreground">
          <div>
            {total > 0 && (
              <>
                显示 {offset + 1} – {pageEnd}（共 {formatInteger(total)} 人）
              </>
            )}
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={!hasPrev}
              onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
              className={cn(
                'inline-flex h-7 items-center gap-1 rounded-[8px] border border-[#DCDDDD] px-2',
                hasPrev
                  ? 'cursor-pointer hover:bg-[#EFEFEF] hover:text-[#EA1F59]'
                  : 'cursor-not-allowed opacity-40',
              )}
            >
              <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
              上一页
            </button>
            <button
              type="button"
              disabled={!hasNext}
              onClick={() => setOffset((o) => o + PAGE_SIZE)}
              className={cn(
                'inline-flex h-7 items-center gap-1 rounded-[8px] border border-[#DCDDDD] px-2',
                hasNext
                  ? 'cursor-pointer hover:bg-[#EFEFEF] hover:text-[#EA1F59]'
                  : 'cursor-not-allowed opacity-40',
              )}
            >
              下一页
              <ChevronRight className="h-3.5 w-3.5" aria-hidden />
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

function normalizeUserRow(value: unknown) {
  const row = asRecord(value);
  return {
    userId: optionalText(row.userId),
    avatarUrl: optionalText(row.avatarUrl),
    displayName: optionalText(row.displayName),
    email: optionalText(row.email),
    plan: safeText(row.plan),
    role: safeText(row.role, 'user'),
    createdAt: optionalText(row.createdAt),
    lastActiveAt: optionalText(row.lastActiveAt),
    monthTaskCount: nullableFiniteNumber(row.monthTaskCount) ?? 0,
  };
}

function SortPill({
  label,
  active,
  order,
  onClick,
}: {
  label: string;
  active: boolean;
  order: Order | null;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex h-7 items-center gap-1 rounded-full border px-3 text-[12px] transition-colors',
        active
          ? 'border-[#EA1F59] bg-[rgba(234,31,89,0.10)] text-[#EA1F59]'
          : 'border-[#DCDDDD] bg-white text-muted-foreground hover:bg-[#EFEFEF] hover:text-[#EA1F59]',
      )}
    >
      {label}
      {active && (
        <span className="text-[9px]" aria-hidden>
          {order === 'asc' ? '↑' : '↓'}
        </span>
      )}
    </button>
  );
}

function Avatar({
  url,
  fallback,
}: {
  url: string | null;
  fallback: string;
}): JSX.Element {
  if (url) {
    return (
      <img
        src={url}
        alt=""
        className="h-7 w-7 shrink-0 rounded-full object-cover"
        loading="lazy"
      />
    );
  }
  const letter = (fallback || '?').charAt(0).toUpperCase();
  return (
    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[rgba(234,31,89,0.12)] text-[11px] font-semibold text-[#EA1F59]">
      {letter}
    </div>
  );
}
