export interface IndexedDiscoveryItem<T> {
  item: T;
  index: number;
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
