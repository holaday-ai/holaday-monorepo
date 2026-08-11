import { EnergyHome } from '@/components/energy/EnergyHome';
import { PageContainer, PageHeader } from '@/pages/PageShell';

export function AstrologyPageShell({
  liveProvider,
  profileStorageScope,
}: {
  liveProvider: boolean;
  profileStorageScope: string | null;
}): JSX.Element {
  const now = new Date();
  const weekday = ['日', '一', '二', '三', '四', '五', '六'][now.getDay()] ?? '日';
  const dateLabel = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日 星期${weekday}`;

  return (
    <PageContainer width="wide" className="max-w-[1180px] !pt-14 min-[769px]:!pt-5">
      <PageHeader
        title="今日能量"
        action={
          <time className="text-sm text-muted-foreground" aria-label="今日日期">
            {dateLabel}
          </time>
        }
      />
      <EnergyHome liveProvider={liveProvider} profileStorageScope={profileStorageScope} />
    </PageContainer>
  );
}
