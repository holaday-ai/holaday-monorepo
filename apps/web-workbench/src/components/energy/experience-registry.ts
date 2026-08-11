import type { EnergyExperienceDefinition } from './energy-types';

export const ENERGY_EXPERIENCES: EnergyExperienceDefinition[] = [
  {
    id: 'tarot',
    kind: 'card',
    title: '抽张卡',
    description: '给当下一个轻提示',
    estimatedSeconds: 30,
    status: 'active',
    actionable: true,
    requiredProfileFields: [],
  },
  {
    id: 'light-test',
    kind: 'test',
    title: '轻测试',
    description: '用一分钟看见现在的状态',
    estimatedSeconds: 60,
    status: 'active',
    actionable: true,
    requiredProfileFields: [],
  },
  {
    id: 'horoscope',
    kind: 'horoscope',
    title: '今日星座',
    description: '看看今天适合怎样安排节奏',
    estimatedSeconds: 60,
    status: 'active',
    actionable: true,
    requiredProfileFields: ['birthday'],
  },
  {
    id: 'games',
    kind: 'game',
    title: '小游戏',
    description: '轻量小游戏正在准备中',
    estimatedSeconds: 180,
    status: 'coming-soon',
    actionable: false,
    requiredProfileFields: [],
  },
];

export function activeEnergyExperiences(): EnergyExperienceDefinition[] {
  return ENERGY_EXPERIENCES.filter((experience) => {
    return experience.status === 'active' && experience.actionable;
  });
}
