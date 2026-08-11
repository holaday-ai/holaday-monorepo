import { type ComponentType, createElement } from 'react';
import type { EnergyExperienceDefinition, EnergyExperienceProps } from './energy-types';

export interface EnergyExperienceRegistration extends EnergyExperienceDefinition {
  load?: () => Promise<{ default: ComponentType<EnergyExperienceProps> }>;
}

export const ENERGY_EXPERIENCES: EnergyExperienceRegistration[] = [
  {
    id: 'recharge',
    kind: 'ritual',
    title: '30 秒补给',
    description: '跟着三段光点找回一点能量',
    estimatedSeconds: 30,
    status: 'active',
    actionable: true,
    requiredProfileFields: [],
    load: () =>
      import('./experiences/RechargeExperience').then((module) => ({
        default: (props: EnergyExperienceProps) =>
          createElement(module.RechargeExperience, {
            need: props.energyNeed,
            phase: props.phase,
            onPhaseChange: props.onPhaseChange,
            onComplete: () => props.onExperienceComplete('recharge'),
          }),
      })),
  },
  {
    id: 'tarot',
    kind: 'card',
    title: '抽张卡',
    description: '给当下一个轻提示',
    estimatedSeconds: 30,
    status: 'active',
    actionable: true,
    requiredProfileFields: [],
    load: () =>
      import('./experiences/TarotExperience').then((module) => ({
        default: (props: EnergyExperienceProps) =>
          createElement(module.TarotExperience, {
            tarot: props.astrology.tarot,
            phase: props.phase,
            onPhaseChange: props.onPhaseChange,
          }),
      })),
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
    load: () =>
      import('./experiences/TestExperience').then((module) => ({
        default: (props: EnergyExperienceProps) =>
          createElement(module.TestExperience, {
            profile: props.profile,
            reading: props.astrology.reading,
            phase: props.phase,
            onPhaseChange: props.onPhaseChange,
          }),
      })),
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
    load: () =>
      import('./experiences/HoroscopeExperience').then((module) => ({
        default: (props: EnergyExperienceProps) =>
          createElement(module.HoroscopeExperience, {
            profile: props.profile,
            astrology: props.astrology,
          }),
      })),
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

export function activeEnergyExperiences(): EnergyExperienceRegistration[] {
  return ENERGY_EXPERIENCES.filter((experience) => {
    return experience.status === 'active' && experience.actionable;
  });
}
