import { useLocation, useNavigate } from 'react-router-dom';
import { LoginGate } from '@/components/LoginGate';
import { authRedirectTarget } from '@/lib/auth-redirect';

/**
 * Standalone register route. Pre-selects the register mode on
 * LoginGate and navigates back to `/` on success so the user lands
 * straight in the workbench.
 */
export function RegisterPage(): JSX.Element {
  const navigate = useNavigate();
  const location = useLocation();
  const target = authRedirectTarget(location.search);
  return (
    <LoginGate
      initialMode="register"
      onAuthenticated={() => navigate(target, { replace: true })}
    />
  );
}
