import { Button } from '@/components/ui/button';
import {
  MODEL_DATA_REGION_COPY,
  type ModelDataRegion,
} from '@/lib/model-data-region-state';
import { cn } from '@/lib/utils';
import * as Dialog from '@radix-ui/react-dialog';
import * as React from 'react';

interface ModelDataRegionDialogProps {
  readonly open: boolean;
  readonly assigning: boolean;
  readonly error: string | null;
  readonly onClose: () => void;
  readonly onConfirm: (region: ModelDataRegion) => Promise<void> | void;
}

export function ModelDataRegionDialog({
  open,
  assigning,
  error,
  onClose,
  onConfirm,
}: ModelDataRegionDialogProps): JSX.Element {
  const [selected, setSelected] = React.useState<ModelDataRegion | null>(null);
  const [locallyConfirming, setLocallyConfirming] = React.useState(false);
  const confirmingRef = React.useRef(false);

  React.useEffect(() => {
    if (!open) {
      setSelected(null);
      setLocallyConfirming(false);
      confirmingRef.current = false;
    }
  }, [open]);

  React.useEffect(() => {
    if (error) {
      setLocallyConfirming(false);
      confirmingRef.current = false;
    }
  }, [error]);

  const confirm = React.useCallback(async () => {
    if (!selected || assigning || confirmingRef.current) return;
    confirmingRef.current = true;
    setLocallyConfirming(true);
    await onConfirm(selected);
  }, [assigning, onConfirm, selected]);

  const pending = assigning || locallyConfirming;

  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && !assigning && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[90] bg-black/25 backdrop-blur-[2px]" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[91] w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border bg-background p-6 shadow-[0_24px_80px_rgba(15,23,42,0.22)] focus:outline-none">
          <Dialog.Title className="text-lg font-semibold text-foreground">
            选择任务处理区域
          </Dialog.Title>
          <Dialog.Description className="mt-2 text-sm leading-6 text-muted-foreground">
            这个选择控制 AI 模型任务在哪里处理。创建模型数据后不能直接更改。
          </Dialog.Description>

          <div className="mt-5 grid gap-3" role="radiogroup" aria-label="任务处理区域">
            {(Object.keys(MODEL_DATA_REGION_COPY) as ModelDataRegion[]).map((region) => {
              const copy = MODEL_DATA_REGION_COPY[region];
              const checked = selected === region;
              return (
                <label
                  key={region}
                  className={cn(
                    'flex cursor-pointer gap-3 rounded-xl border px-4 py-3 transition-colors',
                    checked
                      ? 'border-primary/60 bg-primary/[0.06]'
                      : 'border-border hover:bg-foreground/[0.025]',
                    pending && 'cursor-not-allowed opacity-60',
                  )}
                >
                  <input
                    type="radio"
                    name="model-data-region"
                    value={region}
                    checked={checked}
                    disabled={pending}
                    onChange={() => setSelected(region)}
                    className="mt-1 h-4 w-4 accent-primary"
                    aria-label={copy.label}
                  />
                  <span>
                    <span className="block text-sm font-medium text-foreground">{copy.label}</span>
                    <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">
                      {copy.description}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>

          <p className="mt-4 text-xs text-muted-foreground" aria-live="polite">
            {pending ? '正在保存区域并恢复你的任务…' : '请选择一个区域后继续。'}
          </p>
          {error && (
            <p className="mt-2 text-xs text-destructive" role="alert">
              {error}
            </p>
          )}

          <div className="mt-6 flex justify-end gap-2">
            <Button type="button" variant="ghost" disabled={pending} onClick={onClose}>
              暂不选择
            </Button>
            <Button type="button" disabled={!selected || pending} onClick={() => void confirm()}>
              {pending ? '正在保存区域…' : '确认并继续任务'}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
