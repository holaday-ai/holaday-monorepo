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

export interface AstrologyProfileInput {
  name?: string;
  birthday: string;
  birthTime?: string;
  birthPlace?: string;
  zodiacSign?: ZodiacSign;
  locale?: string;
}

export interface AstrologyReading {
  provider: 'mock' | 'astrologyapi';
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

export function hasAstrologyApiCredentials(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.ASTROLOGY_API_USER_ID && env.ASTROLOGY_API_KEY);
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

export function buildDailyAstrologyReading(
  input: AstrologyProfileInput,
  options: { env?: NodeJS.ProcessEnv; now?: Date } = {},
): AstrologyReading {
  const now = options.now ?? new Date();
  const zodiacSign = input.zodiacSign ?? zodiacFromBirthday(input.birthday);
  const meta = ZODIAC_META[zodiacSign];
  const seed = seededNumber(`${zodiacSign}-${input.birthday}-${dateKey(now)}`);
  const apiConfigured = hasAstrologyApiCredentials(options.env);
  return {
    provider: apiConfigured ? 'astrologyapi' : 'mock',
    apiConfigured,
    zodiacSign,
    zodiacLabel: meta.label,
    dateLabel: formatDateLabel(now),
    headline: meta.headline,
    workNote: meta.workNote,
    energyScore: 56 + (seed % 39),
    luckyColor: meta.luckyColor,
    luckyWindow: pick(seed, [
      '09:30 - 10:20',
      '11:10 - 12:00',
      '14:00 - 14:45',
      '16:20 - 17:10',
      '20:30 - 21:15',
    ]),
    weekly: buildWeek(seed),
  };
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
