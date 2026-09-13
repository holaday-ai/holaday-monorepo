import { expect, it } from 'vitest';
import {
  type BrokerBootFrame,
  decodeBrokerBootFrame,
  encodeBrokerBootFrame,
} from './broker-boot-protocol.js';
const hello: BrokerBootFrame = {
  version: 2,
  phase: 'boot-hello',
  candidate: 'a'.repeat(40),
  boot: 'b'.repeat(32),
  clientNonce: 'd'.repeat(32),
};

it('rejects an extra own __proto__ key instead of silently discarding it', () => {
  const value = { ...hello };
  Object.defineProperty(value, '__proto__', { value: null, enumerable: true });
  expect(() => encodeBrokerBootFrame(value)).toThrow();
});

it('rejects accessors without invoking their code', () => {
  let called = 0;
  const accessor = {
    ...hello,
    get version() {
      called++;
      return 2 as const;
    },
  };
  expect(() => encodeBrokerBootFrame(accessor)).toThrow();
  expect(called).toBe(0);
});

it('boot canonical bytes exclude every business field and ambiguous representation', () => {
  const raw = Buffer.from(
    `{"boot":"${'b'.repeat(32)}","candidate":"${'a'.repeat(40)}","clientNonce":"${'d'.repeat(32)}","phase":"boot-hello","version":2}`,
  );
  const prefix = Buffer.alloc(4);
  prefix.writeUInt32BE(raw.length);
  const original = Buffer.concat([prefix, raw]);
  expect(encodeBrokerBootFrame(hello)).toEqual(original);
  expect(decodeBrokerBootFrame(original)).toEqual(hello);
  for (const value of [
    { ...hello, version: true },
    { ...hello, epoch: 'c'.repeat(32) },
    { ...hello, action: 'create' },
    { ...hello, candidate: '0'.repeat(40) },
    { ...hello, phase: 'boot-challenge', rootNonce: 'd'.repeat(32), epoch: 'c'.repeat(32) },
  ])
    expect(() => encodeBrokerBootFrame(value as BrokerBootFrame)).toThrow();
  for (const bytes of [
    Buffer.concat([original, Buffer.from('x')]),
    Buffer.concat([
      prefix,
      Buffer.from(raw.toString().replace('"version":2', '"version":2,"version":2')),
    ]),
    Buffer.concat([prefix, Buffer.from(raw.toString().replace('"version":2', '"version": 2'))]),
  ])
    expect(() => decodeBrokerBootFrame(bytes)).toThrow();
});
