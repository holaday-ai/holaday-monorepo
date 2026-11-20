import {
  type HomeUploadContext,
  type HomeUploadSession,
  createHomeUploadContext,
} from '@/lib/home-upload-context';
import { uploadFailureMessage } from '@/lib/upload-file';
import { Loader2, Upload, X } from 'lucide-react';
import * as React from 'react';

const BUTTON =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40';
const pending = (state: string) =>
  ['opening', 'awaiting_files', 'preparing', 'delivering'].includes(state);
const COPY = {
  opening: '正在准备文件选择。',
  awaiting_files: '助手正在等你选择文件或取消。',
  preparing: '正在核对所选文件。',
  delivering: '正在交给页面，请等待回执。',
  handed_to_page: '已交给页面，请在网站核对接收和保存结果。',
  unknown: '交付结果待核对，请先查看网站，不要重复交付。',
  cancelled: '已取消文件选择，文件未交给页面。',
  expired: '文件选择已过期，文件未交给页面。',
  unavailable: '原页面或请求已变化，文件未交给页面。',
  failed: '文件未交给页面，请核对格式和网页后重新选择。',
};
export function BrowserHomeUpload(props: {
  ownerId: string;
  instanceId: string;
}): JSX.Element | null {
  return <OwnedUpload key={`${props.ownerId}:${props.instanceId}`} {...props} />;
}
function OwnedUpload({
  ownerId,
  instanceId,
}: { ownerId: string; instanceId: string }): JSX.Element | null {
  const [data, setData] = React.useState<HomeUploadSession | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [dismissed, setDismissed] = React.useState<string | null>(null);
  const input = React.useRef<HTMLInputElement>(null);
  const context = React.useRef<HomeUploadContext | null>(null);
  const mounted = React.useRef(true);
  const pendingId = React.useRef<string | null>(null);
  const selection = React.useRef<AbortController | null>(null);
  const refresh = React.useRef<(() => Promise<void>) | null>(null);
  const epoch = React.useRef(0);
  const apply = React.useCallback(
    (session: HomeUploadSession) => {
      if (session.instanceId !== instanceId)
        throw new Error('原浏览器已变化，请重新打开云浏览器。');
      if (
        selection.current &&
        (!session.request ||
          !pending(session.request.state) ||
          (pendingId.current && pendingId.current !== session.request.id))
      ) {
        selection.current.abort();
        selection.current = null;
        setBusy(false);
      }
      pendingId.current =
        session.request && pending(session.request.state) ? session.request.id : null;
      setData(session);
    },
    [instanceId],
  );
  React.useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  React.useEffect(() => {
    const controller = new AbortController();
    let active = true;
    let fetching = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const current = () => {
      if (!active || !mounted.current) throw new Error('文件选择界面已关闭。');
    };
    const poll = async () => {
      if (fetching || !active) return;
      fetching = true;
      clearTimeout(timer);
      const version = epoch.current;
      try {
        const bound =
          context.current ??
          (await createHomeUploadContext(ownerId, instanceId, current, controller.signal));
        current();
        context.current = bound;
        const result = await bound.list();
        current();
        if (version === epoch.current) {
          if (result.changed) {
            selection.current?.abort();
            setBusy(false);
            pendingId.current = null;
            setData(null);
            throw new Error('原浏览器已变化，请重新打开云浏览器。');
          }
          if (result.session) apply(result.session);
          else if (!result.enabled) {
            selection.current?.abort();
            setBusy(false);
            pendingId.current = null;
            setData(null);
          }
          setError(null);
        }
        if (result.enabled && !result.changed) timer = setTimeout(() => void poll(), 2000);
      } catch (failure) {
        if (active && mounted.current) {
          const bound = context.current;
          try {
            bound?.current();
          } catch {
            selection.current?.abort();
            setBusy(false);
            if (pendingId.current) void bound?.cancelOnLeave(pendingId.current);
            pendingId.current = null;
            setData(null);
          }
          setError(
            failure instanceof Error ? failure.message : '暂时无法读取文件请求，请核对状态。',
          );
        }
      } finally {
        fetching = false;
      }
    };
    refresh.current = poll;
    void poll();
    return () => {
      active = false;
      selection.current?.abort();
      if (pendingId.current) void context.current?.cancelOnLeave(pendingId.current);
      controller.abort();
      clearTimeout(timer);
      context.current = null;
      refresh.current = null;
    };
  }, [ownerId, instanceId, apply]);
  const cancel = async () => {
    const bound = context.current;
    const id = data?.request?.id;
    if (!bound || !id) return;
    selection.current?.abort();
    epoch.current++;
    try {
      const result = await bound.cancel(id);
      bound.current();
      epoch.current++;
      apply(result);
      setError(null);
      setBusy(false);
    } catch {
      if (mounted.current && context.current === bound)
        setError('暂时无法确认取消结果，请核对文件状态。');
    }
  };
  const choose = async (files: File[]) => {
    const bound = context.current;
    const request = data?.request;
    if (!bound || !request || request.state !== 'awaiting_files' || busy || !files.length) return;
    if (
      files.length > (request.multiple ? 5 : 1) ||
      files.reduce((n, file) => n + file.size, 0) > 50 * 1024 * 1024
    ) {
      setError('最多选择 5 个文件、总计不超过 50MB，并遵守网站的文件数量要求。');
      return;
    }
    const controller = new AbortController();
    selection.current = controller;
    epoch.current++;
    setBusy(true);
    setError(null);
    try {
      const ids: string[] = [];
      for (const file of files) {
        const stored = await bound.upload(file, controller.signal);
        bound.current();
        controller.signal.throwIfAborted();
        ids.push(stored.fileId);
      }
      const result = await bound.choose(request.id, ids);
      bound.current();
      controller.signal.throwIfAborted();
      epoch.current++;
      apply(result);
    } catch (failure) {
      if (!controller.signal.aborted && mounted.current && context.current === bound)
        setError(`${uploadFailureMessage(failure)} 如已发起交付，请先核对文件状态，不要重复选择。`);
    } finally {
      if (mounted.current && context.current === bound && selection.current === controller) {
        setBusy(false);
        selection.current = null;
        if (input.current) input.current.value = '';
      }
    }
  };
  const request = data?.request;
  const cancelAction = React.useRef(cancel);
  cancelAction.current = cancel;
  React.useEffect(() => {
    const element = input.current;
    const cancelled = () => {
      void cancelAction.current();
    };
    element?.addEventListener('cancel', cancelled);
    return () => element?.removeEventListener('cancel', cancelled);
  }, [request?.id, request?.state]);
  if ((!request || dismissed === request.id) && !error) return null;
  return (
    <section
      aria-label="网站文件请求"
      className="flex shrink-0 flex-wrap items-center gap-3 border-b bg-muted/30 px-4 py-3 text-sm"
      aria-live="polite"
    >
      <div className="min-w-0 flex-1 basis-64 space-y-1">
        {request && (
          <>
            <p className="break-all">
              <strong>{request.origin}</strong> 请求文件
            </p>
            {request.formOrigin !== request.origin && (
              <p className="break-all text-muted-foreground">表单接收站点：{request.formOrigin}</p>
            )}
            <p>{busy ? '正在交付所选文件，助手继续等待。' : COPY[request.state]}</p>
            {request.state === 'awaiting_files' && (
              <p className="text-muted-foreground">选定后，网站可能立即接收并提交文件。</p>
            )}
          </>
        )}
        {error && (
          <p role="alert" className="break-words text-destructive">
            {error}
          </p>
        )}
      </div>
      <div className="flex max-w-full flex-wrap gap-2">
        {request?.state === 'awaiting_files' && (
          <>
            <input
              ref={input}
              type="file"
              aria-label="选择文件交给网站"
              className="sr-only"
              tabIndex={-1}
              accept={request.accept}
              multiple={request.multiple}
              disabled={busy}
              onChange={(event) => void choose(Array.from(event.target.files ?? []))}
            />
            <button
              type="button"
              className={BUTTON}
              disabled={busy}
              onClick={() => input.current?.click()}
            >
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Upload className="h-4 w-4" aria-hidden />
              )}
              选择文件
            </button>
          </>
        )}
        {request && ['opening', 'awaiting_files', 'preparing'].includes(request.state) && (
          <button
            type="button"
            className={BUTTON}
            onClick={() => void cancel()}
            aria-label="取消文件选择"
          >
            取消
          </button>
        )}
        <button
          type="button"
          className={BUTTON}
          onClick={() => void refresh.current?.()}
          aria-label="核对文件状态"
        >
          核对状态
        </button>
        {request && !pending(request.state) && (
          <button
            type="button"
            className={BUTTON}
            onClick={() => {
              setDismissed(request.id);
              setError(null);
            }}
            aria-label="关闭文件提示"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        )}
      </div>
    </section>
  );
}
