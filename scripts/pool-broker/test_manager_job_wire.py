"""Fixed D-Bus wire vectors, independent message builder and strict malformed rejection."""
import struct
import unittest

import manager_probe as module


def frame(kind, fields, body=b'', serial=9):
    """Independent little-endian fixture for header primitive s/o/u/g values."""
    header = bytearray()
    for code, signature, value in fields:
        header.extend(b'\0' * (-len(header) % 8))
        header.extend(bytes([code, 1]) + signature.encode() + b'\0')
        if signature == 'u': header.extend(struct.pack('<I', value))
        elif signature == 'g': header.extend(bytes([len(value)]) + value.encode() + b'\0')
        else:
            raw = value.encode()
            header.extend(struct.pack('<I', len(raw)) + raw + b'\0')
    prefix = struct.pack('<BBBBIII', 108, kind, 0, 1, len(body), serial, len(header))
    return prefix + header + b'\0' * (-len(header) % 8) + body


class JobWireTests(unittest.TestCase):
    def test_known_reply_vector_and_fixed_call_are_marshaled_with_global_alignment(self):
        self.assertTrue(callable(getattr(module, '_dbus_decode', None)), 'bounded original-job wire codec missing')
        body = struct.pack('<I', 5) + b':1.42\0'
        raw = frame(2, [(5, 'u', 1), (7, 's', 'org.freedesktop.DBus'), (8, 'g', 's')], body)
        decoded = module._dbus_decode(raw)
        self.assertEqual(decoded['body'], (':1.42',))
        self.assertEqual(decoded['headers'][5], 1)
        expected = frame(1, [(1, 'o', '/org/freedesktop/DBus'), (2, 's', 'org.freedesktop.DBus'),
                              (3, 's', 'Hello'), (6, 's', 'org.freedesktop.DBus')], serial=1)
        self.assertEqual(module._dbus_encode(1, 1, {1: '/org/freedesktop/DBus',
            2: 'org.freedesktop.DBus', 3: 'Hello', 6: 'org.freedesktop.DBus'}, '', ()), expected)

    def test_variant_job_and_invocation_bytes_are_decoded_from_independent_vectors(self):
        self.assertTrue(callable(getattr(module, '_dbus_decode', None)))
        job = b'\x04(uo)\0\0\0' + struct.pack('<II', 0, 1) + b'/\0'
        raw = frame(2, [(5, 'u', 4), (7, 's', ':1.5'), (8, 'g', 'v')], job)
        self.assertEqual(module._dbus_decode(raw)['body'], (('(uo)', (0, '/')),))
        invocation = b'\x02ay\0' + struct.pack('<I', 16) + bytes(range(16))
        raw = frame(2, [(5, 'u', 5), (7, 's', ':1.5'), (8, 'g', 'v')], invocation)
        self.assertEqual(module._dbus_decode(raw)['body'], (('ay', bytes(range(16))),))

    def test_duplicate_headers_rights_claim_bad_lengths_padding_and_signatures_rejected(self):
        self.assertTrue(callable(getattr(module, '_dbus_decode', None)))
        base = frame(2, [(5, 'u', 1), (7, 's', ':1.5')])
        bad_padding = bytearray(base); bad_padding[38] = 1
        cases = [base[:-1], base + b'\0', bytes(bad_padding),
            frame(2, [(5, 'u', 1), (5, 'u', 1)]), frame(2, [(5, 'u', 1), (9, 'u', 1)]),
            frame(2, [(5, 'u', 1), (8, 'g', 'h')], b'\0' * 4), b'x' * 32769,
            frame(4, [(1, 'o', '/org/freedesktop/systemd1'), (2, 's', 'org.freedesktop.systemd1.Manager'),
                       (3, 's', 'JobRemoved'), (8, 'g', 'uoss')], b'\0' * 4)]
        for index, raw in enumerate(cases):
            with self.subTest(index=index), self.assertRaises(ValueError): module._dbus_decode(raw)


if __name__ == '__main__': unittest.main()
