import { describe, expect, it } from 'vitest';
import { TRPCError } from '@trpc/server';
import { __tasksInternals } from './tasks.js';

const {
  assertManualSkillSelectionEnabled,
  buildPlannerIntent,
  buildPlannerSkillCatalogue,
  resolveTaskDispatchSkillId,
  resolveTaskSkillContext,
} = __tasksInternals as typeof __tasksInternals & {
  buildPlannerIntent?: (intent: string, taskSkillId: string | undefined) => string;
  buildPlannerSkillCatalogue?: (rows: Array<{
    slug: string;
    description: string | null;
    occupationTag: string | null;
    manifest: unknown;
  }>) => Array<{ slug: string; description: string; allowedOrigins?: readonly string[] }>;
};

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

  it('keeps the planner catalogue aligned with every user-visible shared skill', () => {
    expect(typeof buildPlannerSkillCatalogue).toBe('function');
    const catalogue = buildPlannerSkillCatalogue!([
      {
        slug: 'douyin-comment-manager',
        description: 'Manage Douyin comments from the legacy DB skill table',
        occupationTag: 'content-ops',
        manifest: { allowedOrigins: ['*.douyin.com'] },
      },
    ]);

    expect(catalogue.map((skill) => skill.slug)).toEqual(
      expect.arrayContaining([
        'douyin-comment-manager',
        'douyin-live-ops',
        'xiaohongshu-seeding-ops',
        'a-share-market-briefing',
        'resume-search-screening',
      ]),
    );
    expect(catalogue.find((skill) => skill.slug === 'douyin-comment-manager')?.allowedOrigins).toEqual([
      '*.douyin.com',
    ]);
    expect(catalogue.find((skill) => skill.slug === 'douyin-live-ops')?.description).toBe(
      '直播复盘、短视频选题、脚本与账号运营',
    );
  });

  it('passes an explicit user-selected skill hint into the planner intent', () => {
    expect(typeof buildPlannerIntent).toBe('function');
    const intent = buildPlannerIntent!('帮我做直播复盘', 'douyin-live-ops');

    expect(intent).toContain('【用户选择的技能】抖音直播与运营（douyin-live-ops）');
    expect(intent).toContain('直播复盘、短视频选题、脚本与账号运营');
    expect(intent.endsWith('帮我做直播复盘')).toBe(true);
    expect(buildPlannerIntent!('帮我做直播复盘', undefined)).toBe('帮我做直播复盘');
    expect(buildPlannerIntent!('帮我做直播复盘', 'legacy-role-id')).toBe('帮我做直播复盘');
  });
});
