import { lazy, Suspense, type ComponentType, type LazyExoticComponent, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AdminLayout } from '@/components/AdminLayout';
import { AppShell, useAppShellContext } from '@/components/AppShell';
import {
  LazyLoadBoundary,
  RouteLoadingFallback,
} from '@/components/LazyLoadBoundary';
import { ToastProvider } from '@/components/ui/toast';
import { LoginPage } from '@/pages/LoginPage';
import { RedirectIfAuthed } from '@/pages/RedirectIfAuthed';
import { RegisterPage } from '@/pages/RegisterPage';
import { WorkbenchApp } from './WorkbenchApp';

const AdminDashboardPage = lazyRoute(() => import('@/pages/admin/AdminDashboardPage'), 'AdminDashboardPage');
const AdminFinancePage = lazyRoute(() => import('@/pages/admin/AdminFinancePage'), 'AdminFinancePage');
const AdminLearningDomainPage = lazyRoute(
  () => import('@/pages/admin/AdminLearningDomainPage'),
  'AdminLearningDomainPage',
);
const AdminLearningPage = lazyRoute(() => import('@/pages/admin/AdminLearningPage'), 'AdminLearningPage');
const AdminUserDetailPage = lazyRoute(() => import('@/pages/admin/AdminUserDetailPage'), 'AdminUserDetailPage');
const AdminUsersPage = lazyRoute(() => import('@/pages/admin/AdminUsersPage'), 'AdminUsersPage');
const BatchPage = lazyRoute(() => import('@/pages/BatchPage'), 'BatchPage');
const BillingPage = lazyRoute(() => import('@/pages/BillingPage'), 'BillingPage');
const ConnectionsPage = lazyRoute(() => import('@/pages/ConnectionsPage'), 'ConnectionsPage');
const FilesPage = lazyRoute(() => import('@/pages/FilesPage'), 'FilesPage');
const HistoryPage = lazyRoute(() => import('@/pages/HistoryPage'), 'HistoryPage');
const NotFoundPage = lazyRoute(() => import('@/pages/NotFoundPage'), 'NotFoundPage');
const PlanPage = lazyRoute(() => import('@/pages/PlanPage'), 'PlanPage');
const PrivacyPage = lazyRoute(() => import('@/pages/PrivacyPage'), 'PrivacyPage');
const ProfilePage = lazyRoute(() => import('@/pages/ProfilePage'), 'ProfilePage');
const ProjectsPage = lazyRoute(() => import('@/pages/ProjectsPage'), 'ProjectsPage');
const RolesPage = lazyRoute(() => import('@/pages/RolesPage'), 'RolesPage');
// Phase 26A — /scheduled renders the FullCalendar-based view. Keep
// the route variable name stable while loading the heavy calendar page
// only when the user actually opens scheduled tasks.
const ScheduledPage = lazyRoute(
  () => import('@/pages/scheduled-calendar/ScheduledCalendarPage'),
  'ScheduledCalendarPage',
);
const ServerErrorPage = lazyRoute(() => import('@/pages/ServerErrorPage'), 'ServerErrorPage');
const SettingsPage = lazyRoute(() => import('@/pages/SettingsPage'), 'SettingsPage');
const SkillsPage = lazyRoute(() => import('@/pages/SkillsPage'), 'SkillsPage');
const StarredPage = lazyRoute(() => import('@/pages/StarredPage'), 'StarredPage');
const StockTasksPage = lazyRoute(() => import('@/pages/StockTasksPage'), 'StockTasksPage');
const TermsPage = lazyRoute(() => import('@/pages/TermsPage'), 'TermsPage');
const UsagePage = lazyRoute(() => import('@/pages/UsagePage'), 'UsagePage');
const VideoPage = lazyRoute(() => import('@/pages/VideoPage'), 'VideoPage');

/**
 * Route table. Every authed route lives inside one `<AppShell>` layout
 * route — same Sidebar mount, same modal stack, same bootstrap across
 * `/`, `/scheduled`, `/batch`, `/files`, etc. The shell handles the
 * auth gate itself (renders LoginGate when no token), so the layout
 * doesn't need RequireAuth — visiting `/scheduled` while logged-out
 * still drops you on the LoginGate card (then takes you back to the
 * requested route once authed).
 *
 * Public pages (login / register / privacy / terms / 500) render
 * outside the shell so they can use their own layout chrome.
 */
export function App(): JSX.Element {
  return (
    <ToastProvider>
      <Routes>
        <Route
          path="/login"
          element={
            <RedirectIfAuthed>
              <LoginPage />
            </RedirectIfAuthed>
          }
        />
        <Route
          path="/register"
          element={
            <RedirectIfAuthed>
              <RegisterPage />
            </RedirectIfAuthed>
          }
        />
        <Route path="/privacy" element={lazyElement(<PrivacyPage />)} />
        <Route path="/terms" element={lazyElement(<TermsPage />)} />
        <Route path="/500" element={lazyElement(<ServerErrorPage />)} />
        <Route path="/app" element={<AppAliasRedirect />} />
        <Route path="/roles" element={<LegacyRolesRedirect />} />
        <Route path="/tasks" element={<LegacyPathRedirect pathname="/history" />} />
        <Route path="/schedule" element={<LegacyPathRedirect pathname="/scheduled" />} />
        <Route path="/calendar" element={<LegacyPathRedirect pathname="/scheduled" />} />
        <Route path="/experts" element={<LegacyPathRedirect pathname="/skills" />} />
        <Route path="/plugins" element={<LegacyPathRedirect pathname="/skills" />} />
        <Route
          path="/settings/appearance"
          element={<LegacySettingsSectionRedirect section="appearance" />}
        />
        <Route
          path="/settings/api-keys"
          element={<LegacySettingsSectionRedirect section="api-keys" />}
        />
        <Route
          path="/settings/memory"
          element={<LegacySettingsSectionRedirect section="memory" />}
        />
        <Route
          path="/settings/notifications"
          element={<LegacySettingsSectionRedirect section="notifications" />}
        />
        <Route
          path="/settings/account"
          element={<LegacySettingsSectionRedirect section="account" />}
        />

        {/* Phase 27 — admin surface. Sits OUTSIDE AppShell because
            it has its own auth + role gate and a dedicated left nav.
            Non-admins land at "/" via the AdminLayout's redirect. */}
        <Route element={<AdminLayout />}>
          <Route path="/admin" element={lazyElement(<AdminDashboardPage />)} />
          <Route path="/admin/users" element={lazyElement(<AdminUsersPage />)} />
          <Route path="/admin/users/:userId" element={lazyElement(<AdminUserDetailPage />)} />
          <Route path="/admin/finance" element={lazyElement(<AdminFinancePage />)} />
          <Route path="/admin/learning" element={lazyElement(<AdminLearningPage />)} />
          <Route path="/admin/learning/:domain" element={lazyElement(<AdminLearningDomainPage />)} />
        </Route>

        <Route element={<AppShell />}>
          <Route path="/" element={<WorkbenchApp />} />
          <Route path="/profile" element={lazyElement(<ProfilePage />)} />
          <Route path="/settings" element={lazyElement(<SettingsPage />)} />
          <Route path="/settings/roles" element={lazyElement(<RolesPage />)} />
          <Route path="/plan" element={lazyElement(<PlanPage />)} />
          <Route path="/billing" element={lazyElement(<BillingPage />)} />
          <Route path="/usage" element={lazyElement(<UsagePage />)} />
          <Route path="/history" element={lazyElement(<HistoryPage />)} />
          <Route path="/skills" element={lazyElement(<SkillsPage />)} />
          <Route path="/stocks" element={lazyElement(<StockTasksPage />)} />
          <Route path="/projects" element={lazyElement(<ProjectsPage />)} />
          <Route path="/starred" element={lazyElement(<StarredPage />)} />
          <Route path="/files" element={lazyElement(<FilesPage />)} />
          <Route path="/video" element={<VideoGate />} />
          <Route path="/scheduled" element={lazyElement(<ScheduledPage />)} />
          <Route path="/batch" element={lazyElement(<BatchPage />)} />
          <Route path="/batch/:batchId" element={lazyElement(<BatchPage />)} />
          <Route path="/connections" element={lazyElement(<ConnectionsPage />)} />
          <Route path="*" element={lazyElement(<NotFoundPage />)} />
        </Route>
      </Routes>
    </ToastProvider>
  );
}

/**
 * `/app` is the legacy alias the landing page lands on after auth
 * handoff. Forward the full location so deep links via `/app/?task=…`
 * survive — a plain `<Navigate to="/" />` would drop search + hash.
 */
function AppAliasRedirect(): JSX.Element {
  const location = useLocation();
  return (
    <Navigate
      to={{ pathname: '/', search: location.search, hash: location.hash }}
      replace
    />
  );
}

function LegacyRolesRedirect(): JSX.Element {
  const location = useLocation();
  return (
    <Navigate
      to={{ pathname: '/settings/roles', search: location.search, hash: location.hash }}
      replace
    />
  );
}

function LegacyPathRedirect({ pathname }: { pathname: string }): JSX.Element {
  const location = useLocation();
  return (
    <Navigate
      to={{ pathname, search: location.search, hash: location.hash }}
      replace
    />
  );
}

function LegacySettingsSectionRedirect({ section }: { section: string }): JSX.Element {
  const location = useLocation();
  return (
    <Navigate
      to={{ pathname: '/settings', search: location.search, hash: `#${section}` }}
      replace
    />
  );
}

function lazyRoute<T extends ComponentType<unknown>>(
  loader: () => Promise<Record<string, T>>,
  exportName: string,
): LazyExoticComponent<T> {
  return lazy(() =>
    loader().then((module) => ({
      default: module[exportName],
    })),
  );
}

function lazyElement(children: ReactNode): JSX.Element {
  return (
    <LazyLoadBoundary surfaceLabel="页面">
      <Suspense fallback={<RouteLoadingFallback />}>{children}</Suspense>
    </LazyLoadBoundary>
  );
}

/**
 * Phase 1 #4 — /video route guard. Rendered inside the AppShell Outlet, so
 * `me` is the bootstrapped profile. When video isn't enabled for this user
 * (flag off or not in the allowlist — `videoEnabled` mirrors the backend
 * fork gate), bounce to home instead of exposing the 3-tab video page; the
 * sidebar entry is hidden in parallel (Sidebar FeatureNav).
 */
function VideoGate(): JSX.Element {
  const { me } = useAppShellContext();
  if (!me?.videoEnabled) return <Navigate to="/" replace />;
  return lazyElement(<VideoPage />);
}
