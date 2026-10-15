import { trpc } from '@/lib/trpc';
import * as React from 'react';

/** Actions affect the existing task only; all verification input stays in the browser. */
export function CaptchaHandoffActions({ taskId }: { taskId: string }) {
  const [pending, setPending] = React.useState(false);
  const [message, setMessage] = React.useState('');
  const act = async (action: 'continue' | 'cancel') => {
    if (pending) return;
    setPending(true);
    setMessage('');
    try {
      const result = await trpc.tasks.browserCaptcha.mutate({ taskId, action });
      if (result.state === 'waiting') setMessage('验证仍未完成，请在浏览器里完成后再继续。');
      else if (result.state === 'inactive') setMessage('任务状态已变化，请查看最新进度。');
    } catch {
      setMessage('暂时无法确认状态，请稍后重试。');
    } finally {
      setPending(false);
    }
  };
  return (
    <div className="mt-3 space-y-2" data-testid="captcha-handoff-actions">
      <p className="text-xs text-muted-foreground">
        只有你可以操作验证；AI 已暂停。完成后自动继续，最多等待 10 分钟。
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => void act('continue')}
          className="rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground disabled:opacity-50"
        >
          我已完成，继续
        </button>
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
