import { describe, expect, it } from 'vitest';
import {
  assertProductionModelRuntimePolicy,
  parseCoreModelLaneCsv,
  resolveCoreModelLaneAccess,
  resolveUnmigratedModelLane,
} from './model-runtime-policy.js';

describe('Qwen-only model runtime policy', () => {
  it('rejects the legacy fixture policy in production', () => {
    expect(() => assertProductionModelRuntimePolicy('production', 'legacy_fixture')).toThrow(
      'MODEL_RUNTIME_POLICY must be qwen_only in production',
    );
  });

  it('permits the legacy fixture policy outside production', () => {
    expect(() => assertProductionModelRuntimePolicy('test', 'legacy_fixture')).not.toThrow();
  });

  it('requires an exact allowlist match in synthetic mode', () => {
    expect(
      resolveCoreModelLaneAccess({
        mode: 'synthetic',
        enabledLanes: 'generate,scrape',
        allowlist: 'usr_alpha,usr_beta',
        actorExternalId: 'usr_al',
        lane: 'generate',
      }),
    ).toEqual({ kind: 'unavailable', reason: 'ROLLOUT_NOT_ALLOWED' });
  });

  it('enables an allowlisted actor only for an enabled lane', () => {
    expect(
      resolveCoreModelLaneAccess({
        mode: 'internal',
        enabledLanes: 'generate, scrape',
        allowlist: 'usr_alpha, usr_beta',
        actorExternalId: 'usr_beta',
        lane: 'scrape',
      }),
    ).toEqual({ kind: 'enabled' });
  });

  it('keeps an empty allowlist closed outside all mode', () => {
    expect(
      resolveCoreModelLaneAccess({
        mode: 'synthetic',
        enabledLanes: 'generate',
        allowlist: '',
        actorExternalId: 'usr_alpha',
        lane: 'generate',
      }),
    ).toEqual({ kind: 'unavailable', reason: 'ROLLOUT_NOT_ALLOWED' });
  });

  it('enables any actor in all mode when the lane is enabled', () => {
    expect(
      resolveCoreModelLaneAccess({
        mode: 'all',
        enabledLanes: 'generate',
        allowlist: '',
        actorExternalId: 'usr_alpha',
        lane: 'generate',
      }),
    ).toEqual({ kind: 'enabled' });
  });

  it.each([
    { mode: 'off' as const, enabledLanes: 'generate' },
    { mode: 'all' as const, enabledLanes: 'scrape' },
  ])('returns LANE_DISABLED when the rollout or lane is disabled', (input) => {
    expect(
      resolveCoreModelLaneAccess({
        ...input,
        allowlist: 'usr_alpha',
        actorExternalId: 'usr_alpha',
        lane: 'generate',
      }),
    ).toEqual({ kind: 'unavailable', reason: 'LANE_DISABLED' });
  });

  it('rejects unknown enabled-lane tokens', () => {
    expect(() => parseCoreModelLaneCsv('generate,unknown_lane')).toThrow(
      'Unknown QWEN_CORE_ENABLED_LANES value: unknown_lane',
    );
  });

  it('marks media and browser lanes outside subproject A as migration unavailable', () => {
    expect(resolveUnmigratedModelLane('browser')).toEqual({
      kind: 'unavailable',
      reason: 'MIGRATION_IN_PROGRESS',
    });
    expect(resolveUnmigratedModelLane('video_generation')).toEqual({
      kind: 'unavailable',
      reason: 'MIGRATION_IN_PROGRESS',
    });
  });
});
