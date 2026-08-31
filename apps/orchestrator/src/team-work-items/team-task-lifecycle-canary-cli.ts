import { closeSync, fstatSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import {
  type LifecycleCanaryManifest,
  type LifecycleCanaryMode,
  type LifecycleCanaryScenario,
  type LifecycleCanarySmokeResult,
  consumeLifecycleCanaryReceipt,
  loadLifecycleCanaryManifest,
  runLifecycleCanary,
  summarizeLifecycleCanaryRun,
  validateLifecycleCanaryRuntime,
} from './team-task-lifecycle-canary-runner.js';

export interface LifecycleCanaryCliConfiguration {
  mode: LifecycleCanaryMode;
  manifestPath: string;
  receiptPath: string;
  trustedSignersPath: string;
  expectedRevision: string;
}

const ROOT_SUPERVISOR_MARKER = 'holaday-team-task-lifecycle-root-supervisor-v1\n';

export function lifecycleCanaryRootSupervisorPipeMetadataValid(input: {
  channel: {
    uid: number;
    nlink: number;
    isFile: boolean;
    isFIFO: boolean;
    isSymbolicLink: boolean;
  };
}): boolean {
  return (
    input.channel.isFIFO &&
    !input.channel.isFile &&
    !input.channel.isSymbolicLink &&
    input.channel.uid === 0 &&
    input.channel.nlink === 0
  );
}

export function consumeLifecycleCanaryRootSupervisorStdin(fd = 0): unknown {
  try {
    const channel = fstatSync(fd);
    if (
      !lifecycleCanaryRootSupervisorPipeMetadataValid({
        channel: {
          uid: channel.uid,
          nlink: channel.nlink,
          isFile: channel.isFile(),
          isFIFO: channel.isFIFO(),
          isSymbolicLink: channel.isSymbolicLink(),
        },
      })
    ) {
      throw new Error('invalid root supervisor token');
    }
    const contents = readFileSync(fd, 'utf8');
    if (
      !contents.startsWith(ROOT_SUPERVISOR_MARKER) ||
      Buffer.byteLength(contents) < Buffer.byteLength(ROOT_SUPERVISOR_MARKER) + 2 ||
      Buffer.byteLength(contents) > Buffer.byteLength(ROOT_SUPERVISOR_MARKER) + 32 * 1024
    ) {
      throw new Error('invalid root supervisor token');
    }
    return JSON.parse(contents.slice(ROOT_SUPERVISOR_MARKER.length)) as unknown;
  } finally {
    closeSync(fd);
  }
}

export interface LifecycleCanarySealCliConfiguration {
  trustedSignersPath: string;
  candidatePath: string;
  primaryAttestationPath: string;
  secondaryAttestationPath: string;
  manifestPath: string;
}

export interface LifecycleCanaryCliAdapter {
  validateBoundary(manifest: LifecycleCanaryManifest): Promise<boolean>;
  smoke(manifest: LifecycleCanaryManifest): Promise<LifecycleCanarySmokeResult>;
  executeScenario(
    scenario: LifecycleCanaryScenario,
    manifest: LifecycleCanaryManifest,
  ): Promise<boolean>;
}

function requiredEnvironmentPath(environment: Record<string, unknown>, key: string): string {
  const value = environment[key];
  if (typeof value !== 'string' || value.length === 0 || !isAbsolute(value)) {
    throw new Error(`invalid ${key}`);
  }
  return resolve(value);
}

export function resolveLifecycleCanarySealCliConfiguration(
  argv: string[],
  uid: number | undefined,
): LifecycleCanarySealCliConfiguration {
  if (uid !== 998) throw new Error('canary sealing CLI must run as the dedicated runtime user');
  if (argv.length !== 5 || argv.some((path) => !isAbsolute(path))) {
    throw new Error('canary sealing CLI requires five absolute paths');
  }
  const [
    trustedSignersPath,
    candidatePath,
    primaryAttestationPath,
    secondaryAttestationPath,
    manifestPath,
  ] = argv.map((path) => resolve(path));
  if (
    !trustedSignersPath ||
    !candidatePath ||
    !primaryAttestationPath ||
    !secondaryAttestationPath ||
    !manifestPath
  ) {
    throw new Error('canary sealing CLI requires five absolute paths');
  }
  if (
    new Set(
      [candidatePath, primaryAttestationPath, secondaryAttestationPath, manifestPath].map((path) =>
        dirname(path),
      ),
    ).size !== 1
  ) {
    throw new Error('canary sealing files must share one restricted directory');
  }
  return {
    trustedSignersPath,
    candidatePath,
    primaryAttestationPath,
    secondaryAttestationPath,
    manifestPath,
  };
}

export function resolveLifecycleCanaryCliConfiguration(
  argv: string[],
  environment: Record<string, unknown>,
  uid: number | undefined,
): LifecycleCanaryCliConfiguration {
  if (uid !== 998) throw new Error('canary CLI must run as the dedicated runtime user');
  if (argv.length !== 1 || (argv[0] !== 'prepare' && argv[0] !== 'run')) {
    throw new Error('canary CLI mode must be prepare or run');
  }
  const manifestPath = requiredEnvironmentPath(
    environment,
    'TEAM_TASK_LIFECYCLE_CANARY_MANIFEST_FILE',
  );
  const receiptPath = requiredEnvironmentPath(environment, 'TEAM_TASK_LIFECYCLE_QA_RECEIPT_FILE');
  const trustedSignersPath = requiredEnvironmentPath(
    environment,
    'TEAM_TASK_LIFECYCLE_TRUSTED_SIGNERS_FILE',
  );
  if (dirname(manifestPath) !== dirname(receiptPath)) {
    throw new Error('canary manifest and receipt must share a restricted directory');
  }
  const expectedRevision = environment.TEAM_TASK_LIFECYCLE_EXPECTED_REVISION;
  if (typeof expectedRevision !== 'string' || !/^[0-9a-f]{40}$/u.test(expectedRevision)) {
    throw new Error('invalid expected revision');
  }
  return {
    mode: argv[0],
    manifestPath,
    receiptPath,
    trustedSignersPath,
    expectedRevision,
  };
}

export async function runLifecycleCanaryCli(input: {
  configuration: LifecycleCanaryCliConfiguration;
  environment: Record<string, unknown>;
  adapter: LifecycleCanaryCliAdapter;
  currentRevision: () => Promise<string>;
  writeLine: (value: string) => void;
}): Promise<boolean> {
  if (input.configuration.mode === 'run') {
    const consumedPrepareReceipt = consumeLifecycleCanaryRootSupervisorStdin();
    return runLifecycleCanaryCliWithPrepareReceipt(input, consumedPrepareReceipt);
  }
  return runLifecycleCanaryCliWithPrepareReceipt(input, undefined);
}

async function runLifecycleCanaryCliWithPrepareReceipt(
  input: Parameters<typeof runLifecycleCanaryCli>[0],
  consumedPrepareReceipt: unknown | undefined,
): Promise<boolean> {
  if (input.configuration.mode === 'run' && consumedPrepareReceipt === undefined) {
    throw new Error('root-supervised prepare receipt required');
  }
  if (input.configuration.mode === 'prepare') {
    await consumeLifecycleCanaryReceipt(input.configuration.receiptPath);
  }
  const manifest = await loadLifecycleCanaryManifest(
    input.configuration.manifestPath,
    input.configuration.trustedSignersPath,
  );
  if (!validateLifecycleCanaryRuntime(input.configuration.mode, input.environment, manifest)) {
    throw new Error('canary runtime configuration mismatch');
  }
  const result = await runLifecycleCanary({
    mode: input.configuration.mode,
    manifest,
    expectedRevision: input.configuration.expectedRevision,
    currentRevision: input.currentRevision,
    receiptPath: input.configuration.receiptPath,
    consumedPrepareReceipt,
    validateBoundary: (value) => input.adapter.validateBoundary(value),
    smoke: () => input.adapter.smoke(manifest),
    executeScenario: (scenario) => input.adapter.executeScenario(scenario, manifest),
  });
  input.writeLine(summarizeLifecycleCanaryRun(result));
  return result.passed;
}
