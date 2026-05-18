import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AdminLayout } from '@/components/AdminLayout';
import { AppShell } from '@/components/AppShell';
import { ToastProvider } from '@/components/ui/toast';
import { AdminDashboardPage } from '@/pages/admin/AdminDashboardPage';
import { AdminFinancePage } from '@/pages/admin/AdminFinancePage';
import { AdminLearningDomainPage } from '@/pages/admin/AdminLearningDomainPage';
import { AdminLearningPage } from '@/pages/admin/AdminLearningPage';
import { AdminUserDetailPage } from '@/pages/admin/AdminUserDetailPage';
import { AdminUsersPage } from '@/pages/admin/AdminUsersPage';
import { BillingPage } from '@/pages/BillingPage';
import { HistoryPage } from '@/pages/HistoryPage';
import { LoginPage } from '@/pages/LoginPage';
import { NotFoundPage } from '@/pages/NotFoundPage';
import { PlanPage } from '@/pages/PlanPage';
import { PrivacyPage } from '@/pages/PrivacyPage';
import { ConnectionsPage } from '@/pages/ConnectionsPage';
import { FilesPage } from '@/pages/FilesPage';
import { ProfilePage } from '@/pages/ProfilePage';
import { ProjectsPage } from '@/pages/ProjectsPage';
import { RedirectIfAuthed } from '@/pages/RedirectIfAuthed';
import { RegisterPage } from '@/pages/RegisterPage';
import { RolesPage } from '@/pages/RolesPage';
import { BatchPage } from '@/pages/BatchPage';
// Phase 26A — /scheduled now renders the FullCalendar-based view.
// The old list-view ScheduledPage is retired; ScheduledCalendarPage
// covers the same CRUD + adds calendar interaction. The export name
// stays `ScheduledPage` to keep this import line stable for grep.
import { ScheduledCalendarPage as ScheduledPage } from '@/pages/scheduled-calendar/ScheduledCalendarPage';
import { ServerErrorPage } from '@/pages/ServerErrorPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { SkillsPage } from '@/pages/SkillsPage';
import { StarredPage } from '@/pages/StarredPage';
import { TermsPage } from '@/pages/TermsPage';
import { UsagePage } from '@/pages/UsagePage';
import { WorkbenchApp } from './WorkbenchApp';

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
        <Route path="/privacy" element={<PrivacyPage />} />
        <Route path="/terms" element={<TermsPage />} />
        <Route path="/500" element={<ServerErrorPage />} />
        <Route path="/app" element={<AppAliasRedirect />} />

        {/* Phase 27 — admin surface. Sits OUTSIDE AppShell because
            it has its own auth + role gate and a dedicated left nav.
            Non-admins land at "/" via the AdminLayout's redirect. */}
        <Route element={<AdminLayout />}>
          <Route path="/admin" element={<AdminDashboardPage />} />
          <Route path="/admin/users" element={<AdminUsersPage />} />
          <Route path="/admin/users/:userId" element={<AdminUserDetailPage />} />
          <Route path="/admin/finance" element={<AdminFinancePage />} />
          <Route path="/admin/learning" element={<AdminLearningPage />} />
          <Route path="/admin/learning/:domain" element={<AdminLearningDomainPage />} />
        </Route>

        <Route element={<AppShell />}>
          <Route path="/" element={<WorkbenchApp />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/settings/roles" element={<RolesPage />} />
          <Route path="/plan" element={<PlanPage />} />
          <Route path="/billing" element={<BillingPage />} />
          <Route path="/usage" element={<UsagePage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/skills" element={<SkillsPage />} />
          <Route path="/projects" element={<ProjectsPage />} />
          <Route path="/starred" element={<StarredPage />} />
          <Route path="/files" element={<FilesPage />} />
          <Route path="/scheduled" element={<ScheduledPage />} />
          <Route path="/batch" element={<BatchPage />} />
          <Route path="/batch/:batchId" element={<BatchPage />} />
          <Route path="/connections" element={<ConnectionsPage />} />
          <Route path="*" element={<NotFoundPage />} />
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
