import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  decodeBrokerControlFrame,
  encodeBrokerControlFrame,
  preparedBrokerControlDigest,
} from './broker-control-protocol.js';

const prepared = () => ({
  version: 2 as const,
  phase: 'prepared' as const,
  requestId: 'a'.repeat(32),
  candidate: 'c'.repeat(40),
  boot: 'b'.repeat(32),
  slot: 0,
  resource: 'd'.repeat(32),
  capability: 'e'.repeat(64),
  egressCapability: 'f'.repeat(64),
  nonce: '1'.repeat(64),
});
function wire(value: object) {
  const raw = Buffer.from(JSON.stringify(Object.fromEntries(Object.entries(value).sort())));
  const length = Buffer.alloc(4);
  length.writeUInt32BE(raw.length);
  return Buffer.concat([length, raw]);
}

describe('closed original v2 control frames', () => {
  it('uses the exact canonical Python framing and hashes the complete prepared frame', () => {
    const frame = encodeBrokerControlFrame(prepared());
    expect(frame).toEqual(wire(prepared()));
    expect(decodeBrokerControlFrame(frame)).toEqual(prepared());
    expect(Object.isFrozen(decodeBrokerControlFrame(frame))).toBe(true);
    expect(preparedBrokerControlDigest(frame)).toBe(
      createHash('sha256').update(frame).digest('hex'),
    );
    const changed = encodeBrokerControlFrame({ ...prepared(), nonce: '2'.repeat(64) });
    expect(preparedBrokerControlDigest(changed)).not.toBe(preparedBrokerControlDigest(frame));
  });

  it('accepts only fixed request and phase schemas; a ready frame alone grants nothing', () => {
    const { capability, egressCapability, nonce, ...scope } = prepared();
    for (const phase of ['accepted', 'ready'] as const) {
      const data = { ...scope, phase, preparedDigest: '3'.repeat(64) };
      expect(decodeBrokerControlFrame(encodeBrokerControlFrame(data))).toEqual(data);
      expect(() => preparedBrokerControlDigest(encodeBrokerControlFrame(data))).toThrow(
        'POOL_BROKER_CONTROL_FRAME_INVALID',
      );
    }
    for (const action of ['create', 'query', 'close']) {
      const data = {
        version: 2,
        action,
        requestId: 'a'.repeat(32),
        boot: 'b'.repeat(32),
        ...(action === 'create' ? { slot: 0 } : { capability }),
      };
      expect(decodeBrokerControlFrame(encodeBrokerControlFrame(data))).toEqual(data);
    }
  });

  it('rejects duplicate keys, unknown fields, noncanonical data and size tricks', () => {
    for (const change of [
      { version: 1 },
      { slot: true },
      { slot: 32 },
      { phase: 'unknown' },
      { capability: 'f'.repeat(64) },
      { nonce: '0'.repeat(64) },
      { groupExitProven: true },
      { message: 'synthetic' },
    ]) {
      expect(() => decodeBrokerControlFrame(wire({ ...prepared(), ...change }))).toThrow(
        'POOL_BROKER_CONTROL_FRAME_INVALID',
      );
    }
    const good = wire(prepared());
    const duplicate = Buffer.from(`{"version":2,${good.subarray(5).toString()}`);
    const prefixed = (raw: Buffer) => {
      const length = Buffer.alloc(4);
      length.writeUInt32BE(raw.length);
      return Buffer.concat([length, raw]);
    };
    for (const frame of [
      good.subarray(0, -1),
      Buffer.concat([good, good]),
      prefixed(duplicate),
      prefixed(Buffer.from(JSON.stringify(prepared(), null, 2))),
      prefixed(Buffer.alloc(4097, 32)),
      Buffer.alloc(4),
    ]) {
      expect(() => decodeBrokerControlFrame(frame)).toThrow('POOL_BROKER_CONTROL_FRAME_INVALID');
    }
  });
});
