export interface IndexedDiscoveryItem<T> {
  item: T;
  index: number;
}

export type StockDiscoveryFeed =
  | '全部'
  | '自选股新闻'
  | '重要公告'
  | 'A股要闻'
  | '美股要闻'
  | '港股要闻';

export function preferredStockDiscoveryFeed(
  counts: Readonly<Record<Exclude<StockDiscoveryFeed, '全部'>, number>>,
): StockDiscoveryFeed {
  if (counts.自选股新闻 > 0) return '自选股新闻';
  if (counts.重要公告 > 0) return '重要公告';
  if (counts.A股要闻 > 0) return 'A股要闻';
  return '全部';
}

export function isExplicitWatchlistNews(
  newsSymbols: readonly string[],
  watchlistSymbols: readonly string[],
): boolean {
  if (newsSymbols.length === 0 || watchlistSymbols.length === 0) return false;
  const normalizedWatchlist = new Set(
    watchlistSymbols.map((symbol) => symbol.trim().toUpperCase()).filter(Boolean),
  );
  return newsSymbols.some((symbol) => normalizedWatchlist.has(symbol.trim().toUpperCase()));
}

type DiscoveryMedia = {
  category?: string;
  title?: string;
  summary?: string;
  imageUrl?: string;
  imageKind?: 'source-cover' | 'editorial-art';
  editorialArtOptions?: readonly string[];
};

const EDITORIAL_ART_BY_TOPIC = {
  board: [
    '/stock-editorial-art/governance-1.jpg',
    '/stock-editorial-art/governance-2.jpg',
    '/stock-editorial-art/governance-3.jpg',
    '/stock-editorial-art/governance-5.jpg',
  ],
  disclosure: [
    '/stock-editorial-art/disclosure-1.jpg',
    '/stock-editorial-art/governance-6.jpg',
  ],
  investorRelations: [
    '/stock-editorial-art/investor-relations-1.jpg',
    '/stock-editorial-art/governance-5.jpg',
  ],
  earnings: [
    '/stock-editorial-art/earnings-1.jpg',
    '/stock-editorial-art/earnings-2.jpg',
  ],
  chips: [
    '/stock-editorial-art/technology-1.jpg',
    '/stock-editorial-art/technology-2.jpg',
    '/stock-editorial-art/technology-3.jpg',
    '/stock-editorial-art/technology-6.jpg',
    '/stock-editorial-art/technology-7.jpg',
  ],
  opticalNetwork: [
    '/stock-editorial-art/technology-4.jpg',
    '/stock-editorial-art/technology-5.jpg',
    '/stock-editorial-art/technology-10.jpg',
  ],
  aiCompute: [
    '/stock-editorial-art/technology-10.jpg',
    '/stock-editorial-art/technology-5.jpg',
  ],
  satellite: ['/stock-editorial-art/technology-9.jpg'],
  manufacturing: [
    '/stock-editorial-art/advanced-manufacturing-1.jpg',
    '/stock-editorial-art/industrial-1.jpg',
    '/stock-editorial-art/technology-8.jpg',
  ],
  mobility: [
    '/stock-editorial-art/mobility-1.jpg',
    '/stock-editorial-art/mobility-2.jpg',
    '/stock-editorial-art/mobility-3.jpg',
  ],
  retail: [
    '/stock-editorial-art/consumer-1.jpg',
    '/stock-editorial-art/consumer-3.jpg',
    '/stock-editorial-art/consumer-4.jpg',
  ],
  healthcare: [
    '/stock-editorial-art/healthcare-1.jpg',
    '/stock-editorial-art/healthcare-2.jpg',
    '/stock-editorial-art/healthcare-3.jpg',
  ],
  materials: [
    '/stock-editorial-art/materials-1.jpg',
    '/stock-editorial-art/materials-2.jpg',
    '/stock-editorial-art/materials-3.jpg',
  ],
  logistics: [
    '/stock-editorial-art/logistics-1.jpg',
    '/stock-editorial-art/logistics-2.jpg',
    '/stock-editorial-art/logistics-3.jpg',
    '/stock-editorial-art/logistics-4.jpg',
  ],
  energy: [
    '/stock-editorial-art/energy-1.jpg',
    '/stock-editorial-art/energy-2.jpg',
    '/stock-editorial-art/energy-3.jpg',
    '/stock-editorial-art/energy-4.jpg',
    '/stock-editorial-art/energy-5.jpg',
  ],
  macro: ['/stock-editorial-art/macro-1.jpg'],
  market: [
    '/stock-editorial-art/market-2.jpg',
    '/stock-editorial-art/market-3.jpg',
  ],
  trade: [
    '/stock-editorial-art/market-4.jpg',
    '/stock-editorial-art/logistics-2.jpg',
    '/stock-editorial-art/logistics-4.jpg',
  ],
} as const;

function preciseEditorialArtOptions(item: DiscoveryMedia): readonly string[] {
  const text = `${item.title ?? ''} ${item.summary ?? ''}`.toLocaleLowerCase('zh-CN');
  if (!text.trim()) return [];

  if (/董事会|股东大会|董事会议|监事会|会议决议|董事长/.test(text)) return EDITORIAL_ART_BY_TOPIC.board;
  if (item.category !== '公告' && /清仓|持仓曝光|机构持仓|私募巨头|基金持仓/.test(text)) {
    return EDITORIAL_ART_BY_TOPIC.market;
  }
  if (/投资者关系|机构调研|业绩说明会|路演|接待调研/.test(text)) return EDITORIAL_ART_BY_TOPIC.investorRelations;
  if (/财务总监|总经理变更|高管变更|任职|离任|辞职|增持|减持|回购|股权激励/.test(text)) {
    return EDITORIAL_ART_BY_TOPIC.investorRelations;
  }
  if (item.category === '公告' || /公告|披露|ipo|招股书|问询函|监管函|停复牌|交易异常/.test(text)) {
    return EDITORIAL_ART_BY_TOPIC.disclosure;
  }
  if (/业绩|营收|净利润|财报|预增|预亏|分红|毛利率|同比增长|扭亏/.test(text)) {
    return EDITORIAL_ART_BY_TOPIC.earnings;
  }
  if (/cpo|光模块|光通信|光纤|通信网络|数据中心互联/.test(text)) return EDITORIAL_ART_BY_TOPIC.opticalNetwork;
  if (/芯片|半导体|晶圆|存储器|存储芯片|集成电路|封装测试|先进制程/.test(text)) {
    return EDITORIAL_ART_BY_TOPIC.chips;
  }
  if (/chatgpt|人工智能|生成式ai|大模型|算力|服务器|云计算|meta\b|英伟达|nvidia/.test(text)) {
    return EDITORIAL_ART_BY_TOPIC.aiCompute;
  }
  if (/卫星|航天|商业航天|北斗/.test(text)) return EDITORIAL_ART_BY_TOPIC.satellite;
  if (/工业机器人|智能制造|高端装备|装备制造|机床|自动化产线|制造业/.test(text)) {
    return EDITORIAL_ART_BY_TOPIC.manufacturing;
  }
  if (/汽车|新能源车|充电桩|动力电池|整车|重卡/.test(text)) return EDITORIAL_ART_BY_TOPIC.mobility;
  if (/零售|服装|商超|门店|食品|饮料|餐饮|乳业|农产品/.test(text)) return EDITORIAL_ART_BY_TOPIC.retail;
  if (/医药|医疗|医院|药品|创新药|生物医药|医疗器械|疫苗/.test(text)) {
    return EDITORIAL_ART_BY_TOPIC.healthcare;
  }
  if (/钢铁|有色|金属|稀土|黄金|铜|铝|锌|矿业|矿产|矿山|矿主|资源股|水泥|建材/.test(text)) {
    return EDITORIAL_ART_BY_TOPIC.materials;
  }
  if (/物流|仓储|快递|铁路运输|货运|供应链/.test(text)) return EDITORIAL_ART_BY_TOPIC.logistics;
  if (/光伏|风电|储能|电力|煤炭|石油|天然气|新能源|逆变器/.test(text)) {
    return EDITORIAL_ART_BY_TOPIC.energy;
  }
  if (/港口|航运|海运|集装箱|外贸|进出口|关税/.test(text)) return EDITORIAL_ART_BY_TOPIC.trade;
  if (/居民消费价格|cpi|通胀|gdp|货币政策|央行|降息|加息|宏观经济/.test(text)) {
    return EDITORIAL_ART_BY_TOPIC.macro;
  }
  if (/a股|港股|美股|股市|大盘|指数|行情|资金流|主力资金|北向资金|南向资金|etf|券商策略/.test(text)) {
    return EDITORIAL_ART_BY_TOPIC.market;
  }
  return [];
}

function stableTextHash(value: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

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
 * Publisher-backed media wins. When a publisher has no usable cover, a local
 * image is allowed only for an explicit title topic. Ambiguous stories remain
 * title-first, and no image URL is repeated within the rendered feed.
 */
export function diversifyDiscoveryEditorialArt<T extends DiscoveryMedia>(
  items: IndexedDiscoveryItem<T>[],
  failedSourceCoverUrls: ReadonlySet<string> = new Set(),
): IndexedDiscoveryItem<T>[] {
  const usedImageUrls = new Set<string>();
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
    const editorialFallback = (): IndexedDiscoveryItem<T> => {
      const candidates = preciseEditorialArtOptions(item);
      if (candidates.length === 0) return titleFirst();
      const offset = stableTextHash(`${item.title ?? ''}:${item.summary ?? ''}`) % candidates.length;
      for (let index = 0; index < candidates.length; index += 1) {
        const candidate = candidates[(offset + index) % candidates.length];
        if (!candidate || usedImageUrls.has(candidate)) continue;
        usedImageUrls.add(candidate);
        return {
          ...entry,
          item: {
            ...item,
            imageUrl: candidate,
            imageKind: 'editorial-art',
            editorialArtOptions: [...candidates],
          },
        };
      }
      return titleFirst();
    };

    if (
      imageUrl &&
      item.imageKind === 'source-cover' &&
      isVerifiedSourceCoverUrl(imageUrl) &&
      !failedSourceCoverUrls.has(imageUrl) &&
      !usedImageUrls.has(imageUrl)
    ) {
      usedImageUrls.add(imageUrl);
      return entry;
    }
    return editorialFallback();
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
