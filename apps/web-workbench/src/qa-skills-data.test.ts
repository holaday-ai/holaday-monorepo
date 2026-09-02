import { HOLADAY_SKILLS } from '@holaday/shared-types';
import { describe, expect, it } from 'vitest';
import { QA_SKILLS } from './qa-skills-data';

describe('QA skill catalogue', () => {
  it('keeps the preview in sync with every production skill', () => {
    expect(QA_SKILLS.map((skill) => skill.id)).toEqual(
      HOLADAY_SKILLS.map((skill) => skill.id),
    );
  });
});
