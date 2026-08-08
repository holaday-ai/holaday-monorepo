export interface IndexedDiscoveryItem<T> {
  item: T;
  index: number;
}

type DiscoveryMedia = {
  imageUrl?: string;
  imageKind?: 'source-cover' | 'editorial-art';
  editorialArtOptions?: readonly string[];
};

function isLocalEditorialArt(item: DiscoveryMedia): item is DiscoveryMedia & { imageUrl: string } {
  return item.imageKind === 'editorial-art' && Boolean(item.imageUrl?.startsWith('/stock-editorial-art/'));
}

/**
 * The carousel intentionally reorders rows so a multi-stock watchlist is not
 * dominated by one symbol. Run this after that ordering to keep consecutive
 * reusable editorial covers visually distinct without allowing a cover from
 * another industry to replace the article's own semantic artwork. Each
 * semantic pool is rotated across the loaded feed before it is reused, while
 * external source covers remain untouched.
 */
export function diversifyDiscoveryEditorialArt<T extends DiscoveryMedia>(
  items: IndexedDiscoveryItem<T>[],
  failedSourceCoverUrls: ReadonlySet<string> = new Set(),
): IndexedDiscoveryItem<T>[] {
  const usedEditorialUrlsByPool = new Map<string, Set<string>>();
  const recentEditorialUrls: string[] = [];
  const sourceCoverCounts = new Map<string, number>();
  for (const { item } of items) {
    if (item.imageKind !== 'source-cover' || !item.imageUrl) continue;
    sourceCoverCounts.set(item.imageUrl, (sourceCoverCounts.get(item.imageUrl) ?? 0) + 1);
  }
  return items.map((entry) => {
    const { item } = entry;
    const imageUrl = item.imageUrl;
    if (!imageUrl) {
      return entry;
    }
    const candidates = item.editorialArtOptions?.filter((candidate, index, all) => all.indexOf(candidate) === index)
      .filter((candidate) => candidate.startsWith('/stock-editorial-art/'))
      ?? [];

    // Publishers occasionally return one generic image for otherwise distinct
    // stories. In that case every affected card uses its own topical fallback
    // so the generic image cannot imply an unrelated subject. The same fallback
    // also keeps an inaccessible external source image from leaving a blank
    // media panel in the reading view.
    if (item.imageKind === 'source-cover') {
      const needsFallback = (sourceCoverCounts.get(imageUrl) ?? 0) >= 2
        || failedSourceCoverUrls.has(imageUrl);
      if (!needsFallback) return entry;
      const poolKey = candidates.join('|');
      const usedEditorialUrls = usedEditorialUrlsByPool.get(poolKey) ?? new Set<string>();
      if (usedEditorialUrls.size >= candidates.length) usedEditorialUrls.clear();
      usedEditorialUrlsByPool.set(poolKey, usedEditorialUrls);
      const replacement = candidates.find((candidate) =>
        !usedEditorialUrls.has(candidate) && !recentEditorialUrls.includes(candidate),
      ) ?? candidates.find((candidate) => !usedEditorialUrls.has(candidate)) ?? candidates[0];
      if (!replacement) return entry;
      usedEditorialUrls.add(replacement);
      recentEditorialUrls.push(replacement);
      if (recentEditorialUrls.length > 3) recentEditorialUrls.shift();
      return {
        ...entry,
        item: { ...item, imageUrl: replacement, imageKind: 'editorial-art' },
      };
    }

    if (!isLocalEditorialArt(item)) {
      return entry;
    }
    const effectiveCandidates = candidates.length > 0 ? candidates : [imageUrl];
    const poolKey = effectiveCandidates.join('|');
    const usedEditorialUrls = usedEditorialUrlsByPool.get(poolKey) ?? new Set<string>();
    if (usedEditorialUrls.size >= effectiveCandidates.length) usedEditorialUrls.clear();
    usedEditorialUrlsByPool.set(poolKey, usedEditorialUrls);

    const replacement = [imageUrl, ...effectiveCandidates].find((candidate) =>
      !usedEditorialUrls.has(candidate) && !recentEditorialUrls.includes(candidate),
    ) ?? [imageUrl, ...effectiveCandidates].find((candidate) => !usedEditorialUrls.has(candidate)) ?? imageUrl;

    usedEditorialUrls.add(replacement);
    recentEditorialUrls.push(replacement);
    if (recentEditorialUrls.length > 3) recentEditorialUrls.shift();
    if (replacement === imageUrl) {
      return entry;
    }
    return {
      ...entry,
      item: { ...item, imageUrl: replacement },
    };
  });
}

/**
 * Keep the chronological feed intact while making each carousel page useful
 * for a multi-stock watchlist. An item is repeated only after every available
 * symbol has had a turn in the current round.
 */
export function diversifyDiscoveryItems<T>(
  items: IndexedDiscoveryItem<T>[],
  symbolFor: (item: T) => string | undefined,
): IndexedDiscoveryItem<T>[] {
  const remaining = [...items];
  const diversified: IndexedDiscoveryItem<T>[] = [];
  const seenSymbols = new Set<string>();

  while (remaining.length > 0) {
    const nextIndex = remaining.findIndex(({ item }) => {
      const symbol = symbolFor(item)?.trim();
      return !symbol || !seenSymbols.has(symbol);
    });

    if (nextIndex === -1) {
      seenSymbols.clear();
      continue;
    }

    const [next] = remaining.splice(nextIndex, 1);
    if (!next) continue;
    diversified.push(next);

    const symbol = symbolFor(next.item)?.trim();
    if (symbol) seenSymbols.add(symbol);
  }

  return diversified;
}

/** Keep the source boundary visible: a disclosure date is not a timestamp. */
export function discoveryTimeLabel(kind: '新闻' | '公告', time: string): string {
  if (kind === '公告' && /^\d{2}-\d{2}$/.test(time)) return `${time} · 披露日`;
  return time;
}

/**
 * Start fetching before the reader runs into the final two carousel pages.
 * This keeps source pagination responsive without eagerly loading every page.
 */
export function shouldPrefetchDiscoveryPage(input: {
  currentPage: number;
  pageCount: number;
  hasMore: boolean;
  isLoading: boolean;
}): boolean {
  if (!input.hasMore || input.isLoading) return false;
  return input.currentPage >= Math.max(0, input.pageCount - 3);
}

/** Keep a growing source-backed feed navigable without rendering an endless row of dots. */
export function discoveryPageIndexes(pageCount: number, currentPage: number): number[] {
  const safeCount = Math.max(0, Math.floor(pageCount));
  if (safeCount <= 7) return Array.from({ length: safeCount }, (_, index) => index);
  const safeCurrent = Math.min(Math.max(0, Math.floor(currentPage)), safeCount - 1);
  return [...new Set([0, safeCurrent - 1, safeCurrent, safeCurrent + 1, safeCount - 1])]
    .filter((index) => index >= 0 && index < safeCount)
    .sort((left, right) => left - right);
}
