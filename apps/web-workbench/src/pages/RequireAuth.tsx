import * as React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { getAccessToken } from '@/lib/auth';

/**
 * Redirects unauthenticated visitors back to `/` (the workbench gate).
 * Stashes the attempted path in location state so the gate could
 * bounce back after login — not wired yet, but the data is there.
 */
export function RequireAuth({ children }: { children: React.ReactNode }): JSX.Element {
  const location = useLocation();
  const token = getAccessToken();
  if (!token) {
    return <Navigate to="/" replace state={{ from: location.pathname }} />;
  }
  return <>{children}</>;
}
