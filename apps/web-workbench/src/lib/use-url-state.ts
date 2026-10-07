import { useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';

/** Replace edits in the current history entry; back/refresh restore the URL state. */
export function useUrlState<T extends string>(key: string, fallback: T, allowed?: readonly T[]): [T, (value: T | null) => void] {
  const [params, setParams] = useSearchParams();
  const setter = useRef(setParams);
  setter.current = setParams;
  const raw = params.get(key);
  const value = raw !== null && (!allowed || allowed.includes(raw as T)) ? raw as T : fallback;
  const setValue = useCallback((next: T | null) => {
    setter.current(current => {
      const updated = new URLSearchParams(current);
      if (next === null || next === fallback) updated.delete(key);
      else updated.set(key, next);
      return updated;
    }, { replace: true });
  }, [key, fallback]);
  return [value, setValue];
}
