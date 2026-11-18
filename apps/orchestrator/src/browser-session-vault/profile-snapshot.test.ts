import { describe, expect, it } from 'vitest';
import { TestKeyProvider, seal, unseal } from './crypto.js';
import {
  type IdentityScope,
  type SiteIdentityProof,
  identityFromProof,
  issueIdentityProof,
  packSnapshot,
  unpackSnapshot,
} from './profile-snapshot.js';

const state = { cookies: [], storage: [{ name: 'preference', value: 'PRIVATE_STATE' }] };
const identity = { adapter: 'fixture-account-v1', subject: 'PRIVATE_IMMUTABLE_ACCOUNT' };
const scope: IdentityScope = {
  userId: 'alice',
  grantId: 'grant',
  grantVersion: 1,
  origin: 'https://fixture.test',
  snapshotVersion: 3,
};

describe('private authenticated subject snapshots', () => {
  it('reads a legacy state without inventing account evidence', () => {
    expect(unpackSnapshot(state)).toEqual({ state, identity: null });
  });
  it('seals state and stable subject together and rejects another owner context', async () => {
    const keys = new TestKeyProvider();
    const context = {
      userId: 'alice',
      grantId: 'grant',
      origin: scope.origin,
      version: 3,
      purpose: 'profile' as const,
    };
    const envelope = await seal(keys, context, packSnapshot(state, identity));
    for (const value of ['PRIVATE_STATE', 'PRIVATE_IMMUTABLE_ACCOUNT'])
      expect(JSON.stringify(envelope)).not.toContain(value);
    expect(unpackSnapshot(await unseal(keys, context, envelope))).toEqual({ state, identity });
    await expect(unseal(keys, { ...context, userId: 'bob' }, envelope)).rejects.toThrow();
  });
  it('cannot accept a JSON receipt or move a valid receipt to other bytes, owners or generations', () => {
    const proof = issueIdentityProof(scope, state, identity);
    expect(identityFromProof(proof, scope, state)).toEqual(identity);
    expect(() =>
      identityFromProof(JSON.parse(JSON.stringify(proof)) as SiteIdentityProof, scope, state),
    ).toThrow('identity_proof_invalid');
    for (const patch of [
      { userId: 'bob' },
      { origin: 'https://other.test' },
      { grantId: 'next' },
      { grantVersion: 2 },
      { snapshotVersion: 4 },
    ])
      expect(() => identityFromProof(proof, { ...scope, ...patch }, state)).toThrow(
        'identity_proof_invalid',
      );
    expect(() => identityFromProof(proof, scope, { ...state, storage: [] })).toThrow(
      'identity_proof_invalid',
    );
  });
  it('refuses malformed new payloads rather than treating their metadata as a legacy login', () => {
    expect(() =>
      unpackSnapshot({
        kind: 'browser-session-snapshot-v2',
        state,
        identity: { subject: 'alice' },
      }),
    ).toThrow('invalid_session');
    expect(() => unpackSnapshot({ kind: 'something-else', ...state })).toThrow('invalid_session');
  });
});
