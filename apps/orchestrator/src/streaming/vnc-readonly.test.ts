import { expect, it } from 'vitest';
import { VncReadOnlyFilter } from './vnc-readonly.js';
const handshake = Buffer.concat([Buffer.from('RFB 003.008\n'), Buffer.from([1, 1])]);
it('allows a split no-auth handshake and framebuffer requests', () => {
  const f = new VncReadOnlyFilter();
  expect(f.receive(handshake.subarray(0, 5))).toHaveLength(0);
  expect(f.receive(handshake.subarray(5))).toEqual(handshake);
  const request = Buffer.from([3, 1, 0, 0, 0, 0, 5, 0, 3, 32]);
  expect(f.receive(request)).toEqual(request);
});
it.each([4, 5, 6, 251, 255])(
  'blocks RFB input or unknown message %s even when coalesced with a read',
  (type) => {
    const f = new VncReadOnlyFilter();
    f.receive(handshake);
    expect(() =>
      f.receive(
        Buffer.concat([
          Buffer.from([3, 1, 0, 0, 0, 0, 5, 0, 3, 32]),
          Buffer.from([type, 0, 0, 0, 0, 0, 0, 0]),
        ]),
      ),
    ).toThrow('browser_vnc_read_only');
  },
);
it('rejects authentication variants instead of guessing handshake bytes', () => {
  const f = new VncReadOnlyFilter();
  expect(() =>
    f.receive(Buffer.concat([Buffer.from('RFB 003.008\n'), Buffer.from([2])])),
  ).toThrow();
});
