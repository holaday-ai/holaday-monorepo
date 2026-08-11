import type { EnergyMood, EnergyNeed } from './energy-types';

export type EnergyContentKind =
  | 'astrology'
  | 'tarot'
  | 'test'
  | 'game'
  | 'micro-content'
  | 'video'
  | 'sponsored';

export type EnergyContentCategory =
  | 'relaxation'
  | 'fortune'
  | 'zodiac-knowledge'
  | 'relationship-quiz'
  | 'poll'
  | 'test-recommendation'
  | 'card-recommendation'
  | 'game-recommendation';

export interface EnergyContentItem {
  id: string;
  kind: EnergyContentKind;
  category: EnergyContentCategory;
  title: string;
  summary: string;
  estimatedSeconds: number;
  tags: string[];
  source: 'divineapi' | 'holaday-editorial' | 'partner';
  actionTarget: string;
  publishedAt?: string;
  expiresAt?: string;
}

export const REQUIRED_CONTENT_COUNTS = {
  relaxation: 6,
  fortune: 6,
  'zodiac-knowledge': 6,
  'relationship-quiz': 4,
  poll: 4,
  'test-recommendation': 4,
  'card-recommendation': 3,
  'game-recommendation': 3,
} as const satisfies Record<EnergyContentCategory, number>;

const editorial = (item: Omit<EnergyContentItem, 'source'>): EnergyContentItem => ({
  ...item,
  source: 'holaday-editorial',
});

export const ENERGY_EXPLORE_CONTENT: EnergyContentItem[] = [
  editorial({
    id: 'relax-breath-window',
    kind: 'micro-content',
    category: 'relaxation',
    title: '窗边八次慢呼吸',
    summary: '把视线放到远处一个固定物体，慢慢吸气和呼气八次，让肩膀在每次呼气时放低一点。',
    estimatedSeconds: 60,
    tags: ['relax', 'focus', 'stressed'],
    actionTarget: 'practice:breath-window',
  }),
  editorial({
    id: 'relax-shoulder-release',
    kind: 'micro-content',
    category: 'relaxation',
    title: '肩颈一分钟松绑',
    summary: '双脚踩稳地面，肩膀向后绕三圈，再轻轻转动头部，用一分钟把久坐的紧绷还给椅背。',
    estimatedSeconds: 60,
    tags: ['relax', 'tired', 'uplift'],
    actionTarget: 'practice:shoulder-release',
  }),
  editorial({
    id: 'relax-five-senses',
    kind: 'micro-content',
    category: 'relaxation',
    title: '五感回到此刻',
    summary: '依次找出眼前五种颜色、四种触感和三种声音，让注意力从纷乱想法回到真实环境。',
    estimatedSeconds: 90,
    tags: ['relax', 'focus', 'stressed'],
    actionTarget: 'practice:five-senses',
  }),
  editorial({
    id: 'relax-water-pause',
    kind: 'micro-content',
    category: 'relaxation',
    title: '一杯水的暂停',
    summary: '离开屏幕倒一杯水，前三口只感受温度和吞咽，不处理消息，也不顺便增加新的待办。',
    estimatedSeconds: 75,
    tags: ['relax', 'tired', 'confidence'],
    actionTarget: 'practice:water-pause',
  }),
  editorial({
    id: 'relax-desk-reset',
    kind: 'micro-content',
    category: 'relaxation',
    title: '桌面三件归位',
    summary: '只收好桌面上三件最碍眼的东西，完成后立刻停下，用小范围秩序换回一点呼吸空间。',
    estimatedSeconds: 90,
    tags: ['relax', 'focus', 'uplift'],
    actionTarget: 'practice:desk-reset',
  }),
  editorial({
    id: 'relax-distance-gaze',
    kind: 'micro-content',
    category: 'relaxation',
    title: '二十秒远眺轮换',
    summary: '连续三轮看向六米外的物体二十秒，再闭眼感受光线变化，让眼睛和大脑一起短暂休息。',
    estimatedSeconds: 80,
    tags: ['relax', 'tired', 'confidence'],
    actionTarget: 'practice:distance-gaze',
  }),
  editorial({
    id: 'fortune-small-luck',
    kind: 'astrology',
    category: 'fortune',
    title: '今日幸运签：小事先成',
    summary: '今天的好运更像一个容易完成的小步骤，先让一件事情顺利结束，再带着这股轻盈继续。',
    estimatedSeconds: 45,
    tags: ['uplift', 'focus', 'confidence'],
    actionTarget: 'astrology:daily',
  }),
  editorial({
    id: 'fortune-kind-reply',
    kind: 'astrology',
    category: 'fortune',
    title: '今日幸运签：温柔回应',
    summary: '一条真诚而简短的回应可能带来好心情，不必组织完美语言，清楚表达善意已经足够。',
    estimatedSeconds: 45,
    tags: ['uplift', 'confidence', 'social'],
    actionTarget: 'astrology:daily',
  }),
  editorial({
    id: 'fortune-open-window',
    kind: 'astrology',
    category: 'fortune',
    title: '今日幸运签：打开窗口',
    summary: '换一点空气、光线或座位方向，会比继续硬撑更容易带来新思路，允许环境帮你转场。',
    estimatedSeconds: 45,
    tags: ['uplift', 'relax', 'tired'],
    actionTarget: 'astrology:daily',
  }),
  editorial({
    id: 'fortune-clear-choice',
    kind: 'astrology',
    category: 'fortune',
    title: '今日幸运签：清楚选择',
    summary: '在两个选项之间犹豫时，先选更容易验证的一个，今天的幸运来自真实反馈而非反复猜测。',
    estimatedSeconds: 50,
    tags: ['confidence', 'focus'],
    actionTarget: 'astrology:weekly',
  }),
  editorial({
    id: 'fortune-slow-answer',
    kind: 'astrology',
    category: 'fortune',
    title: '今日幸运签：慢一点答',
    summary: '重要回应不必抢在第一秒完成，留一点确认空间，反而更容易说出真正符合你需要的话。',
    estimatedSeconds: 50,
    tags: ['confidence', 'relax', 'relationship'],
    actionTarget: 'astrology:weekly',
  }),
  editorial({
    id: 'fortune-finish-line',
    kind: 'astrology',
    category: 'fortune',
    title: '今日幸运签：看见终点',
    summary: '开始前先写清怎样算完成，明确的终点会减少无谓打磨，也让今天更容易获得成就感。',
    estimatedSeconds: 50,
    tags: ['focus', 'confidence', 'uplift'],
    actionTarget: 'astrology:monthly',
  }),
  editorial({
    id: 'zodiac-fire-recharge',
    kind: 'astrology',
    category: 'zodiac-knowledge',
    title: '火象星座怎样充电',
    summary: '白羊、狮子和射手常从行动感中恢复，目标不需要大，快速看见一步进展就能重新点亮热情。',
    estimatedSeconds: 70,
    tags: ['confidence', 'uplift', 'focus'],
    actionTarget: 'astrology:signs',
  }),
  editorial({
    id: 'zodiac-earth-rhythm',
    kind: 'astrology',
    category: 'zodiac-knowledge',
    title: '土象星座的安心节奏',
    summary:
      '金牛、处女和摩羯通常喜欢可预期的推进方式，把计划拆清楚，比突然提高强度更能建立安全感。',
    estimatedSeconds: 70,
    tags: ['focus', 'confidence', 'relax'],
    actionTarget: 'astrology:signs',
  }),
  editorial({
    id: 'zodiac-air-connection',
    kind: 'astrology',
    category: 'zodiac-knowledge',
    title: '风象星座的连接方式',
    summary: '双子、天秤和水瓶常在交换想法时获得活力，一次轻松对话可能比独自反刍更快打开新角度。',
    estimatedSeconds: 70,
    tags: ['uplift', 'social', 'confidence'],
    actionTarget: 'astrology:signs',
  }),
  editorial({
    id: 'zodiac-water-boundary',
    kind: 'astrology',
    category: 'zodiac-knowledge',
    title: '水象星座的柔软边界',
    summary: '巨蟹、天蝎和双鱼容易接收环境情绪，温柔并不等于全部承担，适时离开也是一种照顾。',
    estimatedSeconds: 70,
    tags: ['relax', 'confidence', 'relationship'],
    actionTarget: 'astrology:signs',
  }),
  editorial({
    id: 'zodiac-sun-sign',
    kind: 'astrology',
    category: 'zodiac-knowledge',
    title: '太阳星座代表什么',
    summary: '太阳星座更接近你主动发展和表达自我的方向，它是认识自己的入口，而不是限制性格的标签。',
    estimatedSeconds: 65,
    tags: ['confidence', 'focus'],
    actionTarget: 'astrology:daily',
  }),
  editorial({
    id: 'zodiac-periods',
    kind: 'astrology',
    category: 'zodiac-knowledge',
    title: '日周月年怎样看',
    summary:
      '日运适合看当下节奏，周运看近期主题，月运和年运更适合观察趋势，不必把提示当成确定预言。',
    estimatedSeconds: 75,
    tags: ['focus', 'relax', 'confidence'],
    actionTarget: 'astrology:monthly',
  }),
  editorial({
    id: 'relationship-reply-speed',
    kind: 'test',
    category: 'relationship-quiz',
    title: '关系小问答：回复速度',
    summary: '对方没有立即回复时，你更需要确认、等待还是转回自己的安排？用一分钟看看当前的安全感。',
    estimatedSeconds: 75,
    tags: ['relationship', 'confidence', 'relax'],
    actionTarget: 'experience:light-test',
  }),
  editorial({
    id: 'relationship-listen-or-solve',
    kind: 'test',
    category: 'relationship-quiz',
    title: '关系小问答：听还是解题',
    summary: '面对朋友的烦恼，你会马上提供方案还是先确认对方需要什么？试着发现自己的回应频道。',
    estimatedSeconds: 75,
    tags: ['relationship', 'uplift', 'social'],
    actionTarget: 'experience:light-test',
  }),
  editorial({
    id: 'relationship-space-signal',
    kind: 'test',
    category: 'relationship-quiz',
    title: '关系小问答：空间信号',
    summary: '想独处时能否清楚留下回应时间，比突然消失更让彼此安心，也能保护你真实的恢复需要。',
    estimatedSeconds: 75,
    tags: ['relationship', 'confidence', 'relax'],
    actionTarget: 'experience:light-test',
  }),
  editorial({
    id: 'relationship-small-invite',
    kind: 'test',
    category: 'relationship-quiz',
    title: '关系小问答：轻量邀请',
    summary: '一次不带压力的问候、散步或咖啡邀请，是否比等待完美时机更适合你今天的社交电量？',
    estimatedSeconds: 75,
    tags: ['relationship', 'uplift', 'social'],
    actionTarget: 'experience:light-test',
  }),
  editorial({
    id: 'poll-break-style',
    kind: 'micro-content',
    category: 'poll',
    title: '今日投票：最有效的休息',
    summary: '闭眼安静、走动伸展、听一首歌或找人聊聊，今天哪一种最能让你真正从工作里切换出来？',
    estimatedSeconds: 40,
    tags: ['relax', 'uplift'],
    actionTarget: 'poll:break-style',
  }),
  editorial({
    id: 'poll-focus-sound',
    kind: 'micro-content',
    category: 'poll',
    title: '今日投票：专注背景声',
    summary: '完全安静、白噪声、纯音乐还是咖啡馆环境音，你今天更愿意把哪一种放进工作背景？',
    estimatedSeconds: 40,
    tags: ['focus', 'uplift'],
    actionTarget: 'poll:focus-sound',
  }),
  editorial({
    id: 'poll-small-reward',
    kind: 'micro-content',
    category: 'poll',
    title: '今日投票：完成后的奖励',
    summary: '结束一件任务后，你更想喝点喜欢的、离开座位、看段轻松内容，还是把待办彻底划掉？',
    estimatedSeconds: 40,
    tags: ['uplift', 'confidence', 'focus'],
    actionTarget: 'poll:small-reward',
  }),
  editorial({
    id: 'poll-social-battery',
    kind: 'micro-content',
    category: 'poll',
    title: '今日投票：社交电量',
    summary: '现在更适合热闹聊天、一对一交流、只回必要消息，还是安静独处？选择不需要向任何人解释。',
    estimatedSeconds: 40,
    tags: ['relax', 'social', 'confidence'],
    actionTarget: 'poll:social-battery',
  }),
  editorial({
    id: 'test-recommend-emotion',
    kind: 'test',
    category: 'test-recommendation',
    title: '推荐测试：情绪电量',
    summary: '五个轻问题帮你看看此刻还有多少内在余量，结果会给出十五分钟内可以完成的恢复动作。',
    estimatedSeconds: 75,
    tags: ['relax', 'tired', 'stressed'],
    actionTarget: 'experience:light-test',
  }),
  editorial({
    id: 'test-recommend-focus',
    kind: 'test',
    category: 'test-recommendation',
    title: '推荐测试：专注入口',
    summary: '如果任务很多却很难开始，用五个问题找出注意力最容易安定的位置，再带走一个小动作。',
    estimatedSeconds: 75,
    tags: ['focus', 'work'],
    actionTarget: 'experience:light-test',
  }),
  editorial({
    id: 'test-recommend-boundary',
    kind: 'test',
    category: 'test-recommendation',
    title: '推荐测试：压力边界',
    summary: '分辨哪些责任真正属于自己，哪些期待可以协商，帮助今天的忙碌不再无限向外扩张。',
    estimatedSeconds: 75,
    tags: ['confidence', 'stressed'],
    actionTarget: 'experience:light-test',
  }),
  editorial({
    id: 'test-recommend-social',
    kind: 'test',
    category: 'test-recommendation',
    title: '推荐测试：连接式恢复',
    summary: '看看今天更适合独处还是低压力陪伴，找到一种不需要持续表现也能获得能量的连接方式。',
    estimatedSeconds: 75,
    tags: ['uplift', 'social', 'relax'],
    actionTarget: 'experience:light-test',
  }),
  editorial({
    id: 'card-recommend-single',
    kind: 'tarot',
    category: 'card-recommendation',
    title: '推荐抽卡：单张提示',
    summary: '从六个生活主题里选择最接近当下的一项，抽一张 Holaday 能量牌，把注意力放回下一步。',
    estimatedSeconds: 45,
    tags: ['uplift', 'focus', 'confidence'],
    actionTarget: 'experience:tarot',
  }),
  editorial({
    id: 'card-recommend-yes-no',
    kind: 'tarot',
    category: 'card-recommendation',
    title: '推荐抽卡：是或否方向',
    summary: '问题只留在心里，不输入也不上传，用一张能量牌看看此刻更适合行动、等待还是重新确认。',
    estimatedSeconds: 50,
    tags: ['confidence', 'relax'],
    actionTarget: 'experience:tarot',
  }),
  editorial({
    id: 'card-recommend-three',
    kind: 'tarot',
    category: 'card-recommendation',
    title: '推荐抽卡：三张能量牌',
    summary: '用回顾、当下和下一步三个位置重新排列视角，牌面提供的是轻提示，不是确定性结论。',
    estimatedSeconds: 70,
    tags: ['relax', 'uplift', 'focus'],
    actionTarget: 'experience:tarot',
  }),
  editorial({
    id: 'game-recommend-catch',
    kind: 'game',
    category: 'game-recommendation',
    title: '推荐小游戏：接住能量',
    summary: '用不到一分钟接住十二颗能量光点，让注意力从等待和焦虑里暂时转向简单、即时的反馈。',
    estimatedSeconds: 45,
    tags: ['uplift', 'focus', 'stressed'],
    actionTarget: 'experience:games',
  }),
  editorial({
    id: 'game-recommend-slow-round',
    kind: 'game',
    category: 'game-recommendation',
    title: '推荐小游戏：慢速一轮',
    summary: '不追求更高分，只完成一轮轻量互动，在短促节奏里给大脑一个清楚、可结束的休息段落。',
    estimatedSeconds: 50,
    tags: ['relax', 'tired', 'uplift'],
    actionTarget: 'experience:games',
  }),
  editorial({
    id: 'game-recommend-focus-round',
    kind: 'game',
    category: 'game-recommendation',
    title: '推荐小游戏：专注一轮',
    summary: '把这一轮当成专注热身，完成后立刻回到最重要的一件事，不让轻松体验变成新的待办。',
    estimatedSeconds: 50,
    tags: ['focus', 'confidence', 'uplift'],
    actionTarget: 'experience:games',
  }),
];

export function nextEnergyContentBatch(input: {
  items: EnergyContentItem[];
  seenIds: string[];
  seed: string;
  size: number;
  now: Date;
  mood: EnergyMood | null;
  energyNeed: EnergyNeed;
}): EnergyContentItem[] {
  const seenIds = new Set(input.seenIds);
  const active = input.items.filter((item) => isActiveAt(item, input.now));
  const unseen = active.filter((item) => !seenIds.has(item.id));
  return unseen
    .map((item) => ({
      item,
      affinity: affinityScore(item, input.mood, input.energyNeed),
      order: seededNumber(`${input.seed}:${item.id}`),
    }))
    .sort((left, right) => right.affinity - left.affinity || left.order - right.order)
    .slice(0, input.size)
    .map(({ item }) => item);
}

function isActiveAt(item: EnergyContentItem, now: Date): boolean {
  const time = now.getTime();
  if (item.publishedAt && new Date(item.publishedAt).getTime() > time) return false;
  if (item.expiresAt && new Date(item.expiresAt).getTime() <= time) return false;
  return true;
}

function affinityScore(
  item: EnergyContentItem,
  mood: EnergyMood | null,
  energyNeed: EnergyNeed,
): number {
  return (item.tags.includes(energyNeed) ? 4 : 0) + (mood && item.tags.includes(mood) ? 2 : 0);
}

function seededNumber(seed: string): number {
  let value = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    value ^= seed.charCodeAt(index);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}
