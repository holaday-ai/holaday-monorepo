import { describe, expect, it } from 'vitest';
import { TRPCError } from '@trpc/server';
import { __tasksInternals } from './tasks.js';

const {
  assertManualSkillSelectionEnabled,
  resolveTaskDispatchSkillId,
  resolveTaskSkillContext,
} = __tasksInternals;

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

  it('normalizes the skill id used by task creation after manual validation', () => {
    expect(
      resolveTaskSkillContext(
        { skillId: 'douyin', skillSource: 'manual' },
        ['douyin'],
      ),
    ).toBe('douyin-live-ops');
    expect(
      resolveTaskSkillContext(
        { roleId: 'xiaohongshu', skillSource: 'manual' },
        ['xiaohongshu'],
      ),
    ).toBe('xiaohongshu-seeding-ops');
  });

  it('canonicalizes known legacy skill ids without breaking old role ids', () => {
    expect(resolveTaskSkillContext({ roleId: 'a-share-analyst' }, [])).toBe(
      'a-share-market-briefing',
    );
    expect(resolveTaskSkillContext({ roleId: 'legacy-role-id' }, [])).toBe(
      'legacy-role-id',
    );
  });

  it('lets explicit skill context win over automatic role classification', () => {
    expect(resolveTaskDispatchSkillId('a-share-market-briefing', 'tech-translator')).toBe(
      'a-share-market-briefing',
    );
    expect(resolveTaskDispatchSkillId(undefined, 'xiaohongshu-expert')).toBe(
      'xiaohongshu-expert',
    );
    expect(resolveTaskDispatchSkillId(undefined, 'none')).toBeUndefined();
  });
});
