import { ModelDataRegionDialog } from '@/components/ModelDataRegionDialog';
import { Button } from '@/components/ui/button';
import {
  MODEL_DATA_REGION_COPY,
  type ModelDataRegion,
} from '@/lib/model-data-region-state';
import { Section } from '@/pages/PageShell';
import * as React from 'react';

export function ModelDataRegionSection({
  region,
  onAssign,
}: {
  readonly region: ModelDataRegion | null;
  readonly onAssign: (region: ModelDataRegion) => Promise<unknown> | unknown;
}): JSX.Element {
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [assigning, setAssigning] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const assign = React.useCallback(
    async (nextRegion: ModelDataRegion) => {
      if (assigning) return;
      setAssigning(true);
      setError(null);
      try {
        await onAssign(nextRegion);
        setDialogOpen(false);
      } catch {
        setError('暂时无法保存任务处理区域，请重试。');
      } finally {
        setAssigning(false);
      }
    },
    [assigning, onAssign],
  );

  return (
    <Section id="model-region" title="任务处理区域" description="决定 AI 模型任务由哪个区域处理">
      {region ? (
        <div className="flex items-start justify-between gap-4 rounded-lg bg-muted/60 px-4 py-3">
          <div>
            <div className="text-sm font-medium text-foreground">
              {MODEL_DATA_REGION_COPY[region].label}
            </div>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {MODEL_DATA_REGION_COPY[region].description}
            </p>
          </div>
          <span className="shrink-0 rounded-full bg-foreground/[0.06] px-2 py-1 text-[11px] font-medium text-muted-foreground">
            已锁定
          </span>
        </div>
      ) : (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm leading-6 text-muted-foreground">
            首次创建 AI 模型任务前需要选择。选择后，任务会在对应区域处理。
          </p>
          <Button type="button" className="shrink-0" onClick={() => setDialogOpen(true)}>
            选择处理区域
          </Button>
        </div>
      )}

      <ModelDataRegionDialog
        open={dialogOpen}
        assigning={assigning}
        error={error}
        onClose={() => !assigning && setDialogOpen(false)}
        onConfirm={assign}
      />
    </Section>
  );
}
