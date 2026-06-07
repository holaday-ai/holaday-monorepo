import { describe, expect, it } from 'vitest';
import { __skillsInternals } from './skills.js';

const { normalizeSelectedSkillIds, skillCapForPlan, skillLimitErrorMessage } = __skillsInternals;

describe('skills router plan limits', () => {
  it('uses the shared plan role limits for expert skills', () => {
    expect(skillCapForPlan('free')).toBe(0);
    expect(skillCapForPlan('basic')).toBe(5);
    expect(skillCapForPlan('pro')).toBe(33);
    expect(skillCapForPlan('unknown')).toBe(0);
  });

  it('keeps server-side limit errors actionable', () => {
    expect(skillLimitErrorMessage('free', 0)).toBe('当前套餐暂不支持启用专家技能');
    expect(skillLimitErrorMessage('basic', 5)).toBe(
      '基础版最多可启用 5 个专家技能，请先停用一个技能后再启用新的技能',
    );
    expect(skillLimitErrorMessage('pro', 33)).toBe(
      '专业版最多可启用 33 个专家技能，请先停用一个技能后再启用新的技能',
    );
  });

  it('drops stale selected skill ids before counting plan limits', () => {
    expect(
      normalizeSelectedSkillIds(['content-creator', 'missing-skill', 'content-creator']),
    ).toEqual(['content-creator']);
    expect(normalizeSelectedSkillIds(null)).toEqual([]);
  });
});
