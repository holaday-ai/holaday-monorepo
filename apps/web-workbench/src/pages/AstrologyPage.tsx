import { useAppShellContext } from '@/components/AppShell';
import { useLocation } from 'react-router-dom';
import { AstrologyPageShell } from './AstrologyPageShell';

export function AstrologyPage(): JSX.Element {
  const location = useLocation();
  const liveProvider = location.pathname === '/cosmic';
  if (liveProvider) return <AuthedAstrologyPage />;
  return <AstrologyPageShell liveProvider={false} profileStorageScope={null} />;
}

function AuthedAstrologyPage(): JSX.Element {
  const { me } = useAppShellContext();
  return <AstrologyPageShell liveProvider profileStorageScope={me?.userId ?? null} />;
}
