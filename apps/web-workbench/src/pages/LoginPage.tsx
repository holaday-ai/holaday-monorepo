import { useLocation, useNavigate } from 'react-router-dom';
import { LoginGate } from '@/components/LoginGate';
import { authRedirectTarget } from '@/lib/auth-redirect';

/**
 * Standalone /login route — mirrors RegisterPage but pre-selects
 * the login mode. Until QA Round 2 the workbench's inline LoginGate
 * was the only login surface; adding this dedicated route mostly
 * exists so the RedirectIfAuthed guard has a coherent landing
 * pad, and so an external link / ad campaign pointing at /login
 * doesn't 404.
 */
export function LoginPage(): JSX.Element {
  const navigate = useNavigate();
  const location = useLocation();
  const target = authRedirectTarget(location.search);
  return (
    <LoginGate initialMode="login" onAuthenticated={() => navigate(target, { replace: true })} />
  );
}
