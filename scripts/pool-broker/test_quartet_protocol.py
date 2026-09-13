"""Versioned whole-group data only; the legacy role decoder is not widened."""
import json
import traceback
import unittest

import protocol
try:
    import quartet_protocol
except ModuleNotFoundError as error:
    if error.name != 'quartet_protocol':
        raise
    quartet_protocol = None


class QuartetProtocolTests(unittest.TestCase):
    def test_data_key_is_a_distinct_domain_bound_child_not_management(self):
        derive = getattr(quartet_protocol, '_derive_data_key', None)
        self.assertTrue(callable(derive), 'private data subkey derivation missing')
        values = ('01' * 32, 'aa' * 20, 'bb' * 16, 'cc' * 16)
        key = derive(*values)
        # Independently computed with OpenSSL HMAC over fixed HKDF info+counter.
        self.assertEqual(key, '3ad7d9903c4c0e86b9ad2dc55e1f4fa194cc55181fd2bd9bf0daa3305a49361a')
        self.assertEqual(len(key), 64)
        self.assertNotEqual(key, values[0])
        for index in range(4):
            changed = list(values)
            changed[index] = ('02' if index == 0 else 'dd') * (len(values[index]) // 2)
            self.assertNotEqual(derive(*changed), key)
        for invalid in (None, True, '', '0' * 64, 'A' * 64):
            with self.assertRaises(ValueError): derive(invalid, *values[1:])

    def test_bad_data_key_input_does_not_retain_caller_error_context(self):
        try:
            raise ValueError('synthetic caller detail')
        except ValueError:
            with self.assertRaises(ValueError) as caught:
                quartet_protocol._derive_data_key(None, 'a' * 40, 'b' * 32, 'c' * 32)
        self.assertIsNone(caught.exception.__context__)

    def create(self, **changes):
        return {'version': 2, 'action': 'create', 'requestId': '1'*32,
                'boot': '2'*32, 'slot': 0} | changes

    def resource(self, action='query', **changes):
        return {'version': 2, 'action': action, 'requestId': '1'*32,
                'boot': '2'*32, 'capability': '3'*64} | changes

    def decode(self, payload):
        self.assertIsNotNone(quartet_protocol, 'whole-group decoder missing')
        return quartet_protocol.decode_quartet_request(payload)

    def encode(self, value):
        return json.dumps(value, separators=(',', ':')).encode()

    def denied(self, raw):
        self.assertIsNotNone(quartet_protocol, 'whole-group decoder missing')
        with self.assertRaises(ValueError) as caught:
            self.decode(raw)
        self.assertEqual(str(caught.exception), 'POOL_BROKER_QUARTET_REQUEST_INVALID')
        self.assertIsNone(caught.exception.__context__)
        self.assertIsNone(caught.exception.__cause__)

    def test_create_is_a_whole_group_without_caller_selected_role(self):
        for slot in (0, 31):
            r = self.decode(self.encode(self.create(slot=slot)))
            self.assertEqual((r.version, r.action, r.slot, r.request_id, r.boot),
                             (2, 'create', slot, '1'*32, '2'*32))
            self.assertFalse(hasattr(r, 'component'))
            with self.assertRaises(AttributeError):
                r.slot = 1
            # Old sockets must not start treating whole-group requests as roles.
            with self.assertRaises(protocol.BrokerRequestError):
                protocol.decode_request(self.encode(self.create(slot=slot)))

    def test_query_and_close_remain_distinct_and_private(self):
        for action in ('query', 'close'):
            r = self.decode(self.encode(self.resource(action)))
            self.assertEqual((r.version, r.action, r.capability), (2, action, '3'*64))
            for private in ('1'*32, '2'*32, '3'*64):
                self.assertNotIn(private, repr(r))
            with self.assertRaises(AttributeError):
                r.action = 'create'
        self.assertNotIn('1'*32, repr(self.decode(self.encode(self.create()))))

    def test_all_legacy_role_shapes_and_unknown_execution_fields_are_denied(self):
        for component in ('xvfb', 'brave', 'x11vnc', 'websockify', 'quartet'):
            self.denied(self.encode(self.create(version=1, component=component)))
            self.denied(self.encode(self.create(component=component)))
        for obj in (self.create(), self.resource(), self.resource('close')):
            for field in ('command', 'args', 'env', 'path', 'pid', 'pgid', 'unit',
                          'namespace', 'uid', 'gid', 'shell', 'endpoint', 'egressCapability'):
                self.denied(self.encode(obj | {field: 'synthetic-forbidden'}))
            for field in tuple(obj):
                self.denied(self.encode({k: v for k, v in obj.items() if k != field}))

    def test_version_slot_and_action_types_are_not_coerced(self):
        for version in (1, True, False, 2.0, '2', 0, 3, None, [], {}):
            self.denied(self.encode(self.create(version=version)))
        for slot in (True, False, 0.0, '0', -1, 32, None, [], {}):
            self.denied(self.encode(self.create(slot=slot)))
        for action in ('restart', 'kill', 'CREATE', 'query ', '', None, 1, [], {}):
            self.denied(self.encode(self.resource(action)))
        self.denied(self.encode(self.create(capability='3'*64)))
        self.denied(self.encode(self.resource(slot=0)))

    def test_identifiers_are_exact_nonzero_lowercase_hex(self):
        for key, count in (('requestId', 32), ('boot', 32), ('capability', 64)):
            for bad in ('', '0'*count, 'A'*count, 'g'*count, '1'*(count-1),
                        '1'*(count+1), '1'*(count-1)+'\n', '１'*count, 1, None, [], {}):
                self.denied(self.encode(self.resource(**{key: bad})))

    def test_bytes_size_duplicates_constants_and_top_level_are_strict(self):
        raw = self.encode(self.create())
        self.assertEqual(self.decode(raw + b' '*(4096-len(raw))).slot, 0)
        self.denied(raw + b' '*(4097-len(raw)))
        for invalid in (b'', b' ', b'{', b'\xff', b'\xef\xbb\xbf'+raw,
                        raw+raw, b'['*1800+b']'*1800,
                        b'{"version":2,'+raw[1:], b'{"ver\\u0073ion":2,'+raw[1:]):
            self.denied(invalid)
        for value in ([], None, True, 'synthetic', 1):
            self.denied(self.encode(value))
        for value in (float('nan'), float('inf'), float('-inf')):
            self.denied(self.encode(self.create(slot=value)))
        class BytesSubclass(bytes):
            pass
        for invalid in (raw.decode(), bytearray(raw), memoryview(raw), BytesSubclass(raw), {}, None):
            self.denied(invalid)

    def test_error_does_not_retain_parser_or_outer_private_text(self):
        self.assertIsNotNone(quartet_protocol, 'whole-group decoder missing')
        raw = b'{"synthetic-private-marker":NaN,broken}'
        try:
            raise RuntimeError('synthetic-private-marker')
        except RuntimeError:
            try:
                self.decode(raw)
            except ValueError as error:
                self.assertIsNone(error.__context__)
                self.assertIsNone(error.__cause__)
                rendered = ''.join(traceback.format_exception(type(error), error, error.__traceback__))
                self.assertNotIn('synthetic-private-marker', rendered)
                self.assertNotIn('JSONDecodeError', rendered)
            else:
                self.fail('malformed group frame accepted')
        self.assertEqual(self.decode(self.encode(self.resource('close'))).action, 'close')


if __name__ == '__main__':
    unittest.main()
