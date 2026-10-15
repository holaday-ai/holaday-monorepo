import { trpc } from '@/lib/trpc';
import * as React from 'react';

type CaptchaStatus = {
  failedRounds?: number;
  alternateAvailable?: boolean;
  challenge?: { kind: string; hint: string } | null;
};

/** Actions affect the existing task only; all verification input stays in the browser. */
export function CaptchaHandoffActions({
  taskId,
  onFullscreen,
}: {
  taskId: string;
  /** CAPTCHA-REDUCE-1: brings the live browser up full screen (opened once on phones). */
  onFullscreen?: () => void;
}) {
  const [pending, setPending] = React.useState(false);
  const [message, setMessage] = React.useState('');
  const [status, setStatus] = React.useState<CaptchaStatus>({});
  const record = React.useCallback((result: CaptchaStatus & { state?: string }) => {
    setStatus({
      failedRounds: result.failedRounds,
      alternateAvailable: result.alternateAvailable,
      challenge: result.challenge ?? null,
    });
  }, []);
  React.useEffect(() => {
    let live = true;
    trpc.tasks.browserCaptcha
      .mutate({ taskId, action: 'status' })
      .then((result) => {
        if (live && result.state === 'waiting') record(result);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [taskId, record]);
  const openedFullscreen = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!onFullscreen || openedFullscreen.current === taskId) return;
    if (typeof window !== 'undefined' && window.innerWidth < 768) {
      openedFullscreen.current = taskId;
      onFullscreen();
    }
  }, [taskId, onFullscreen]);
  const act = async (action: 'continue' | 'cancel' | 'alternate') => {
    if (pending) return;
    setPending(true);
    setMessage('');
    try {
      const result = await trpc.tasks.browserCaptcha.mutate({ taskId, action });
      if ('failedRounds' in result) record(result);
      if (result.state === 'waiting')
        setMessage(
          action === 'alternate'
            ? '暂时还不能换方式，请先在浏览器里再试一次验证。'
            : '验证仍未完成，请在浏览器里完成后再继续。',
        );
      else if (result.state === 'inactive') setMessage('任务状态已变化，请查看最新进度。');
    } catch {
      setMessage('暂时无法确认状态，请稍后重试。');
    } finally {
      setPending(false);
    }
  };
  return (
    <div className="mt-3 space-y-2" data-testid="captcha-handoff-actions">
      {status.challenge?.hint && (
        <p className="text-xs text-foreground" data-testid="captcha-hint">
          {status.challenge.hint}
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        只有你可以操作验证；AI 已暂停。完成后自动继续，最多等待 10 分钟。
      </p>
      {status.alternateAvailable && (
        <p className="text-xs text-muted-foreground">
          这道题连续没通过，可以不再做题，让 AI 换个方式继续（改用其他来源，做不到会如实说明）。
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => void act('continue')}
          className="rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground disabled:opacity-50"
        >
          我已完成，继续
        </button>
        {status.alternateAvailable && (
          <button
            type="button"
            disabled={pending}
            onClick={() => void act('alternate')}
            className="rounded-md border border-primary px-3 py-2 text-xs font-medium text-primary disabled:opacity-50"
          >
            换个方式继续
          </button>
        )}
        {onFullscreen && (
          <button
            type="button"
            onClick={onFullscreen}
            className="rounded-md border border-border px-3 py-2 text-xs"
          >
            全屏操作
          </button>
        )}
        <button
          type="button"
          disabled={pending}
          onClick={() => void act('cancel')}
          className="rounded-md border border-border px-3 py-2 text-xs disabled:opacity-50"
        >
          放弃
        </button>
      </div>
      {message && (
        <p role="status" className="text-xs text-muted-foreground">
          {message}
        </p>
      )}
    </div>
  );
}
