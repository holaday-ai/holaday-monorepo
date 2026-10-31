import { trpc } from '@/lib/trpc';
import { useEffect, useState } from 'react';

/**
 * CAPTCHA-REDUCE-1: the user's persistent cloud browser profile — verification
 * clearance kept between tasks so a passed check is not asked again. Shown only
 * when the store is configured; clearing touches only the caller's profile.
 */
export function CloudBrowserProfileControl() {
  const [configured, setConfigured] = useState(false);
  const [state, setState] = useState<'idle' | 'busy' | 'cleared' | 'failed'>('idle');
  useEffect(() => {
    let live = true;
    // Any failure, even a synchronous one, means "not shown": this optional row
    // must never take the settings page down with it.
    Promise.resolve()
      .then(() => trpc.tasks.browserProfileStatus.query())
      .then((result) => {
        if (live) setConfigured(result.configured);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  if (!configured) return null;
  return (
    <div className="mt-4 space-y-2 border-t border-border pt-4" data-testid="cloud-browser-profile">
      <p className="text-sm text-muted-foreground">
        云端浏览器会保留你通过网站验证后的放行记录（加密保存，只属于你），之后的任务少遇到验证码。
      </p>
      <button
        type="button"
        className="text-sm text-destructive underline"
        disabled={state === 'busy'}
        onClick={() => {
          setState('busy');
          Promise.resolve()
            .then(() => trpc.tasks.browserProfileClear.mutate())
            .then(() => setState('cleared'))
            .catch(() => setState('failed'));
        }}
      >
        清除云端浏览器档案
      </button>
      {state === 'cleared' && <p className="text-xs text-muted-foreground">已清除。</p>}
      {state === 'failed' && <p className="text-xs text-destructive">暂时无法清除，请稍后重试。</p>}
    </div>
  );
}
