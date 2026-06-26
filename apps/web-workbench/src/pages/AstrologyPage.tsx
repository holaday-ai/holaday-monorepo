import { useLocation } from 'react-router-dom';
import { AstroDashboard } from '@/components/astrology/AstroDashboard';
import { useAppShellContext } from '@/components/AppShell';
import { PageContainer, PageHeader } from '@/pages/PageShell';

export function AstrologyPage(): JSX.Element {
  const location = useLocation();
  const liveProvider = location.pathname === '/cosmic';
  if (liveProvider) return <AuthedAstrologyPage />;
  return <AstrologyPageShell liveProvider={false} profileStorageScope={null} />;
}

function AuthedAstrologyPage(): JSX.Element {
  const { me } = useAppShellContext();
  return (
    <AstrologyPageShell
      liveProvider
      profileStorageScope={me?.userId ?? null}
    />
  );
}

function AstrologyPageShell({
  liveProvider,
  profileStorageScope,
}: {
  liveProvider: boolean;
  profileStorageScope: string | null;
}): JSX.Element {
  return (
    <PageContainer width="wide">
      <PageHeader
        title="今日能量"
        description="给等待任务、开始工作和每周规划加一点轻松的个人节奏。"
      />
      <AstroDashboard
        liveProvider={liveProvider}
        profileStorageScope={profileStorageScope}
      />
    </PageContainer>
  );
}
