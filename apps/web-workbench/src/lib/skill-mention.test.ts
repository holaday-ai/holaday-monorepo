import { describe, expect, it } from 'vitest';
import {
  detectSkillMentionTrigger,
  filterMentionSkills,
  stripSkillMention,
} from './skill-mention';

const skills = [
  {
    id: 'douyin-live-ops',
    name: '抖音直播与运营',
    aliases: ['抖音', '直播', 'douyin'],
    enabled: true,
  },
  {
    id: 'resume-search-screening',
    name: '简历搜索筛选',
    aliases: ['招聘', '简历', 'boss'],
    enabled: true,
  },
  {
    id: 'contract-risk-review',
    name: '合同风险审查',
    aliases: ['合同', '法务'],
    enabled: false,
  },
] as const;

describe('skill mention helpers', () => {
  it('detects an active skill mention trigger and query', () => {
    expect(detectSkillMentionTrigger('帮我 @抖')).toEqual({
      start: 3,
      end: 5,
      query: '抖',
    });
  });

  it('ignores mentions that already ended with whitespace', () => {
    expect(detectSkillMentionTrigger('@抖音直播与运营 帮我复盘')).toBeNull();
  });

  it('filters enabled skills by name and aliases', () => {
    expect(filterMentionSkills(skills, '简历').map((skill) => skill.id)).toEqual([
      'resume-search-screening',
    ]);
    expect(filterMentionSkills(skills, '合同')).toEqual([]);
  });

  it('strips the selected leading skill mention before submit', () => {
    expect(stripSkillMention('@抖音直播与运营 帮我复盘', '抖音直播与运营')).toBe(
      '帮我复盘',
    );
    expect(stripSkillMention('帮我复盘', '抖音直播与运营')).toBe('帮我复盘');
  });
});
