import { describe, expect, it } from 'vitest';
import { TRPCError } from '@trpc/server';
import { __tasksInternals } from './tasks.js';

const { assertManualSkillSelectionEnabled } = __tasksInternals;

describe('tasks router manual skill selection', () => {
  it('accepts enabled catalogue skills selected from the composer', () => {
    expect(
      assertManualSkillSelectionEnabled(
        { skillId: 'douyin-live-ops', skillSource: 'manual' },
        ['douyin-live-ops'],
      ),
    ).toBe('douyin-live-ops');
  });

  it('accepts legacy enabled skill ids and returns the canonical catalogue id', () => {
    expect(
      assertManualSkillSelectionEnabled(
        { skillId: 'a-share-analyst', skillSource: 'manual' },
        ['a-share-analyst'],
      ),
    ).toBe('a-share-market-briefing');

    expect(
      assertManualSkillSelectionEnabled(
        { skillId: 'douyin', skillSource: 'manual' },
        ['douyin'],
      ),
    ).toBe('douyin-live-ops');
  });

  it('accepts canonical composer ids when the stored enabled id is legacy', () => {
    expect(
      assertManualSkillSelectionEnabled(
        { skillId: 'xiaohongshu-seeding-ops', skillSource: 'manual' },
        ['xiaohongshu'],
      ),
    ).toBe('xiaohongshu-seeding-ops');
  });

  it('rejects manual composer skills that are not enabled', () => {
    expect(() =>
      assertManualSkillSelectionEnabled(
        { skillId: 'douyin-live-ops', skillSource: 'manual' },
        ['xiaohongshu-seeding-ops'],
      ),
    ).toThrow(TRPCError);
  });

  it('rejects stale manual skill ids', () => {
    expect(() =>
      assertManualSkillSelectionEnabled(
        { skillId: 'missing-skill', skillSource: 'manual' },
        ['missing-skill'],
      ),
    ).toThrow(TRPCError);
  });

  it('keeps legacy unmarked skill ids compatible', () => {
    expect(
      assertManualSkillSelectionEnabled(
        { skillId: 'legacy-role-id', skillSource: undefined },
        [],
      ),
    ).toBeNull();
  });
});
