import { useNavigate } from 'react-router-dom';
import { LoginGate } from '@/components/LoginGate';

/**
 * Standalone register route. Pre-selects the register mode on
 * LoginGate and navigates back to `/` on success so the user lands
 * straight in the workbench.
 */
export function RegisterPage(): JSX.Element {
  const navigate = useNavigate();
  return <LoginGate initialMode="register" onAuthenticated={() => navigate('/', { replace: true })} />;
}
