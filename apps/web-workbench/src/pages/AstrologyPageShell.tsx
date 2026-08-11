import { EnergyHome } from '@/components/energy/EnergyHome';
import { PageContainer, PageHeader } from '@/pages/PageShell';

export function AstrologyPageShell({
  liveProvider,
  profileStorageScope,
}: {
  liveProvider: boolean;
  profileStorageScope: string | null;
}): JSX.Element {
  return (
    <PageContainer width="wide">
      <PageHeader title="今日能量" description="工作间隙，给自己一点轻松、鼓励和重新出发的空间。" />
      <EnergyHome liveProvider={liveProvider} profileStorageScope={profileStorageScope} />
    </PageContainer>
  );
}
