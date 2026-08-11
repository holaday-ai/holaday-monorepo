import type {
  EnergyExperienceDefinition,
  EnergyExperienceId,
  EnergyMood,
} from './energy-types';
import { ENERGY_EXPERIENCES } from './experience-registry';

export interface EnergyMoodResponse {
  title: string;
  body: string;
  action: string;
}

const RESPONSES = {
  good: {
    title: '把这股状态留给真正重要的一件事',
    body: '不用把今天塞满，选一件值得推进的小事就好。',
    action: '开始一个轻测试',
  },
  tired: {
    title: '先让自己松一点',
    body: '疲惫不是拖延。给身体半分钟，再决定下一步。',
    action: '抽一张轻提示卡',
  },
  stressed: {
    title: '你不用现在解决全部事情',
    body: '先把最吵的一件事放到旁边，留一个可以呼吸的空格。',
    action: '抽一张安定卡',
  },
  unwind: {
    title: '这几分钟只用来放空',
    body: '不需要产出，也不需要证明什么。玩一个轻体验就好。',
    action: '玩一个轻测试',
  },
} satisfies Record<EnergyMood, EnergyMoodResponse>;

const RECOMMENDATION_IDS = {
  good: 'light-test',
  tired: 'tarot',
  stressed: 'tarot',
  unwind: 'light-test',
} satisfies Record<EnergyMood, EnergyExperienceId>;

export function energyResponseForMood(mood: EnergyMood): EnergyMoodResponse {
  return { ...RESPONSES[mood] };
}

export function recommendExperience(mood: EnergyMood): EnergyExperienceDefinition {
  const recommendation = ENERGY_EXPERIENCES.find(
    (experience) => experience.id === RECOMMENDATION_IDS[mood],
  );
  if (!recommendation || !recommendation.actionable || recommendation.status !== 'active') {
    throw new Error(`Missing actionable energy recommendation for mood: ${mood}`);
  }
  return recommendation;
}
