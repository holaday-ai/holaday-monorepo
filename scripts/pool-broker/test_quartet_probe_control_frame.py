"""Closed metadata frame only; no endpoint, grant or dispatch from parsing."""
import copy
import struct
import unittest
import quartet_worker_guard as guard

BINDING = {'candidate': 'a' * 40, 'resource': 'b' * 32, 'application': {'boot': 'c' * 32}}
FRAME = struct.Struct('!4sBB20s16s16s16sI32sQQ')


class ProbeControlFrameTests(unittest.TestCase):
    def functions(self):
        encode, decode = getattr(guard, '_probe_control_frame', None), getattr(guard, '_decode_probe_control_frame', None)
        self.assertTrue(callable(encode) and callable(decode), 'closed HPT1 frame missing')
        return encode, decode

    def test_all_fixed_phases_have_one_canonical_wire_and_scope(self):
        encode, decode = self.functions()
        for kind, stage, millis in ((1, 0, 0), (2, 0, 60000), (3, 0, 60000), (4, 1, 5000),
                                    (5, 2, 4999), (6, 1, 5000), (6, 2, 5000), (6, 3, 5000), (6, 4, 5000), (7, 4, 5000)):
            with self.subTest(kind=kind):
                invocation, pid = ('0' * 32, 0) if kind == 1 else ('d' * 32, 321)
                total = 0 if kind == 1 else 60000
                wire = encode(kind, stage, BINDING, invocation, pid, b'n' * 32, total, millis)
                self.assertEqual(len(wire), FRAME.size)
                self.assertEqual(FRAME.unpack(wire)[:3], (b'HPT1', kind, stage))
                self.assertEqual(decode(wire, BINDING), (kind, stage, invocation, pid, b'n' * 32, total, millis))

    def test_cross_scope_extra_bytes_unknown_phases_and_invalid_bounds_deny(self):
        encode, decode = self.functions()
        wire = encode(4, 1, BINDING, 'd' * 32, 321, b'n' * 32, 60000, 5000)
        for offset in (0, 4, 5, 6, 26, 42):
            value = wire[:offset] + bytes([wire[offset] ^ 128]) + wire[offset + 1:]
            with self.subTest(offset=offset), self.assertRaises(ValueError): decode(value, BINDING)
        for value in (b'', wire[:-1], wire + b'x'):
            with self.assertRaises(ValueError): decode(value, BINDING)
        for kind, stage, invocation, pid, nonce, millis in ((True, 1, 'd' * 32, 321, b'n' * 32, 5000),
                (4, 0, 'd' * 32, 321, b'n' * 32, 5000), (4, 1, '0' * 32, 321, b'n' * 32, 5000),
                (4, 1, 'd' * 32, True, b'n' * 32, 5000), (4, 1, 'd' * 32, 321, bytes(32), 5000),
                (4, 1, 'd' * 32, 321, b'n' * 32, 2**63), (6, 0, 'd' * 32, 321, b'n' * 32, 5000)):
            with self.assertRaises(ValueError): encode(kind, stage, BINDING, invocation, pid, nonce, 60000, millis)
        for total, phase in ((0, 0), (2**63, 1), (5000, 5001), (60000, True)):
            with self.assertRaises(ValueError): encode(4, 1, BINDING, 'd' * 32, 321, b'n' * 32, total, phase)


if __name__ == '__main__': unittest.main()
