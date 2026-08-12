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
    id: 'practice',
    kind: 'ritual',
    title: '轻松练习',
    description: '跟着几步小动作松开一点',
    estimatedSeconds: 60,
    status: 'active',
    actionable: true,
    requiredProfileFields: [],
    surface: 'target-only',
    load: () =>
      import('./experiences/PracticeExperience').then((module) => ({
        default: (props: EnergyExperienceProps) => {
          if (props.launchTarget?.type !== 'practice') {
            return createElement('p', { role: 'status' }, '这个练习暂时不可用');
          }
          return createElement(module.PracticeExperience, {
            initialPracticeId: props.launchTarget.practiceId,
            profileStorageScope: props.profileStorageScope,
            phase: props.phase,
            onPhaseChange: props.onPhaseChange,
            onComplete: () => props.onExperienceComplete('recharge'),
          });
        },
      })),
  },
  {
    id: 'poll',
    kind: 'poll',
    title: '今日轻投票',
    description: '选一种更适合现在的补给方式',
    estimatedSeconds: 40,
    status: 'active',
    actionable: true,
    requiredProfileFields: [],
    surface: 'target-only',
    load: () =>
      import('./experiences/PollExperience').then((module) => ({
        default: (props: EnergyExperienceProps) => {
          if (props.launchTarget?.type !== 'poll') {
            return createElement('p', { role: 'status' }, '这个投票暂时不可用');
          }
          return createElement(module.PollExperience, {
            initialPollId: props.launchTarget.pollId,
            profileStorageScope: props.profileStorageScope,
            phase: props.phase,
            onPhaseChange: props.onPhaseChange,
          });
        },
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
    replayLabel: '重新开始抽卡',
    load: () =>
      import('./experiences/TarotExperience').then((module) => ({
        default: (props: EnergyExperienceProps) =>
          createElement(module.TarotExperience, {
            profileStorageScope: props.profileStorageScope,
            capabilities: props.astrology.capabilities,
            initialMode: props.launchTarget?.type === 'tarot' ? props.launchTarget.mode : undefined,
            initialTheme:
              props.launchTarget?.type === 'tarot' ? props.launchTarget.theme : undefined,
            phase: props.phase,
            onPhaseChange: props.onPhaseChange,
            onComplete: () => props.onExperienceComplete('tarot'),
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
            profileStorageScope: props.profileStorageScope,
            initialTestId:
              props.launchTarget?.type === 'test' ? props.launchTarget.testId : undefined,
            phase: props.phase,
            onPhaseChange: props.onPhaseChange,
            onComplete: () => props.onExperienceComplete('test'),
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
            phase: props.phase,
            onPhaseChange: props.onPhaseChange,
            onComplete: () => props.onExperienceComplete('horoscope'),
          }),
      })),
  },
  {
    id: 'games',
    kind: 'game',
    title: '小游戏',
    description: '接住十二颗轻盈的能量光点',
    estimatedSeconds: 45,
    status: 'active',
    actionable: true,
    requiredProfileFields: [],
    load: () =>
      import('./experiences/MiniGameExperience').then((module) => ({
        default: (props: EnergyExperienceProps) =>
          createElement(module.MiniGameExperience, {
            phase: props.phase,
            onPhaseChange: props.onPhaseChange,
            onComplete: () => props.onExperienceComplete('game'),
          }),
      })),
  },
];

export function activeEnergyExperiences(): EnergyExperienceRegistration[] {
  return ENERGY_EXPERIENCES.filter((experience) => {
    return (
      experience.status === 'active' &&
      experience.actionable &&
      experience.surface !== 'target-only'
    );
  });
}
