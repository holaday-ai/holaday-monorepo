export interface IndexedDiscoveryItem<T> {
  item: T;
  index: number;
}

type DiscoveryMedia = {
  imageUrl?: string;
  imageKind?: 'source-cover' | 'editorial-art';
};

const EDITORIAL_ART_URLS = [
  '/stock-editorial-art/advanced-manufacturing-1.jpg',
  '/stock-editorial-art/consumer-1.jpg',
  '/stock-editorial-art/disclosure-1.jpg',
  '/stock-editorial-art/earnings-1.jpg',
  '/stock-editorial-art/energy-1.jpg',
  '/stock-editorial-art/governance-1.jpg',
  '/stock-editorial-art/industrial-1.jpg',
  '/stock-editorial-art/investor-relations-1.jpg',
  '/stock-editorial-art/logistics-1.jpg',
  '/stock-editorial-art/macro-1.jpg',
  '/stock-editorial-art/mobility-1.jpg',
  '/stock-editorial-art/technology-1.jpg',
] as const;

function isLocalEditorialArt(item: DiscoveryMedia): item is DiscoveryMedia & { imageUrl: string } {
  return Boolean(item.imageUrl?.startsWith('/stock-editorial-art/'));
}

function alternateEditorialArtUrl(currentUrl: string, index: number): string {
  const currentIndex = EDITORIAL_ART_URLS.indexOf(currentUrl as (typeof EDITORIAL_ART_URLS)[number]);
  const start = currentIndex >= 0 ? currentIndex + 1 + index : index;
  for (let offset = 0; offset < EDITORIAL_ART_URLS.length; offset += 1) {
    const candidate = EDITORIAL_ART_URLS[(start + offset) % EDITORIAL_ART_URLS.length]!;
    if (candidate !== currentUrl) return candidate;
  }
  return currentUrl;
}

/**
 * The carousel intentionally reorders rows so a multi-stock watchlist is not
 * dominated by one symbol. Run this after that ordering to keep consecutive
 * reusable editorial covers visually distinct. External source covers remain
 * untouched.
 */
export function diversifyDiscoveryEditorialArt<T extends DiscoveryMedia>(
  items: IndexedDiscoveryItem<T>[],
): IndexedDiscoveryItem<T>[] {
  let previousImageUrl: string | undefined;
  return items.map((entry) => {
    const { item } = entry;
    const imageUrl = item.imageUrl;
    if (!imageUrl || previousImageUrl !== imageUrl || !isLocalEditorialArt(item)) {
      previousImageUrl = imageUrl;
      return entry;
    }
    const replacement = alternateEditorialArtUrl(imageUrl, entry.index);
    previousImageUrl = replacement;
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
