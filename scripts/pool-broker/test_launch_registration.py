"""Registration transaction boundary tests; not native Linux validation."""

import array
import contextlib
import inspect
import socket
import struct
import sys
import unittest
from unittest.mock import Mock, patch

import process_pin
import test_launch_authorization as auth_tests

try:
    import launch_registration
except ModuleNotFoundError as error:
    if error.name != "launch_registration":
        raise
    launch_registration = None


class LaunchRegistrationTests(unittest.TestCase):
    @contextlib.contextmanager
    def kernel(self):
        self.assertIsNotNone(launch_registration, "root registration not implemented")
        with contextlib.ExitStack() as stack:
            stack.enter_context(patch.object(sys, "platform", "linux"))
            for name, value in (("SCM_CREDENTIALS", 2), ("SO_PASSCRED", 16),
                                ("SO_PEERCRED", 17), ("MSG_CMSG_CLOEXEC", 0x40000000)):
                stack.enter_context(patch.object(socket, name, value, create=True))
            calls = {}
            for target, name, value in (
                (process_pin.os, "geteuid", 0), (process_pin.os, "getuid", 0),
                (process_pin.os, "getgid", 0), (process_pin.os, "getpid", 123),
                (process_pin.os, "pidfd_open", 9), (process_pin.os, "dup", 42),
                (process_pin.os, "set_inheritable", None), (process_pin.os, "close", None),
                (process_pin.os, "open", 43),
                (process_pin.os, "read", b"Pid:\t123\nNSpid:\t123\n"),
                (process_pin.signal, "pidfd_send_signal", None),
            ):
                calls[name] = stack.enter_context(patch.object(target, name, return_value=value, create=True))
            poller = Mock()
            poller.poll.return_value = []
            calls["poller"] = poller
            stack.enter_context(patch.object(process_pin.select, "poll", return_value=poller))
            yield calls

    def packet(self, ack=False):
        return (b"HDPLACK1" if ack else b"HDPLREG1") + b"\xaa" * 20 + b"\xbb" * 16 + b"\x00\x00\x03\xe6"

    def channel(self, *, server=False):
        channel = Mock(spec=socket.socket)
        channel.family = socket.AF_UNIX
        peer = struct.pack("=iII", 123 if server else 456, 0, 0)
        channel.getsockopt.side_effect = lambda level, opt, *args: (
            socket.SOCK_SEQPACKET if opt == socket.SO_TYPE else peer)
        ancillary = [(socket.SOL_SOCKET, socket.SCM_CREDENTIALS, peer)]
        if server:
            ancillary.append((socket.SOL_SOCKET, socket.SCM_RIGHTS, array.array("i", [9]).tobytes()))
        channel.recvmsg.return_value = (self.packet(ack=not server), ancillary, 0, None)
        channel.sendmsg.return_value = 48
        return channel

    def test_sender_transfers_its_own_pidfd_and_waits_for_exact_ack(self):
        with self.kernel() as k:
            channel = self.channel()
            self.assertIsNone(launch_registration.register_self(channel, "a" * 40, "b" * 32, 998))
            k["pidfd_open"].assert_called_once_with(123, 0)
            k["close"].assert_called_once_with(9)
            sent = channel.sendmsg.call_args.args
            self.assertEqual(sent[0], [self.packet()])
            self.assertEqual(sent[1], [(socket.SOL_SOCKET, socket.SCM_RIGHTS, array.array("i", [9]).tobytes())])
            self.assertEqual(channel.recvmsg.call_count, 1)
            channel.close.assert_called_once()

    def test_receiver_holds_original_pin_before_ack_and_rejects_second_attempt(self):
        with self.kernel() as k:
            channel = self.channel(server=True)
            registration = launch_registration.LaunchRegistration("a" * 40, 998)
            self.assertIsNone(registration.receive(channel))
            k["pidfd_open"].assert_not_called()
            k["dup"].assert_called_once_with(9)
            self.assertEqual(channel.sendmsg.call_args.args[0], [self.packet(ack=True)])
            self.assertNotIn((42,), [c.args for c in k["close"].call_args_list])
            second = self.channel(server=True)
            with self.assertRaises(ValueError):
                registration.receive(second)
            second.recvmsg.assert_not_called()
            registration.close()
            self.assertEqual([c.args for c in k["close"].call_args_list].count((42,)), 1)
            self.assertEqual([c.args for c in k["close"].call_args_list].count((9,)), 1)
            channel.close.assert_called_once()

    def reject(self, call):
        with self.assertRaises(ValueError) as caught:
            call()
        self.assertEqual(type(caught.exception).__name__, "BrokerRegistrationError")
        self.assertEqual(str(caught.exception), "POOL_BROKER_REGISTRATION_UNPROVEN")
        self.assertIsNone(caught.exception.__context__)
        self.assertIsNone(caught.exception.__cause__)

    def send(self, channel, **changes):
        args = dict(candidate="a" * 40, boot="b" * 32, gid=998) | changes
        return launch_registration.register_self(channel, **args)

    def receiver(self):
        return launch_registration.LaunchRegistration("a" * 40, 998)

    @contextlib.contextmanager
    def launch_window(self):
        self.assertIn('window', inspect.signature(launch_registration.LaunchRegistration.receive).parameters,
                      'registration does not consume the real launch window')
        with auth_tests.AuthorizationTests().system() as fs:
            window = auth_tests.launch_authorization.consume_launch_authorization('a' * 40)
            clock = fs.clock
        with self.kernel() as kernel, patch.object(launch_registration.time, 'time', lambda: clock[0]), \
                patch.object(launch_registration.time, 'monotonic', lambda: clock[1]):
            yield window, clock, kernel

    def test_receiver_uses_actual_consumed_window_and_original_pin(self):
        with self.launch_window() as (window, clock, kernel):
            channel = self.channel(server=True)
            registration = self.receiver()
            registration.receive(channel, window=window)
            self.assertEqual(channel.sendmsg.call_args.args[0], [self.packet(ack=True)])
            self.assertIsInstance(registration._pin, process_pin.PinnedApplication)
            registration.close()
            self.assertEqual([call.args for call in kernel['close'].call_args_list].count((42,)), 1)

    def test_wall_clock_expiry_during_pin_prevents_ack(self):
        with self.launch_window() as (window, clock, kernel):
            channel = self.channel(server=True)
            def expired(*args):
                clock[0] = 130.0
                return b'Pid:\t123\nNSpid:\t123\n'
            kernel['read'].side_effect = expired
            self.reject(lambda: self.receiver().receive(channel, window=window))
            channel.sendmsg.assert_not_called()
            self.assertEqual([call.args for call in kernel['close'].call_args_list].count((42,)), 1)

    def test_wall_clock_expiry_during_fd_close_prevents_ack(self):
        with self.launch_window() as (window, clock, kernel):
            channel = self.channel(server=True)
            def expired(fd):
                if fd == 9:
                    clock[0] = 130.0
            kernel['close'].side_effect = expired
            self.reject(lambda: self.receiver().receive(channel, window=window))
            channel.sendmsg.assert_not_called()

    def test_wall_clock_expiry_in_final_socket_cleanup_revokes_registration(self):
        with self.launch_window() as (window, clock, kernel):
            channel = self.channel(server=True)
            channel.close.side_effect = lambda: clock.__setitem__(0, 130.0)
            self.reject(lambda: self.receiver().receive(channel, window=window))
            self.assertEqual([call.args for call in kernel['close'].call_args_list].count((42,)), 1)

    def test_window_can_shorten_but_not_extend_default_registration_deadline(self):
        with self.launch_window() as (window, clock, kernel):
            clock[0] = 129.5
            channel = self.channel(server=True)
            registration = self.receiver()
            registration.receive(channel, window=window)
            self.assertTrue(all(0 < call.args[0] <= 0.5 for call in channel.settimeout.call_args_list))
            registration.close()

    def test_sender_rejects_invalid_trusted_parameters_before_opening_pidfd(self):
        with self.kernel() as k:
            for key, values in (("candidate", [None, "", "a" * 39, "A" * 40, "0" * 40]),
                                ("boot", [None, "", "b" * 31, "B" * 32, "0" * 32]),
                                ("gid", [True, 0, -1, 4294967295, "998"])):
                for value in values:
                    with self.subTest(key=key, value=value):
                        channel = self.channel()
                        self.reject(lambda: self.send(channel, **{key: value}))
                        channel.close.assert_called_once()
            k["pidfd_open"].assert_not_called()

    def test_constructor_rejects_bad_pinned_configuration(self):
        with self.kernel():
            for candidate, gid in (("a" * 39, 998), ("0" * 40, 998), ("a" * 40, True),
                                   ("a" * 40, 0), ("a" * 40, 4294967295)):
                self.reject(lambda: launch_registration.LaunchRegistration(candidate, gid))

    def test_platform_and_root_gate_before_io(self):
        with self.kernel() as k:
            for name in ("getuid", "geteuid", "getgid"):
                k[name].return_value = 998
                channel = self.channel()
                self.reject(lambda: self.send(channel))
                channel.sendmsg.assert_not_called()
                k[name].return_value = 0
            with patch.object(sys, "platform", "darwin"):
                self.reject(lambda: self.send(self.channel()))
            with patch.object(launch_registration.os, "pidfd_open", None):
                self.reject(lambda: self.send(self.channel()))
            k["pidfd_open"].assert_not_called()

    @unittest.skipIf(sys.platform == "linux", "actual non-Linux rejection")
    def test_native_non_linux_denied_without_syscall_substitution(self):
        self.assertIsNotNone(launch_registration)
        channel = Mock(spec=socket.socket)
        self.reject(lambda: self.send(channel))
        channel.sendmsg.assert_not_called()
        channel.close.assert_called_once()

    def test_wrong_family_type_and_nonroot_peer_are_rejected_before_send(self):
        with self.kernel() as k:
            for mode in ("family", "type", "peer", "peer-size"):
                channel = self.channel()
                if mode == "family":
                    channel.family = socket.AF_INET
                else:
                    channel.getsockopt.side_effect = lambda level, opt, *args: (
                        socket.SOCK_STREAM if mode == "type" else socket.SOCK_SEQPACKET
                    ) if opt == socket.SO_TYPE else (b"short" if mode == "peer-size" else struct.pack("=iII", 456, 998 if mode == "peer" else 0, 998 if mode == "peer" else 0))
                self.reject(lambda: self.send(channel))
                channel.sendmsg.assert_not_called()
            k["pidfd_open"].assert_not_called()

    def test_receiver_rejects_payload_changes_and_consumes_only_one_attempt(self):
        with self.kernel() as k:
            valid = self.packet()
            bad = [b"", valid[:-1], valid + b"x", b"HDPLREG2" + valid[8:],
                   valid[:8] + b"\xcc" * 20 + valid[28:],
                   valid[:28] + bytes(16) + valid[44:], valid[:-4] + bytes(4),
                   valid[:-4] + struct.pack("!I", 999)]
            for payload in bad:
                with self.subTest(size=len(payload)):
                    k["close"].reset_mock()
                    channel = self.channel(server=True)
                    _, ancillary, flags, address = channel.recvmsg.return_value
                    channel.recvmsg.return_value = payload, ancillary, flags, address
                    registration = self.receiver()
                    self.reject(lambda: registration.receive(channel))
                    self.assertIn((9,), [c.args for c in k["close"].call_args_list])
                    channel.sendmsg.assert_not_called()
                    second = self.channel(server=True)
                    self.reject(lambda: registration.receive(second))
                    second.recvmsg.assert_not_called()
            k["dup"].assert_not_called()

    def test_actual_message_credentials_are_required_and_must_match_connection(self):
        with self.kernel() as k:
            cred = (socket.SOL_SOCKET, socket.SCM_CREDENTIALS, struct.pack("=iII", 123, 0, 0))
            fd = (socket.SOL_SOCKET, socket.SCM_RIGHTS, array.array("i", [9]).tobytes())
            for credentials in ([], [cred, cred], [(cred[0], cred[1], b"bad")],
                                [(cred[0], cred[1], struct.pack("=iII", 124, 0, 0))],
                                [(cred[0], cred[1], struct.pack("=iII", 123, 998, 998))]):
                k["close"].reset_mock()
                channel = self.channel(server=True)
                channel.recvmsg.return_value = self.packet(), credentials + [fd], 0, None
                self.reject(lambda: self.receiver().receive(channel))
                channel.sendmsg.assert_not_called()
                k["close"].assert_called_once_with(9)
            k["dup"].assert_not_called()

    def test_truncation_unknown_ancillary_and_extra_fds_all_close_received_fds(self):
        with self.kernel() as k:
            for mode in ("trunc", "ctrunc", "unknown", "extra", "duplicate-rights", "partial-rights", "no-fd"):
                with self.subTest(mode=mode):
                    channel = self.channel(server=True)
                    payload, ancillary, flags, address = channel.recvmsg.return_value
                    fds = [9]
                    if mode == "trunc": flags = socket.MSG_TRUNC
                    elif mode == "ctrunc": flags = socket.MSG_CTRUNC
                    elif mode == "unknown": ancillary.insert(0, (socket.SOL_SOCKET, 54321, b"unknown"))
                    elif mode == "extra":
                        ancillary[-1] = socket.SOL_SOCKET, socket.SCM_RIGHTS, array.array("i", [9, 10]).tobytes()
                        fds.append(10)
                    elif mode == "duplicate-rights":
                        ancillary.append((socket.SOL_SOCKET, socket.SCM_RIGHTS, array.array("i", [10]).tobytes()))
                        fds.append(10)
                    elif mode == "partial-rights":
                        ancillary[-1] = socket.SOL_SOCKET, socket.SCM_RIGHTS, array.array("i", [9]).tobytes() + b"x"
                    elif mode == "no-fd":
                        ancillary.pop()
                        fds = []
                    channel.recvmsg.return_value = payload, ancillary, flags, address
                    k["close"].reset_mock()
                    self.reject(lambda: self.receiver().receive(channel))
                    self.assertEqual(sorted(c.args[0] for c in k["close"].call_args_list), fds)
                    channel.sendmsg.assert_not_called()
            k["dup"].assert_not_called()

    def test_sender_rejects_untrusted_ack_including_rights_and_cleans_them(self):
        with self.kernel() as k:
            for mode in ("empty", "wrong-boot", "wrong-peer", "no-credentials", "rights", "truncated"):
                with self.subTest(mode=mode):
                    channel = self.channel()
                    payload, ancillary, flags, address = channel.recvmsg.return_value
                    if mode == "empty": payload = b""
                    elif mode == "wrong-boot": payload = payload[:28] + b"\xcc" * 16 + payload[44:]
                    elif mode == "wrong-peer": ancillary[0] = socket.SOL_SOCKET, socket.SCM_CREDENTIALS, struct.pack("=iII", 457, 0, 0)
                    elif mode == "no-credentials": ancillary = []
                    elif mode == "rights": ancillary.append((socket.SOL_SOCKET, socket.SCM_RIGHTS, array.array("i", [10]).tobytes()))
                    elif mode == "truncated": flags = socket.MSG_CTRUNC
                    channel.recvmsg.return_value = payload, ancillary, flags, address
                    k["close"].reset_mock()
                    self.reject(lambda: self.send(channel))
                    self.assertEqual(sorted(c.args[0] for c in k["close"].call_args_list), [9, 10] if mode == "rights" else [9])
                    self.assertEqual(channel.sendmsg.call_count, 1)

    def test_short_send_and_io_failure_never_retry(self):
        with self.kernel() as k:
            for server in (False, True):
                for phase in ("send-short", "send-error", "recv-error", "socket-close"):
                    channel = self.channel(server=server)
                    k["close"].reset_mock()
                    if phase == "send-short": channel.sendmsg.return_value = 47
                    elif phase == "send-error": channel.sendmsg.side_effect = OSError("private detail")
                    elif phase == "recv-error": channel.recvmsg.side_effect = TimeoutError("private detail")
                    elif phase == "socket-close": channel.close.side_effect = OSError("private detail")
                    registration = self.receiver() if server else None
                    self.reject(lambda: registration.receive(channel) if server else self.send(channel))
                    self.assertLessEqual(channel.sendmsg.call_count, 1)
                    channel.close.assert_called_once()
                    if server:
                        second = self.channel(server=True)
                        self.reject(lambda: registration.receive(second))
                        second.recvmsg.assert_not_called()
                        if phase != "recv-error":
                            self.assertEqual([c.args for c in k["close"].call_args_list].count((42,)), 1)

    def test_pidfd_and_pin_failures_close_every_owned_fd_without_retry(self):
        with self.kernel() as k:
            for server, name in ((False, "pidfd_open"), (False, "set_inheritable"),
                                  (True, "dup"), (True, "pidfd_send_signal")):
                original = k[name].side_effect
                k[name].side_effect = OSError("private detail")
                k["close"].reset_mock()
                channel = self.channel(server=server)
                self.reject(lambda: self.receiver().receive(channel) if server else self.send(channel))
                if name != "pidfd_open":
                    self.assertEqual([c.args for c in k["close"].call_args_list].count((9,)), 1)
                if name == "pidfd_send_signal":
                    self.assertEqual([c.args for c in k["close"].call_args_list].count((42,)), 1)
                channel.sendmsg.assert_not_called()
                k[name].side_effect = original

    def test_invalid_pidfd_identity_prevents_ack(self):
        with self.kernel() as k:
            k["read"].return_value = b"Pid:\t124\n"
            channel = self.channel(server=True)
            self.reject(lambda: self.receiver().receive(channel))
            channel.sendmsg.assert_not_called()
            self.assertIn((42,), [c.args for c in k["close"].call_args_list])
            self.assertIn((9,), [c.args for c in k["close"].call_args_list])

    def test_close_before_receive_and_duplicate_close_are_terminal(self):
        with self.kernel() as k:
            registration = self.receiver()
            registration.close()
            registration.close()
            channel = self.channel(server=True)
            self.reject(lambda: registration.receive(channel))
            channel.recvmsg.assert_not_called()
            k["dup"].assert_not_called()

    def test_owned_close_error_is_fixed_and_never_retried(self):
        with self.kernel() as k:
            registration = self.receiver()
            registration.receive(self.channel(server=True))
            k["close"].reset_mock()
            k["close"].side_effect = OSError("private detail")
            self.reject(registration.close)
            registration.close()
            k["close"].assert_called_once_with(42)

    def test_outer_active_exception_not_retained(self):
        with self.kernel():
            try:
                raise RuntimeError("private caller detail")
            except RuntimeError:
                channel = self.channel()
                channel.recvmsg.side_effect = OSError("private socket detail")
                self.reject(lambda: self.send(channel))
                self.reject(lambda: launch_registration.LaunchRegistration("bad", 998))

    def test_receive_uses_atomic_cloexec_credential_capture_and_fixed_buffers(self):
        with self.kernel():
            channel = self.channel(server=True)
            registration = self.receiver()
            registration.receive(channel)
            self.assertIn(((socket.SOL_SOCKET, socket.SO_PASSCRED, 1),), [tuple([c.args]) for c in channel.setsockopt.call_args_list])
            args = channel.recvmsg.call_args.args
            self.assertEqual(args[0], 49)
            self.assertLessEqual(args[1], 1100)
            self.assertEqual(args[2], socket.MSG_CMSG_CLOEXEC)
            registration.close()

    def test_deadline_is_transaction_wide_not_reset_by_each_operation(self):
        with self.kernel():
            self.assertTrue(hasattr(launch_registration, "time"), "bounded monotonic transaction missing")
            clock = [100.0]
            with patch.object(launch_registration.time, "monotonic", side_effect=lambda: clock[0]):
                channel = self.channel()
                def sent(*args):
                    clock[0] = 106.0
                    return 48
                channel.sendmsg.side_effect = sent
                self.reject(lambda: self.send(channel))
                channel.recvmsg.assert_not_called()
                channel.close.assert_called_once()

    def test_cleanup_expiry_cannot_return_success_or_retain_pin(self):
        with self.kernel() as k:
            for server in (False, True):
                for boundary in ("fd", "socket"):
                    with self.subTest(server=server, boundary=boundary):
                        clock = [100.0]
                        channel = self.channel(server=server)
                        registration = self.receiver() if server else None
                        def expire(*args):
                            clock[0] = 106.0
                        k["close"].reset_mock(side_effect=True)
                        if boundary == "fd": k["close"].side_effect = expire
                        else: channel.close.side_effect = expire
                        with patch.object(launch_registration.time, "monotonic", side_effect=lambda: clock[0]):
                            self.reject(lambda: registration.receive(channel) if server else self.send(channel))
                        if server:
                            self.assertEqual([c.args for c in k["close"].call_args_list].count((42,)), 1)
                            registration.close()
                            self.assertEqual([c.args for c in k["close"].call_args_list].count((42,)), 1)
                        channel.close.assert_called_once()

    def test_reentrant_close_cannot_resurrect_a_registration(self):
        with self.kernel() as k:
            for boundary in ("recv", "dup", "observe", "send", "socket-close"):
                with self.subTest(boundary=boundary):
                    registration = self.receiver()
                    channel = self.channel(server=True)
                    packet = channel.recvmsg.return_value
                    k["close"].reset_mock()
                    def revoke(result):
                        registration.close()
                        return result
                    if boundary == "recv": channel.recvmsg.side_effect = lambda *args: revoke(packet)
                    elif boundary == "dup": k["dup"].side_effect = lambda *args: revoke(42)
                    elif boundary == "observe": k["pidfd_send_signal"].side_effect = lambda *args: revoke(None)
                    elif boundary == "send": channel.sendmsg.side_effect = lambda *args: revoke(48)
                    else: channel.close.side_effect = lambda *args: revoke(None)
                    self.reject(lambda: registration.receive(channel))
                    if boundary not in ("send", "socket-close"):
                        channel.sendmsg.assert_not_called()
                    self.assertEqual([c.args for c in k["close"].call_args_list].count((9,)), 1)
                    self.assertEqual([c.args for c in k["close"].call_args_list].count((42,)), 0 if boundary == "recv" else 1)
                    second = self.channel(server=True)
                    self.reject(lambda: registration.receive(second))
                    second.recvmsg.assert_not_called()
                    k["dup"].side_effect = None
                    k["pidfd_send_signal"].side_effect = None

    def test_received_fd_close_failure_still_closes_pin_and_socket(self):
        with self.kernel() as k:
            def close(fd):
                if fd == 9:
                    raise OSError("private close failure")
            k["close"].side_effect = close
            channel = self.channel(server=True)
            registration = self.receiver()
            self.reject(lambda: registration.receive(channel))
            self.assertEqual([c.args for c in k["close"].call_args_list].count((9,)), 1)
            self.assertEqual([c.args for c in k["close"].call_args_list].count((42,)), 1)
            channel.sendmsg.assert_not_called()
            channel.close.assert_called_once()
            registration.close()
            self.assertEqual([c.args for c in k["close"].call_args_list].count((42,)), 1)

    def test_all_rejected_rights_are_closed_even_if_one_close_fails(self):
        with self.kernel() as k:
            k["close"].side_effect = OSError("private close failure")
            channel = self.channel(server=True)
            payload, ancillary, _, address = channel.recvmsg.return_value
            ancillary[-1] = socket.SOL_SOCKET, socket.SCM_RIGHTS, array.array("i", [9, 10]).tobytes()
            channel.recvmsg.return_value = payload, ancillary, socket.MSG_CTRUNC, address
            self.reject(lambda: self.receiver().receive(channel))
            self.assertEqual(sorted(c.args[0] for c in k["close"].call_args_list), [9, 10])
            channel.sendmsg.assert_not_called()
            channel.close.assert_called_once()

    def test_valid_credentials_need_not_precede_rights_and_kernel_flags_are_allowed(self):
        with self.kernel():
            channel = self.channel(server=True)
            payload, ancillary, _, address = channel.recvmsg.return_value
            channel.recvmsg.return_value = payload, list(reversed(ancillary)), socket.MSG_EOR | socket.MSG_CMSG_CLOEXEC, address
            registration = self.receiver()
            registration.receive(channel)
            self.assertEqual(channel.sendmsg.call_args.args[0], [self.packet(ack=True)])
            registration.close()


if __name__ == "__main__":
    unittest.main()
