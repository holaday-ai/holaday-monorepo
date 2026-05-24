import * as React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { getAccessToken } from '@/lib/auth';
import { authRedirectTarget } from '@/lib/auth-redirect';

/**
 * Mirror of RequireAuth — bounces an ALREADY-authenticated visitor
 * away from /login and /register back to the workbench. Without this
 * a logged-in user could keep typing `/register` and get the signup
 * card from a stale tab; the orchestrator would happily process the
 * register call and overwrite their session.
 *
 * Intentionally a hard `Navigate` rather than rendering a "you're
 * already logged in" card — the only sensible thing to do at /register
 * after login is to land on the workbench, and a visible bounce is
 * less confusing than an extra interstitial.
 */
export function RedirectIfAuthed({ children }: { children: React.ReactNode }): JSX.Element {
  const token = getAccessToken();
  const location = useLocation();
  if (token) {
    return <Navigate to={authRedirectTarget(location.search)} replace />;
  }
  return <>{children}</>;
}
