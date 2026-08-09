export interface IndexedDiscoveryItem<T> {
  item: T;
  index: number;
}

type DiscoveryMedia = {
  imageUrl?: string;
  imageKind?: 'source-cover' | 'editorial-art';
  editorialArtOptions?: readonly string[];
};

function isReadableEastmoneyCover(value: string): boolean {
  try {
    const image = new URL(value);
    if (image.protocol !== 'https:' || image.hostname !== 'np-newspic.dfcfw.com') return false;
    const dimensions = /_w(\d+)h(\d+)\.(?:jpe?g|png|webp|avif)$/i.exec(image.pathname);
    if (!dimensions) return false;
    const width = Number(dimensions[1]);
    const height = Number(dimensions[2]);
    const ratio = width / height;
    return width >= 900 && height >= 450 && ratio >= 1.35 && ratio <= 2.05;
  } catch {
    return false;
  }
}

function isVerifiedSourceCoverUrl(value: string): boolean {
  if (isReadableEastmoneyCover(value)) return true;
  try {
    const proxy = new URL(value, 'https://holaday.invalid');
    if (proxy.origin !== 'https://holaday.invalid' || proxy.pathname !== '/api/stock-news/source-cover') return false;
    const source = proxy.searchParams.get('url');
    return source ? isReadableEastmoneyCover(source) : false;
  } catch {
    return false;
  }
}

/**
 * Only publisher-backed media is allowed in discovery. Legacy editorial art,
 * repeated covers, and failed source images become title-first cards instead
 * of being replaced with an unrelated decorative image.
 */
export function diversifyDiscoveryEditorialArt<T extends DiscoveryMedia>(
  items: IndexedDiscoveryItem<T>[],
  failedSourceCoverUrls: ReadonlySet<string> = new Set(),
): IndexedDiscoveryItem<T>[] {
  const usedSourceCoverUrls = new Set<string>();
  return items.map((entry) => {
    const { item } = entry;
    const imageUrl = item.imageUrl;
    const titleFirst = (): IndexedDiscoveryItem<T> => ({
      ...entry,
      item: {
        ...item,
        imageUrl: undefined,
        imageKind: undefined,
        editorialArtOptions: undefined,
      },
    });
    if (!imageUrl) return item.imageKind === 'editorial-art' ? titleFirst() : entry;
    if (item.imageKind !== 'source-cover' || !isVerifiedSourceCoverUrl(imageUrl)) return titleFirst();
    if (failedSourceCoverUrls.has(imageUrl) || usedSourceCoverUrls.has(imageUrl)) return titleFirst();
    usedSourceCoverUrls.add(imageUrl);
    return entry;
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

/**
 * Keep editorial importance while reserving the first discovery page for
 * distinct followed stocks whenever alternatives are available.
 */
export function prioritizeAndDiversifyDiscoveryItems<T>(
  items: IndexedDiscoveryItem<T>[],
  priorityFor: (item: T) => number,
  symbolFor: (item: T) => string | undefined,
): IndexedDiscoveryItem<T>[] {
  const prioritized = [...items].sort((left, right) => {
    const priorityDifference = priorityFor(right.item) - priorityFor(left.item);
    return priorityDifference || left.index - right.index;
  });
  return diversifyDiscoveryItems(prioritized, symbolFor);
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
  /** Keep the initial source cap intact until the reader has reached it. */
  hasExhaustedLoadedItems?: boolean;
}): boolean {
  if (!input.hasMore || input.isLoading || input.hasExhaustedLoadedItems === false) return false;
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
