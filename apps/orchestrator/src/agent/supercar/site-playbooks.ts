/**
 * Phase 14 — Site Playbook 数据。
 *
 * 高频网站的操作路径、登录要求、反爬策略、agent 提示。任务一开
 * 始就匹配播本，把匹配到的 tips 注入到首条 user message（不进
 * system prompt — 保留 cache hits）。Cold-start 路由参考 prefer-
 * redLane；statsService 累计 ≥3 样本后切回热数据。
 */

export type PlaybookCategory =
  | 'ecommerce'
  | 'search'
  | 'travel'
  | 'recruitment'
  | 'social'
  | 'food'
  | 'finance'
  | 'gov';

export type PlaybookLane = 'brave_api' | 'browser_cdp' | 'apify';

export type PlaybookAntiBot = 'low' | 'medium' | 'high';

export interface SitePlaybook {
  /** Bare host (no scheme, no www, lowercase). Acts as the lookup key. */
  domain: string;
  /** Chinese display name — matched as substring against task intent. */
  name: string;
  /** English display name — matched case-insensitive against task intent. */
  nameEn: string;
  category: PlaybookCategory;
  /** Search URL template, `{query}` placeholder. Optional. */
  searchUrl?: string;
  /** Key DOM selectors for the lane that drives a real browser. */
  keySelectors?: Record<string, string>;
  preferredLane: PlaybookLane;
  antiBot: PlaybookAntiBot;
  /** `true` = login required, `'partial'` = some flows need login. */
  loginRequired: boolean | 'partial';
  /** What user-action triggers the login wall (for `'partial'`). */
  loginTrigger?: string;
  /** Agent operating tip — injected verbatim into the user message. */
  tips: string;
  commonPitfalls?: string[];
  /**
   * B-专项 — when true, this site's query tasks prefer the user's own
   * logged-in browser (extension/Mode B) over the server Brave, because
   * the server can't reproduce the user's login/device session (China
   * OTA hotel pages gate results behind login + 风控). Consumed by the
   * OTA user-browser lane decision (gated by the OTA_USER_BROWSER flag).
   * Read/search/filter/extract only — never 下单/预订/支付.
   */
  preferUserBrowser?: boolean;
}

export const PLAYBOOKS: Record<string, SitePlaybook> = {
  'jd.com': {
    domain: 'jd.com',
    name: '京东',
    nameEn: 'JD.com',
    category: 'ecommerce',
    searchUrl: 'https://search.jd.com/Search?keyword={query}&enc=utf-8',
    keySelectors: {
      searchBox: '#key',
      productList: '.gl-item',
      productName: '.p-name a em',
      price: '.p-price strong i',
      shopName: '.p-shop a',
    },
    preferredLane: 'brave_api',
    antiBot: 'low',
    loginRequired: 'partial',
    loginTrigger: '加购/下单',
    tips: '京东搜索结果区分自营和第三方。自营价格在 .p-price，通常更可靠。京东国补/PLUS 会员价需要在商品详情页查看，搜索结果页只显示基础价。国际版和国行版价格差异大，注意区分。',
    commonPitfalls: ['搜索结果第一行可能是广告', '价格不含国补优惠，需要点进详情页'],
  },

  'taobao.com': {
    domain: 'taobao.com',
    name: '淘宝',
    nameEn: 'Taobao',
    category: 'ecommerce',
    searchUrl: 'https://s.taobao.com/search?q={query}',
    keySelectors: {
      searchBox: '#q',
      productCard: '.Card--doubleCardWrapper',
      price: '.Price--priceInt',
      shopName: '.shopNameText',
    },
    preferredLane: 'brave_api',
    antiBot: 'high',
    loginRequired: 'partial',
    loginTrigger: '看详情页/下单',
    tips: '淘宝反爬非常严格，浏览器访问超过 3 次/分钟大概率触发滑块验证码。优先用搜索 API 获取价格。注意区分天猫旗舰店、天猫超市和第三方店铺——价格和可信度差异很大。百亿补贴价格需在专门入口查看。',
    commonPitfalls: ['频繁访问触发滑块', '第三方店铺价格低但可能假货', '详情页需要登录'],
  },

  'tmall.com': {
    domain: 'tmall.com',
    name: '天猫',
    nameEn: 'Tmall',
    category: 'ecommerce',
    searchUrl: 'https://list.tmall.com/search_product.htm?q={query}',
    preferredLane: 'brave_api',
    antiBot: 'high',
    loginRequired: 'partial',
    loginTrigger: '看详情/下单',
    tips: '天猫是淘宝的品牌旗舰店版本，同样反爬严格。天猫超市和品牌旗舰店可信度高。价格通常比淘宝第三方贵但品质有保障。',
    commonPitfalls: ['和淘宝共享反爬系统', '旗舰店 vs 专卖店 vs 专营店品质有差异'],
  },

  'pinduoduo.com': {
    domain: 'pinduoduo.com',
    name: '拼多多',
    nameEn: 'Pinduoduo',
    category: 'ecommerce',
    searchUrl: 'https://mobile.yangkeduo.com/search_result.html?search_key={query}',
    preferredLane: 'brave_api',
    antiBot: 'medium',
    loginRequired: false,
    tips: '拼多多以低价著称但需注意品质。百亿补贴频道价格最低且有平台保障。搜索结果价格可能是拼团价（需要 2 人成团）。网页版功能有限，很多操作只能在 APP 完成。',
    commonPitfalls: ['价格可能是拼团价', '网页版功能受限'],
  },

  'baidu.com': {
    domain: 'baidu.com',
    name: '百度',
    nameEn: 'Baidu',
    category: 'search',
    searchUrl: 'https://www.baidu.com/s?wd={query}',
    keySelectors: {
      searchBox: '#kw',
      resultList: '.result.c-container',
      resultTitle: 'h3 a',
    },
    preferredLane: 'brave_api',
    antiBot: 'low',
    loginRequired: false,
    tips: '百度搜索结果前 3-5 条通常是广告（标注"广告"字样），真实结果从后面开始。百度百科/知道/贴吧的结果排名偏高但质量参差。',
    commonPitfalls: ['前几条是广告', '百度竞价排名影响结果质量'],
  },

  'bing.com': {
    domain: 'bing.com',
    name: '必应',
    nameEn: 'Bing',
    category: 'search',
    searchUrl: 'https://cn.bing.com/search?q={query}',
    preferredLane: 'brave_api',
    antiBot: 'low',
    loginRequired: false,
    tips: '必应国际版搜英文内容质量比百度好。国内版 cn.bing.com 和国际版 bing.com 结果不同。',
  },

  'ctrip.com': {
    domain: 'ctrip.com',
    name: '携程',
    nameEn: 'Ctrip',
    preferUserBrowser: true,
    category: 'travel',
    searchUrl: 'https://flights.ctrip.com/online/list/oneway-{from}-{to}?depdate={date}',
    keySelectors: {
      flightSearchUrl: 'https://flights.ctrip.com/online/list/oneway-{from}-{to}?depdate={date}',
      roundTripSearchUrl:
        'https://flights.ctrip.com/online/list/round-{from}-{to}?depdate={date}&rdate={returnDate}',
      hotelSearchUrl: 'https://hotels.ctrip.com/hotels/list?city={cityId}&checkin={in}&checkout={out}',
    },
    preferredLane: 'browser_cdp',
    antiBot: 'medium',
    loginRequired: 'partial',
    loginTrigger: '预订/查看详细票价规则',
    // Concrete operating playbook (flights + hotels). Search/list pages
    // do NOT need login; only 预订/详细规则 does — if a login or 验证码
    // wall appears, hand back to the user (awaiting_user), don't fail.
    tips:
      '携程机票/酒店搜索必须用浏览器（搜索 API 拿不到实时价格）。' +
      '【机票】① 进 flights.ctrip.com ② 在出发/到达城市框输入城市（中文城市名即可）' +
      '③ 选好出发日期（往返再选返程）④ 点"搜索"⑤ 用左侧/顶部筛选「直飞」「起飞时间」「价格区间」' +
      '⑥ 取价格最低的前 3 个航班。【酒店】进 hotels.ctrip.com，输入城市+入住/离店日期，搜索后用' +
      '「星级(4星/5星)」「价格区间」筛选，取前 5 家。价格分经济舱/超经/公务舱；显示价可能不含税费燃油，' +
      '低价票多不可退改。输出统一用表格：机票=航空公司/航班时间/时长/是否直飞/价格/链接；' +
      '酒店=酒店名/星级/价格/位置/链接。务必在结尾注明「仅查询，未下单/未预订」。',
    commonPitfalls: [
      '显示价格不含税费',
      '低价票不可退改',
      '同一航班不同渠道价格不同',
      '严禁点"预订/去支付/提交订单"，最多停在列表或详情页',
    ],
  },

  'qunar.com': {
    domain: 'qunar.com',
    name: '去哪儿',
    nameEn: 'Qunar',
    preferUserBrowser: true,
    category: 'travel',
    preferredLane: 'browser_cdp',
    antiBot: 'medium',
    loginRequired: 'partial',
    loginTrigger: '预订',
    tips: '去哪儿是比价平台，同一航班会显示多个代理商价格。最低价可能来自小代理，售后风险较高。建议对比携程和去哪儿的价格后选择。',
  },

  '12306.cn': {
    domain: '12306.cn',
    name: '12306',
    nameEn: '12306 China Railway',
    category: 'travel',
    searchUrl: 'https://www.12306.cn/index/',
    preferredLane: 'browser_cdp',
    antiBot: 'high',
    loginRequired: true,
    loginTrigger: '查询和购票都需要登录',
    tips: '12306 反爬极其严格，频繁访问会被封 IP。必须登录才能查询车次。查询需要选出发站、到达站、日期。验证码是必经步骤。建议让用户自己操作登录和验证码，agent 只负责信息整理。',
    commonPitfalls: ['必须登录', '验证码复杂', '频繁访问会被封'],
  },

  'fliggy.com': {
    domain: 'fliggy.com',
    name: '飞猪',
    nameEn: 'Fliggy',
    preferUserBrowser: true,
    category: 'travel',
    preferredLane: 'browser_cdp',
    antiBot: 'medium',
    loginRequired: 'partial',
    loginTrigger: '预订',
    tips: '飞猪是阿里旗下旅游平台，和淘宝账号互通。经常有会员专属价和平台补贴价。国际机票有时比携程便宜。搜索机票/酒店用浏览器：输入城市+日期→搜索→用直飞/价格/星级筛选→取前 3-5 个，表格输出。结尾注明「仅查询，未下单/未预订」，严禁点预订/支付。',
  },

  'ly.com': {
    domain: 'ly.com',
    name: '同程',
    nameEn: 'Tongcheng',
    preferUserBrowser: true,
    category: 'travel',
    preferredLane: 'browser_cdp',
    antiBot: 'medium',
    loginRequired: 'partial',
    loginTrigger: '预订',
    tips: '同程旅行（同程艺龙）主打机票/火车票/酒店，下沉市场份额高。搜索用浏览器：输入出发/到达城市+日期→搜索→用直飞/价格/星级筛选→取前 3-5 个结果，表格输出（航司或酒店名/时间/价格/链接）。结尾注明「仅查询，未下单/未预订」，严禁点预订/支付/提交订单。',
  },

  'zhipin.com': {
    domain: 'zhipin.com',
    name: 'Boss直聘',
    nameEn: 'Boss Zhipin',
    category: 'recruitment',
    searchUrl: 'https://www.zhipin.com/web/geek/job?query={query}&city=101020100',
    keySelectors: {
      jobCard: '.job-card-wrapper',
      jobName: '.job-name',
      salary: '.salary',
      company: '.company-name a',
    },
    preferredLane: 'browser_cdp',
    antiBot: 'high',
    loginRequired: 'partial',
    loginTrigger: '看 HR 联系方式/投递简历',
    tips: 'Boss直聘搜索结果可以不登录查看，但联系 HR 和投递必须登录。频繁访问容易触发验证。薪资范围是"面议"的岗位通常低于市场价。城市代码：上海 101020100，北京 101010100，深圳 101280100，杭州 101210100。',
    commonPitfalls: ['联系方式需要登录', '频繁访问触发验证', '"面议"通常低于预期'],
  },

  'liepin.com': {
    domain: 'liepin.com',
    name: '猎聘',
    nameEn: 'Liepin',
    category: 'recruitment',
    preferredLane: 'browser_cdp',
    antiBot: 'medium',
    loginRequired: 'partial',
    loginTrigger: '看详情/投递',
    tips: '猎聘定位中高端招聘。搜索结果按匹配度排序。猎头推荐的岗位通常质量较高但竞争也大。',
  },

  'lagou.com': {
    domain: 'lagou.com',
    name: '拉勾',
    nameEn: 'Lagou',
    category: 'recruitment',
    preferredLane: 'browser_cdp',
    antiBot: 'high',
    loginRequired: true,
    tips: '拉勾主打互联网行业招聘。必须登录才能使用大部分功能。反爬较严格。',
  },

  'xiaohongshu.com': {
    domain: 'xiaohongshu.com',
    name: '小红书',
    nameEn: 'Xiaohongshu',
    category: 'social',
    searchUrl: 'https://www.xiaohongshu.com/search_result?keyword={query}',
    preferredLane: 'browser_cdp',
    antiBot: 'high',
    loginRequired: 'partial',
    loginTrigger: '看完整内容/评论/收藏',
    tips: '小红书网页版功能极其有限，很多操作需要 APP。搜索结果以图文笔记和视频为主。反爬严格，频繁访问会要求登录。内容分析适合用搜索 API 获取标题和摘要，不建议逐篇打开浏览器。',
    commonPitfalls: ['网页版功能受限', '反爬严格', '很多内容只在 APP 可见'],
  },

  'weibo.com': {
    domain: 'weibo.com',
    name: '微博',
    nameEn: 'Weibo',
    category: 'social',
    searchUrl: 'https://s.weibo.com/weibo?q={query}',
    preferredLane: 'browser_cdp',
    antiBot: 'medium',
    loginRequired: 'partial',
    loginTrigger: '看评论/转发/详情',
    tips: '微博搜索结果默认按热度排序，可切换为"实时"看最新内容。热搜列表在 s.weibo.com/top/summary。不登录可以看前几条搜索结果但很快会弹登录框。',
  },

  'zhihu.com': {
    domain: 'zhihu.com',
    name: '知乎',
    nameEn: 'Zhihu',
    category: 'social',
    searchUrl: 'https://www.zhihu.com/search?type=content&q={query}',
    preferredLane: 'brave_api',
    antiBot: 'medium',
    loginRequired: 'partial',
    loginTrigger: '看完整回答（超过折叠部分）',
    tips: '知乎的内容 Brave API 能搜到大部分。完整回答可能需要浏览器展开。高赞回答通常在前面但不一定是最新的。搜索类型可选"内容/问题/用户/专栏"。',
  },

  'meituan.com': {
    domain: 'meituan.com',
    name: '美团',
    nameEn: 'Meituan',
    preferUserBrowser: true,
    category: 'food',
    preferredLane: 'browser_cdp',
    antiBot: 'medium',
    loginRequired: 'partial',
    loginTrigger: '下单/查看优惠券',
    tips: '美团网页版主要用于餐厅信息查询和评分查看。外卖下单建议在 APP。餐厅评分 4.5+ 通常靠谱。团购和外卖价格不同。',
  },

  'dianping.com': {
    domain: 'dianping.com',
    name: '大众点评',
    nameEn: 'Dianping',
    category: 'food',
    searchUrl: 'https://www.dianping.com/search/keyword/{cityId}/0_{query}',
    preferredLane: 'browser_cdp',
    antiBot: 'high',
    loginRequired: 'partial',
    loginTrigger: '看完整评价/图片',
    tips: '大众点评反爬严格（和美团同体系）。评分体系：五星制，4.0+ 算不错。搜索需要选城市。"必吃榜"和"黑珍珠"是高质量筛选。不登录只能看前几条评价摘要。',
    commonPitfalls: ['反爬严格', '不登录看不到完整评价', '城市必选'],
  },

  'eastmoney.com': {
    domain: 'eastmoney.com',
    name: '东方财富',
    nameEn: 'East Money',
    category: 'finance',
    searchUrl: 'https://so.eastmoney.com/web/s?keyword={query}',
    preferredLane: 'brave_api',
    antiBot: 'low',
    loginRequired: false,
    tips: '东方财富是国内最大财经门户之一。股票行情在 quote.eastmoney.com，基金在 fund.eastmoney.com。实时行情数据丰富，API 能搜到大部分公开信息。',
  },

  'xueqiu.com': {
    domain: 'xueqiu.com',
    name: '雪球',
    nameEn: 'Xueqiu',
    category: 'finance',
    preferredLane: 'brave_api',
    antiBot: 'medium',
    loginRequired: 'partial',
    loginTrigger: '看完整讨论/组合详情',
    tips: '雪球偏投资社区，用户讨论质量参差。个股页面 xueqiu.com/S/{股票代码} 能看行情+讨论。组合功能是特色。API 能搜到公开讨论。',
  },

  'gsxt.gov.cn': {
    domain: 'gsxt.gov.cn',
    name: '国家企业信用信息公示系统',
    nameEn: 'GSXT',
    category: 'gov',
    preferredLane: 'browser_cdp',
    antiBot: 'high',
    loginRequired: false,
    tips: '官方企业信息查询。反爬极严格（验证码+IP限制）。查询结果包含注册信息、股东、经营异常等。建议先用天眼查/企查查搜，需要官方数据再来这里确认。',
    commonPitfalls: ['验证码频繁', 'IP 限制严格', '查询速度慢'],
  },

  'tianyancha.com': {
    domain: 'tianyancha.com',
    name: '天眼查',
    nameEn: 'Tianyancha',
    category: 'gov',
    searchUrl: 'https://www.tianyancha.com/search?key={query}',
    preferredLane: 'browser_cdp',
    antiBot: 'medium',
    loginRequired: 'partial',
    loginTrigger: '看详细工商信息/股权穿透',
    tips: '天眼查是最常用的企业信息查询平台。基础工商信息免费，详细信息（股权穿透、司法风险等）需要会员。搜索结果第一条通常是目标公司。',
  },

  'qcc.com': {
    domain: 'qcc.com',
    name: '企查查',
    nameEn: 'Qichacha',
    category: 'gov',
    searchUrl: 'https://www.qcc.com/web/search?key={query}',
    preferredLane: 'browser_cdp',
    antiBot: 'medium',
    loginRequired: 'partial',
    loginTrigger: '看详细信息',
    tips: '企查查和天眼查功能类似，数据来源相同（工商局公示数据）。两者对比使用可以交叉验证。企查查的关联图谱做得比天眼查好。',
  },

  'github.com': {
    domain: 'github.com',
    name: 'GitHub',
    nameEn: 'GitHub',
    category: 'search',
    searchUrl: 'https://github.com/search?q={query}&type=repositories',
    preferredLane: 'browser_cdp',
    antiBot: 'low',
    loginRequired: false,
    tips: 'GitHub 搜索支持高级语法（language:TypeScript stars:>1000）。Trending 页面 github.com/trending 可按语言和时间段筛选。README 内容通常在仓库首页直接展示。',
  },
};
