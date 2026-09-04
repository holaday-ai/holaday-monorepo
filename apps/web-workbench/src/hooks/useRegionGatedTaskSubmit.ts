import {
  modelTaskSubmitDecision,
  type ModelDataRegion,
} from '@/lib/model-data-region-state';
import * as React from 'react';

interface RegionProfile {
  readonly modelDataRegion?: unknown;
}

interface UseRegionGatedTaskSubmitOptions<TPayload, TResult> {
  readonly region: unknown;
  readonly assignRegion: (region: ModelDataRegion) => Promise<unknown> | unknown;
  readonly refreshMe: () => Promise<RegionProfile | null>;
  readonly submit: (payload: TPayload) => Promise<TResult> | TResult;
}

type RegionSubmitDecision<TResult> =
  | { readonly kind: 'choose_region' }
  | { readonly kind: 'submitted'; readonly result: TResult };

const REFRESH_ERROR = '区域已保存，但暂时无法刷新账号状态，请重试。';
const ASSIGN_ERROR = '暂时无法保存任务处理区域，请重试。';

export function useRegionGatedTaskSubmit<TPayload, TResult>({
  region,
  assignRegion,
  refreshMe,
  submit,
}: UseRegionGatedTaskSubmitOptions<TPayload, TResult>) {
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [assigning, setAssigning] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const pendingPayloadRef = React.useRef<TPayload | null>(null);
  const assignmentPendingRef = React.useRef(false);

  const requestSubmit = React.useCallback(
    async (payload: TPayload): Promise<RegionSubmitDecision<TResult>> => {
      if (modelTaskSubmitDecision(region) === 'submit') {
        return { kind: 'submitted', result: await submit(payload) };
      }

      pendingPayloadRef.current = payload;
      setError(null);
      setDialogOpen(true);
      return { kind: 'choose_region' };
    },
    [region, submit],
  );

  const confirmRegion = React.useCallback(
    async (nextRegion: ModelDataRegion): Promise<TResult | undefined> => {
      if (assignmentPendingRef.current || pendingPayloadRef.current === null) return undefined;

      assignmentPendingRef.current = true;
      setAssigning(true);
      setError(null);
      try {
        await assignRegion(nextRegion);
        const refreshed = await refreshMe();
        if (refreshed?.modelDataRegion !== nextRegion) {
          setError(REFRESH_ERROR);
          return undefined;
        }

        const payload = pendingPayloadRef.current;
        pendingPayloadRef.current = null;
        setDialogOpen(false);
        return await submit(payload);
      } catch {
        setError(ASSIGN_ERROR);
        return undefined;
      } finally {
        assignmentPendingRef.current = false;
        setAssigning(false);
      }
    },
    [assignRegion, refreshMe, submit],
  );

  const closeDialog = React.useCallback(() => {
    if (assignmentPendingRef.current) return;
    pendingPayloadRef.current = null;
    setDialogOpen(false);
    setError(null);
  }, []);

  return {
    dialogOpen,
    assigning,
    error,
    requestSubmit,
    confirmRegion,
    closeDialog,
  } as const;
}
