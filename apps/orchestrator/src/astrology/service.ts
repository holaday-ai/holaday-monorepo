import {
  type AstrologyCapability,
  DivineApiContractError,
  type ProviderCapabilityState,
  allAstrologyCapabilities,
  assertDivineApiSuccess,
  readConfiguredCapabilities,
} from './divine-api-contract.js';

export type ZodiacSign =
  | 'aries'
  | 'taurus'
  | 'gemini'
  | 'cancer'
  | 'leo'
  | 'virgo'
  | 'libra'
  | 'scorpio'
  | 'sagittarius'
  | 'capricorn'
  | 'aquarius'
  | 'pisces';

export type AstrologyPeriod = 'daily' | 'weekly' | 'monthly' | 'yearly';

export type AstrologyDimensionKey =
  | 'personal'
  | 'health'
  | 'profession'
  | 'emotions'
  | 'travel'
  | 'luck';

export interface AstrologyDimension {
  key: AstrologyDimensionKey;
  label: string;
  body: string;
  score: number | null;
}

export interface AstrologyPeriodReading {
  period: AstrologyPeriod;
  provider: 'mock' | 'divineapi';
  source: 'local-fallback' | 'divineapi';
  freshness: 'local' | 'fresh' | 'stale';
  zodiacSign: ZodiacSign;
  zodiacLabel: string;
  rangeLabel: string;
  rangeKey: 'today' | 'current' | 'next';
  summary: string;
  dimensions: AstrologyDimension[];
  luckyColors: string[];
  luckyNumbers: string[];
  luckyLetters: string[];
  suitableTimes: string[];
  sevenDayTrend: {
    source: 'divineapi';
    items: Array<{ dateLabel: string; score: number }>;
  } | null;
  cosmicTip: string | null;
  singlesTip: string | null;
  couplesTip: string | null;
}

export interface AstrologyRankingItem {
  zodiacSign: ZodiacSign;
  zodiacLabel: string;
  score: number;
  dateLabel: string;
}

export interface AstrologyRankingResult {
  complete: boolean;
  items: AstrologyRankingItem[];
}

export interface AstrologyProfileInput {
  name?: string;
  birthday: string;
  birthTime?: string;
  birthPlace?: string;
  zodiacSign?: ZodiacSign;
  zodiacSignOverride?: ZodiacSign;
  locale?: string;
}

export interface AstrologyReading extends AstrologyPeriodReading {
  provider: 'mock' | 'divineapi';
  apiConfigured: boolean;
  zodiacSign: ZodiacSign;
  zodiacLabel: string;
  dateLabel: string;
  headline: string;
  workNote: string;
  energyScore: number;
  luckyColor: string;
  luckyWindow: string;
  weekly: Array<{
    key: string;
    label: string;
    energy: number;
    tone: 'focus' | 'social' | 'creative' | 'recovery';
    title: string;
    suggestion: string;
  }>;
}

export interface TarotReading {
  provider: 'mock' | 'divineapi';
  apiConfigured: boolean;
  title: string;
  subtitle: string;
  body: string;
}

export interface WeeklyAstrologyReading extends AstrologyPeriodReading {
  provider: 'mock' | 'divineapi';
  apiConfigured: boolean;
  zodiacSign: ZodiacSign;
  zodiacLabel: string;
  weekLabel: string;
  personal: string;
  health: string;
  profession: string;
  emotions: string;
  travel: string;
  luck: string;
  luckyColors: string[];
}

export interface YesNoTarotReading {
  provider: 'mock' | 'divineapi';
  apiConfigured: boolean;
  answer: 'yes' | 'no' | 'maybe';
  card: string;
  category: string;
  result: string;
  imageUrl: string | null;
}

interface DivineApiConfig {
  apiKey: string;
  accessToken: string;
  baseUrl: string;
  translatorBaseUrl: string;
  cacheTtlMs: number;
  staleIfErrorMs: number;
  capabilityRefreshTtlMs: number;
  capabilities: Set<AstrologyCapability>;
}

interface RequestOptions {
  env?: NodeJS.ProcessEnv;
  now?: Date;
  fetchImpl?: typeof fetch;
}

const DIVINE_DEFAULT_BASE_URL = 'https://astroapi-5.divineapi.com';
const DIVINE_DEFAULT_TRANSLATOR_BASE_URL = 'https://astroapi-5-translator.divineapi.com';
const DIVINE_DEFAULT_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const DIVINE_DEFAULT_STALE_IF_ERROR_MS = 24 * 60 * 60 * 1000;
const DIVINE_DEFAULT_CAPABILITY_REFRESH_TTL_MS = 15 * 60 * 1000;
const divineApiCache = new Map<string, { expiresAt: number; staleUntil: number; value: unknown }>();
const observedCapabilityFailures = new Map<
  AstrologyCapability,
  { reason: 'not-authorized' | 'invalid-response'; expiresAt: number }
>();

const ZODIAC_META: Record<
  ZodiacSign,
  {
    label: string;
    mood: string;
    focusMode: string;
    luckyColor: string;
    headline: string;
    workNote: string;
  }
> = {
  aries: {
    label: '白羊座',
    mood: '推进',
    focusMode: '先开第一步',
    luckyColor: '莓果红',
    headline: '今天适合把卡住的事先推一厘米。',
    workNote: '把任务拆成 15 分钟的小动作，先拿到一点动量。',
  },
  taurus: {
    label: '金牛座',
    mood: '稳定',
    focusMode: '慢热深工',
    luckyColor: '鼠尾草绿',
    headline: '今天的节奏越稳，结果越容易长出来。',
    workNote: '适合整理资料、补齐细节和推进长期项目。',
  },
  gemini: {
    label: '双子座',
    mood: '连接',
    focusMode: '快速切换',
    luckyColor: '柠檬黄',
    headline: '今天适合问问题、找线索、把散点串起来。',
    workNote: '复杂任务先列清单，再分批推进沟通和调研。',
  },
  cancer: {
    label: '巨蟹座',
    mood: '照料',
    focusMode: '安静收拢',
    luckyColor: '月光白',
    headline: '今天适合清理边角，把工作台变得舒服一点。',
    workNote: '优先处理需要共情、复盘、整理和收尾的任务。',
  },
  leo: {
    label: '狮子座',
    mood: '表达',
    focusMode: '亮出来',
    luckyColor: '金橙',
    headline: '今天适合把你的成果讲清楚。',
    workNote: '先写出最有力的三句话，再去做展示或汇报。',
  },
  virgo: {
    label: '处女座',
    mood: '校准',
    focusMode: '逐项打磨',
    luckyColor: '薄荷绿',
    headline: '今天适合把混乱变成秩序。',
    workNote: '适合检查、修 bug、整理文档，但别把小问题无限放大。',
  },
  libra: {
    label: '天秤座',
    mood: '平衡',
    focusMode: '对齐共识',
    luckyColor: '柔粉',
    headline: '今天适合对齐优先级，把关系和任务都放顺。',
    workNote: '用利弊表做选择，避免在相近选项里反复犹豫。',
  },
  scorpio: {
    label: '天蝎座',
    mood: '深入',
    focusMode: '穿透问题',
    luckyColor: '深莓紫',
    headline: '今天适合做一件真正需要专注的事。',
    workNote: '适合分析、调查、策略判断，把通知关掉会很值。',
  },
  sagittarius: {
    label: '射手座',
    mood: '探索',
    focusMode: '打开视野',
    luckyColor: '天蓝',
    headline: '今天适合看远一点，给任务换个角度。',
    workNote: '把好奇心落成一个具体行动，别只停在收集信息。',
  },
  capricorn: {
    label: '摩羯座',
    mood: '爬坡',
    focusMode: '稳步完成',
    luckyColor: '岩灰',
    headline: '今天适合把长期目标往前搬一格。',
    workNote: '适合推进硬任务、做计划、补齐基础设施。进度比速度重要。',
  },
  aquarius: {
    label: '水瓶座',
    mood: '发明',
    focusMode: '换个解法',
    luckyColor: '电光蓝',
    headline: '今天适合试一个不那么常规的办法。',
    workNote: '适合自动化、产品想法、系统改造。先做小实验。',
  },
  pisces: {
    label: '双鱼座',
    mood: '灵感',
    focusMode: '柔软创造',
    luckyColor: '海雾紫',
    headline: '今天适合把模糊的感觉变成一个具体草稿。',
    workNote: '适合写作、设计、创意整理。给自己一个温和的开始。',
  },
};

export function hasDivineApiCredentials(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.DIVINE_API_KEY && env.DIVINE_ACCESS_TOKEN);
}

export function hasAstrologyApiCredentials(env: NodeJS.ProcessEnv = process.env): boolean {
  return hasDivineApiCredentials(env);
}

export function divineApiStatus(env: NodeJS.ProcessEnv = process.env): {
  provider: 'divineapi' | 'mock';
  apiConfigured: boolean;
  cacheTtlMs: number;
  cacheEntries: number;
  capabilities: ProviderCapabilityState[];
  endpoints: {
    dailyHoroscope: string;
    dailyTarot: string;
    weeklyHoroscope: string;
    yesNoTarot: string;
  };
} {
  const config = divineApiConfig(env);
  const checkedAt = env.DIVINE_API_CAPABILITIES_CHECKED_AT?.trim() || new Date().toISOString();
  return {
    provider: config ? 'divineapi' : 'mock',
    apiConfigured: Boolean(config),
    cacheTtlMs: config?.cacheTtlMs ?? readCacheTtlMs(env),
    cacheEntries: divineApiCache.size,
    capabilities: allAstrologyCapabilities().map((capability) => {
      const observedFailure = activeCapabilityFailure(capability);
      const available = Boolean(config?.capabilities.has(capability)) && !observedFailure;
      return available
        ? { capability, available, checkedAt }
        : {
            capability,
            available,
            checkedAt,
            reason: observedFailure?.reason ?? ('not-configured' as const),
          };
    }),
    endpoints: {
      dailyHoroscope: '/api/v5/daily-horoscope',
      dailyTarot: '/api/v2/daily-tarot',
      weeklyHoroscope: '/api/v5/weekly-horoscope',
      yesNoTarot: '/api/v2/yes-or-no-tarot',
    },
  };
}

export function clearDivineApiCacheForTest(): void {
  divineApiCache.clear();
  observedCapabilityFailures.clear();
}

export function zodiacFromBirthday(birthday: string): ZodiacSign {
  const [, , monthRaw, dayRaw] = birthday.match(/^(\d{4})-(\d{2})-(\d{2})$/) ?? [];
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  if (!month || !day) return 'aries';
  const value = month * 100 + day;
  if (value >= 321 && value <= 419) return 'aries';
  if (value >= 420 && value <= 520) return 'taurus';
  if (value >= 521 && value <= 620) return 'gemini';
  if (value >= 621 && value <= 722) return 'cancer';
  if (value >= 723 && value <= 822) return 'leo';
  if (value >= 823 && value <= 922) return 'virgo';
  if (value >= 923 && value <= 1022) return 'libra';
  if (value >= 1023 && value <= 1121) return 'scorpio';
  if (value >= 1122 && value <= 1221) return 'sagittarius';
  if (value >= 1222 || value <= 119) return 'capricorn';
  if (value >= 120 && value <= 218) return 'aquarius';
  return 'pisces';
}

function resolveZodiacSign(input: AstrologyProfileInput): ZodiacSign {
  return input.zodiacSignOverride ?? input.zodiacSign ?? zodiacFromBirthday(input.birthday);
}

export function buildDailyAstrologyReading(
  input: AstrologyProfileInput,
  options: RequestOptions = {},
): AstrologyReading {
  const now = options.now ?? new Date();
  const zodiacSign = resolveZodiacSign(input);
  const meta = ZODIAC_META[zodiacSign];
  const seed = seededNumber(`${zodiacSign}-${input.birthday}-${dateKey(now)}`);
  const apiConfigured = hasDivineApiCredentials(options.env);
  const dateLabel = formatDateLabel(now);
  const luckyWindow = pick(seed, [
    '09:30 - 10:20',
    '11:10 - 12:00',
    '14:00 - 14:45',
    '16:20 - 17:10',
    '20:30 - 21:15',
  ]);
  const weekly = buildWeek(seed);
  const dimensions = localDimensions({
    personal: meta.headline,
    health: '把休息放进日程，优先选择能让身体慢下来的小习惯。',
    profession: meta.workNote,
    emotions: '先识别感受，再决定回应方式；不必立刻解决所有问题。',
    travel: '行程和外出安排保留一点弹性，会比排得太满更舒服。',
    luck: '小范围尝试会比一次押注更容易带来好结果。',
  });
  return {
    period: 'daily',
    provider: 'mock',
    source: 'local-fallback',
    freshness: 'local',
    apiConfigured,
    zodiacSign,
    zodiacLabel: meta.label,
    rangeLabel: dateLabel,
    rangeKey: 'today',
    summary: meta.headline,
    dimensions,
    luckyColors: [meta.luckyColor],
    luckyNumbers: [],
    luckyLetters: [],
    suitableTimes: [luckyWindow],
    sevenDayTrend: null,
    cosmicTip: null,
    singlesTip: null,
    couplesTip: null,
    dateLabel,
    headline: meta.headline,
    workNote: meta.workNote,
    energyScore: 56 + (seed % 39),
    luckyColor: meta.luckyColor,
    luckyWindow,
    weekly,
  };
}

export async function getDailyAstrologyReading(
  input: AstrologyProfileInput,
  options: RequestOptions = {},
): Promise<AstrologyReading> {
  const mock = buildDailyAstrologyReading(input, options);
  const config = divineApiConfig(options.env);
  if (!isCapabilityAvailable(config, 'daily-horoscope')) return mock;
  const target = requestTarget(config, input.locale);
  if (!target) return mock;

  try {
    const response = await postDivineApiJson(
      '/api/v5/daily-horoscope',
      {
        api_key: config.apiKey,
        sign: mock.zodiacSign,
        h_day: 'today',
        tzone: timezoneOffsetHours(options.now ?? new Date()),
        lan: target.lan,
      },
      { ...config, baseUrl: target.baseUrl },
      'daily-horoscope',
      options.fetchImpl,
      horoscopeRequiredPaths('prediction'),
      (json) => assertHoroscopeDimensionTypes(json, 'prediction'),
    );
    return mergeDivineDaily(mock, response.json, response.freshness);
  } catch {
    return mock;
  }
}

export function buildMockTarotReading(
  input: { zodiacSign?: ZodiacSign; locale?: string } = {},
  options: RequestOptions = {},
): TarotReading {
  const now = options.now ?? new Date();
  const sign = input.zodiacSign ?? 'aries';
  const seed = seededNumber(`${sign}-tarot-${dateKey(now)}`);
  const apiConfigured = hasDivineApiCredentials(options.env);
  const cards: [
    Pick<TarotReading, 'title' | 'subtitle' | 'body'>,
    ...Array<Pick<TarotReading, 'title' | 'subtitle' | 'body'>>,
  ] = [
    {
      title: 'The Star',
      subtitle: '先把希望放回桌面',
      body: '今天适合相信一个长期方向，但行动要轻一点。先完成一件能恢复信心的小事。',
    },
    {
      title: 'Temperance',
      subtitle: '把节奏调匀',
      body: '今天不适合用力过猛。把任务拆开，给沟通和休息都留出位置。',
    },
    {
      title: 'Page of Pentacles',
      subtitle: '从一个可执行动作开始',
      body: '今天适合学习、整理、试一个小工具。别急着定终局，先拿到反馈。',
    },
  ];
  const card = cards[seed % cards.length] ?? cards[0];
  return {
    provider: 'mock',
    apiConfigured,
    title: card.title,
    subtitle: card.subtitle,
    body: card.body,
  };
}

export async function getDailyTarotReading(
  input: { zodiacSign?: ZodiacSign; locale?: string } = {},
  options: RequestOptions = {},
): Promise<TarotReading> {
  const mock = buildMockTarotReading(input, options);
  const config = divineApiConfig(options.env);
  if (!isCapabilityAvailable(config, 'daily-tarot')) return mock;
  const target = requestTarget(config, input.locale);
  if (!target) return mock;

  try {
    const response = await postDivineApiJson(
      '/api/v2/daily-tarot',
      {
        api_key: config.apiKey,
        sign: input.zodiacSign ?? 'aries',
        h_day: 'today',
        lan: target.lan,
      },
      { ...config, baseUrl: target.baseUrl },
      'daily-tarot',
      options.fetchImpl,
      [['data', 'card_name']],
    );
    return mergeDivineTarot(mock, response.json);
  } catch {
    return mock;
  }
}

export function buildMockWeeklyAstrologyReading(
  input: AstrologyProfileInput,
  options: RequestOptions = {},
): WeeklyAstrologyReading {
  const now = options.now ?? new Date();
  const zodiacSign = resolveZodiacSign(input);
  const meta = ZODIAC_META[zodiacSign];
  const seed = seededNumber(`${zodiacSign}-weekly-${dateKey(now)}`);
  const weekLabel = formatWeekLabel(now);
  const personal = `${meta.label}本周适合把关系里的期待说得更具体，也给彼此留一点缓冲。`;
  const health = '把休息放进日程，优先选择能让身体慢下来的小习惯。';
  const profession = meta.workNote;
  const emotions = '先识别感受，再决定回应方式；不必立刻解决所有问题。';
  const travel = '行程和外出安排保留一点弹性，会比排得太满更舒服。';
  const luck = pick(seed, [
    '小范围尝试会比一次押注更容易带来好结果。',
    '主动发出一次清楚的邀请，会打开新的回应。',
    '整理一个拖延已久的角落，可能顺带清除心里的噪音。',
  ]);
  return {
    period: 'weekly',
    provider: 'mock',
    source: 'local-fallback',
    freshness: 'local',
    apiConfigured: hasDivineApiCredentials(options.env),
    zodiacSign,
    zodiacLabel: meta.label,
    rangeLabel: weekLabel,
    rangeKey: 'current',
    summary: personal,
    dimensions: localDimensions({ personal, health, profession, emotions, travel, luck }),
    luckyColors: [meta.luckyColor],
    luckyNumbers: [],
    luckyLetters: [],
    suitableTimes: [],
    sevenDayTrend: null,
    cosmicTip: null,
    singlesTip: null,
    couplesTip: null,
    weekLabel,
    personal,
    health,
    profession,
    emotions,
    travel,
    luck,
  };
}

export async function getWeeklyAstrologyReading(
  input: AstrologyProfileInput,
  options: RequestOptions = {},
): Promise<WeeklyAstrologyReading> {
  const mock = buildMockWeeklyAstrologyReading(input, options);
  const config = divineApiConfig(options.env);
  if (!isCapabilityAvailable(config, 'weekly-horoscope')) return mock;
  const target = requestTarget(config, input.locale);
  if (!target) return mock;

  try {
    const response = await postDivineApiJson(
      '/api/v5/weekly-horoscope',
      {
        api_key: config.apiKey,
        sign: mock.zodiacSign,
        week: 'current',
        tzone: timezoneOffsetHours(options.now ?? new Date()),
        lan: target.lan,
      },
      { ...config, baseUrl: target.baseUrl },
      'weekly-horoscope',
      options.fetchImpl,
      horoscopeRequiredPaths('weekly_horoscope'),
      (json) => assertHoroscopeDimensionTypes(json, 'weekly_horoscope'),
    );
    return mergeDivineWeekly(mock, response.json, response.freshness);
  } catch {
    return mock;
  }
}

export async function getMonthlyAstrologyReading(
  input: AstrologyProfileInput,
  rangeKey: 'current' | 'next' = 'current',
  options: RequestOptions = {},
): Promise<AstrologyPeriodReading> {
  return getLongPeriodReading(input, 'monthly', rangeKey, options);
}

export async function getYearlyAstrologyReading(
  input: AstrologyProfileInput,
  options: RequestOptions = {},
): Promise<AstrologyPeriodReading> {
  return getLongPeriodReading(input, 'yearly', 'current', options);
}

export async function getAstrologyRanking(
  locale = 'en',
  options: RequestOptions = {},
): Promise<AstrologyRankingResult> {
  const signs = Object.keys(ZODIAC_META) as ZodiacSign[];
  const readings = await Promise.all(
    signs.map((zodiacSignOverride) =>
      getDailyAstrologyReading(
        {
          birthday: '2000-01-01',
          zodiacSignOverride,
          locale,
        },
        options,
      ),
    ),
  );
  const dateLabels = new Set(readings.map((reading) => reading.rangeLabel));
  if (
    readings.length !== signs.length ||
    dateLabels.size !== 1 ||
    readings.some((reading) => reading.source !== 'divineapi')
  ) {
    return { complete: false, items: [] };
  }

  const items: AstrologyRankingItem[] = [];
  for (const reading of readings) {
    const scores = reading.dimensions.map((dimension) => dimension.score);
    if (scores.some((score) => score === null)) return { complete: false, items: [] };
    const numericScores = scores as number[];
    items.push({
      zodiacSign: reading.zodiacSign,
      zodiacLabel: reading.zodiacLabel,
      score: Math.round(
        numericScores.reduce((total, score) => total + score, 0) / numericScores.length,
      ),
      dateLabel: reading.rangeLabel,
    });
  }

  return {
    complete: true,
    items: items.sort((left, right) => right.score - left.score),
  };
}

async function getLongPeriodReading(
  input: AstrologyProfileInput,
  period: 'monthly' | 'yearly',
  rangeKey: 'current' | 'next',
  options: RequestOptions,
): Promise<AstrologyPeriodReading> {
  const local = buildLocalLongPeriodReading(input, period, rangeKey, options);
  const config = divineApiConfig(options.env);
  const capability: AstrologyCapability = `${period}-horoscope`;
  if (!isCapabilityAvailable(config, capability)) return local;
  const target = requestTarget(config, input.locale);
  if (!target) return local;
  const selector = `${period}_horoscope`;
  try {
    const response = await postDivineApiJson(
      `/api/v5/${period}-horoscope`,
      {
        api_key: config.apiKey,
        sign: local.zodiacSign,
        [period === 'monthly' ? 'month' : 'year']: rangeKey,
        tzone: timezoneOffsetHours(options.now ?? new Date()),
        lan: target.lan,
      },
      { ...config, baseUrl: target.baseUrl },
      capability,
      options.fetchImpl,
      horoscopeRequiredPaths(selector),
      (json) => assertHoroscopeDimensionTypes(json, selector),
    );
    return mergeDivinePeriod(
      local,
      response.json,
      selector,
      period === 'monthly' ? 'month' : 'year',
      response.freshness,
    );
  } catch {
    return local;
  }
}

function buildLocalLongPeriodReading(
  input: AstrologyProfileInput,
  period: 'monthly' | 'yearly',
  rangeKey: 'current' | 'next',
  options: RequestOptions,
): AstrologyPeriodReading {
  const now = new Date(options.now ?? new Date());
  if (period === 'monthly' && rangeKey === 'next') now.setMonth(now.getMonth() + 1);
  const zodiacSign = resolveZodiacSign(input);
  const meta = ZODIAC_META[zodiacSign];
  const rangeLabel =
    period === 'monthly'
      ? new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long' }).format(now)
      : String(now.getFullYear());
  const bodies: Record<AstrologyDimensionKey, string> = {
    personal: `${meta.label}${rangeKey === 'next' ? '下个月' : period === 'monthly' ? '本月' : '本年'}适合把期待说具体，也给关系留一点缓冲。`,
    health: '把休息和规律放进计划，用可持续的节奏代替一次用力过猛。',
    profession: meta.workNote,
    emotions: '先识别感受，再决定回应方式；不必一次解决所有问题。',
    travel: '行程安排保留一点弹性，新环境会带来有用的观察。',
    luck: '从小范围尝试开始，真实反馈会带来下一步线索。',
  };
  return {
    period,
    provider: 'mock',
    source: 'local-fallback',
    freshness: 'local',
    zodiacSign,
    zodiacLabel: meta.label,
    rangeLabel,
    rangeKey,
    summary: bodies.personal,
    dimensions: localDimensions(bodies),
    luckyColors: [meta.luckyColor],
    luckyNumbers: [],
    luckyLetters: [],
    suitableTimes: [],
    sevenDayTrend: null,
    cosmicTip: null,
    singlesTip: null,
    couplesTip: null,
  };
}

export function buildMockYesNoTarotReading(
  input: { zodiacSign?: ZodiacSign; locale?: string } = {},
  options: RequestOptions = {},
): YesNoTarotReading {
  const now = options.now ?? new Date();
  const sign = input.zodiacSign ?? 'aries';
  const seed = seededNumber(`${sign}-yes-no-${dateKey(now)}`);
  const optionsList: [
    Pick<YesNoTarotReading, 'answer' | 'card' | 'category' | 'result'>,
    ...Array<Pick<YesNoTarotReading, 'answer' | 'card' | 'category' | 'result'>>,
  ] = [
    {
      answer: 'yes',
      card: 'The Sun',
      category: 'Major Arcana',
      result: '可以，从一个清楚、轻量的小步骤开始，先观察真实反馈。',
    },
    {
      answer: 'maybe',
      card: 'Temperance',
      category: 'Major Arcana',
      result: '先别急着定论。补足一个关键信息，再给自己一点时间校准节奏。',
    },
    {
      answer: 'no',
      card: 'Four of Swords',
      category: 'Minor Arcana',
      result: '现在更适合暂停和整理。拒绝这一次，不等于永远没有机会。',
    },
  ];
  const selected = optionsList[seed % optionsList.length] ?? optionsList[0];
  return {
    provider: 'mock',
    apiConfigured: hasDivineApiCredentials(options.env),
    ...selected,
    imageUrl: null,
  };
}

export async function getYesNoTarotReading(
  input: { zodiacSign?: ZodiacSign; locale?: string } = {},
  options: RequestOptions = {},
): Promise<YesNoTarotReading> {
  const mock = buildMockYesNoTarotReading(input, options);
  const config = divineApiConfig(options.env);
  if (!isCapabilityAvailable(config, 'yes-no-tarot')) return mock;
  const target = requestTarget(config, input.locale);
  if (!target) return mock;

  try {
    const response = await postDivineApiJson(
      '/api/v2/yes-or-no-tarot',
      {
        api_key: config.apiKey,
        lan: target.lan,
      },
      { ...config, baseUrl: target.baseUrl },
      'yes-no-tarot',
      options.fetchImpl,
      [['data', 'prediction']],
    );
    return mergeDivineYesNoTarot(mock, response.json);
  } catch {
    return mock;
  }
}

function buildWeek(seed: number): AstrologyReading['weekly'] {
  const labels = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
  const tones: AstrologyReading['weekly'][number]['tone'][] = [
    'focus',
    'social',
    'creative',
    'recovery',
  ];
  const titles: Record<AstrologyReading['weekly'][number]['tone'], string> = {
    focus: '深度工作',
    social: '沟通对齐',
    creative: '创意探索',
    recovery: '整理恢复',
  };
  const suggestions: Record<AstrologyReading['weekly'][number]['tone'], string> = {
    focus: '适合处理最硬的任务',
    social: '适合开会、回复和推进协作',
    creative: '适合写方案、找灵感和试想法',
    recovery: '适合收尾、归档和低压维护',
  };
  return labels.map((label, index) => {
    const tone = tones[(seed + index * 3) % tones.length] ?? 'focus';
    return {
      key: label,
      label,
      tone,
      energy: 48 + ((seed + index * 11) % 45),
      title: titles[tone],
      suggestion: suggestions[tone],
    };
  });
}

function divineApiConfig(env: NodeJS.ProcessEnv = process.env): DivineApiConfig | null {
  const apiKey = env.DIVINE_API_KEY;
  const accessToken = env.DIVINE_ACCESS_TOKEN;
  if (!apiKey || !accessToken) return null;
  return {
    apiKey,
    accessToken,
    baseUrl: (env.DIVINE_API_BASE_URL ?? DIVINE_DEFAULT_BASE_URL).replace(/\/+$/, ''),
    translatorBaseUrl: (
      env.DIVINE_API_TRANSLATOR_BASE_URL ?? DIVINE_DEFAULT_TRANSLATOR_BASE_URL
    ).replace(/\/+$/, ''),
    cacheTtlMs: readCacheTtlMs(env),
    staleIfErrorMs: readNonNegativeMs(
      env.DIVINE_API_STALE_IF_ERROR_MS,
      DIVINE_DEFAULT_STALE_IF_ERROR_MS,
    ),
    capabilityRefreshTtlMs: readNonNegativeMs(
      env.DIVINE_API_CAPABILITY_REFRESH_TTL_MS,
      DIVINE_DEFAULT_CAPABILITY_REFRESH_TTL_MS,
    ),
    capabilities: readConfiguredCapabilities(env),
  };
}

async function postDivineApiJson(
  path: string,
  body: Record<string, string>,
  config: DivineApiConfig,
  capability: AstrologyCapability,
  fetchImpl: typeof fetch | undefined,
  requiredPaths: ReadonlyArray<ReadonlyArray<string>>,
  validate?: (json: unknown) => void,
): Promise<{ json: unknown; freshness: 'fresh' | 'stale' }> {
  const bodyString = new URLSearchParams(body).toString();
  const cacheParams = new URLSearchParams(
    Object.entries(body).filter(([key]) => key !== 'api_key'),
  ).toString();
  const cacheKey = `${config.baseUrl}${path}?${cacheParams}`;
  let staleValue: unknown;
  if (config.cacheTtlMs > 0) {
    const cached = divineApiCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return { json: cached.value, freshness: 'fresh' };
    }
    if (cached && cached.staleUntil > Date.now()) staleValue = cached.value;
    if (cached && cached.staleUntil <= Date.now()) divineApiCache.delete(cacheKey);
  }
  try {
    const res = await (fetchImpl ?? fetch)(`${config.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: bodyString,
    });
    if (!res.ok) {
      throw new Error(`DivineAPI request failed: ${res.status}`);
    }
    const json = await res.json();
    assertDivineApiSuccess(json, requiredPaths);
    validate?.(json);
    if (config.cacheTtlMs > 0) {
      const expiresAt = Date.now() + config.cacheTtlMs;
      divineApiCache.set(cacheKey, {
        expiresAt,
        staleUntil: expiresAt + config.staleIfErrorMs,
        value: json,
      });
    }
    return { json, freshness: 'fresh' };
  } catch (error) {
    if (error instanceof DivineApiContractError) {
      observedCapabilityFailures.set(capability, {
        reason: error.reason === 'not-authorized' ? 'not-authorized' : 'invalid-response',
        expiresAt: Date.now() + config.capabilityRefreshTtlMs,
      });
    }
    if (staleValue !== undefined) return { json: staleValue, freshness: 'stale' };
    throw error;
  }
}

function activeCapabilityFailure(
  capability: AstrologyCapability,
): { reason: 'not-authorized' | 'invalid-response'; expiresAt: number } | null {
  const failure = observedCapabilityFailures.get(capability);
  if (!failure) return null;
  if (failure.expiresAt > Date.now()) return failure;
  observedCapabilityFailures.delete(capability);
  return null;
}

function isCapabilityAvailable(
  config: DivineApiConfig | null,
  capability: AstrologyCapability,
): config is DivineApiConfig {
  return Boolean(config?.capabilities.has(capability) && !activeCapabilityFailure(capability));
}

function mergeDivineDaily(
  mock: AstrologyReading,
  json: unknown,
  freshness: 'fresh' | 'stale',
): AstrologyReading {
  const predictionPath = ['data', 'prediction'];
  const dimensions = parseProviderDimensions(json, predictionPath);
  const insights = parseLuckyInsights(json, predictionPath);
  const headline =
    dimensionBody(dimensions, 'personal', '') ||
    firstString(json, [['data', 'prediction', 'personal_life']]) ||
    mock.headline;
  const workNote = dimensionBody(dimensions, 'profession', mock.workNote);
  const rangeLabel = firstString(json, [['data', 'date']]) ?? mock.rangeLabel;
  const scoreValues = dimensions
    .map((dimension) => dimension.score)
    .filter((score): score is number => score !== null);
  const luckyColor =
    insights.luckyColors[0] ??
    firstString(json, [
      ['data', 'lucky_color'],
      ['data', 'luckyColor'],
      ['data', 'lucky', 'color'],
    ]) ??
    mock.luckyColor;
  return {
    ...mock,
    provider: 'divineapi',
    source: 'divineapi',
    freshness,
    rangeLabel,
    summary: headline,
    dimensions,
    luckyColors: insights.luckyColors.length > 0 ? insights.luckyColors : [luckyColor],
    luckyNumbers: insights.luckyNumbers,
    luckyLetters: insights.luckyLetters,
    suitableTimes: parseSuitableTimes(json),
    sevenDayTrend: parseSevenDayTrend(json),
    cosmicTip: insights.cosmicTip,
    singlesTip: insights.singlesTip,
    couplesTip: insights.couplesTip,
    dateLabel: rangeLabel,
    headline,
    workNote,
    energyScore:
      scoreValues.length > 0
        ? Math.round(scoreValues.reduce((sum, score) => sum + score, 0) / scoreValues.length)
        : mock.energyScore,
    luckyColor,
  };
}

function mergeDivineTarot(mock: TarotReading, json: unknown): TarotReading {
  const title =
    firstString(json, [
      ['data', 'card_name'],
      ['data', 'card', 'name'],
      ['data', 'name'],
      ['card_name'],
    ]) ?? mock.title;
  return {
    provider: 'divineapi',
    apiConfigured: true,
    title,
    subtitle:
      firstString(json, [
        ['data', 'card_type'],
        ['data', 'deck'],
        ['data', 'subtitle'],
      ]) ?? mock.subtitle,
    body:
      firstString(json, [
        ['data', 'prediction'],
        ['data', 'description'],
        ['data', 'meaning'],
        ['data', 'bot_response'],
      ]) ?? mock.body,
  };
}

function mergeDivineWeekly(
  mock: WeeklyAstrologyReading,
  json: unknown,
  freshness: 'fresh' | 'stale',
): WeeklyAstrologyReading {
  const horoscopePath = ['data', 'weekly_horoscope'];
  const dimensions = parseProviderDimensions(json, horoscopePath);
  const insights = parseLuckyInsights(json, horoscopePath);
  const personal = dimensionBody(dimensions, 'personal', mock.personal);
  const health = dimensionBody(dimensions, 'health', mock.health);
  const profession = dimensionBody(dimensions, 'profession', mock.profession);
  const emotions = dimensionBody(dimensions, 'emotions', mock.emotions);
  const travel = dimensionBody(dimensions, 'travel', mock.travel);
  const luck = dimensionBody(dimensions, 'luck', mock.luck);
  const weekLabel = firstString(json, [['data', 'week']]) ?? mock.weekLabel;
  return {
    ...mock,
    provider: 'divineapi',
    source: 'divineapi',
    freshness,
    rangeLabel: weekLabel,
    summary: personal,
    dimensions,
    luckyColors: insights.luckyColors.length > 0 ? insights.luckyColors : mock.luckyColors,
    luckyNumbers: insights.luckyNumbers,
    luckyLetters: insights.luckyLetters,
    cosmicTip: insights.cosmicTip,
    singlesTip: insights.singlesTip,
    couplesTip: insights.couplesTip,
    weekLabel,
    personal,
    health,
    profession,
    emotions,
    travel,
    luck,
  };
}

function mergeDivinePeriod(
  local: AstrologyPeriodReading,
  json: unknown,
  selector: string,
  rangeField: 'month' | 'year',
  freshness: 'fresh' | 'stale',
): AstrologyPeriodReading {
  const horoscopePath = ['data', selector];
  const dimensions = parseProviderDimensions(json, horoscopePath);
  const insights = parseLuckyInsights(json, horoscopePath);
  const summary = dimensionBody(dimensions, 'personal', local.summary);
  return {
    ...local,
    provider: 'divineapi',
    source: 'divineapi',
    freshness,
    rangeLabel: firstString(json, [['data', rangeField]]) ?? local.rangeLabel,
    summary,
    dimensions,
    luckyColors: insights.luckyColors.length > 0 ? insights.luckyColors : local.luckyColors,
    luckyNumbers: insights.luckyNumbers,
    luckyLetters: insights.luckyLetters,
    cosmicTip: insights.cosmicTip,
    singlesTip: insights.singlesTip,
    couplesTip: insights.couplesTip,
  };
}

const DIMENSION_LABELS: Record<AstrologyDimensionKey, string> = {
  personal: '个人',
  health: '健康',
  profession: '工作',
  emotions: '情绪',
  travel: '出行',
  luck: '好运',
};

const DIMENSION_KEYS = Object.keys(DIMENSION_LABELS) as AstrologyDimensionKey[];

function horoscopeRequiredPaths(selector: string): ReadonlyArray<ReadonlyArray<string>> {
  return DIMENSION_KEYS.map((key) => ['data', selector, key]);
}

function assertHoroscopeDimensionTypes(json: unknown, selector: string): void {
  for (const key of DIMENSION_KEYS) {
    const value = getPath(json, ['data', selector, key]);
    const valid =
      key === 'luck'
        ? Array.isArray(value) &&
          value.length > 0 &&
          value.every((entry) => typeof entry === 'string' && Boolean(entry.trim()))
        : typeof value === 'string' && Boolean(value.trim());
    if (!valid) throw new DivineApiContractError('invalid-response');
  }
}

function localDimensions(bodies: Record<AstrologyDimensionKey, string>): AstrologyDimension[] {
  return DIMENSION_KEYS.map((key) => ({
    key,
    label: DIMENSION_LABELS[key],
    body: bodies[key],
    score: null,
  }));
}

function parseProviderDimensions(json: unknown, horoscopePath: string[]): AstrologyDimension[] {
  return DIMENSION_KEYS.map((key) => ({
    key,
    label: DIMENSION_LABELS[key],
    body:
      key === 'luck'
        ? (firstStringArray(json, [[...horoscopePath, key]])?.join(' ') ?? '')
        : (firstString(json, [[...horoscopePath, key]]) ?? ''),
    score: boundedScore(getPath(json, ['data', 'special', 'horoscope_percentage', key])),
  }));
}

function dimensionBody(
  dimensions: AstrologyDimension[],
  key: AstrologyDimensionKey,
  fallback: string,
): string {
  return dimensions.find((dimension) => dimension.key === key)?.body || fallback;
}

function boundedScore(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  if (value < 0 || value > 100) return null;
  return Math.round(value);
}

function parseLuckyInsights(
  json: unknown,
  horoscopePath: string[],
): Pick<
  AstrologyPeriodReading,
  'luckyColors' | 'luckyNumbers' | 'luckyLetters' | 'cosmicTip' | 'singlesTip' | 'couplesTip'
> {
  const lines = firstStringArray(json, [[...horoscopePath, 'luck']]) ?? [];
  return {
    luckyColors:
      firstStringArray(json, [['data', 'special', 'lucky_color_codes']]) ??
      splitInsightList(findInsight(lines, [/^colors?\b/i, /^幸运色/])),
    luckyNumbers: splitInsightList(findInsight(lines, [/^lucky numbers?\b/i, /^幸运数字/])),
    luckyLetters: splitInsightList(
      findInsight(lines, [/^lucky alphabets?\b/i, /^lucky letters?\b/i, /^幸运字母/]),
    ),
    cosmicTip: findInsight(lines, [/^cosmic tip\b/i, /^宇宙提示/]),
    singlesTip: findInsight(lines, [/^tips? for singles\b/i, /^单身/]),
    couplesTip: findInsight(lines, [/^tips? for couples\b/i, /^伴侣/, /^情侣/]),
  };
}

function findInsight(lines: string[], prefixes: RegExp[]): string | null {
  for (const line of lines) {
    if (!prefixes.some((prefix) => prefix.test(line))) continue;
    const separator = line.indexOf(':');
    return (separator >= 0 ? line.slice(separator + 1) : line).trim() || null;
  }
  return null;
}

function splitInsightList(value: string | null): string[] {
  if (!value) return [];
  return value
    .split(/[,，]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseSuitableTimes(json: unknown): string[] {
  const array = firstStringArray(json, [
    ['data', 'suitable_times'],
    ['data', 'lucky_times'],
  ]);
  if (array) return array;
  const single = firstString(json, [
    ['data', 'suitable_time'],
    ['data', 'lucky_time'],
  ]);
  return single ? [single] : [];
}

function parseSevenDayTrend(json: unknown): AstrologyPeriodReading['sevenDayTrend'] {
  const value = getPath(json, ['data', 'seven_day_trend']);
  if (!Array.isArray(value) || value.length !== 7) return null;
  const items: Array<{ dateLabel: string; score: number }> = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') return null;
    const record = entry as Record<string, unknown>;
    const dateLabel = typeof record.date === 'string' ? record.date.trim() : '';
    const score = boundedScore(record.score);
    if (!dateLabel || score === null) return null;
    items.push({ dateLabel, score });
  }
  return { source: 'divineapi', items };
}

function mergeDivineYesNoTarot(mock: YesNoTarotReading, json: unknown): YesNoTarotReading {
  const answerText = firstString(json, [
    ['data', 'prediction', 'yes_no'],
    ['data', 'prediction', 'answer'],
  ]);
  return {
    ...mock,
    provider: 'divineapi',
    answer: normalizeYesNo(answerText),
    card: firstString(json, [['data', 'prediction', 'card']]) ?? mock.card,
    category: firstString(json, [['data', 'prediction', 'category']]) ?? mock.category,
    result: firstString(json, [['data', 'prediction', 'result']]) ?? mock.result,
    imageUrl:
      firstString(json, [
        ['data', 'prediction', 'image'],
        ['data', 'prediction', 'image2'],
      ]) ?? mock.imageUrl,
  };
}

function normalizeYesNo(value: string | null): YesNoTarotReading['answer'] {
  const normalized = value?.trim().toLowerCase() ?? '';
  if (normalized === 'yes' || normalized === '是') return 'yes';
  if (normalized === 'no' || normalized === '否') return 'no';
  return 'maybe';
}

function firstString(json: unknown, paths: Array<Array<string>>): string | null {
  for (const path of paths) {
    const value = getPath(json, path);
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
    if (value && typeof value === 'object') {
      const flattened = Object.values(value)
        .filter((entry): entry is string => typeof entry === 'string' && Boolean(entry.trim()))
        .join(' ');
      if (flattened) return flattened;
    }
  }
  return null;
}

function firstStringArray(json: unknown, paths: Array<Array<string>>): string[] | null {
  for (const path of paths) {
    const value = getPath(json, path);
    if (!Array.isArray(value)) continue;
    const strings = value.filter(
      (entry): entry is string => typeof entry === 'string' && Boolean(entry.trim()),
    );
    if (strings.length > 0) return strings.map((entry) => entry.trim());
  }
  return null;
}

function getPath(value: unknown, path: Array<string>): unknown {
  let current = value;
  for (const key of path) {
    if (!current || typeof current !== 'object' || !(key in current)) return null;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function requestTarget(
  config: DivineApiConfig,
  locale?: string,
): { baseUrl: string; lan: 'en' | 'zh' } | null {
  if (locale?.toLowerCase().startsWith('zh')) {
    return config.capabilities.has('translator')
      ? { baseUrl: config.translatorBaseUrl, lan: 'zh' }
      : null;
  }
  return { baseUrl: config.baseUrl, lan: 'en' };
}

function timezoneOffsetHours(date: Date): string {
  return String(-date.getTimezoneOffset() / 60);
}

function readCacheTtlMs(env: NodeJS.ProcessEnv = process.env): number {
  return readNonNegativeMs(env.DIVINE_API_CACHE_TTL_MS, DIVINE_DEFAULT_CACHE_TTL_MS);
}

function readNonNegativeMs(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
}

function seededNumber(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function pick<T>(seed: number, values: readonly [T, ...T[]]): T {
  return values[seed % values.length] ?? values[0];
}

function dateKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

function formatDateLabel(date: Date): string {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  }).format(date);
}

function formatWeekLabel(date: Date): string {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  const formatter = new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric' });
  return `${formatter.format(start)} - ${formatter.format(end)}`;
}
