import { trpc } from '@/lib/trpc';
import * as React from 'react';

/**
 * Image / video model choices the backend can actually serve right now
 * (auth.me → mediaModels, derived from configured provider credentials).
 * `null` = not known yet: callers keep every option visible and let the
 * backend gate decide, instead of flashing an empty picker.
 */
export interface MediaModelAvailability {
  readonly image: readonly string[];
  readonly video: readonly string[];
  readonly petVideo: readonly string[];
}

function stringList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return value.filter((item): item is string => typeof item === 'string' && item.length > 0);
}

export function normalizeMediaModels(raw: unknown): MediaModelAvailability | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const record = raw as Record<string, unknown>;
  const image = stringList(record.image);
  const video = stringList(record.video);
  const petVideo = stringList(record.petVideo);
  if (!image || !video || !petVideo) return null;
  return { image, video, petVideo };
}

/** Unknown availability never hides an option. */
export function isModelAvailable(
  available: readonly string[] | null | undefined,
  value: string,
): boolean {
  return !available || available.includes(value);
}

/** Keep only usable options; options listed in `alwaysAvailable` (e.g. 'auto') are kept. */
export function filterAvailableOptions<T extends { readonly value: string | number }>(
  options: readonly T[],
  available: readonly string[] | null | undefined,
  alwaysAvailable: readonly string[] = [],
): T[] {
  return options.filter(
    (option) =>
      alwaysAvailable.includes(String(option.value)) ||
      isModelAvailable(available, String(option.value)),
  );
}

let pending: Promise<MediaModelAvailability | null> | null = null;

export function loadMediaModels(): Promise<MediaModelAvailability | null> {
  if (!pending) {
    pending = Promise.resolve()
      .then(() => trpc.auth.me.query())
      .then((me) => normalizeMediaModels((me as { mediaModels?: unknown }).mediaModels))
      .catch(() => {
        pending = null;
        return null;
      });
  }
  return pending;
}

/** Test seam: forget the cached availability. */
export function resetMediaModelsCache(): void {
  pending = null;
}

export function useMediaModels(): MediaModelAvailability | null {
  const [models, setModels] = React.useState<MediaModelAvailability | null>(null);
  React.useEffect(() => {
    let active = true;
    void loadMediaModels().then((next) => {
      if (active) setModels(next);
    });
    return () => {
      active = false;
    };
  }, []);
  return models;
}
