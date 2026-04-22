import * as React from 'react';

/**
 * Theme mode store — light / dark / system. "system" follows the OS
 * preference via prefers-color-scheme and updates live when the user
 * changes their OS theme mid-session. The user's explicit choice is
 * persisted in localStorage and survives reloads; the first visit
 * lands on 'system'.
 */
export type ThemeMode = 'light' | 'dark' | 'system';
const STORAGE_KEY = 'holaday.theme';

function readStored(): ThemeMode {
  if (typeof localStorage === 'undefined') return 'system';
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw === 'light' || raw === 'dark' || raw === 'system') return raw;
  return 'system';
}

function systemPrefersDark(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function applyThemeClass(effective: 'light' | 'dark'): void {
  const root = document.documentElement;
  if (effective === 'dark') root.classList.add('dark');
  else root.classList.remove('dark');
}

/**
 * Subscribe to theme changes. Kept as a plain React hook + module
 * singleton (no zustand needed) — the single consumer is the shell
 * and the toggle button. Exports a { mode, setMode, effective } tuple.
 */
interface ThemeState {
  mode: ThemeMode;
  effective: 'light' | 'dark';
  setMode(m: ThemeMode): void;
}

export function useTheme(): ThemeState {
  const [mode, setModeState] = React.useState<ThemeMode>(() => readStored());
  const [systemDark, setSystemDark] = React.useState<boolean>(() => systemPrefersDark());

  React.useEffect(() => {
    if (!window.matchMedia) return;
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e: MediaQueryListEvent): void => setSystemDark(e.matches);
    if (mql.addEventListener) mql.addEventListener('change', onChange);
    else mql.addListener(onChange);
    return () => {
      if (mql.removeEventListener) mql.removeEventListener('change', onChange);
      else mql.removeListener(onChange);
    };
  }, []);

  const effective: 'light' | 'dark' = mode === 'system' ? (systemDark ? 'dark' : 'light') : mode;

  React.useEffect(() => {
    applyThemeClass(effective);
  }, [effective]);

  const setMode = React.useCallback((m: ThemeMode) => {
    try {
      localStorage.setItem(STORAGE_KEY, m);
    } catch {
      /* private mode etc. */
    }
    setModeState(m);
  }, []);

  return { mode, effective, setMode };
}

/**
 * Eagerly apply the persisted theme at module load so there's no flash
 * of the wrong palette between initial paint and React hydration.
 * Called from main.tsx before rendering.
 */
export function bootstrapTheme(): void {
  if (typeof document === 'undefined') return;
  const stored = readStored();
  const effective = stored === 'system' ? (systemPrefersDark() ? 'dark' : 'light') : stored;
  applyThemeClass(effective);
}
