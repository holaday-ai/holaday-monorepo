import { Navigate, Route, Routes } from 'react-router-dom';
import { ToastProvider } from '@/components/ui/toast';
import { BillingPage } from '@/pages/BillingPage';
import { HistoryPage } from '@/pages/HistoryPage';
import { LoginPage } from '@/pages/LoginPage';
import { NotFoundPage } from '@/pages/NotFoundPage';
import { PlanPage } from '@/pages/PlanPage';
import { PrivacyPage } from '@/pages/PrivacyPage';
import { ProfilePage } from '@/pages/ProfilePage';
import { ProjectsPage } from '@/pages/ProjectsPage';
import { RedirectIfAuthed } from '@/pages/RedirectIfAuthed';
import { RegisterPage } from '@/pages/RegisterPage';
import { RequireAuth } from '@/pages/RequireAuth';
import { RolesPage } from '@/pages/RolesPage';
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
              <ProfilePage />
            </RequireAuth>
          }
        />
        <Route
          path="/settings"
          element={
            <RequireAuth>
              <SettingsPage />
            </RequireAuth>
          }
        />
        <Route
          path="/settings/roles"
          element={
            <RequireAuth>
              <RolesPage />
            </RequireAuth>
          }
        />
        <Route
          path="/plan"
          element={
            <RequireAuth>
              <PlanPage />
            </RequireAuth>
          }
        />
        <Route
          path="/billing"
          element={
            <RequireAuth>
              <BillingPage />
            </RequireAuth>
          }
        />
        <Route
          path="/usage"
          element={
            <RequireAuth>
              <UsagePage />
            </RequireAuth>
          }
        />
        <Route
          path="/history"
          element={
            <RequireAuth>
              <HistoryPage />
            </RequireAuth>
          }
        />

        <Route
          path="/skills"
          element={
            <RequireAuth>
              <SkillsPage />
            </RequireAuth>
          }
        />
        <Route
          path="/projects"
          element={
            <RequireAuth>
              <ProjectsPage />
            </RequireAuth>
          }
        />
        <Route
          path="/starred"
          element={
            <RequireAuth>
              <StarredPage />
            </RequireAuth>
          }
        />

        <Route path="/app" element={<Navigate to="/" replace />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </ToastProvider>
  );
}
