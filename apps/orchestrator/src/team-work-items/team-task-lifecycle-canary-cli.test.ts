import { describe, expect, it } from 'vitest';
import {
  lifecycleCanaryRootSupervisorPipeMetadataValid,
  resolveLifecycleCanaryCliConfiguration,
  resolveLifecycleCanarySealCliConfiguration,
} from './team-task-lifecycle-canary-cli.js';

const REVISION = '75f48853ea2f781c8f3dfde79f44fbdacbb9501c';

describe('team task lifecycle canary CLI configuration', () => {
  it('allows uid 998 to seal three restricted inputs into a same-directory manifest path', () => {
    expect(
      resolveLifecycleCanarySealCliConfiguration(
        [
          '/etc/holaday/team-task-lifecycle-trusted-signers.json',
          '/var/lib/holaday-canary/candidate.json',
          '/var/lib/holaday-canary/primary.json',
          '/var/lib/holaday-canary/secondary.json',
          '/var/lib/holaday-canary/manifest.json',
        ],
        998,
      ),
    ).toEqual({
      trustedSignersPath: '/etc/holaday/team-task-lifecycle-trusted-signers.json',
      candidatePath: '/var/lib/holaday-canary/candidate.json',
      primaryAttestationPath: '/var/lib/holaday-canary/primary.json',
      secondaryAttestationPath: '/var/lib/holaday-canary/secondary.json',
      manifestPath: '/var/lib/holaday-canary/manifest.json',
    });
    expect(() =>
      resolveLifecycleCanarySealCliConfiguration(
        [
          '/etc/holaday/team-task-lifecycle-trusted-signers.json',
          '/var/lib/holaday-canary/candidate.json',
          '/var/lib/holaday-canary/primary.json',
          '/tmp/secondary.json',
          '/var/lib/holaday-canary/manifest.json',
        ],
        998,
      ),
    ).toThrow('restricted directory');
  });

  it('accepts only uid 998 with absolute manifest and receipt paths in the same directory', () => {
    expect(
      resolveLifecycleCanaryCliConfiguration(
        ['run'],
        {
          TEAM_TASK_LIFECYCLE_CANARY_MANIFEST_FILE: '/var/lib/holaday-canary/manifest.json',
          TEAM_TASK_LIFECYCLE_QA_RECEIPT_FILE: '/var/lib/holaday-canary/receipt.json',
          TEAM_TASK_LIFECYCLE_TRUSTED_SIGNERS_FILE:
            '/etc/holaday/team-task-lifecycle-trusted-signers.json',
          TEAM_TASK_LIFECYCLE_EXPECTED_REVISION: REVISION,
        },
        998,
      ),
    ).toEqual({
      mode: 'run',
      manifestPath: '/var/lib/holaday-canary/manifest.json',
      receiptPath: '/var/lib/holaday-canary/receipt.json',
      trustedSignersPath: '/etc/holaday/team-task-lifecycle-trusted-signers.json',
      expectedRevision: REVISION,
    });
  });

  it('accepts only an unlinked root-created FIFO supervisor capability', () => {
    const valid = {
      channel: {
        uid: 0,
        nlink: 0,
        isFile: false,
        isFIFO: true,
        isSymbolicLink: false,
      },
    };
    expect(lifecycleCanaryRootSupervisorPipeMetadataValid(valid)).toBe(true);
    expect(
      lifecycleCanaryRootSupervisorPipeMetadataValid({
        ...valid,
        channel: { ...valid.channel, uid: 998 },
      }),
    ).toBe(false);
    expect(
      lifecycleCanaryRootSupervisorPipeMetadataValid({
        ...valid,
        channel: { ...valid.channel, isFIFO: false, isFile: true },
      }),
    ).toBe(false);
    expect(
      lifecycleCanaryRootSupervisorPipeMetadataValid({
        ...valid,
        channel: { ...valid.channel, nlink: 1 },
      }),
    ).toBe(false);
  });

  it.each([
    ['root execution', ['run'], 0, '/var/lib/holaday-canary/receipt.json'],
    ['unknown mode', ['enable'], 998, '/var/lib/holaday-canary/receipt.json'],
    ['relative receipt', ['run'], 998, 'receipt.json'],
    ['different directory', ['prepare'], 998, '/tmp/receipt.json'],
  ] as const)('fails closed for %s', (_label, argv, uid, receiptPath) => {
    expect(() =>
      resolveLifecycleCanaryCliConfiguration(
        [...argv],
        {
          TEAM_TASK_LIFECYCLE_CANARY_MANIFEST_FILE: '/var/lib/holaday-canary/manifest.json',
          TEAM_TASK_LIFECYCLE_QA_RECEIPT_FILE: receiptPath,
          TEAM_TASK_LIFECYCLE_TRUSTED_SIGNERS_FILE:
            '/etc/holaday/team-task-lifecycle-trusted-signers.json',
          TEAM_TASK_LIFECYCLE_EXPECTED_REVISION: REVISION,
        },
        uid,
      ),
    ).toThrow();
  });
});
