import {
  getSelectedBrainId,
  setSelectedBrainId,
  subscribeSelectedBrainId,
} from '@/lib/brain-preference';
import { trpc } from '@/lib/trpc';
import * as React from 'react';

export interface BrainOption {
  id: string;
  label: string;
  provider: string;
  isDefault: boolean;
  /** Visible to this viewer only because they are an admin. */
  adminOnly: boolean;
  configured: boolean;
}

const DEFAULT_OPTION: BrainOption = {
  id: 'qwen',
  label: '千问',
  provider: 'alibaba-model-studio',
  isDefault: true,
  adminOnly: false,
  configured: true,
};
const FALLBACK: BrainOption[] = [DEFAULT_OPTION];

/** Options from the admin model catalog plus the current selection. */
export function useBrainOptions(): {
  options: BrainOption[];
  selected: BrainOption;
  select: (id: string) => void;
} {
  const [options, setOptions] = React.useState<BrainOption[]>(FALLBACK);
  const [loaded, setLoaded] = React.useState(false);
  const selectedId = React.useSyncExternalStore(
    subscribeSelectedBrainId,
    getSelectedBrainId,
    getSelectedBrainId,
  );

  React.useEffect(() => {
    let cancelled = false;
    const load = () => {
      void trpc.models.list
        .query()
        .then((res) => {
          if (cancelled) return;
          if (res.items.length) setOptions(res.items);
          setLoaded(true);
        })
        .catch(() => {
          /* Keep the current options; the server falls back to its default. */
        });
    };
    load();
    // Admin switches apply without a reload: re-read when the tab regains focus.
    window.addEventListener('focus', load);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', load);
    };
  }, []);

  const fallback = options.find((option) => option.isDefault) ?? options[0] ?? DEFAULT_OPTION;
  const selected =
    options.find((option) => option.id === selectedId && option.configured) ?? fallback;

  React.useEffect(() => {
    // A brain that was hidden since the user picked it reverts to the default.
    if (loaded && selectedId && selectedId !== selected.id) {
      setSelectedBrainId(selected.isDefault ? null : selected.id);
    }
  }, [loaded, selectedId, selected.id, selected.isDefault]);

  const select = React.useCallback(
    (id: string) => {
      const option = options.find((candidate) => candidate.id === id);
      if (!option || !option.configured) return;
      setSelectedBrainId(option.isDefault ? null : option.id);
    },
    [options],
  );

  return { options, selected, select };
}
