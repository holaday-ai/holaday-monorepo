import { createHash, createPublicKey, randomUUID, verify as verifySignature } from 'node:crypto';
import { link, lstat, open, readFile, rename, unlink } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { isExternalId } from '@holaday/shared-types';

export const LIFECYCLE_CANARY_SCENARIOS = [
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

export type LifecycleCanaryScenario = (typeof LIFECYCLE_CANARY_SCENARIOS)[number];
export type LifecycleCanaryMode = 'prepare' | 'run';
export type LifecycleCanaryRole = 'creatorApprover' | 'claimantA' | 'claimantB' | 'arbitrator';

const ROLE_NAMES: readonly LifecycleCanaryRole[] = [
  'creatorApprover',
  'claimantA',
  'claimantB',
  'arbitrator',
];
const MANIFEST_SOURCE = 'holaday-team-task-lifecycle-canary-manifest-v1';
const CANDIDATE_SOURCE = 'holaday-team-task-lifecycle-canary-candidate-v1';
const CONFIRMATION_SOURCE = 'holaday-team-task-lifecycle-dual-operator-confirmation-v1';
const OPERATOR_ATTESTATION_SOURCE = 'holaday-team-task-lifecycle-operator-attestation-v1';
const TRUSTED_SIGNERS_SOURCE = 'holaday-team-task-lifecycle-trusted-signers-v1';
const RECEIPT_SOURCE = 'holaday-team-task-lifecycle-qa-v1';
const MAX_MANIFEST_BYTES = 32 * 1024;

export interface LifecycleCanaryActor {
  userId: string;
  organizationMemberId: string;
  projectMemberId: string;
}

export interface LifecycleCanaryScope {
  organizationId: string;
  projectId: string;
  actors: Record<LifecycleCanaryRole, LifecycleCanaryActor>;
}

export interface LifecycleCanaryManifest {
  schemaVersion: 1;
  source: typeof MANIFEST_SOURCE;
  confirmation: {
    source: typeof CONFIRMATION_SOURCE;
    boundaryDigest: string;
    primaryAttestation: LifecycleCanaryOperatorAttestation;
    secondaryAttestation: LifecycleCanaryOperatorAttestation;
    distinctHumanOperatorsConfirmed: true;
  };
  scopes: [LifecycleCanaryScope, LifecycleCanaryScope];
}

export interface LifecycleCanaryCandidate {
  schemaVersion: 1;
  source: typeof CANDIDATE_SOURCE;
  scopes: [LifecycleCanaryScope, LifecycleCanaryScope];
}

export interface LifecycleCanaryOperatorAttestation {
  schemaVersion: 1;
  source: typeof OPERATOR_ATTESTATION_SOURCE;
  operatorSlot: 'primary' | 'secondary';
  operatorPrincipal: string;
  boundaryDigest: string;
  confirmedAt: string;
  confirmedSyntheticBoundary: true;
  signature: string;
}

export interface LifecycleCanaryTrustedSigner {
  operatorSlot: 'primary' | 'secondary';
  operatorPrincipal: string;
  publicKeyPem: string;
}

export interface LifecycleCanaryTrustedSigners {
  schemaVersion: 1;
  source: typeof TRUSTED_SIGNERS_SOURCE;
  signers: [LifecycleCanaryTrustedSigner, LifecycleCanaryTrustedSigner];
}

export interface LifecycleCanaryRunResult {
  mode: LifecycleCanaryMode;
  passed: boolean;
  scenarioChecksPassed: number;
}

export interface LifecycleCanarySmokeResult {
  personalProjects: boolean;
  teamProjects: boolean;
  filePath: boolean;
}

export interface LifecycleCanaryRunOptions {
  mode: LifecycleCanaryMode;
  manifest: LifecycleCanaryManifest;
  expectedRevision: string;
  currentRevision: () => Promise<string>;
  receiptPath: string;
  consumedPrepareReceipt?: unknown;
  now?: () => Date;
  validateBoundary: (manifest: LifecycleCanaryManifest) => Promise<boolean>;
  smoke: () => Promise<LifecycleCanarySmokeResult>;
  executeScenario: (
    scenario: LifecycleCanaryScenario,
    manifest: LifecycleCanaryManifest,
  ) => Promise<boolean>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  return (
    keys.length === expected.length &&
    keys.every((key, index) => key === [...expected].sort()[index])
  );
}

function requireExternalId(value: unknown, kind: Parameters<typeof isExternalId>[1]): string {
  if (typeof value !== 'string' || !isExternalId(value, kind)) {
    throw new Error(`invalid ${kind} identifier`);
  }
  return value;
}

function parseActor(value: unknown): LifecycleCanaryActor {
  if (
    !isRecord(value) ||
    !exactKeys(value, ['organizationMemberId', 'projectMemberId', 'userId'])
  ) {
    throw new Error('invalid canary actor');
  }
  return {
    userId: requireExternalId(value.userId, 'user'),
    organizationMemberId: requireExternalId(value.organizationMemberId, 'organizationMember'),
    projectMemberId: requireExternalId(value.projectMemberId, 'projectMember'),
  };
}

function parseScope(value: unknown): LifecycleCanaryScope {
  if (!isRecord(value) || !exactKeys(value, ['actors', 'organizationId', 'projectId'])) {
    throw new Error('invalid canary scope');
  }
  if (!isRecord(value.actors) || !exactKeys(value.actors, ROLE_NAMES)) {
    throw new Error('canary scope must contain four fixed roles');
  }
  return {
    organizationId: requireExternalId(value.organizationId, 'organization'),
    projectId: requireExternalId(value.projectId, 'project'),
    actors: {
      creatorApprover: parseActor(value.actors.creatorApprover),
      claimantA: parseActor(value.actors.claimantA),
      claimantB: parseActor(value.actors.claimantB),
      arbitrator: parseActor(value.actors.arbitrator),
    },
  };
}

export function lifecycleCanaryBoundaryDigestForScopes(
  scopes: [LifecycleCanaryScope, LifecycleCanaryScope],
): string {
  const boundary = scopes.map((scope) => ({
    organizationId: scope.organizationId,
    projectId: scope.projectId,
    actors: Object.fromEntries(
      ROLE_NAMES.map((role) => [
        role,
        {
          userId: scope.actors[role].userId,
          organizationMemberId: scope.actors[role].organizationMemberId,
          projectMemberId: scope.actors[role].projectMemberId,
        },
      ]),
    ),
  }));
  return createHash('sha256')
    .update(JSON.stringify({ version: 1, scopes: boundary }), 'utf8')
    .digest('hex');
}

function confirmedAt(value: unknown): string {
  if (typeof value !== 'string') throw new Error('invalid dual-operator confirmation timestamp');
  const date = new Date(value);
  if (!Number.isFinite(date.valueOf()) || date.toISOString() !== value) {
    throw new Error('invalid dual-operator confirmation timestamp');
  }
  return value;
}

function operatorPrincipal(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._:@-]{3,128}$/u.test(value)) {
    throw new Error('invalid lifecycle canary operator principal');
  }
  return value;
}

function parseAndValidateScopes(value: unknown): [LifecycleCanaryScope, LifecycleCanaryScope] {
  if (!Array.isArray(value) || value.length !== 2) {
    throw new Error('canary requires exactly two synthetic scopes');
  }
  const scopes = value.map(parseScope) as [LifecycleCanaryScope, LifecycleCanaryScope];
  if (
    scopes[0].organizationId === scopes[1].organizationId ||
    scopes[0].projectId === scopes[1].projectId
  ) {
    throw new Error('canary requires two distinct synthetic organizations and projects');
  }
  const userSets = scopes.map(
    (scope) => new Set(ROLE_NAMES.map((role) => scope.actors[role].userId)),
  ) as [Set<string>, Set<string>];
  const [firstUsers, secondUsers] = userSets;
  if (
    userSets.some((users) => users.size !== 4) ||
    [...firstUsers].some((userId) => !secondUsers.has(userId))
  ) {
    throw new Error('canary requires four shared synthetic users across both organizations');
  }
  if (ROLE_NAMES.some((role) => scopes[0].actors[role].userId !== scopes[1].actors[role].userId)) {
    throw new Error('canary requires the same synthetic user for each fixed role');
  }
  for (const scope of scopes) {
    if (new Set(ROLE_NAMES.map((role) => scope.actors[role].organizationMemberId)).size !== 4) {
      throw new Error('canary organization member roles must be distinct');
    }
    if (new Set(ROLE_NAMES.map((role) => scope.actors[role].projectMemberId)).size !== 4) {
      throw new Error('canary project member roles must be distinct');
    }
  }
  if (
    new Set(
      scopes.flatMap((scope) => ROLE_NAMES.map((role) => scope.actors[role].organizationMemberId)),
    ).size !== 8 ||
    new Set(scopes.flatMap((scope) => ROLE_NAMES.map((role) => scope.actors[role].projectMemberId)))
      .size !== 8
  ) {
    throw new Error('canary member identifiers must be globally distinct');
  }
  return scopes;
}

export function parseLifecycleCanaryManifest(value: unknown): LifecycleCanaryManifest {
  if (
    !isRecord(value) ||
    !exactKeys(value, ['confirmation', 'schemaVersion', 'scopes', 'source']) ||
    value.schemaVersion !== 1 ||
    value.source !== MANIFEST_SOURCE ||
    !Array.isArray(value.scopes) ||
    value.scopes.length !== 2
  ) {
    throw new Error('invalid lifecycle canary manifest');
  }
  const scopes = parseAndValidateScopes(value.scopes);
  if (
    !isRecord(value.confirmation) ||
    !exactKeys(value.confirmation, [
      'boundaryDigest',
      'distinctHumanOperatorsConfirmed',
      'primaryAttestation',
      'secondaryAttestation',
      'source',
    ]) ||
    value.confirmation.source !== CONFIRMATION_SOURCE ||
    value.confirmation.distinctHumanOperatorsConfirmed !== true
  ) {
    throw new Error('invalid dual-operator confirmation');
  }
  const primaryAttestation = parseOperatorAttestation(value.confirmation.primaryAttestation);
  const secondaryAttestation = parseOperatorAttestation(value.confirmation.secondaryAttestation);
  const boundaryDigest = value.confirmation.boundaryDigest;
  if (
    typeof boundaryDigest !== 'string' ||
    !/^[0-9a-f]{64}$/u.test(boundaryDigest) ||
    boundaryDigest !== lifecycleCanaryBoundaryDigestForScopes(scopes)
  ) {
    throw new Error('dual-operator confirmation boundary mismatch');
  }
  if (
    primaryAttestation.operatorSlot !== 'primary' ||
    secondaryAttestation.operatorSlot !== 'secondary' ||
    primaryAttestation.operatorPrincipal === secondaryAttestation.operatorPrincipal ||
    primaryAttestation.boundaryDigest !== boundaryDigest ||
    secondaryAttestation.boundaryDigest !== boundaryDigest ||
    new Date(secondaryAttestation.confirmedAt) < new Date(primaryAttestation.confirmedAt)
  ) {
    throw new Error('invalid dual-operator confirmation');
  }
  return {
    schemaVersion: 1,
    source: MANIFEST_SOURCE,
    confirmation: {
      source: CONFIRMATION_SOURCE,
      boundaryDigest,
      primaryAttestation,
      secondaryAttestation,
      distinctHumanOperatorsConfirmed: true,
    },
    scopes,
  };
}

export function verifyLifecycleCanaryManifest(
  value: unknown,
  rawTrustedSigners: unknown,
): LifecycleCanaryManifest {
  const manifest = parseLifecycleCanaryManifest(value);
  const trustedSigners = parseLifecycleCanaryTrustedSigners(rawTrustedSigners);
  if (
    !verifyOperatorAttestation(manifest.confirmation.primaryAttestation, trustedSigners) ||
    !verifyOperatorAttestation(manifest.confirmation.secondaryAttestation, trustedSigners)
  ) {
    throw new Error('lifecycle canary operator signature verification failed');
  }
  return manifest;
}

function parseLifecycleCanaryCandidate(value: unknown): LifecycleCanaryCandidate {
  if (
    !isRecord(value) ||
    !exactKeys(value, ['schemaVersion', 'scopes', 'source']) ||
    value.schemaVersion !== 1 ||
    value.source !== CANDIDATE_SOURCE
  ) {
    throw new Error('invalid lifecycle canary candidate');
  }
  return {
    schemaVersion: 1,
    source: CANDIDATE_SOURCE,
    scopes: parseAndValidateScopes(value.scopes),
  };
}

function parseOperatorAttestation(value: unknown): LifecycleCanaryOperatorAttestation {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      'boundaryDigest',
      'confirmedAt',
      'confirmedSyntheticBoundary',
      'operatorPrincipal',
      'operatorSlot',
      'schemaVersion',
      'signature',
      'source',
    ]) ||
    value.schemaVersion !== 1 ||
    value.source !== OPERATOR_ATTESTATION_SOURCE ||
    (value.operatorSlot !== 'primary' && value.operatorSlot !== 'secondary') ||
    value.confirmedSyntheticBoundary !== true ||
    typeof value.boundaryDigest !== 'string' ||
    !/^[0-9a-f]{64}$/u.test(value.boundaryDigest) ||
    typeof value.signature !== 'string'
  ) {
    throw new Error('invalid lifecycle canary operator attestation');
  }
  const signature = Buffer.from(value.signature, 'base64');
  if (signature.length !== 64 || signature.toString('base64') !== value.signature) {
    throw new Error('invalid lifecycle canary operator signature');
  }
  return {
    schemaVersion: 1,
    source: OPERATOR_ATTESTATION_SOURCE,
    operatorSlot: value.operatorSlot,
    operatorPrincipal: operatorPrincipal(value.operatorPrincipal),
    boundaryDigest: value.boundaryDigest,
    confirmedAt: confirmedAt(value.confirmedAt),
    confirmedSyntheticBoundary: true,
    signature: value.signature,
  };
}

export function lifecycleCanaryAttestationSigningPayload(
  attestation: Omit<LifecycleCanaryOperatorAttestation, 'signature'>,
): Buffer {
  return Buffer.from(
    JSON.stringify({
      schemaVersion: attestation.schemaVersion,
      source: attestation.source,
      operatorSlot: attestation.operatorSlot,
      operatorPrincipal: attestation.operatorPrincipal,
      boundaryDigest: attestation.boundaryDigest,
      confirmedAt: attestation.confirmedAt,
      confirmedSyntheticBoundary: attestation.confirmedSyntheticBoundary,
    }),
    'utf8',
  );
}

export function createLifecycleCanaryUnsignedAttestation(input: {
  candidate: unknown;
  operatorSlot: 'primary' | 'secondary';
  operatorPrincipal: string;
  confirmedAt: string;
}): Omit<LifecycleCanaryOperatorAttestation, 'signature'> {
  const candidate = parseLifecycleCanaryCandidate(input.candidate);
  return {
    schemaVersion: 1,
    source: OPERATOR_ATTESTATION_SOURCE,
    operatorSlot: input.operatorSlot,
    operatorPrincipal: operatorPrincipal(input.operatorPrincipal),
    boundaryDigest: lifecycleCanaryBoundaryDigestForScopes(candidate.scopes),
    confirmedAt: confirmedAt(input.confirmedAt),
    confirmedSyntheticBoundary: true,
  };
}

export function parseLifecycleCanaryTrustedSigners(value: unknown): LifecycleCanaryTrustedSigners {
  if (
    !isRecord(value) ||
    !exactKeys(value, ['schemaVersion', 'signers', 'source']) ||
    value.schemaVersion !== 1 ||
    value.source !== TRUSTED_SIGNERS_SOURCE ||
    !Array.isArray(value.signers) ||
    value.signers.length !== 2
  ) {
    throw new Error('invalid lifecycle canary trusted signers');
  }
  const signers = value.signers.map((signer): LifecycleCanaryTrustedSigner => {
    if (
      !isRecord(signer) ||
      !exactKeys(signer, ['operatorPrincipal', 'operatorSlot', 'publicKeyPem']) ||
      (signer.operatorSlot !== 'primary' && signer.operatorSlot !== 'secondary') ||
      typeof signer.publicKeyPem !== 'string' ||
      signer.publicKeyPem.length > 8 * 1024
    ) {
      throw new Error('invalid lifecycle canary trusted signer');
    }
    const publicKey = createPublicKey(signer.publicKeyPem);
    if (publicKey.type !== 'public' || publicKey.asymmetricKeyType !== 'ed25519') {
      throw new Error('lifecycle canary trusted signer must use Ed25519');
    }
    return {
      operatorSlot: signer.operatorSlot,
      operatorPrincipal: operatorPrincipal(signer.operatorPrincipal),
      publicKeyPem: signer.publicKeyPem,
    };
  }) as [LifecycleCanaryTrustedSigner, LifecycleCanaryTrustedSigner];
  if (
    new Set(signers.map((signer) => signer.operatorSlot)).size !== 2 ||
    new Set(signers.map((signer) => signer.operatorPrincipal)).size !== 2
  ) {
    throw new Error('lifecycle canary requires two distinct trusted operator principals');
  }
  return { schemaVersion: 1, source: TRUSTED_SIGNERS_SOURCE, signers };
}

function verifyOperatorAttestation(
  attestation: LifecycleCanaryOperatorAttestation,
  trustedSigners: LifecycleCanaryTrustedSigners,
): boolean {
  const signer = trustedSigners.signers.find(
    (candidate) =>
      candidate.operatorSlot === attestation.operatorSlot &&
      candidate.operatorPrincipal === attestation.operatorPrincipal,
  );
  if (!signer) return false;
  const { signature, ...unsignedAttestation } = attestation;
  return verifySignature(
    null,
    lifecycleCanaryAttestationSigningPayload(unsignedAttestation),
    createPublicKey(signer.publicKeyPem),
    Buffer.from(signature, 'base64'),
  );
}

export function sealLifecycleCanaryCandidate(
  rawCandidate: unknown,
  rawFirstAttestation: unknown,
  rawSecondAttestation: unknown,
  rawTrustedSigners: unknown,
): LifecycleCanaryManifest {
  const candidate = parseLifecycleCanaryCandidate(rawCandidate);
  const trustedSigners = parseLifecycleCanaryTrustedSigners(rawTrustedSigners);
  const attestations = [
    parseOperatorAttestation(rawFirstAttestation),
    parseOperatorAttestation(rawSecondAttestation),
  ];
  if (new Set(attestations.map((attestation) => attestation.operatorSlot)).size !== 2) {
    throw new Error('canary sealing requires distinct operator slots');
  }
  const boundaryDigest = lifecycleCanaryBoundaryDigestForScopes(candidate.scopes);
  if (attestations.some((attestation) => attestation.boundaryDigest !== boundaryDigest)) {
    throw new Error('operator attestation boundary mismatch');
  }
  const primary = attestations.find((attestation) => attestation.operatorSlot === 'primary');
  const secondary = attestations.find((attestation) => attestation.operatorSlot === 'secondary');
  if (!primary || !secondary) throw new Error('canary sealing requires distinct operator slots');
  if (new Date(secondary.confirmedAt) < new Date(primary.confirmedAt)) {
    throw new Error('secondary operator confirmation must not predate primary confirmation');
  }
  if (
    !verifyOperatorAttestation(primary, trustedSigners) ||
    !verifyOperatorAttestation(secondary, trustedSigners)
  ) {
    throw new Error('lifecycle canary operator signature verification failed');
  }
  return verifyLifecycleCanaryManifest(
    {
      schemaVersion: 1,
      source: MANIFEST_SOURCE,
      confirmation: {
        source: CONFIRMATION_SOURCE,
        boundaryDigest,
        primaryAttestation: primary,
        secondaryAttestation: secondary,
        distinctHumanOperatorsConfirmed: true,
      },
      scopes: candidate.scopes,
    },
    trustedSigners,
  );
}

export function lifecycleCanaryBoundaryDigest(rawManifest: LifecycleCanaryManifest): string {
  const manifest = parseLifecycleCanaryManifest(rawManifest);
  return lifecycleCanaryBoundaryDigestForScopes(manifest.scopes);
}

async function loadOwnerOnlyJson(path: string, expectedOwnerUid?: number): Promise<unknown> {
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.size < 2 || metadata.size > MAX_MANIFEST_BYTES) {
    throw new Error('canary input must be a bounded regular file');
  }
  if ((metadata.mode & 0o077) !== 0) {
    throw new Error('canary input must be owner-only');
  }
  if (expectedOwnerUid !== undefined && metadata.uid !== expectedOwnerUid) {
    throw new Error('canary input owner must match restricted directory owner');
  }
  const raw = await readFile(path, 'utf8');
  return JSON.parse(raw) as unknown;
}

async function loadTrustedSignersJson(path: string): Promise<unknown> {
  const metadata = await lstat(path);
  const runtimeUid = process.getuid?.();
  const trustedOwner = runtimeUid === 998 ? metadata.uid === 0 : metadata.uid === runtimeUid;
  if (
    !metadata.isFile() ||
    metadata.size < 2 ||
    metadata.size > MAX_MANIFEST_BYTES ||
    (metadata.mode & 0o022) !== 0 ||
    !trustedOwner
  ) {
    throw new Error('canary trusted signers must be a root-controlled regular file');
  }
  return JSON.parse(await readFile(path, 'utf8')) as unknown;
}

export async function loadLifecycleCanaryManifest(
  path: string,
  trustedSignersPath: string,
): Promise<LifecycleCanaryManifest> {
  const trustedSigners = await loadTrustedSignersJson(trustedSignersPath);
  return verifyLifecycleCanaryManifest(await loadOwnerOnlyJson(path), trustedSigners);
}

export async function loadLifecycleCanaryCandidate(
  path: string,
): Promise<LifecycleCanaryCandidate> {
  if (!isAbsolute(path)) throw new Error('canary candidate path must be absolute');
  const resolvedPath = resolve(path);
  const directoryMetadata = await lstat(dirname(resolvedPath));
  const runtimeUid = process.getuid?.();
  if (
    !directoryMetadata.isDirectory() ||
    (directoryMetadata.mode & 0o077) !== 0 ||
    (runtimeUid !== undefined && directoryMetadata.uid !== runtimeUid)
  ) {
    throw new Error('canary candidate requires a runtime-owned restricted directory');
  }
  return parseLifecycleCanaryCandidate(
    await loadOwnerOnlyJson(resolvedPath, directoryMetadata.uid),
  );
}

function isRevision(value: string): boolean {
  return /^[0-9a-f]{40}$/u.test(value);
}

async function writeReceiptAtomically(path: string, value: unknown): Promise<void> {
  const directory = dirname(path);
  const temporaryPath = join(directory, `.team-task-canary-${randomUUID()}.tmp`);
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(temporaryPath, 'wx', 0o600);
    await handle.writeFile(`${JSON.stringify(value)}\n`, 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporaryPath, path);
    const directoryHandle = await open(directory, 'r');
    try {
      await directoryHandle.sync();
    } finally {
      await directoryHandle.close();
    }
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

async function writeJsonExclusively(path: string, value: unknown): Promise<void> {
  const directory = dirname(path);
  const temporaryPath = join(directory, `.team-task-canary-seal-${randomUUID()}.tmp`);
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(temporaryPath, 'wx', 0o600);
    await handle.writeFile(`${JSON.stringify(value)}\n`, 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    await link(temporaryPath, path);
    await unlink(temporaryPath);
    const directoryHandle = await open(directory, 'r');
    try {
      await directoryHandle.sync();
    } finally {
      await directoryHandle.close();
    }
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

export async function sealLifecycleCanaryCandidateFiles(input: {
  candidatePath: string;
  primaryAttestationPath: string;
  secondaryAttestationPath: string;
  manifestPath: string;
  trustedSignersPath: string;
}): Promise<LifecycleCanaryManifest> {
  if (!isAbsolute(input.trustedSignersPath)) {
    throw new Error('canary trusted signers path must be absolute');
  }
  const paths = [
    input.candidatePath,
    input.primaryAttestationPath,
    input.secondaryAttestationPath,
    input.manifestPath,
  ];
  if (paths.some((path) => !isAbsolute(path))) {
    throw new Error('canary sealing paths must be absolute');
  }
  const resolved = paths.map((path) => resolve(path));
  if (new Set(resolved.map((path) => dirname(path))).size !== 1) {
    throw new Error('canary sealing files must share one restricted directory');
  }
  const directoryPath = dirname(resolved[0] as string);
  const directoryMetadata = await lstat(directoryPath);
  if (!directoryMetadata.isDirectory() || (directoryMetadata.mode & 0o077) !== 0) {
    throw new Error('canary sealing requires an owner-only restricted directory');
  }
  const runtimeUid = process.getuid?.();
  if (runtimeUid !== undefined && directoryMetadata.uid !== runtimeUid) {
    throw new Error('canary sealing restricted directory must belong to the runtime user');
  }
  const [candidate, primary, secondary] = await Promise.all(
    resolved.slice(0, 3).map((path) => loadOwnerOnlyJson(path, directoryMetadata.uid)),
  );
  const trustedSigners = await loadTrustedSignersJson(resolve(input.trustedSignersPath));
  const manifest = sealLifecycleCanaryCandidate(candidate, primary, secondary, trustedSigners);
  await writeJsonExclusively(resolved[3] as string, manifest);
  return manifest;
}

export async function consumeLifecycleCanaryReceipt(path: string): Promise<unknown | null> {
  try {
    const metadata = await lstat(path);
    const runtimeUid = process.getuid?.();
    if (
      !metadata.isFile() ||
      (metadata.mode & 0o077) !== 0 ||
      (runtimeUid !== undefined && metadata.uid !== runtimeUid)
    ) {
      throw new Error('canary receipt must be an owner-only regular file');
    }
    const raw = await readFile(path, 'utf8');
    await unlink(path);
    return JSON.parse(raw) as unknown;
  } catch (error) {
    if (!isRecord(error) || error.code !== 'ENOENT') throw error;
    return null;
  }
}

export async function invalidateLifecycleCanaryReceipt(path: string): Promise<void> {
  await consumeLifecycleCanaryReceipt(path);
}

function parseSmokeResult(value: unknown): LifecycleCanarySmokeResult {
  if (
    !isRecord(value) ||
    !exactKeys(value, ['filePath', 'personalProjects', 'teamProjects']) ||
    typeof value.personalProjects !== 'boolean' ||
    typeof value.teamProjects !== 'boolean' ||
    typeof value.filePath !== 'boolean'
  ) {
    throw new Error('invalid phase one smoke receipt');
  }
  return {
    personalProjects: value.personalProjects,
    teamProjects: value.teamProjects,
    filePath: value.filePath,
  };
}

function parsePrepareReceipt(
  value: unknown,
  expectedRevision: string,
  expectedBoundaryDigest: string,
  now: Date,
): LifecycleCanarySmokeResult {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      'boundaryDigest',
      'checks',
      'completedAt',
      'phaseOne',
      'receiptKind',
      'revision',
      'schemaVersion',
      'source',
    ]) ||
    value.schemaVersion !== 1 ||
    value.source !== RECEIPT_SOURCE ||
    value.receiptKind !== 'prepare' ||
    value.revision !== expectedRevision ||
    value.boundaryDigest !== expectedBoundaryDigest ||
    !isRecord(value.phaseOne) ||
    !exactKeys(value.phaseOne, ['disabled', 'enabled']) ||
    value.phaseOne.enabled !== null ||
    !isRecord(value.checks) ||
    !exactKeys(value.checks, LIFECYCLE_CANARY_SCENARIOS)
  ) {
    throw new Error('valid disabled-state prepare receipt required');
  }
  const checks = value.checks;
  if (LIFECYCLE_CANARY_SCENARIOS.some((scenario) => checks[scenario] !== false)) {
    throw new Error('valid disabled-state prepare receipt required');
  }
  const completedAt = new Date(String(value.completedAt ?? ''));
  if (
    !Number.isFinite(completedAt.valueOf()) ||
    completedAt.toISOString() !== value.completedAt ||
    completedAt > now ||
    completedAt < new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
  ) {
    throw new Error('valid disabled-state prepare receipt required');
  }
  return parseSmokeResult(value.phaseOne.disabled);
}

export async function runLifecycleCanary(
  options: LifecycleCanaryRunOptions,
): Promise<LifecycleCanaryRunResult> {
  const now = (options.now ?? (() => new Date()))();
  let consumedPrepareReceipt: unknown = null;
  if (options.mode === 'run') {
    consumedPrepareReceipt =
      options.consumedPrepareReceipt ?? (await consumeLifecycleCanaryReceipt(options.receiptPath));
  }
  const manifest = parseLifecycleCanaryManifest(options.manifest);
  if (!isRevision(options.expectedRevision)) throw new Error('invalid expected revision');
  const currentRevision = await options.currentRevision();
  if (currentRevision !== options.expectedRevision) throw new Error('revision mismatch');
  const boundaryDigest = lifecycleCanaryBoundaryDigest(manifest);
  const disabledSmoke =
    options.mode === 'run'
      ? parsePrepareReceipt(consumedPrepareReceipt, options.expectedRevision, boundaryDigest, now)
      : null;
  if ((await options.validateBoundary(manifest)) !== true) {
    throw new Error('synthetic boundary validation failed');
  }
  const smoke = await options.smoke();
  if (smoke.personalProjects !== true || smoke.teamProjects !== true || smoke.filePath !== true) {
    throw new Error('phase one smoke failed');
  }
  const checks = Object.fromEntries(
    LIFECYCLE_CANARY_SCENARIOS.map((scenario) => [scenario, false]),
  ) as Record<LifecycleCanaryScenario, boolean>;
  if (options.mode === 'run') {
    let passed = 0;
    for (const scenario of LIFECYCLE_CANARY_SCENARIOS) {
      if ((await options.executeScenario(scenario, manifest)) !== true) {
        return { mode: options.mode, passed: false, scenarioChecksPassed: passed };
      }
      checks[scenario] = true;
      passed += 1;
    }
  }
  const scenarioChecksPassed = LIFECYCLE_CANARY_SCENARIOS.filter(
    (scenario) => checks[scenario],
  ).length;
  await writeReceiptAtomically(options.receiptPath, {
    schemaVersion: 1,
    source: RECEIPT_SOURCE,
    receiptKind: options.mode,
    revision: options.expectedRevision,
    boundaryDigest,
    completedAt: now.toISOString(),
    phaseOne: {
      disabled: options.mode === 'prepare' ? smoke : disabledSmoke,
      enabled: options.mode === 'run' ? smoke : null,
    },
    checks,
  });
  return { mode: options.mode, passed: true, scenarioChecksPassed };
}

export function summarizeLifecycleCanaryRun(result: LifecycleCanaryRunResult): string {
  return [
    'TEAM_TASK_LIFECYCLE_CANARY',
    `mode=${result.mode}`,
    `passed=${result.passed}`,
    'syntheticUsers=4',
    'syntheticOrganizations=2',
    `scenarioChecks=${result.scenarioChecksPassed}/13`,
  ].join(' ');
}

function enabled(value: unknown): boolean {
  return value === true || value === 'true';
}

function csvSet(value: unknown): Set<string> {
  if (typeof value !== 'string') return new Set();
  return new Set(
    value
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean),
  );
}

function equalSets(left: Set<string>, right: Set<string>): boolean {
  return left.size === right.size && [...left].every((value) => right.has(value));
}

export function validateLifecycleCanaryRuntime(
  mode: LifecycleCanaryMode,
  environment: Record<string, unknown>,
  rawManifest: LifecycleCanaryManifest,
): boolean {
  const manifest = parseLifecycleCanaryManifest(rawManifest);
  const users = new Set(ROLE_NAMES.map((role) => manifest.scopes[0].actors[role].userId));
  return (
    enabled(environment.TEAM_PROJECTS_ENABLED) &&
    enabled(environment.TEAM_TASK_LIFECYCLE_ENABLED) === (mode === 'run') &&
    equalSets(csvSet(environment.TEAM_PROJECTS_ALLOWLIST), users) &&
    equalSets(csvSet(environment.TEAM_TASK_LIFECYCLE_ALLOWLIST), users)
  );
}
