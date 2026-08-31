import { type KeyObject, generateKeyPairSync, sign, verify } from 'node:crypto';
import { chmod, mkdtemp, readFile, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  LIFECYCLE_CANARY_SCENARIOS,
  type LifecycleCanaryManifest,
  type LifecycleCanaryOperatorAttestation,
  type LifecycleCanaryTrustedSigners,
  createLifecycleCanaryUnsignedAttestation,
  lifecycleCanaryAttestationSigningPayload,
  lifecycleCanaryBoundaryDigest,
  lifecycleCanaryBoundaryDigestForScopes,
  loadLifecycleCanaryManifest,
  parseLifecycleCanaryManifest,
  runLifecycleCanary,
  sealLifecycleCanaryCandidate,
  sealLifecycleCanaryCandidateFiles,
  summarizeLifecycleCanaryRun,
  validateLifecycleCanaryRuntime,
} from './team-task-lifecycle-canary-runner.js';

const PRIMARY_KEYS = generateKeyPairSync('ed25519');
const SECONDARY_KEYS = generateKeyPairSync('ed25519');
const TRUSTED_SIGNERS: LifecycleCanaryTrustedSigners = {
  schemaVersion: 1,
  source: 'holaday-team-task-lifecycle-trusted-signers-v1',
  signers: [
    {
      operatorSlot: 'primary',
      operatorPrincipal: 'ops:primary-human',
      publicKeyPem: PRIMARY_KEYS.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    },
    {
      operatorSlot: 'secondary',
      operatorPrincipal: 'ops:secondary-human',
      publicKeyPem: SECONDARY_KEYS.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    },
  ],
};

const REVISION = '75f48853ea2f781c8f3dfde79f44fbdacbb9501c';
const RECEIPT_SCENARIOS = [
  'directLifecycle',
  'firstComeRace',
  'validRevision',
  'vagueRevisionRejected',
  'revisionLimit',
  'appeal',
  'independentArbitration',
  'crossTenantHidden',
  'inactiveRejected',
  'idempotentRetry',
  'aiCannotAccept',
  'onTimeIndependent',
  'phaseOneRegression',
] as const;
const tempDirectories: string[] = [];

function externalId(prefix: string, fill: string): string {
  return `${prefix}_${fill.repeat(21).slice(0, 21)}`;
}

function signedAttestation(input: {
  slot: 'primary' | 'secondary';
  boundaryDigest: string;
  confirmedAt: string;
  privateKey: KeyObject;
}): LifecycleCanaryOperatorAttestation {
  const unsigned = {
    schemaVersion: 1 as const,
    source: 'holaday-team-task-lifecycle-operator-attestation-v1' as const,
    operatorSlot: input.slot,
    operatorPrincipal: input.slot === 'primary' ? 'ops:primary-human' : 'ops:secondary-human',
    boundaryDigest: input.boundaryDigest,
    confirmedAt: input.confirmedAt,
    confirmedSyntheticBoundary: true as const,
  };
  return {
    ...unsigned,
    signature: sign(
      null,
      lifecycleCanaryAttestationSigningPayload(unsigned),
      input.privateKey,
    ).toString('base64'),
  };
}

function manifest(): LifecycleCanaryManifest {
  const users = {
    creatorApprover: externalId('usr', 'A'),
    claimantA: externalId('usr', 'B'),
    claimantB: externalId('usr', 'C'),
    arbitrator: externalId('usr', 'D'),
  } as const;
  const scope = (suffix: string) => ({
    organizationId: externalId('org', suffix),
    projectId: externalId('prj', suffix),
    actors: {
      creatorApprover: {
        userId: users.creatorApprover,
        organizationMemberId: externalId('omem', `${suffix}A`),
        projectMemberId: externalId('pmem', `${suffix}A`),
      },
      claimantA: {
        userId: users.claimantA,
        organizationMemberId: externalId('omem', `${suffix}B`),
        projectMemberId: externalId('pmem', `${suffix}B`),
      },
      claimantB: {
        userId: users.claimantB,
        organizationMemberId: externalId('omem', `${suffix}C`),
        projectMemberId: externalId('pmem', `${suffix}C`),
      },
      arbitrator: {
        userId: users.arbitrator,
        organizationMemberId: externalId('omem', `${suffix}D`),
        projectMemberId: externalId('pmem', `${suffix}D`),
      },
    },
  });
  const scopes: LifecycleCanaryManifest['scopes'] = [scope('E'), scope('F')];
  const boundaryDigest = lifecycleCanaryBoundaryDigestForScopes(scopes);
  return {
    schemaVersion: 1,
    source: 'holaday-team-task-lifecycle-canary-manifest-v1',
    confirmation: {
      source: 'holaday-team-task-lifecycle-dual-operator-confirmation-v1',
      boundaryDigest,
      primaryAttestation: signedAttestation({
        slot: 'primary',
        boundaryDigest,
        confirmedAt: '2026-08-31T05:00:00.000Z',
        privateKey: PRIMARY_KEYS.privateKey,
      }),
      secondaryAttestation: signedAttestation({
        slot: 'secondary',
        boundaryDigest,
        confirmedAt: '2026-08-31T05:05:00.000Z',
        privateKey: SECONDARY_KEYS.privateKey,
      }),
      distinctHumanOperatorsConfirmed: true,
    },
    scopes,
  };
}

function attestedManifest(): unknown {
  return manifest();
}

async function tempDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'team-task-canary-'));
  tempDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  const { rm } = await import('node:fs/promises');
  await Promise.all(
    tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

describe('team task lifecycle production canary runner', () => {
  it('builds the canonical digest-bound payload without handling a private key', () => {
    const current = manifest();
    const candidate = {
      schemaVersion: 1,
      source: 'holaday-team-task-lifecycle-canary-candidate-v1',
      scopes: current.scopes,
    } as const;
    const unsigned = createLifecycleCanaryUnsignedAttestation({
      candidate,
      operatorSlot: 'primary',
      operatorPrincipal: 'ops:primary-human',
      confirmedAt: '2026-08-31T05:00:00.000Z',
    });
    const payload = lifecycleCanaryAttestationSigningPayload(unsigned);
    const signature = sign(null, payload, PRIMARY_KEYS.privateKey);

    expect(unsigned.boundaryDigest).toBe(lifecycleCanaryBoundaryDigestForScopes(current.scopes));
    expect(verify(null, payload, PRIMARY_KEYS.publicKey, signature)).toBe(true);
    expect(payload.toString('utf8')).not.toContain('privateKey');
  });

  it('seals a candidate only from two role-distinct attestations bound to the same digest', () => {
    const current = manifest();
    const candidate = {
      schemaVersion: 1,
      source: 'holaday-team-task-lifecycle-canary-candidate-v1',
      scopes: current.scopes,
    } as const;
    const primary = current.confirmation.primaryAttestation;
    const secondary = current.confirmation.secondaryAttestation;

    expect(sealLifecycleCanaryCandidate(candidate, primary, secondary, TRUSTED_SIGNERS)).toEqual(
      current,
    );
    expect(() =>
      sealLifecycleCanaryCandidate(candidate, primary, primary, TRUSTED_SIGNERS),
    ).toThrow('distinct operator slots');
    expect(() =>
      sealLifecycleCanaryCandidate(
        candidate,
        primary,
        {
          ...secondary,
          boundaryDigest: '0'.repeat(64),
        },
        TRUSTED_SIGNERS,
      ),
    ).toThrow('attestation boundary');
    expect(() =>
      sealLifecycleCanaryCandidate(
        candidate,
        primary,
        { ...secondary, signature: primary.signature },
        TRUSTED_SIGNERS,
      ),
    ).toThrow('signature verification');
  });

  it('writes a final owner-only manifest only from three owner-only files in one directory', async () => {
    const directory = await tempDirectory();
    const current = manifest();
    const candidatePath = join(directory, 'candidate.json');
    const primaryPath = join(directory, 'primary.json');
    const secondaryPath = join(directory, 'secondary.json');
    const manifestPath = join(directory, 'manifest.json');
    const trustedSignersPath = join(directory, 'trusted-signers.json');
    const candidate = {
      schemaVersion: 1,
      source: 'holaday-team-task-lifecycle-canary-candidate-v1',
      scopes: current.scopes,
    };
    const primary = current.confirmation.primaryAttestation;
    const secondary = current.confirmation.secondaryAttestation;
    await Promise.all([
      writeFile(candidatePath, JSON.stringify(candidate), { mode: 0o600 }),
      writeFile(primaryPath, JSON.stringify(primary), { mode: 0o600 }),
      writeFile(secondaryPath, JSON.stringify(secondary), { mode: 0o600 }),
      writeFile(trustedSignersPath, JSON.stringify(TRUSTED_SIGNERS), { mode: 0o600 }),
    ]);

    await expect(
      sealLifecycleCanaryCandidateFiles({
        candidatePath,
        primaryAttestationPath: primaryPath,
        secondaryAttestationPath: secondaryPath,
        manifestPath,
        trustedSignersPath,
      }),
    ).resolves.toEqual(current);
    expect((await stat(manifestPath)).mode & 0o777).toBe(0o600);

    await chmod(secondaryPath, 0o640);
    await expect(
      sealLifecycleCanaryCandidateFiles({
        candidatePath,
        primaryAttestationPath: primaryPath,
        secondaryAttestationPath: secondaryPath,
        manifestPath: join(directory, 'unsafe-manifest.json'),
        trustedSignersPath,
      }),
    ).rejects.toThrow('owner-only');

    await chmod(secondaryPath, 0o600);
    await chmod(directory, 0o770);
    await expect(
      sealLifecycleCanaryCandidateFiles({
        candidatePath,
        primaryAttestationPath: primaryPath,
        secondaryAttestationPath: secondaryPath,
        manifestPath: join(directory, 'shared-directory-manifest.json'),
        trustedSignersPath,
      }),
    ).rejects.toThrow('restricted directory');
  });

  it('requires a dual-operator attestation bound to the exact 4 x 2 boundary digest', () => {
    expect(parseLifecycleCanaryManifest(attestedManifest())).toEqual(attestedManifest());

    const mismatched = attestedManifest() as {
      confirmation: { boundaryDigest: string };
    };
    mismatched.confirmation.boundaryDigest = '0'.repeat(64);
    expect(() => parseLifecycleCanaryManifest(mismatched)).toThrow('confirmation boundary');

    const remapped = attestedManifest() as LifecycleCanaryManifest;
    remapped.scopes[0].actors.claimantA.projectMemberId = externalId('pmem', 'Z');
    expect(() => parseLifecycleCanaryManifest(remapped)).toThrow('confirmation boundary');
  });

  it('loads only an owner-only 4-user by 2-organization synthetic manifest', async () => {
    const directory = await tempDirectory();
    const path = join(directory, 'manifest.json');
    const trustedSignersPath = join(directory, 'trusted-signers.json');
    await writeFile(path, JSON.stringify(manifest()), { mode: 0o600 });
    await writeFile(trustedSignersPath, JSON.stringify(TRUSTED_SIGNERS), { mode: 0o600 });

    await expect(loadLifecycleCanaryManifest(path, trustedSignersPath)).resolves.toEqual(
      manifest(),
    );

    const unsafe = manifest();
    unsafe.scopes[1].actors.claimantB.userId = unsafe.scopes[1].actors.claimantA.userId;
    await writeFile(path, JSON.stringify(unsafe), { mode: 0o600 });
    await expect(loadLifecycleCanaryManifest(path, trustedSignersPath)).rejects.toThrow(
      'four shared synthetic users',
    );

    const roleSwapped = manifest();
    const claimantA = roleSwapped.scopes[1].actors.claimantA.userId;
    roleSwapped.scopes[1].actors.claimantA.userId = roleSwapped.scopes[1].actors.claimantB.userId;
    roleSwapped.scopes[1].actors.claimantB.userId = claimantA;
    await writeFile(path, JSON.stringify(roleSwapped), { mode: 0o600 });
    await expect(loadLifecycleCanaryManifest(path, trustedSignersPath)).rejects.toThrow(
      'same synthetic user for each fixed role',
    );

    await writeFile(path, JSON.stringify(manifest()), { mode: 0o640 });
    await chmod(path, 0o640);
    await expect(loadLifecycleCanaryManifest(path, trustedSignersPath)).rejects.toThrow(
      'owner-only',
    );

    await chmod(path, 0o600);
    const linkPath = join(directory, 'manifest-link.json');
    await symlink(path, linkPath);
    await expect(loadLifecycleCanaryManifest(linkPath, trustedSignersPath)).rejects.toThrow(
      'regular file',
    );
  });

  it('prepares a restricted smoke receipt without claiming any lifecycle scenario', async () => {
    const directory = await tempDirectory();
    const receiptPath = join(directory, 'receipt.json');
    const result = await runLifecycleCanary({
      mode: 'prepare',
      manifest: manifest(),
      expectedRevision: REVISION,
      currentRevision: async () => REVISION,
      receiptPath,
      now: () => new Date('2026-08-31T04:00:00.000Z'),
      validateBoundary: async () => true,
      smoke: async () => ({ personalProjects: true, teamProjects: true, filePath: true }),
      executeScenario: async () => {
        throw new Error('prepare must not execute lifecycle scenarios');
      },
    });

    expect(result).toEqual({ mode: 'prepare', passed: true, scenarioChecksPassed: 0 });
    expect((await stat(receiptPath)).mode & 0o777).toBe(0o600);
    expect(JSON.parse(await readFile(receiptPath, 'utf8'))).toEqual({
      schemaVersion: 1,
      source: 'holaday-team-task-lifecycle-qa-v1',
      receiptKind: 'prepare',
      revision: REVISION,
      boundaryDigest: lifecycleCanaryBoundaryDigest(manifest()),
      completedAt: '2026-08-31T04:00:00.000Z',
      phaseOne: {
        disabled: { personalProjects: true, teamProjects: true, filePath: true },
        enabled: null,
      },
      checks: Object.fromEntries(RECEIPT_SCENARIOS.map((name) => [name, false])),
    });
    expect(LIFECYCLE_CANARY_SCENARIOS).toEqual(RECEIPT_SCENARIOS);
  });

  it('invalidates a stale receipt before running and writes a new one only after all 13 pass', async () => {
    const directory = await tempDirectory();
    const receiptPath = join(directory, 'receipt.json');
    const prepare = async (completedAt: string) =>
      runLifecycleCanary({
        mode: 'prepare',
        manifest: manifest(),
        expectedRevision: REVISION,
        currentRevision: async () => REVISION,
        receiptPath,
        now: () => new Date(completedAt),
        validateBoundary: async () => true,
        smoke: async () => ({ personalProjects: true, teamProjects: true, filePath: true }),
        executeScenario: async () => false,
      });
    await prepare('2026-08-31T04:00:00.000Z');
    const observed: string[] = [];

    const failed = await runLifecycleCanary({
      mode: 'run',
      manifest: manifest(),
      expectedRevision: REVISION,
      currentRevision: async () => REVISION,
      receiptPath,
      now: () => new Date('2026-08-31T04:05:00.000Z'),
      validateBoundary: async () => true,
      smoke: async () => ({ personalProjects: true, teamProjects: true, filePath: true }),
      executeScenario: async (scenario) => {
        observed.push(scenario);
        return scenario !== 'independentArbitration';
      },
    });

    expect(failed).toEqual({ mode: 'run', passed: false, scenarioChecksPassed: 6 });
    expect(observed).toEqual(LIFECYCLE_CANARY_SCENARIOS.slice(0, 7));
    await expect(readFile(receiptPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });

    observed.length = 0;
    await prepare('2026-08-31T04:06:00.000Z');
    const passed = await runLifecycleCanary({
      mode: 'run',
      manifest: manifest(),
      expectedRevision: REVISION,
      currentRevision: async () => REVISION,
      receiptPath,
      now: () => new Date('2026-08-31T04:10:00.000Z'),
      validateBoundary: async () => true,
      smoke: async () => ({ personalProjects: true, teamProjects: true, filePath: true }),
      executeScenario: async (scenario) => {
        observed.push(scenario);
        return true;
      },
    });

    expect(passed).toEqual({ mode: 'run', passed: true, scenarioChecksPassed: 13 });
    expect(observed).toEqual(LIFECYCLE_CANARY_SCENARIOS);
    const receipt = JSON.parse(await readFile(receiptPath, 'utf8')) as {
      checks: unknown;
      phaseOne: unknown;
      receiptKind: string;
    };
    expect(receipt.receiptKind).toBe('run');
    expect(receipt.phaseOne).toEqual({
      disabled: { personalProjects: true, teamProjects: true, filePath: true },
      enabled: { personalProjects: true, teamProjects: true, filePath: true },
    });
    expect(receipt.checks).toEqual(
      Object.fromEntries(LIFECYCLE_CANARY_SCENARIOS.map((name) => [name, true])),
    );
  });

  it('fails closed on revision or smoke drift and exposes only fixed counts and booleans', async () => {
    const directory = await tempDirectory();
    const receiptPath = join(directory, 'receipt.json');
    await writeFile(receiptPath, '{"stale":"13/13"}', { mode: 0o600 });
    await expect(
      runLifecycleCanary({
        mode: 'run',
        manifest: manifest(),
        expectedRevision: REVISION,
        currentRevision: async () => '0000000000000000000000000000000000000000',
        receiptPath,
        validateBoundary: async () => true,
        smoke: async () => ({ personalProjects: true, teamProjects: true, filePath: true }),
        executeScenario: async () => true,
      }),
    ).rejects.toThrow('revision mismatch');
    await expect(readFile(receiptPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });

    const summary = summarizeLifecycleCanaryRun({
      mode: 'run',
      passed: false,
      scenarioChecksPassed: 5,
    });
    expect(summary).toBe(
      'TEAM_TASK_LIFECYCLE_CANARY mode=run passed=false syntheticUsers=4 syntheticOrganizations=2 scenarioChecks=5/13',
    );
    expect(summary).not.toMatch(/usr_|org_|prj_|omem_|pmem_/);
  });

  it('requires exact four-user feature allowlists and the expected lifecycle switch state', () => {
    const users = Object.values(manifest().scopes[0].actors).map((actor) => actor.userId);
    const ready = {
      TEAM_PROJECTS_ENABLED: 'true',
      TEAM_PROJECTS_ALLOWLIST: users.join(','),
      TEAM_TASK_LIFECYCLE_ENABLED: 'false',
      TEAM_TASK_LIFECYCLE_ALLOWLIST: users.join(','),
    };
    expect(validateLifecycleCanaryRuntime('prepare', ready, manifest())).toBe(true);
    expect(
      validateLifecycleCanaryRuntime(
        'run',
        { ...ready, TEAM_TASK_LIFECYCLE_ENABLED: 'true' },
        manifest(),
      ),
    ).toBe(true);
    expect(
      validateLifecycleCanaryRuntime(
        'prepare',
        {
          ...ready,
          TEAM_TASK_LIFECYCLE_ALLOWLIST: users.slice(0, 2).join(','),
        },
        manifest(),
      ),
    ).toBe(false);
    expect(
      validateLifecycleCanaryRuntime(
        'run',
        {
          ...ready,
          TEAM_TASK_LIFECYCLE_ENABLED: 'true',
          TEAM_PROJECTS_ALLOWLIST: `${users.join(',')},usr_extra`,
        },
        manifest(),
      ),
    ).toBe(false);
  });
});
