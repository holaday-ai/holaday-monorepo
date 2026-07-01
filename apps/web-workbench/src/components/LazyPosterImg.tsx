import { Film } from 'lucide-react';
import * as React from 'react';
import { blobToDataUrl, fetchFileBlobAuthed } from '@/lib/download-file';
import { cn } from '@/lib/utils';

/**
 * Lazy poster thumbnail for a 成片.
 *
 * The R2 download URL is Bearer-gated, so a plain `<img src>` would 401 and a
 * native `loading="lazy"` can't apply. Instead we defer the authed blob fetch
 * until the element scrolls into view (IntersectionObserver, 200px margin),
 * show a film-icon placeholder meanwhile, and fall back to that same
 * placeholder on error — never a broken-image crack. The poster is ~50KB so
 * this stays cheap, and we never eagerly pull the 5MB video blob.
 */
export function LazyPosterImg({
  posterUrl,
  alt,
  className,
}: {
  posterUrl: string;
  alt: string;
  className?: string;
}): JSX.Element {
  const ref = React.useRef<HTMLDivElement>(null);
  const [visible, setVisible] = React.useState(false);
  const [state, setState] = React.useState<'idle' | 'loading' | 'ready' | 'failed'>('idle');
  const [url, setUrl] = React.useState<string | null>(null);

  // Reveal once scrolled near the viewport.
  React.useEffect(() => {
    if (visible) return;
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin: '200px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [visible]);

  // Authed blob fetch — runs once when first visible (deps exclude `state` so
  // setState inside can't re-trigger it → no render churn).
  React.useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setState('loading');
    void fetchFileBlobAuthed({ url: posterUrl }).then((res) => {
      if (cancelled) return;
      if (res.ok && res.blob) {
        void blobToDataUrl(res.blob).then((dataUrl) => {
          if (cancelled) return;
          setUrl(dataUrl);
          setState('ready');
        }).catch(() => {
          if (!cancelled) setState('failed');
        });
      } else {
        setState('failed');
      }
    });
    return () => {
      cancelled = true;
    };
  }, [visible, posterUrl]);

  return (
    <div
      ref={ref}
      className={cn(
        'flex shrink-0 items-center justify-center overflow-hidden rounded-[6px] border border-[#DCDDDD] bg-[#EFEFEF]/50 dark:border-white/10 dark:bg-white/5',
        className,
      )}
    >
      {state === 'ready' && url ? (
        <img src={url} alt={alt} className="h-full w-full object-cover" />
      ) : (
        <Film className={cn('h-5 w-5 text-muted-foreground/50', state === 'loading' && 'animate-pulse')} />
      )}
    </div>
  );
}
