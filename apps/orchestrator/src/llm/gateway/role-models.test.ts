import { describe, expect, it, vi } from 'vitest';
import { BUILTIN_MODEL_CATALOG } from '../model-catalog.js';
import { MODEL_ROLES } from './model-roles.js';
import { DEFAULT_ROLE_MODELS, defaultRoleModel, parseRoleModelOverrides } from './role-models.js';

/**
 * Today's effective model per role (built-in Qwen brain, model-runtime-wiring
 * withBrainQwenModels: a lane's model for every purpose, the vision model for `vision`).
 */
const TODAY = {
  brain: 'qwen3.8-max', // browser lane, vision purpose → laneModels.vision
  vision: 'qwen3.8-max', // verifier lane, vision purpose → laneModels.vision
  verifier: 'qwen3.8-max', // laneModels.verifier
  plan: 'qwen3.8-flash', // laneModels.plan (= plan-runner's former literal)
  judge: 'qwen3.8-flash', // plan lane
  generate: 'qwen3.7-plus', // laneModels.generate
  scrape: 'qwen3.7-plus', // laneModels.scrape
  suggestions: 'qwen3.8-flash', // laneModels.suggestions (= QWEN_FAST_MODEL default)
  video_edit_planner: 'qwen3.8-flash', // laneModels.video_edit_planner (= QWEN_FAST_MODEL default)
  search: 'qwen3.8-max', // browser lane, fast purpose → laneModels.browser
};

describe('role models', () => {
  it("defaults to today's effective Qwen model per role, in both regions", () => {
    expect(DEFAULT_ROLE_MODELS.cn).toEqual(TODAY);
    expect(DEFAULT_ROLE_MODELS.intl).toEqual(TODAY);
    expect(defaultRoleModel('plan')).toBe('qwen3.8-flash');
    const qwen = BUILTIN_MODEL_CATALOG.find((brain) => brain.id === 'qwen');
    expect(qwen?.laneModels.plan).toBe(TODAY.plan);
  });

  it('applies a valid override for one region and role only', () => {
    const warn = vi.fn();
    const table = parseRoleModelOverrides(
      JSON.stringify({ cn: { judge: 'qwen3.6-flash' }, intl: { generate: 'qwen3.8-max' } }),
      warn,
    );
    expect(table.cn.judge).toBe('qwen3.6-flash');
    expect(table.intl.judge).toBe(TODAY.judge);
    expect(table.intl.generate).toBe('qwen3.8-max');
    expect(table.cn.generate).toBe(TODAY.generate);
    expect(warn).not.toHaveBeenCalled();
    expect(DEFAULT_ROLE_MODELS.cn.judge).toBe(TODAY.judge);
  });

  it('ignores unknown regions, unknown roles and non-Qwen names with a warning', () => {
    const warn = vi.fn();
    const table = parseRoleModelOverrides(
      JSON.stringify({
        eu: { judge: 'qwen3.6-flash' },
        cn: { boss: 'qwen3.6-flash', judge: 'gpt-4o', plan: 42, verifier: 'qwen3.8-plus' },
        intl: 'qwen3.8-max',
      }),
      warn,
    );
    expect(table.cn).toEqual({ ...TODAY, verifier: 'qwen3.8-plus' });
    expect(table.intl).toEqual(TODAY);
    expect(warn).toHaveBeenCalledTimes(5);
  });

  it('falls back to the defaults on malformed JSON or a non-object', () => {
    for (const raw of ['{not json', '[]', '"cn"', 'null']) {
      const warn = vi.fn();
      expect(parseRoleModelOverrides(raw, warn)).toBe(DEFAULT_ROLE_MODELS);
      expect(warn).toHaveBeenCalledTimes(1);
    }
    expect(parseRoleModelOverrides('', vi.fn())).toBe(DEFAULT_ROLE_MODELS);
    expect(parseRoleModelOverrides(undefined, vi.fn())).toBe(DEFAULT_ROLE_MODELS);
  });

  it('covers every role', () => {
    expect(Object.keys(DEFAULT_ROLE_MODELS.cn).sort()).toEqual([...MODEL_ROLES].sort());
  });
});
