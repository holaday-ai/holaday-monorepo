/**
 * FIX-33 (Deploy-33 new-amazon-sg 「在亚马逊新加坡站搜 usb c cable，列出前三个的名称和价格」
 * and new-bestbuy 「在 BestBuy 搜 usb c cable 告诉我第一个结果」 went to generate and
 * answered from memory): 「在/去/上 <站点或品牌>(地区站) 搜/查/找…」 is that site's own
 * search box, whatever the brand. Common e-commerce, map, video, music and social sites,
 * with regional stores (亚马逊新加坡站, Shopee 马来西亚站, amazon.co.jp).
 */
const BRANDS: readonly string[] = [
  // E-commerce
  '淘宝',
  '天猫',
  '京东',
  '拼多多',
  '闲鱼',
  '唯品会',
  '苏宁易购',
  '苏宁',
  '得物',
  '当当',
  '1688',
  '亚马逊',
  'amazon',
  'ebay',
  'best buy',
  'bestbuy',
  '百思买',
  'walmart',
  '沃尔玛',
  'target',
  'costco',
  '好市多',
  'newegg',
  'aliexpress',
  '速卖通',
  'shopee',
  '虾皮',
  'lazada',
  'temu',
  'shein',
  'etsy',
  'rakuten',
  '乐天',
  'mercari',
  '煤炉',
  'coupang',
  'flipkart',
  'ikea',
  '宜家',
  'qoo10',
  // Maps / travel / local
  '百度地图',
  '高德地图',
  '高德',
  '腾讯地图',
  '谷歌地图',
  'google maps',
  '携程',
  '飞猪',
  '去哪儿',
  '美团',
  '饿了么',
  '大众点评',
  'booking',
  'airbnb',
  '爱彼迎',
  'agoda',
  'expedia',
  'tripadvisor',
  '猫途鹰',
  // Video
  '抖音',
  '快手',
  'b站',
  'bilibili',
  '哔哩哔哩',
  'youtube',
  '油管',
  '优酷',
  '爱奇艺',
  '腾讯视频',
  '西瓜视频',
  'netflix',
  'tiktok',
  'vimeo',
  'twitch',
  // Music
  'qq音乐',
  '网易云音乐',
  '网易云',
  '酷狗音乐',
  '酷狗',
  '酷我音乐',
  'spotify',
  'apple music',
  // Social / community / search
  '小红书',
  '微博',
  '知乎',
  '豆瓣',
  '贴吧',
  '百度贴吧',
  '虎扑',
  'twitter',
  '推特',
  'facebook',
  '脸书',
  'instagram',
  'reddit',
  'linkedin',
  '领英',
  'pinterest',
  'threads',
  'github',
  // A general search engine is only a site search when named (「打开 google.com 搜索」);
  // 「上百度搜一下」 stays a web search.
  'google',
  '谷歌',
];

function brandPattern(brand: string): string {
  // 「B 站」「QQ 音乐」「Best Buy」 are written with and without the space.
  return brand
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/ /g, '\\s*')
    .replace(/^([a-z0-9]+)(?=[\u4e00-\u9fa5])/i, '$1\\s*');
}

const BRAND_ALT = [...BRANDS]
  .sort((a, b) => b.length - a.length)
  .map(brandPattern)
  .join('|');
/** A brand, an optional domain suffix (google.com, amazon.co.jp) and regional store (新加坡站). */
const NAMED_SITE = String.raw`(?:${BRAND_ALT})(?:\.(?:com|cn|co|sg|jp|uk|de|ca|au|in|my|ph|th|vn|tw|hk|net|fr)){0,2}(?:\s*(?:[一-龥]{1,5}|[a-z]{2,12})\s*(?:站|版|分站|区))?`;
const WHERE = String.raw`\s*(?:上面|上|里面|里|内|中|网站上?|官网|app|平台|首页)?\s*(?:[，,]\s*)?`;
/**
 * Asking how the site's search works (「搜索排名的算法是什么」「怎么按销量排序」) is a
 * topic, not a search. Words like 算法/报告 inside what is searched for are not
 * (「在 BestBuy 搜算法导论」, Codex review on PR #296).
 */
const TOPIC_RE =
  /(?:算法|规则|机制|原理|逻辑|技巧|策略)(?:是什么|是怎样|是怎么|怎么|如何|有哪些)|是什么(?:原理|机制|算法)|(?:怎么|如何)(?:按|用|使用|设置|筛选|排序|搜|提高|优化)|(?:搜索?|查找)(?:的)?(?:功能|排名|算法|规则|机制|逻辑|原理|技巧|优化|引擎|框)(?=$|[的是怎如有吗，。？?！!\s])/;

const SEARCH_RE = new RegExp(
  String.raw`(?:在|去|上|到|用|打开|进入|访问)\s*${NAMED_SITE}${WHERE}(?:搜一下|搜一搜|搜索|搜|查找|查一下|查询|查|找一下|找找|找)|\bsearch\s+(?:on\s+)?(?:${BRAND_ALT})\b|\b(?:on|at)\s+(?:${BRAND_ALT})\b[^.\n]{0,40}\bsearch\b|\bsearch\b[^.\n]{1,60}\b(?:on|at)\s+(?:${BRAND_ALT})\b`,
  'i',
);
const VIEW_RE = new RegExp(
  String.raw`(?:在|去|上|到|用)\s*${NAMED_SITE}${WHERE}(?:看看|看一下|看|浏览|查看|读)`,
  'i',
);

/** 「在亚马逊新加坡站搜…」 — the matched words, or null. */
export function namedSiteSearch(text: string): string | null {
  if (TOPIC_RE.test(text)) return null;
  return SEARCH_RE.exec(text)?.[0].trim().slice(0, 40) ?? null;
}

/** 「在 QQ 音乐看热歌榜」 — reading a named site, not writing about it. */
export function namedSiteView(text: string): string | null {
  if (TOPIC_RE.test(text)) return null;
  return VIEW_RE.exec(text)?.[0].trim().slice(0, 40) ?? null;
}
