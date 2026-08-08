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
 * another industry to replace the article's own semantic artwork. External
 * source covers remain untouched.
 */
export function diversifyDiscoveryEditorialArt<T extends DiscoveryMedia>(
  items: IndexedDiscoveryItem<T>[],
): IndexedDiscoveryItem<T>[] {
  const pageSize = 3;
  const usedEditorialUrlsByPage = new Map<number, Set<string>>();
  return items.map((entry, position) => {
    const { item } = entry;
    const imageUrl = item.imageUrl;
    if (!imageUrl || !isLocalEditorialArt(item)) {
      return entry;
    }
    const currentPageStart = Math.floor(position / pageSize) * pageSize;
    const usedEditorialUrls = usedEditorialUrlsByPage.get(currentPageStart) ?? new Set<string>();
    usedEditorialUrlsByPage.set(currentPageStart, usedEditorialUrls);
    if (!usedEditorialUrls.has(imageUrl)) {
      usedEditorialUrls.add(imageUrl);
      return entry;
    }
    const replacement = item.editorialArtOptions?.find((candidate) => !usedEditorialUrls.has(candidate));
    if (!replacement) {
      usedEditorialUrls.add(imageUrl);
      return entry;
    }
    usedEditorialUrls.add(replacement);
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
