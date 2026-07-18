import * as React from 'react';

// Tailwind's `md` breakpoint begins at 768px. Treat that exact boundary as
// mobile in JavaScript so the 304px desktop sidebar cannot squeeze a tablet
// viewport while the page body is already using its compact layout.
const MOBILE_MAX_WIDTH = 768;

export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined);

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_MAX_WIDTH}px)`);
    const onChange = (): void => {
      setIsMobile(window.innerWidth <= MOBILE_MAX_WIDTH);
    };
    mql.addEventListener('change', onChange);
    setIsMobile(window.innerWidth <= MOBILE_MAX_WIDTH);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  return !!isMobile;
}
