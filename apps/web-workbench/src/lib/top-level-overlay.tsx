import { createContext, useCallback, useContext, useLayoutEffect, useRef } from 'react';

export const OverlayNestingContext = createContext(false);
let active: { owner: symbol; dismiss: () => void } | null = null;

/** One independent overlay; portal children keep the parent scope and are exempt. */
export function useExclusiveOverlay(open: boolean, onOpenChange: (open: boolean) => void): (open: boolean) => void {
  const nested = useContext(OverlayNestingContext);
  const owner = useRef(Symbol('overlay')).current;
  const change = useRef(onOpenChange);
  change.current = onOpenChange;
  const release = useCallback(() => { if (active?.owner === owner) active = null; }, [owner]);
  const claim = useCallback(() => {
    if (nested || active?.owner === owner) return;
    const previous = active;
    active = { owner, dismiss: () => change.current(false) };
    previous?.dismiss();
  }, [nested, owner]);
  useLayoutEffect(() => {
    if (open) claim(); else release();
    return release;
  }, [open, claim, release]);
  return useCallback((next: boolean) => {
    if (next) claim(); else release();
    change.current(next);
  }, [claim, release]);
}
