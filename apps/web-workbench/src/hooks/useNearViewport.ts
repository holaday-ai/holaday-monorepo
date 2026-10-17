import * as React from 'react';

/**
 * Latches `true` once the referenced element scrolls within `rootMargin`
 * of the viewport. Used to defer Bearer-gated media fetches: R2 download
 * URLs need an Authorization header, so native `loading="lazy"` on an
 * `<img src>` cannot apply — the fetch itself has to wait.
 *
 * Without IntersectionObserver (old browsers, some test environments) the
 * element counts as visible immediately so content is never stuck hidden.
 */
export function useNearViewport<T extends Element>(
  enabled = true,
  rootMargin = '200px',
): [React.RefObject<T>, boolean] {
  const ref = React.useRef<T>(null);
  const [near, setNear] = React.useState(false);

  React.useEffect(() => {
    if (!enabled || near) return;
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') {
      setNear(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setNear(true);
          io.disconnect();
        }
      },
      { rootMargin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [enabled, near, rootMargin]);

  return [ref, near];
}
