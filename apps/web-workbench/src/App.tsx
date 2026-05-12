import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AuthedAppLayout } from '@/components/AuthedAppLayout';
import { ToastProvider } from '@/components/ui/toast';
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
import { RequireAuth } from '@/pages/RequireAuth';
import { RolesPage } from '@/pages/RolesPage';
import { BatchPage } from '@/pages/BatchPage';
import { ScheduledPage } from '@/pages/ScheduledPage';
import { ServerErrorPage } from '@/pages/ServerErrorPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { SkillsPage } from '@/pages/SkillsPage';
import { StarredPage } from '@/pages/StarredPage';
import { TermsPage } from '@/pages/TermsPage';
import { UsagePage } from '@/pages/UsagePage';
import { WorkbenchApp } from './WorkbenchApp';

/**
 * Route table. The workbench at `/` keeps its inline LoginGate (existing
 * UX — logged-out users land on a card, not a redirect). Secondary
 * product pages live under their own paths and are gated by
 * RequireAuth, which bounces to `/` when there's no access token.
 */
export function App(): JSX.Element {
  return (
    <ToastProvider>
      <Routes>
        <Route path="/" element={<WorkbenchApp />} />
        {/* QA #15 — both auth pages bounce already-authenticated
         *  visitors back to the workbench. /login is also added as
         *  a dedicated route so external campaign links don't 404. */}
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

        <Route
          path="/profile"
          element={
            <RequireAuth>
              <AuthedAppLayout>
                <ProfilePage />
              </AuthedAppLayout>
            </RequireAuth>
          }
        />
        <Route
          path="/settings"
          element={
            <RequireAuth>
              <AuthedAppLayout>
                <SettingsPage />
              </AuthedAppLayout>
            </RequireAuth>
          }
        />
        <Route
          path="/settings/roles"
          element={
            <RequireAuth>
              <AuthedAppLayout>
                <RolesPage />
              </AuthedAppLayout>
            </RequireAuth>
          }
        />
        <Route
          path="/plan"
          element={
            <RequireAuth>
              <AuthedAppLayout>
                <PlanPage />
              </AuthedAppLayout>
            </RequireAuth>
          }
        />
        <Route
          path="/billing"
          element={
            <RequireAuth>
              <AuthedAppLayout>
                <BillingPage />
              </AuthedAppLayout>
            </RequireAuth>
          }
        />
        <Route
          path="/usage"
          element={
            <RequireAuth>
              <AuthedAppLayout>
                <UsagePage />
              </AuthedAppLayout>
            </RequireAuth>
          }
        />
        <Route
          path="/history"
          element={
            <RequireAuth>
              <AuthedAppLayout>
                <HistoryPage />
              </AuthedAppLayout>
            </RequireAuth>
          }
        />

        <Route
          path="/skills"
          element={
            <RequireAuth>
              <AuthedAppLayout>
                <SkillsPage />
              </AuthedAppLayout>
            </RequireAuth>
          }
        />
        <Route
          path="/projects"
          element={
            <RequireAuth>
              <AuthedAppLayout>
                <ProjectsPage />
              </AuthedAppLayout>
            </RequireAuth>
          }
        />
        <Route
          path="/starred"
          element={
            <RequireAuth>
              <AuthedAppLayout>
                <StarredPage />
              </AuthedAppLayout>
            </RequireAuth>
          }
        />
        <Route
          path="/files"
          element={
            <RequireAuth>
              <AuthedAppLayout>
                <FilesPage />
              </AuthedAppLayout>
            </RequireAuth>
          }
        />
        <Route
          path="/scheduled"
          element={
            <RequireAuth>
              <AuthedAppLayout>
                <ScheduledPage />
              </AuthedAppLayout>
            </RequireAuth>
          }
        />
        <Route
          path="/batch"
          element={
            <RequireAuth>
              <AuthedAppLayout>
                <BatchPage />
              </AuthedAppLayout>
            </RequireAuth>
          }
        />
        <Route
          path="/batch/:batchId"
          element={
            <RequireAuth>
              <AuthedAppLayout>
                <BatchPage />
              </AuthedAppLayout>
            </RequireAuth>
          }
        />
        <Route
          path="/connections"
          element={
            <RequireAuth>
              <AuthedAppLayout>
                <ConnectionsPage />
              </AuthedAppLayout>
            </RequireAuth>
          }
        />

        <Route path="/app" element={<AppAliasRedirect />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </ToastProvider>
  );
}

/**
 * P1-B — `/app` is the legacy alias the landing page lands on after
 * auth handoff. The previous `<Navigate to="/" />` dropped query +
 * hash, which killed any deep link routed through it (notably
 * `/app/?task=tsk_xxx` from a shared link). Forward the full
 * location so search + hash survive.
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
