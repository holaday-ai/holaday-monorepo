import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  acceptEgressClientHandshake,
  createBrokerDataHandshake,
  createEgressClientHandshake,
  deriveBrokerDataKey,
  replyToBrokerEgressProbe,
} from './broker-data-protocol.js';

const scope = { candidate: 'aa'.repeat(20), boot: 'bb'.repeat(16), resource: 'cc'.repeat(16) };
const management = Buffer.alloc(32, 1);
const egress = Buffer.alloc(32, 7);
const dataDomain = Buffer.from('HoladayPool/data-auth/v1\0');

function frame(
  type: number,
  kind: number,
  server: Buffer,
  client: Buffer,
  key: Buffer,
  transcript = Buffer.alloc(0),
) {
  const header = Buffer.concat([
    Buffer.from('HPD1'),
    Buffer.from([type, kind]),
    Buffer.from(scope.candidate, 'hex'),
    Buffer.from(scope.resource, 'hex'),
    Buffer.from(scope.boot, 'hex'),
    server,
    client,
  ]);
  return Buffer.concat([
    header,
    createHmac('sha256', key).update(dataDomain).update(header).update(transcript).digest(),
  ]);
}

describe('broker data protocol codecs (not socket or readiness authority)', () => {
  it('matches the independently computed OpenSSL HKDF-Expand vector', () => {
    expect(deriveBrokerDataKey(management, scope).toString('hex')).toBe(
      '3ad7d9903c4c0e86b9ad2dc55e1f4fa194cc55181fd2bd9bf0daa3305a49361a',
    );
    expect(deriveBrokerDataKey(management, { ...scope, boot: 'dd'.repeat(16) })).not.toEqual(
      deriveBrokerDataKey(management, scope),
    );
  });

  it('binds the actual Python HPD1 layout, both nonces and response-tag transcript', () => {
    const key = deriveBrokerDataKey(management, scope);
    for (const kind of [1, 2] as const) {
      const server = Buffer.alloc(32, 8);
      const handshake = createBrokerDataHandshake(
        scope,
        key,
        kind,
        frame(1, kind, server, Buffer.alloc(32), key),
      );
      expect(handshake.response.length).toBe(154);
      const client = handshake.response.subarray(90, 122);
      expect(client).not.toEqual(Buffer.alloc(32));
      expect(client).not.toEqual(server);
      expect(handshake.response).toEqual(frame(2, kind, server, client, key));
      const ack = frame(3, kind, server, client, key, handshake.response.subarray(122));
      expect(() => handshake.acceptAcknowledgement(ack)).not.toThrow();
      expect(() => handshake.acceptAcknowledgement(ack)).toThrow('POOL_BROKER_DATA_INVALID');
      handshake.close();
      expect(key.some((byte) => byte !== 0)).toBe(true); // The caller owns its original key.
    }
  });

  it('rejects altered context, kind, tag, length and replay and never resurrects a failed exchange', () => {
    const key = deriveBrokerDataKey(management, scope);
    const server = Buffer.alloc(32, 8);
    const challenge = frame(1, 1, server, Buffer.alloc(32), key);
    for (const offset of [0, 4, 5, 6, 26, 42, 58, 90, 122]) {
      const bad = Buffer.from(challenge);
      bad[offset] = bad.readUInt8(offset) ^ 1;
      expect(() => createBrokerDataHandshake(scope, key, 1, bad)).toThrow(
        'POOL_BROKER_DATA_INVALID',
      );
    }
    for (const bad of [challenge.subarray(1), Buffer.concat([challenge, Buffer.from('x')])]) {
      expect(() => createBrokerDataHandshake(scope, key, 1, bad)).toThrow(
        'POOL_BROKER_DATA_INVALID',
      );
    }
    const handshake = createBrokerDataHandshake(scope, key, 1, challenge);
    const ack = frame(
      3,
      1,
      server,
      handshake.response.subarray(90, 122),
      key,
      handshake.response.subarray(122),
    );
    expect(() => handshake.acceptAcknowledgement(challenge)).toThrow('POOL_BROKER_DATA_INVALID');
    expect(() => handshake.acceptAcknowledgement(ack)).toThrow('POOL_BROKER_DATA_INVALID');
  });

  it('rejects zero or malformed values without exposing the secret or original exception', () => {
    for (const key of [Buffer.alloc(32), Buffer.alloc(31, 1)]) {
      expect(() => deriveBrokerDataKey(key, scope)).toThrow('POOL_BROKER_DATA_INVALID');
    }
    expect(() =>
      deriveBrokerDataKey(management, { ...scope, candidate: scope.candidate.toUpperCase() }),
    ).toThrow('POOL_BROKER_DATA_INVALID');
    expect(() => deriveBrokerDataKey(management, { ...scope, resource: '00'.repeat(16) })).toThrow(
      'POOL_BROKER_DATA_INVALID',
    );
  });

  it('encodes only a single validated scope snapshot and suppresses initialization exceptions', () => {
    let reads = 0;
    const changing = {
      ...scope,
      get candidate() {
        return ++reads === 1 ? scope.candidate : 'dd'.repeat(20);
      },
    };
    expect(deriveBrokerDataKey(management, changing)).toEqual(
      deriveBrokerDataKey(management, scope),
    );
    expect(reads).toBe(1);
    const throwing = {
      ...scope,
      get candidate(): string {
        throw new Error('synthetic-private-marker');
      },
    };
    for (const run of [
      () => deriveBrokerDataKey(management, throwing),
      () => createBrokerDataHandshake(throwing, management, 1, Buffer.alloc(154)),
      () => replyToBrokerEgressProbe(throwing, Buffer.alloc(89)),
      () => createEgressClientHandshake(throwing, egress),
      () => acceptEgressClientHandshake(throwing, egress, Buffer.alloc(154)),
    ])
      expect(run).toThrow(/^POOL_BROKER_DATA_INVALID$/);
  });

  it('replies only to the fixed HPE1 original-group probe without parsing business content', () => {
    const nonce = Buffer.alloc(32, 11);
    const request = Buffer.concat([
      Buffer.from('HPE1'),
      Buffer.from([1]),
      Buffer.from(scope.candidate, 'hex'),
      Buffer.from(scope.resource, 'hex'),
      Buffer.from(scope.boot, 'hex'),
      nonce,
    ]);
    const reply = replyToBrokerEgressProbe(scope, request);
    expect(reply.length).toBe(89);
    expect(reply[4]).toBe(2);
    expect(reply.subarray(5)).toEqual(request.subarray(5));
    expect(request[4]).toBe(1);
    expect(() => replyToBrokerEgressProbe(scope, reply)).toThrow('POOL_BROKER_DATA_INVALID');
    expect(() =>
      replyToBrokerEgressProbe({ ...scope, resource: 'dd'.repeat(16) }, request),
    ).toThrow('POOL_BROKER_DATA_INVALID');
  });

  it('authenticates egress with its independent key and both fresh endpoint nonces', () => {
    const client = createEgressClientHandshake(scope, egress);
    const server = acceptEgressClientHandshake(scope, egress, client.hello);
    expect(client.hello.length).toBe(154);
    expect(client.hello.subarray(0, 4).toString()).toBe('HPG1');
    expect(server.challenge.subarray(58, 90)).not.toEqual(Buffer.alloc(32));
    expect(server.challenge.subarray(90, 122)).toEqual(client.hello.subarray(90, 122));
    const acknowledgement = client.answerChallenge(server.challenge);
    expect(() => server.acceptAcknowledgement(acknowledgement)).not.toThrow();
    expect(() => client.answerChallenge(server.challenge)).toThrow('POOL_BROKER_DATA_INVALID');
    expect(() => server.acceptAcknowledgement(acknowledgement)).toThrow('POOL_BROKER_DATA_INVALID');
  });

  it('refuses data keys, wrong groups and old egress challenges or acknowledgements', () => {
    const client = createEgressClientHandshake(scope, egress);
    expect(() =>
      acceptEgressClientHandshake(scope, deriveBrokerDataKey(management, scope), client.hello),
    ).toThrow('POOL_BROKER_DATA_INVALID');
    expect(() =>
      acceptEgressClientHandshake({ ...scope, boot: 'ee'.repeat(16) }, egress, client.hello),
    ).toThrow('POOL_BROKER_DATA_INVALID');
    const firstServer = acceptEgressClientHandshake(scope, egress, client.hello);
    const secondServer = acceptEgressClientHandshake(scope, egress, client.hello);
    const ack = client.answerChallenge(firstServer.challenge);
    expect(() => secondServer.acceptAcknowledgement(ack)).toThrow('POOL_BROKER_DATA_INVALID');
    const secondClient = createEgressClientHandshake(scope, egress);
    expect(() => secondClient.answerChallenge(firstServer.challenge)).toThrow(
      'POOL_BROKER_DATA_INVALID',
    );
    firstServer.close();
    secondServer.close();
    client.close();
    secondClient.close();
  });

  it('keeps validated keys, context and transcript separate from caller-owned buffers', () => {
    const key = Buffer.from(egress);
    const mutableScope = { ...scope };
    const client = createEgressClientHandshake(mutableScope, key);
    const hello = Buffer.from(client.hello);
    key.fill(0);
    mutableScope.boot = 'ee'.repeat(16);
    client.hello.fill(0);
    const server = acceptEgressClientHandshake(scope, egress, hello);
    const challenge = Buffer.from(server.challenge);
    hello.fill(0);
    server.challenge.fill(0);
    const ack = client.answerChallenge(challenge);
    challenge.fill(0);
    expect(() => server.acceptAcknowledgement(ack)).not.toThrow();
  });
});
