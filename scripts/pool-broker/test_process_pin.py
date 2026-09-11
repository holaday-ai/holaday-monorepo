"""Syscall-boundary unit tests, not Linux integration or client authentication."""

import contextlib
import struct
import sys
import unittest
from unittest.mock import Mock, patch

try:
    import process_pin
except ModuleNotFoundError as error:
    if error.name != "process_pin":
        raise
    process_pin = None


class ProcessPinTests(unittest.TestCase):
    @contextlib.contextmanager
    def kernel(self):
        self.assertIsNotNone(process_pin, "original process pin not implemented")
        poller = Mock()
        poller.poll.return_value = []
        with contextlib.ExitStack() as stack:
            stack.enter_context(patch.object(process_pin.sys, "platform", "linux"))
            calls = {}
            for target, name, result in (
                (process_pin.os, "geteuid", 0),
                (process_pin.os, "dup", 42),
                (process_pin.os, "set_inheritable", None),
                (process_pin.os, "open", 43),
                (process_pin.os, "read", b"pos:\t0\nflags:\t02000002\nmnt_id:\t5\nino:\t222\nPid:\t123\nNSpid:\t123\n"),
                (process_pin.os, "close", None),
                (process_pin.signal, "pidfd_send_signal", None),
                (process_pin.select, "poll", poller),
            ):
                calls[name] = stack.enter_context(patch.object(
                    target, name, return_value=result, create=True))
            calls["poller"] = poller
            yield calls

    def make(self, **changes):
        values = dict(pidfd=9, expected_pid=123, boot="1" * 32, gid=998)
        return process_pin.PinnedApplication.from_root_launch(**(values | changes))

    def sender(self, **changes):
        values = dict(pid=123, uid=998, gid=998)
        v = values | changes
        return struct.pack("=iII", v["pid"], v["uid"], v["gid"])

    def reject(self, call):
        with self.assertRaises(ValueError) as caught:
            call()
        self.assertEqual(type(caught.exception).__name__, "BrokerIdentityError")
        self.assertEqual(str(caught.exception), "POOL_BROKER_IDENTITY_UNPROVEN")
        self.assertIsNone(caught.exception.__context__)
        self.assertIsNone(caught.exception.__cause__)

    def test_owned_copy_accepts_only_the_original_process(self):
        with self.kernel() as k:
            with self.make() as pin:
                self.assertIsNone(pin.check_sender(self.sender(), "1" * 32))
                k["dup"].assert_called_once_with(9)
                k["set_inheritable"].assert_called_once_with(42, False)
            self.assertEqual([c.args for c in k["close"].call_args_list].count((42,)), 1)
            self.assertNotIn((9,), [c.args for c in k["close"].call_args_list])

    def test_close_permanently_revokes_the_pin(self):
        with self.kernel() as k:
            pin = self.make()
            pin.close()
            pin.close()
            with self.assertRaisesRegex(ValueError, "^POOL_BROKER_IDENTITY_UNPROVEN$"):
                pin.check_sender(self.sender(), "1" * 32)
            self.assertEqual([c.args for c in k["close"].call_args_list].count((42,)), 1)

    def test_mismatched_senders_do_not_revoke_the_legitimate_process(self):
        with self.kernel():
            with self.make() as pin:
                for fields in (dict(pid=124), dict(pid=0), dict(uid=999), dict(gid=999)):
                    with self.subTest(fields=fields):
                        self.reject(lambda: pin.check_sender(self.sender(**fields), "1" * 32))
                for boot in ("2" * 32, "", None, 1, [], {}):
                    self.reject(lambda: pin.check_sender(self.sender(), boot))
                self.assertIsNone(pin.check_sender(self.sender(), "1" * 32))

    def test_credentials_are_exact_native_bytes_not_coerced(self):
        class BytesSubclass(bytes):
            pass
        with self.kernel():
            with self.make() as pin:
                for value in (b"", self.sender()[:-1], self.sender() + b"x",
                              bytearray(self.sender()), BytesSubclass(self.sender()),
                              None, [], {}, "synthetic"):
                    self.reject(lambda: pin.check_sender(value, "1" * 32))

    def test_invalid_registration_rejected_before_dup(self):
        with self.kernel() as k:
            for key, values in (
                ("pidfd", [True, -1, "9", None, 9.0]),
                ("expected_pid", [True, 0, 1, -1, 2147483648, "123", None]),
                ("gid", [True, 0, -1, 4294967295, "998", None]),
                ("boot", ["0" * 32, "A" * 32, "1" * 31, "1" * 33, [], None]),
            ):
                for value in values:
                    with self.subTest(key=key, value=value):
                        self.reject(lambda: self.make(**{key: value}))
            k["dup"].assert_not_called()

    def test_non_linux_or_non_root_rejected_before_dup(self):
        with self.kernel() as k:
            with patch.object(process_pin.sys, "platform", "darwin"):
                self.reject(self.make)
            k["geteuid"].return_value = 998
            self.reject(self.make)
            k["dup"].assert_not_called()

    @unittest.skipIf(sys.platform == "linux", "native non-Linux rejection only")
    def test_actual_non_linux_environment_fails_closed_without_mock(self):
        self.assertIsNotNone(process_pin)
        self.reject(self.make)

    def test_missing_native_capability_rejected_before_dup(self):
        with self.kernel() as k:
            for target, name in ((process_pin.signal, "pidfd_send_signal"),
                                 (process_pin.select, "poll")):
                with patch.object(target, name, None):
                    self.reject(self.make)
            k["dup"].assert_not_called()

    def test_direct_construction_cannot_create_a_pin(self):
        self.assertIsNotNone(process_pin)
        with self.assertRaises(TypeError):
            process_pin.PinnedApplication()

    def test_dup_failure_does_not_close_borrowed_fd(self):
        with self.kernel() as k:
            k["dup"].side_effect = OSError("synthetic-private-marker")
            self.reject(self.make)
            k["close"].assert_not_called()

    def test_factory_failures_close_only_owned_descriptors(self):
        for failed in ("set_inheritable", "pidfd_send_signal", "open", "read"):
            with self.subTest(failed=failed), self.kernel() as k:
                k[failed].side_effect = OSError("synthetic-private-marker")
                self.reject(self.make)
                closed = [c.args for c in k["close"].call_args_list]
                self.assertEqual(closed.count((42,)), 1)
                self.assertNotIn((9,), closed)
                self.assertEqual(closed.count((43,)), int(failed == "read"))

    def test_fdinfo_must_name_exactly_the_original_process(self):
        for content in (b"", b"Pid:\t124\n", b"Pid:\t-1\n", b"Pid:\t0\n",
                        b"Pid:\t123\nPid:\t123\n", b"Pid:\t123x\n",
                        b"Pid:\t123\n" + b" " * 8192):
            with self.subTest(size=len(content)), self.kernel() as k:
                k["read"].return_value = content
                self.reject(self.make)
                closed = [c.args for c in k["close"].call_args_list]
                self.assertEqual(closed.count((42,)), 1)
                self.assertEqual(closed.count((43,)), 1)

    def test_kernel_checks_use_only_owned_fd_and_signal_zero(self):
        with self.kernel() as k:
            with self.make() as pin:
                pin.check_sender(self.sender(), "1" * 32)
                self.assertGreater(len(k["pidfd_send_signal"].call_args_list), 0)
                for c in k["pidfd_send_signal"].call_args_list:
                    self.assertEqual(c.args, (42, 0, None, 0))
                for c in k["open"].call_args_list:
                    self.assertEqual(c.args[0], "/proc/self/fdinfo/42")
                    self.assertTrue(c.args[1] & process_pin.os.O_CLOEXEC)
                    self.assertTrue(c.args[1] & process_pin.os.O_NOFOLLOW)
                for c in k["read"].call_args_list:
                    self.assertEqual(c.args, (43, 8193))

    def test_any_exit_or_poll_error_permanently_revokes(self):
        for event in (1, 8, 16, 32):
            with self.subTest(event=event), self.kernel() as k:
                pin = self.make()
                k["poller"].poll.return_value = [(42, event)]
                self.reject(lambda: pin.check_sender(self.sender(), "1" * 32))
                k["poller"].poll.return_value = []
                self.reject(lambda: pin.check_sender(self.sender(), "1" * 32))
                pin.close()
                self.assertEqual([c.args for c in k["close"].call_args_list].count((42,)), 1)

    def test_observation_errors_permanently_revoke(self):
        for failed in ("pidfd_send_signal", "open", "read", "poll"):
            with self.subTest(failed=failed), self.kernel() as k:
                pin = self.make()
                call = k["poller"].poll if failed == "poll" else k[failed]
                call.side_effect = OSError("synthetic-private-marker")
                self.reject(lambda: pin.check_sender(self.sender(), "1" * 32))
                call.side_effect = None
                self.reject(lambda: pin.check_sender(self.sender(), "1" * 32))
                pin.close()

    def test_process_exit_during_check_is_not_accepted(self):
        with self.kernel() as k:
            pin = self.make()
            k["poller"].poll.side_effect = [[], [(42, 1)]]
            self.reject(lambda: pin.check_sender(self.sender(), "1" * 32))
            pin.close()

    def test_close_error_does_not_retry_or_revive_fd(self):
        with self.kernel() as k:
            pin = self.make()
            k["close"].reset_mock()
            k["close"].side_effect = OSError("synthetic-private-marker")
            self.reject(pin.close)
            pin.close()
            self.reject(lambda: pin.check_sender(self.sender(), "1" * 32))
            k["close"].assert_called_once_with(42)

    def test_fdinfo_close_failure_releases_pin_without_retry(self):
        with self.kernel() as k:
            k["close"].side_effect = lambda fd: (_ for _ in ()).throw(
                OSError("synthetic-private-marker")) if fd == 43 else None
            self.reject(self.make)
            self.assertEqual([c.args for c in k["close"].call_args_list], [(43,), (42,)])

    def test_repr_does_not_disclose_registration_fields(self):
        with self.kernel():
            with self.make() as pin:
                text = repr(pin)
                self.assertNotIn("1" * 32, text)
                self.assertNotIn("pid=", text)
                self.assertNotIn("gid=", text)

    def test_rejections_do_not_retain_an_outer_exception_context(self):
        with self.kernel() as k:
            with self.make() as pin:
                try:
                    raise RuntimeError("synthetic-private-outer-marker")
                except RuntimeError:
                    self.reject(lambda: pin.check_sender(self.sender(pid=124), "1" * 32))
                    k["dup"].side_effect = OSError("synthetic-private-inner-marker")
                    self.reject(self.make)

    def test_context_manager_close_error_does_not_retain_body_data(self):
        with self.kernel() as k:
            def run():
                with self.make():
                    k["close"].side_effect = OSError("synthetic-private-close-marker")
                    raise RuntimeError("synthetic-private-body-marker")
            self.reject(run)


if __name__ == "__main__":
    unittest.main()
