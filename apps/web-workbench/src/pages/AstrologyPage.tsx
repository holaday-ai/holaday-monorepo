import { AstroDashboard } from '@/components/astrology/AstroDashboard';
import { PageContainer, PageHeader } from '@/pages/PageShell';

export function AstrologyPage(): JSX.Element {
  return (
    <PageContainer width="wide">
      <PageHeader
        title="今日能量"
        description="给等待任务、开始工作和每周规划加一点轻松的个人节奏。"
      />
      <AstroDashboard />
    </PageContainer>
  );
}
