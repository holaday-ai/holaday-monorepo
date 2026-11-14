import { cn } from '@/lib/utils';
import { ArrowLeft, ArrowRight, Globe, House, LockKeyhole, RotateCw } from 'lucide-react';
import * as React from 'react';

export const BROWSER_HOME_LABEL = 'HOLA DAY 主页';

const NAV_BUTTON =
  'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] text-muted-foreground transition-colors hover:bg-[#EFEFEF] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF0061]/20 disabled:pointer-events-none disabled:opacity-40 dark:hover:bg-white/10';

/**
 * BROWSER-HOME-1 — the thin bar above the cloud browser: back / forward / reload, a home button
 * and one input that takes an address or search words (Enter). No tabs. On the home view the
 * input reads「HOLA DAY 主页」until the person starts typing.
 */
export function BrowserHomeAddressBar({
  view,
  url,
  pending,
  onNavigate,
  onHome,
}: {
  view: 'home' | 'browser';
  /** The page the cloud browser shows (only meaningful in the browser view). */
  url: string | null;
  pending: boolean;
  onNavigate(direction: 'back' | 'forward' | 'reload' | 'goto', input?: string): Promise<boolean>;
  onHome(): void;
}): JSX.Element {
  const shown = view === 'home' ? '' : (url ?? '');
  const [draft, setDraft] = React.useState(shown);
  const [editing, setEditing] = React.useState(false);
  React.useEffect(() => {
    if (!editing) setDraft(shown);
  }, [shown, editing]);

  const secure = view === 'browser' && /^https:\/\//i.test(shown);
  const UrlIcon = pending ? RotateCw : secure ? LockKeyhole : Globe;

  const submit = async (): Promise<void> => {
    const target = draft.trim();
    if (!target || pending) return;
    const ok = await onNavigate('goto', target);
    if (ok) {
      setEditing(false);
      (document.activeElement as HTMLElement | null)?.blur?.();
    }
  };

  return (
    <div className="flex h-11 min-w-0 shrink-0 items-center gap-1 px-3 sm:px-6">
      <button
        type="button"
        className={NAV_BUTTON}
        title="后退"
        aria-label="后退"
        disabled={pending || view === 'home'}
        onClick={() => void onNavigate('back')}
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
      </button>
      <button
        type="button"
        className={NAV_BUTTON}
        title="前进"
        aria-label="前进"
        disabled={pending}
        onClick={() => void onNavigate('forward')}
      >
        <ArrowRight className="h-4 w-4" aria-hidden />
      </button>
      <button
        type="button"
        className={NAV_BUTTON}
        title="刷新"
        aria-label="刷新"
        disabled={pending || view === 'home'}
        onClick={() => void onNavigate('reload')}
      >
        <RotateCw className="h-4 w-4" aria-hidden />
      </button>
      <button
        type="button"
        className={cn(NAV_BUTTON, view === 'home' && 'text-[#FF0061]')}
        title={BROWSER_HOME_LABEL}
        aria-label={BROWSER_HOME_LABEL}
        aria-pressed={view === 'home'}
        onClick={onHome}
      >
        <House className="h-4 w-4" aria-hidden />
      </button>
      <form
        className={cn(
          'ml-1 flex h-8 min-w-0 flex-1 items-center gap-2 rounded-[10px] border px-2.5 transition-colors',
          'border-[#E6E7EB] bg-[#F6F7F9] text-muted-foreground hover:border-[#DCDDDD] hover:bg-white',
          'focus-within:border-[#FF0061]/35 focus-within:bg-white focus-within:text-foreground',
          'dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10 dark:focus-within:bg-white/10',
          pending && 'cursor-wait opacity-80',
        )}
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <UrlIcon
          className={cn(
            'h-3.5 w-3.5 shrink-0',
            pending && 'animate-spin',
            secure && 'text-[#0F9F6E]',
            view === 'home' && !pending && 'text-[#FF0061]',
          )}
          aria-hidden
        />
        <input
          type="text"
          inputMode="url"
          spellCheck={false}
          autoComplete="off"
          enterKeyHint="go"
          aria-label="云浏览器地址栏（输入网址或搜索内容，回车打开）"
          value={view === 'home' && !editing ? BROWSER_HOME_LABEL : draft}
          placeholder="输入网址或搜索内容"
          disabled={pending}
          onFocus={(event) => {
            setEditing(true);
            if (view === 'home') setDraft('');
            else event.currentTarget.select();
          }}
          onBlur={() => setEditing(false)}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            // IME guard: the Enter that commits a composition (中文.com) must not navigate.
            if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
              event.preventDefault();
              void submit();
            } else if (event.key === 'Escape') {
              setDraft(shown);
              event.currentTarget.blur();
            }
          }}
          className={cn(
            'h-full min-w-0 flex-1 truncate border-0 bg-transparent px-0 text-[12px] outline-none',
            'text-foreground placeholder:text-muted-foreground/70 disabled:cursor-wait',
            view === 'home' && !editing && 'text-muted-foreground',
            view === 'browser' && 'font-mono',
          )}
        />
      </form>
    </div>
  );
}
