export type EnergyExperienceKind = 'ritual' | 'card' | 'test' | 'horoscope' | 'game';
export type EnergyExperienceStatus = 'active' | 'coming-soon' | 'hidden';
export type EnergyNeed = 'focus' | 'relax' | 'confidence' | 'uplift';
export type EnergyExperienceId = 'recharge' | 'tarot' | 'light-test' | 'horoscope' | 'games';

export interface EnergyExperienceCatalogItem {
  id: EnergyExperienceId;
  kind: EnergyExperienceKind;
  title: string;
  description: string;
  estimatedSeconds: number;
  status: EnergyExperienceStatus;
  actionable: boolean;
}

const EXPERIENCES: readonly EnergyExperienceCatalogItem[] = [
  {
    id: 'recharge',
    kind: 'ritual',
    title: '30 秒补给',
    description: '跟着三段光点找回一点能量',
    estimatedSeconds: 30,
    status: 'active',
    actionable: true,
  },
  {
    id: 'tarot',
    kind: 'card',
    title: '抽张卡',
    description: '给当下一个轻提示',
    estimatedSeconds: 30,
    status: 'active',
    actionable: true,
  },
  {
    id: 'light-test',
    kind: 'test',
    title: '轻测试',
    description: '用一分钟看见现在的状态',
    estimatedSeconds: 60,
    status: 'active',
    actionable: true,
  },
  {
    id: 'horoscope',
    kind: 'horoscope',
    title: '今日星座',
    description: '看看今天适合怎样安排节奏',
    estimatedSeconds: 60,
    status: 'active',
    actionable: true,
  },
  {
    id: 'games',
    kind: 'game',
    title: '小游戏',
    description: '接住十二颗轻盈的能量光点',
    estimatedSeconds: 45,
    status: 'active',
    actionable: true,
  },
];

export function buildEnergyHome(): { experiences: EnergyExperienceCatalogItem[] } {
  return { experiences: EXPERIENCES.map((item) => ({ ...item })) };
}
