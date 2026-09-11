"""Pure request-boundary tests; no socket, process, filesystem or platform mocks."""

import json
import traceback
import unittest

try:
    import protocol
except ModuleNotFoundError as error:
    if error.name != "protocol":
        raise
    protocol = None


class RequestBoundaryTests(unittest.TestCase):
    def create(self, **overrides):
        value = {
            "version": 1,
            "action": "create",
            "requestId": "1" * 32,
            "boot": "2" * 32,
            "component": "brave",
            "slot": 0,
        }
        return {**value, **overrides}

    def resource(self, action="query", **overrides):
        return {
            "version": 1,
            "action": action,
            "requestId": "1" * 32,
            "boot": "2" * 32,
            "capability": "3" * 64,
            **overrides,
        }

    def decode(self, value):
        self.assertIsNotNone(protocol, "broker request decoder is not implemented")
        return protocol.decode_request(value)

    def encode(self, value):
        return json.dumps(value, separators=(",", ":")).encode("utf-8")

    def test_create_preserves_each_allowed_component_and_slot(self):
        for component in ("xvfb", "brave", "x11vnc", "websockify"):
            for slot in (0, 31):
                with self.subTest(component=component, slot=slot):
                    result = self.decode(self.encode(self.create(component=component, slot=slot)))
                    self.assertEqual((result.action, result.component, result.slot),
                                     ("create", component, slot))
                    self.assertEqual((result.version, result.request_id, result.boot),
                                     (1, "1" * 32, "2" * 32))

    def test_query_preserves_opaque_resource_reference(self):
        result = self.decode(self.encode(self.resource()))
        self.assertEqual((result.action, result.capability), ("query", "3" * 64))

    def test_close_is_distinct_from_query(self):
        result = self.decode(self.encode(self.resource("close")))
        self.assertEqual((result.action, result.capability), ("close", "3" * 64))

    def test_validated_request_cannot_be_mutated_to_another_action(self):
        result = self.decode(self.encode(self.resource()))
        with self.assertRaises(AttributeError):
            result.action = "create"

    def reject(self, payload):
        with self.assertRaises(ValueError) as caught:
            self.decode(payload)
        self.assertEqual(type(caught.exception).__name__, "BrokerRequestError")
        self.assertEqual(str(caught.exception), "POOL_BROKER_REQUEST_INVALID")

    def test_arbitrary_execution_fields_are_rejected_on_every_action(self):
        for value in (self.create(), self.resource(), self.resource("close")):
            for key in ("command", "args", "env", "path", "pid", "pgid", "unit", "uid", "gid", "shell"):
                with self.subTest(action=value["action"], key=key):
                    self.reject(self.encode({**value, key: "synthetic-forbidden"}))

    def test_unknown_field_is_not_ignored(self):
        self.reject(self.encode(self.create(unknown=1)))

    def test_action_specific_fields_cannot_be_mixed(self):
        self.reject(self.encode(self.create(capability="3" * 64)))
        self.reject(self.encode(self.resource(slot=0)))
        self.reject(self.encode(self.resource("close", component="brave")))

    def test_required_fields_cannot_be_missing(self):
        for value in (self.create(), self.resource(), self.resource("close")):
            for key in tuple(value):
                with self.subTest(action=value["action"], missing=key):
                    reduced = {k: v for k, v in value.items() if k != key}
                    self.reject(self.encode(reduced))

    def test_version_does_not_accept_boolean_float_or_coercion(self):
        for version in (True, False, 1.0, "1", 0, 2, None, [], {}):
            with self.subTest(version=version):
                self.reject(self.encode(self.create(version=version)))

    def test_slot_does_not_accept_boolean_float_or_out_of_range(self):
        for slot in (True, False, 0.0, "0", -1, 32, 100000, None, [], {}):
            with self.subTest(slot=slot):
                self.reject(self.encode(self.create(slot=slot)))

    def test_unknown_or_structured_action_is_rejected(self):
        for action in ("restart", "kill", "CREATE", "create ", "", None, 1, [], {}):
            with self.subTest(action=action):
                self.reject(self.encode(self.resource(action)))

    def test_unknown_or_structured_component_is_rejected(self):
        for component in ("chromium", "bash", "Brave", "brave ", "", None, 1, [], {}):
            with self.subTest(component=component):
                self.reject(self.encode(self.create(component=component)))

    def test_common_identifiers_are_exact_nonzero_lowercase_ascii_hex(self):
        bad = ("", "0" * 32, "A" * 32, "g" * 32, "1" * 31, "1" * 33,
               "1" * 31 + "\n", "１" * 32, None, 123, [], {})
        for key in ("requestId", "boot"):
            for value in bad:
                with self.subTest(key=key, kind=type(value).__name__):
                    self.reject(self.encode(self.create(**{key: value})))

    def test_resource_capability_is_exact_nonzero_lowercase_ascii_hex(self):
        for capability in ("", "0" * 64, "A" * 64, "g" * 64, "3" * 63, "3" * 65,
                           "３" * 64, "3" * 63 + "\n", None, 123, [], {}):
            with self.subTest(kind=type(capability).__name__):
                self.reject(self.encode(self.resource(capability=capability)))

    def test_duplicate_keys_are_rejected_even_when_values_agree(self):
        payload = self.encode(self.create())
        self.reject(b'{"version":1,' + payload[1:])
        self.reject(b'{"version":2,' + payload[1:])
        self.reject(b'{"ver\\u0073ion":1,' + payload[1:])

    def test_nonstandard_json_constants_are_rejected(self):
        for value in (float("nan"), float("inf"), float("-inf")):
            self.reject(self.encode(self.create(slot=value)))

    def test_only_exact_bytes_are_accepted(self):
        payload = self.encode(self.create())
        class BytesSubclass(bytes):
            pass
        for value in (payload.decode(), bytearray(payload), memoryview(payload),
                      BytesSubclass(payload), None, 0, {}, []):
            with self.subTest(kind=type(value).__name__):
                self.reject(value)

    def test_invalid_utf8_and_bom_are_rejected(self):
        self.reject(b"\xff")
        self.reject(b"\xef\xbb\xbf" + self.encode(self.create()))
        self.reject(self.encode(self.create()).decode().encode("utf-16"))

    def test_top_level_must_be_a_single_object(self):
        for value in ([], None, 1, "synthetic-value", True):
            with self.subTest(kind=type(value).__name__):
                self.reject(self.encode(value))
        self.reject(self.encode(self.create()) + self.encode(self.create()))

    def test_empty_malformed_and_deep_payload_have_fixed_errors(self):
        for payload in (b"", b" ", b"{", b'{"slot":', b"[" * 1800 + b"]" * 1800):
            with self.subTest(size=len(payload)):
                self.reject(payload)

    def test_byte_limit_applies_before_json_whitespace_is_removed(self):
        payload = self.encode(self.create())
        exact = payload + b" " * (4096 - len(payload))
        self.assertEqual(self.decode(exact).slot, 0)
        self.reject(exact + b" ")

    def test_legal_outer_whitespace_does_not_change_request(self):
        self.assertEqual(self.decode(b" \n" + self.encode(self.create()) + b"\t\r").action,
                         "create")

    def test_default_representation_does_not_disclose_private_fields(self):
        for value in (self.create(), self.resource(), self.resource("close")):
            rendered = repr(self.decode(self.encode(value)))
            for key in ("requestId", "boot", "capability"):
                if key in value:
                    self.assertNotIn(value[key], rendered)

    def test_formatted_exception_does_not_include_raw_parser_error(self):
        for payload in (b'{"synthetic-private-marker": NaN, broken}',
                        b'{"synthetic-private-marker": broken}',
                        b'synthetic-private-marker\xff'):
            with self.subTest(size=len(payload)):
                try:
                    self.decode(payload)
                except Exception as error:
                    formatted = "".join(traceback.format_exception(
                        type(error), error, error.__traceback__))
                    self.assertNotIn("JSONDecodeError", formatted)
                    self.assertNotIn("UnicodeDecodeError", formatted)
                    self.assertNotIn("synthetic-private-marker", formatted)
                    self.assertEqual(str(error), "POOL_BROKER_REQUEST_INVALID")
                    self.assertIsNone(error.__context__)
                    self.assertIsNone(error.__cause__)
                else:
                    self.fail("malformed request accepted")

    def test_rejected_request_does_not_pollute_the_next_decode(self):
        self.reject(self.encode(self.create(command="synthetic")))
        self.assertEqual(self.decode(self.encode(self.resource("close"))).action, "close")

    def test_rejection_does_not_retain_callers_active_exception(self):
        try:
            raise RuntimeError("synthetic-private-outer-marker")
        except RuntimeError:
            with self.assertRaises(ValueError) as caught:
                self.decode(b"{")
            self.assertEqual(str(caught.exception), "POOL_BROKER_REQUEST_INVALID")
            self.assertIsNone(caught.exception.__context__)
            self.assertIsNone(caught.exception.__cause__)


if __name__ == "__main__":
    unittest.main()
