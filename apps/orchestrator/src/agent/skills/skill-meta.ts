import { HOLADAY_SKILLS, skillById, type HoladaySkill } from '@holaday/shared-types';

export type SkillMeta = HoladaySkill;
export type SkillCategory = HoladaySkill['category'];

export const SKILL_META: readonly SkillMeta[] = HOLADAY_SKILLS;

export function skillMetaByName(name: string): SkillMeta | undefined {
  return SKILL_META.find((skill) => skill.name === name);
}

export function skillMetaById(id: string): SkillMeta | undefined {
  return skillById(id);
}
