"""Closed anchor-only LoadCredential data; never grants a live connection."""
import copy
import json
import unittest
import quartet_worker_guard as guard


class EgressBindingTests(unittest.TestCase):
    def binding(self):
        return {'version': 1, 'candidate': 'a' * 40, 'resource': 'b' * 32,
            'boot': 'c' * 32, 'key': 'd' * 64, 'leaf': {'device': 1, 'inode': 2}}

    def decode(self, value):
        return guard._decode_egress_binding(json.dumps(value).encode(), 'a' * 40, 'b' * 32, 'c' * 32)

    def test_exact_fixed_scope_and_no_additional_identity_or_path_input(self):
        self.assertEqual(self.decode(self.binding()), self.binding())
        for key, value in (('version', True), ('candidate', 'e' * 40), ('resource', 'e' * 32),
                ('boot', 'e' * 32), ('key', '0' * 64), ('path', '/tmp/other'), ('pid', 123)):
            with self.subTest(key=key):
                data = self.binding(); data[key] = value
                with self.assertRaises(ValueError): self.decode(data)

    def test_leaf_is_unsigned_exact_integer_identity(self):
        for leaf in ({'device': -1, 'inode': 2}, {'device': True, 'inode': 2},
                {'device': 1, 'inode': 0}, {'device': 1, 'inode': 2**64},
                {'device': 1, 'inode': 2, 'path': 'extra'}, []):
            with self.subTest(leaf=leaf):
                data = self.binding(); data['leaf'] = copy.deepcopy(leaf)
                with self.assertRaises(ValueError): self.decode(data)

    def test_duplicate_and_oversized_input_are_rejected(self):
        for raw in (b'{"version":1,"version":1}', b' ' * 2049, b'null'):
            with self.assertRaises(ValueError):
                guard._decode_egress_binding(raw, 'a' * 40, 'b' * 32, 'c' * 32)
