import * as React from 'react';

/**
 * How much of the layout viewport's bottom the on-screen keyboard covers (px, 0 without one).
 * Phones shrink `window.visualViewport` when the keyboard opens while `position: absolute/fixed`
 * bottoms stay at the layout viewport, so a floating composer lifts itself by this much.
 */
export function keyboardInsetFor(
  layoutHeight: number,
  viewport: { height: number; offsetTop: number } | null | undefined,
): number {
  if (!viewport || !Number.isFinite(layoutHeight)) return 0;
  const covered = layoutHeight - viewport.height - viewport.offsetTop;
  // Sub-pixel rounding and browser chrome animations: ignore tiny differences.
  return covered > 24 ? Math.round(covered) : 0;
}

export function useKeyboardInset(): number {
  const [inset, setInset] = React.useState(0);
  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const viewport = window.visualViewport;
    if (!viewport) return;
    const update = () => setInset(keyboardInsetFor(window.innerHeight, viewport));
    update();
    viewport.addEventListener('resize', update);
    viewport.addEventListener('scroll', update);
    return () => {
      viewport.removeEventListener('resize', update);
      viewport.removeEventListener('scroll', update);
    };
  }, []);
  return inset;
}
