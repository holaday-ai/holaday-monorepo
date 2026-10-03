"""Closed v2 application control frames. All fields are synthetic."""
import hashlib
import json
import struct
import unittest

import quartet_protocol as protocol


class ControlCodecTests(unittest.TestCase):
    def prepared(self):
        return {'version': 2, 'phase': 'prepared', 'requestId': 'a'*32,
            'candidate': 'c'*40, 'boot': 'b'*32, 'slot': 0, 'resource': 'd'*32,
            'capability': 'e'*64, 'egressCapability': 'f'*64, 'nonce': '1'*64}

    def wire(self, value):
        raw = json.dumps(value, sort_keys=True, separators=(',', ':')).encode('ascii')
        return struct.pack('!I', len(raw)) + raw

    def test_canonical_prepared_and_digest_cover_entire_exact_frame(self):
        self.assertTrue(callable(getattr(protocol, 'encode_control_frame', None)), 'control codec missing')
        value = self.prepared()
        encoded = protocol.encode_control_frame(value)
        self.assertEqual(encoded, self.wire(value))
        self.assertEqual(protocol.decode_control_frame(encoded), value)
        self.assertEqual(protocol.control_prepared_digest(encoded), hashlib.sha256(encoded).hexdigest())
        for key in ('candidate', 'boot', 'resource', 'capability', 'egressCapability', 'nonce', 'requestId'):
            changed = value | {key: '2'*len(value[key])}
            self.assertNotEqual(protocol.control_prepared_digest(protocol.encode_control_frame(changed)),
                                protocol.control_prepared_digest(encoded))

    def test_only_closed_request_prepared_accepted_ready_shapes_are_valid(self):
        self.assertTrue(callable(getattr(protocol, 'encode_control_frame', None)), 'control codec missing')
        prepared = self.prepared()
        scope = {key: prepared[key] for key in ('version', 'requestId', 'candidate', 'boot', 'resource', 'slot')}
        for phase in ('accepted', 'ready'):
            value = scope | {'phase': phase, 'preparedDigest': '3'*64}
            self.assertEqual(protocol.decode_control_frame(protocol.encode_control_frame(value)), value)
            with self.assertRaises(ValueError): protocol.control_prepared_digest(protocol.encode_control_frame(value))
        request = {'version': 2, 'action': 'create', 'requestId': 'a'*32, 'boot': 'b'*32, 'slot': 0}
        self.assertEqual(protocol.decode_control_frame(protocol.encode_control_frame(request)), request)
        for change in ({'phase': 'unknown'}, {'slot': True}, {'slot': 32}, {'capability': 'f'*64},
                {'nonce': '0'*64}, {'groupExitProven': True}, {'pid': 123}, {'message': 'synthetic'}):
            with self.subTest(change=tuple(change)), self.assertRaises(ValueError):
                protocol.decode_control_frame(self.wire(prepared | change))

    def test_noncanonical_duplicate_trailing_and_oversize_bytes_are_rejected(self):
        self.assertTrue(callable(getattr(protocol, 'decode_control_frame', None)), 'control codec missing')
        wire = self.wire(self.prepared())
        raw = wire[4:]
        duplicate = b'{"version":2,' + raw[1:]
        spaced = json.dumps(self.prepared()).encode()
        for bad in (wire + b'0', wire[:-1], struct.pack('!I', 4097) + b' '*4097,
                struct.pack('!I', 0), struct.pack('!I', len(raw)) + raw + wire,
                struct.pack('!I', len(duplicate)) + duplicate,
                struct.pack('!I', len(spaced)) + spaced, bytearray(wire)):
            with self.subTest(length=len(bad)), self.assertRaises(ValueError): protocol.decode_control_frame(bad)


if __name__ == '__main__': unittest.main()
