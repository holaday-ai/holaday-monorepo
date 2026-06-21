import { RefreshCw, X } from 'lucide-react';
import * as React from 'react';
import {
  fetchDeployedBundleHash,
  getLoadedBundleHash,
  isNewVersionAvailable,
} from '@/lib/version-check';

// 5 min — cheap; the focus/visibility check covers the common "came back to a
// tab left open across a deploy" case, the interval is just a backstop.
const POLL_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Proactive "a newer version is deployed → refresh" banner. Polls the live
 * index.html on focus + a slow interval and compares its bundle hash to the one
 * this tab loaded. DISMISSIBLE; refresh is user-initiated only — never a silent
 * reload (would drop a half-filled form or an in-flight task). See
 * lib/version-check.ts.
 */
export function UpdateBanner(): JSX.Element | null {
  const loadedHash = React.useRef<string | null>(null);
  const availableRef = React.useRef(false);
  const [available, setAvailable] = React.useState(false);
  const [dismissed, setDismissed] = React.useState(false);

  React.useEffect(() => {
    loadedHash.current = getLoadedBundleHash();
    // Can't read our own hash → never nag (no false positives).
    if (!loadedHash.current) return;

    let cancelled = false;
    const check = async (): Promise<void> => {
      if (cancelled || availableRef.current) return;
      const deployed = await fetchDeployedBundleHash();
      if (cancelled || availableRef.current) return;
      if (isNewVersionAvailable(loadedHash.current, deployed)) {
        availableRef.current = true;
        setAvailable(true);
      }
    };
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') void check();
    };

    const interval = window.setInterval(() => void check(), POLL_INTERVAL_MS);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    void check(); // initial: catch a tab opened just before a deploy

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, []);

  if (!available || dismissed) return null;

  return (
    <div className="fixed inset-x-0 bottom-3 z-[90] flex justify-center px-3">
      <div className="inline-flex max-w-[calc(100vw-1.5rem)] items-center gap-3 rounded-[10px] border border-[#EA1F59]/25 bg-white/95 px-3.5 py-2 text-[12px] font-medium text-[#595757] shadow-[0_12px_30px_rgba(89,87,87,0.16)] backdrop-blur dark:border-[#EA1F59]/35 dark:bg-card/95 dark:text-foreground/85">
        <span className="shrink-0">有新版本可用</span>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-[7px] bg-[#EA1F59] px-2.5 py-1 text-[12px] font-medium text-white transition-colors hover:bg-[#d11a50]"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          刷新
        </button>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label="关闭"
          title="稍后再说"
          className="inline-flex shrink-0 items-center justify-center rounded-[6px] p-1 text-muted-foreground transition-colors hover:bg-[#EFEFEF] hover:text-foreground dark:hover:bg-white/10"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
