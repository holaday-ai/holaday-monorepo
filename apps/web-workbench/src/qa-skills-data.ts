import type { UiSkill } from '@/types/task';
import { HOLADAY_SKILLS } from '@holaday/shared-types';

const DEFAULT_COMMON_SKILL_IDS = new Set([
  'market-competitor-insight',
  'data-report-insight',
]);

export const QA_SKILLS: UiSkill[] = HOLADAY_SKILLS.map((skill) => ({
  ...skill,
  enabled: DEFAULT_COMMON_SKILL_IDS.has(skill.id),
}));
