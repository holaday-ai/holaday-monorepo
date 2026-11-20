import { createHash } from 'node:crypto';
import { type BrowserSessionState, browserSessionStateSchema } from '@holaday/shared-types';
import { z } from 'zod';

const identitySchema = z
  .object({
    adapter: z.string().min(1).max(128),
    subject: z.string().min(1).max(512),
  })
  .strict();
export type SiteIdentity = Readonly<z.infer<typeof identitySchema>>;
const payloadSchema = z
  .object({
    kind: z.literal('browser-session-snapshot-v2'),
    state: browserSessionStateSchema,
    identity: identitySchema.nullable(),
  })
  .strict();

export interface IdentityScope {
  userId: string;
  grantId: string;
  grantVersion: number;
  origin: string;
  snapshotVersion: number;
}
declare const proofBrand: unique symbol;
/** Opaque server-only receipt. A JSON/page/tool result can never manufacture it. */
export type SiteIdentityProof = Readonly<{ [proofBrand]: true }>;
const receipts = new WeakMap<
  SiteIdentityProof,
  {
    scope: IdentityScope;
    digest: string;
    identity: SiteIdentity;
  }
>();

function stateDigest(state: BrowserSessionState): string {
  const normalized = browserSessionStateSchema.safeParse(state);
  if (!normalized.success) throw new Error('identity_proof_invalid');
  return createHash('sha256').update(JSON.stringify(normalized.data)).digest('hex');
}

/** Called by the trusted site verifier, never by a request-body decoder. */
export function issueIdentityProof(
  scope: IdentityScope,
  state: BrowserSessionState,
  value: SiteIdentity,
): SiteIdentityProof {
  const parsed = identitySchema.safeParse(value);
  if (!parsed.success) throw new Error('identity_proof_invalid');
  const proof = Object.freeze({}) as SiteIdentityProof;
  receipts.set(proof, {
    scope: { ...scope },
    digest: stateDigest(state),
    identity: Object.freeze(parsed.data),
  });
  return proof;
}

export function identityFromProof(
  proof: SiteIdentityProof,
  scope: IdentityScope,
  state: BrowserSessionState,
): SiteIdentity {
  const receipt = receipts.get(proof);
  const keys: Array<keyof IdentityScope> = [
    'userId',
    'grantId',
    'grantVersion',
    'origin',
    'snapshotVersion',
  ];
  if (
    !receipt ||
    keys.some((key) => receipt.scope[key] !== scope[key]) ||
    receipt.digest !== stateDigest(state)
  )
    throw new Error('identity_proof_invalid');
  return receipt.identity;
}

/** This whole value is sealed with the existing owner/origin/grant/version AEAD context. */
export function packSnapshot(state: BrowserSessionState, identity: SiteIdentity | null = null) {
  const result = payloadSchema.safeParse({ kind: 'browser-session-snapshot-v2', state, identity });
  if (!result.success) throw new Error('invalid_session');
  return result.data;
}

export function unpackSnapshot(raw: unknown): {
  state: BrowserSessionState;
  identity: SiteIdentity | null;
} {
  if (raw && typeof raw === 'object' && 'kind' in raw) {
    const value = payloadSchema.safeParse(raw);
    if (!value.success) throw new Error('invalid_session');
    return {
      state: value.data.state,
      identity: value.data.identity && Object.freeze(value.data.identity),
    };
  }
  const legacy = browserSessionStateSchema.safeParse(raw);
  if (!legacy.success) throw new Error('invalid_session');
  return { state: legacy.data, identity: null };
}

export function sameIdentity(a: SiteIdentity, b: SiteIdentity): boolean {
  return a.adapter === b.adapter && a.subject === b.subject;
}
