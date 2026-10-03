"""Real durable consumer and registration with synthetic OS boundaries."""

import array
import contextlib
import os
import socket
import stat
import struct
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

import process_pin
import test_launch_authorization as auth_tests

try:
    import launch_listener
except ModuleNotFoundError as error:
    if error.name != 'launch_listener':
        raise
    launch_listener = None


class ListenerTests(unittest.TestCase):
    @contextlib.contextmanager
    def system(self):
        self.assertIsNotNone(launch_listener, 'root launch listener missing')
        with contextlib.ExitStack() as stack:
            fs = stack.enter_context(auth_tests.AuthorizationTests().system())
            path = '/run/holaday-pool-broker/register.sock'
            for name, value in (('SCM_CREDENTIALS', 2), ('SO_PASSCRED', 16),
                                ('SO_PEERCRED', 17), ('MSG_CMSG_CLOEXEC', 0x40000000), ('SOCK_CLOEXEC', 524288)):
                stack.enter_context(patch.object(socket, name, value, create=True))
            server, channel = Mock(spec=socket.socket), Mock(spec=socket.socket)
            server.family = channel.family = socket.AF_UNIX
            peer = struct.pack('=iII', 123, 0, 0)
            channel.getsockopt.side_effect = lambda level, opt, *args: socket.SOCK_SEQPACKET if opt == socket.SO_TYPE else peer
            channel.sendmsg.return_value = 48
            payload = b'HDPLREG1' + b'\xaa' * 20 + b'\xbb' * 16 + b'\x00\x00\x03\xe6'
            owned, closed, events = set(), [], []
            def receive(*args):
                owned.add(9)
                return payload, [(socket.SOL_SOCKET, socket.SCM_CREDENTIALS, peer),
                    (socket.SOL_SOCKET, socket.SCM_RIGHTS, array.array('i', [9]).tobytes())], 0, None
            channel.recvmsg.side_effect = receive
            server.accept.return_value = (channel, '')
            def bind(target):
                assert target == path
                assert fs.synced == {fs.consumed, '/var/lib/holaday-pool-broker'}
                server.setsockopt.assert_called_with(socket.SOL_SOCKET, socket.SO_PASSCRED, 1)
                if target in fs.fs.paths:
                    raise OSError('synthetic path exists')
                fs.fs.paths[target] = SimpleNamespace(st_uid=0, st_gid=0, st_mode=stat.S_IFSOCK | 0o700,
                    st_nlink=1, st_dev=1, st_ino=200, attrs=[])
                events.append('bind')
            server.bind.side_effect = bind
            factory = stack.enter_context(patch.object(launch_listener, 'Socket', return_value=server))
            stack.enter_context(patch.object(os, 'umask', return_value=0o077))
            def target(name, dir_fd):
                result = fs.fs.opened[dir_fd] + '/' + name
                assert result == path
                return result
            def status(name, *, dir_fd, follow_symlinks):
                assert follow_symlinks is False
                return fs.fs.paths[target(name, dir_fd)]
            def chmod(name, mode, *, dir_fd, follow_symlinks):
                assert follow_symlinks is False and mode == 0o600
                fs.fs.paths[target(name, dir_fd)].st_mode = stat.S_IFSOCK | mode
            def unlink(name, *, dir_fd):
                del fs.fs.paths[target(name, dir_fd)]
                events.append('unlink')
            stack.enter_context(patch.object(os, 'stat', side_effect=status))
            stack.enter_context(patch.object(os, 'chmod', side_effect=chmod))
            removed = stack.enter_context(patch.object(os, 'unlink', side_effect=unlink))
            old_open, old_close = fs.fs.mocks['open'].side_effect, fs.fs.mocks['close'].side_effect
            def open_file(name, *args, **kwargs):
                if name == '/proc/self/fdinfo/42':
                    owned.add(43)
                    return 43
                return old_open(name, *args, **kwargs)
            def close(fd):
                if fd in (9, 42, 43):
                    assert fd in owned
                    owned.remove(fd)
                    closed.append(fd)
                else:
                    old_close(fd)
            fs.fs.mocks['open'].side_effect, fs.fs.mocks['close'].side_effect = open_file, close
            def duplicate(fd):
                assert fd == 9 and fd in owned
                owned.add(42)
                return 42
            stack.enter_context(patch.object(os, 'dup', side_effect=duplicate))
            stack.enter_context(patch.object(os, 'read', return_value=b'Pid:\t123\nNSpid:\t123\n'))
            stack.enter_context(patch.object(os, 'set_inheritable', return_value=None))
            for name in ('getuid', 'geteuid', 'getgid'):
                stack.enter_context(patch.object(os, name, return_value=0))
            stack.enter_context(patch.object(os, 'pidfd_open', return_value=9, create=True))
            stack.enter_context(patch.object(process_pin.signal, 'pidfd_send_signal', return_value=None, create=True))
            poller = Mock()
            poller.poll.return_value = []
            stack.enter_context(patch.object(process_pin.select, 'poll', return_value=poller))
            yield SimpleNamespace(fs=fs, server=server, channel=channel, owned=owned, closed=closed,
                                  factory=factory, path=path, events=events, removed=removed)

    def test_single_listener_consumes_persistently_and_holds_actual_registered_pin(self):
        with self.system() as s:
            listener = launch_listener.RootLaunchListener.open('a' * 40)
            s.server.listen.assert_called_once_with(1)
            listener.accept_once()
            self.assertIsInstance(listener._registration._pin, process_pin.PinnedApplication)
            self.assertEqual(s.owned, {42})
            self.assertNotIn(s.path, s.fs.fs.paths)
            self.assertIn(s.fs.consumed, s.fs.data)
            self.assertEqual(s.fs.fs.opened, {})
            self.assertEqual(s.channel.sendmsg.call_args.args[0],
                [b'HDPLACK1' + b'\xaa' * 20 + b'\xbb' * 16 + b'\x00\x00\x03\xe6'])
            listener.close()
            self.assertEqual(s.owned, set())
            self.assertEqual(s.closed.count(42), 1)
            s.server.close.assert_called_once()
            s.channel.close.assert_called_once()

    def denied(self, call):
        with self.assertRaises(ValueError) as caught:
            call()
        self.assertEqual(str(caught.exception), 'POOL_BROKER_LAUNCH_LISTENER_UNPROVEN')
        self.assertIsNone(caught.exception.__context__)
        self.assertIsNone(caught.exception.__cause__)

    def test_missing_authorization_never_creates_socket(self):
        with self.system() as s:
            del s.fs.fs.paths[s.fs.authorization]
            self.denied(lambda: launch_listener.RootLaunchListener.open('a' * 40))
            s.factory.assert_not_called()
            self.assertEqual(s.fs.fs.opened, {})

    def test_existing_consumption_blocks_new_object_before_socket_creation(self):
        with self.system() as s:
            listener = launch_listener.RootLaunchListener.open('a' * 40)
            listener.close()
            self.denied(lambda: launch_listener.RootLaunchListener.open('a' * 40))
            self.assertEqual(s.factory.call_count, 1)
            self.assertIn(s.fs.consumed, s.fs.data)

    def test_existing_socket_is_never_unlinked_as_stale(self):
        with self.system() as s:
            other = SimpleNamespace(st_uid=0, st_gid=0, st_mode=stat.S_IFSOCK | 0o600,
                                    st_nlink=1, st_dev=1, st_ino=999)
            s.fs.fs.paths[s.path] = other
            self.denied(lambda: launch_listener.RootLaunchListener.open('a' * 40))
            self.assertIs(s.fs.fs.paths[s.path], other)
            s.removed.assert_not_called()
            self.assertIn(s.fs.consumed, s.fs.data)

    def test_socket_setup_failure_does_not_return_consumption(self):
        for action in ('set_inheritable', 'setsockopt', 'bind', 'listen'):
            with self.subTest(action=action), self.system() as s:
                getattr(s.server, action).side_effect = OSError('synthetic setup')
                self.denied(lambda: launch_listener.RootLaunchListener.open('a' * 40))
                self.assertIn(s.fs.consumed, s.fs.data)
                self.assertEqual(s.fs.fs.opened, {})
                s.server.close.assert_called_once()

    def test_accept_timeout_closes_own_socket_but_preserves_claim(self):
        with self.system() as s:
            listener = launch_listener.RootLaunchListener.open('a' * 40)
            s.server.accept.side_effect = TimeoutError('synthetic timeout')
            self.denied(listener.accept_once)
            self.assertIn(s.fs.consumed, s.fs.data)
            self.assertNotIn(s.path, s.fs.fs.paths)
            self.assertEqual(s.fs.fs.opened, {})
            s.channel.close.assert_not_called()

    def test_accept_after_expiry_never_touches_unaccepted_channel(self):
        with self.system() as s:
            listener = launch_listener.RootLaunchListener.open('a' * 40)
            s.fs.clock[0] = 130.0
            self.denied(listener.accept_once)
            s.server.accept.assert_not_called()
            s.channel.close.assert_not_called()
            self.assertEqual(s.owned, set())

    def test_expiry_during_accept_closes_accepted_socket_without_ack(self):
        with self.system() as s:
            listener = launch_listener.RootLaunchListener.open('a' * 40)
            def expired():
                s.fs.clock[0] = 130.0
                return s.channel, ''
            s.server.accept.side_effect = expired
            self.denied(listener.accept_once)
            s.channel.close.assert_called_once()
            s.channel.sendmsg.assert_not_called()

    def test_second_accept_revokes_original_pin_instead_of_readmitting(self):
        with self.system() as s:
            listener = launch_listener.RootLaunchListener.open('a' * 40)
            listener.accept_once()
            self.denied(listener.accept_once)
            s.server.accept.assert_called_once()
            self.assertEqual(s.owned, set())
            listener.close()
            self.assertEqual(s.closed.count(42), 1)

    def test_synchronous_close_during_pin_cannot_revive_registration(self):
        with self.system() as s:
            listener = launch_listener.RootLaunchListener.open('a' * 40)
            def revoked(*args):
                listener.close()
                return b'Pid:\t123\nNSpid:\t123\n'
            with patch.object(os, 'read', side_effect=revoked):
                self.denied(listener.accept_once)
            s.channel.sendmsg.assert_not_called()
            self.assertEqual(s.owned, set())
            s.channel.close.assert_called_once()
            self.assertEqual(s.closed.count(42), 1)

    def test_replaced_listener_path_is_not_deleted(self):
        with self.system() as s:
            listener = launch_listener.RootLaunchListener.open('a' * 40)
            s.fs.fs.paths[s.path].st_ino = 999
            self.denied(listener.accept_once)
            self.assertIn(s.path, s.fs.fs.paths)
            s.removed.assert_not_called()
            self.assertEqual(s.owned, set())

    def test_final_directory_close_expiry_revokes_acknowledged_pin(self):
        with self.system() as s:
            listener = launch_listener.RootLaunchListener.open('a' * 40)
            close = s.fs.fs.mocks['close'].side_effect
            def expired(fd):
                if s.fs.fs.opened.get(fd) == '/run/holaday-pool-broker':
                    s.fs.clock[0] = 130.0
                close(fd)
            s.fs.fs.mocks['close'].side_effect = expired
            self.denied(listener.accept_once)
            self.assertEqual(s.owned, set())
            self.assertEqual(s.closed.count(42), 1)

    def test_context_drift_during_accept_prevents_registration(self):
        with self.system() as s:
            listener = launch_listener.RootLaunchListener.open('a' * 40)
            def drift():
                os.environ['NODE_OPTIONS'] = 'synthetic'
                return s.channel, ''
            s.server.accept.side_effect = drift
            self.denied(listener.accept_once)
            s.channel.sendmsg.assert_not_called()
            s.channel.close.assert_called_once()

    def test_wrong_peer_and_short_ack_fail_actual_registration(self):
        for failure in ('peer', 'ack'):
            with self.subTest(failure=failure), self.system() as s:
                listener = launch_listener.RootLaunchListener.open('a' * 40)
                if failure == 'peer':
                    s.channel.getsockopt.side_effect = lambda level, opt, *args: (
                        socket.SOCK_SEQPACKET if opt == socket.SO_TYPE else struct.pack('=iII', 123, 998, 998))
                else:
                    s.channel.sendmsg.return_value = 47
                self.denied(listener.accept_once)
                self.assertEqual(s.owned, set())
                self.assertIn(s.fs.consumed, s.fs.data)
                self.assertEqual(s.fs.fs.opened, {})
                s.channel.close.assert_called_once()
                if failure == 'peer':
                    s.channel.sendmsg.assert_not_called()

    def test_context_check_reentrant_close_preserves_channel_ownership(self):
        with self.system() as s:
            listener = launch_listener.RootLaunchListener.open('a' * 40)
            def tasks(path):
                if s.server.close.called:
                    listener.close()
                return ['1']
            with patch.object(os, 'listdir', side_effect=tasks):
                self.denied(listener.accept_once)
            s.channel.close.assert_called_once()
            s.channel.sendmsg.assert_not_called()
            self.assertEqual(s.owned, set())

    def test_ack_window_check_reentrant_close_cannot_send_ack(self):
        with self.system() as s:
            listener = launch_listener.RootLaunchListener.open('a' * 40)
            registration = listener._registration
            def now():
                if 9 in s.closed and registration._pin is not None:
                    registration.close()
                return s.fs.clock[0]
            with patch.object(launch_listener.launch_authorization.time, 'time', side_effect=now):
                self.denied(listener.accept_once)
            s.channel.close.assert_called_once()
            s.channel.sendmsg.assert_not_called()
            self.assertEqual(s.owned, set())

    def test_transport_close_failure_revokes_without_retry(self):
        for failure in ('listener', 'channel', 'unlink'):
            with self.subTest(failure=failure), self.system() as s:
                listener = launch_listener.RootLaunchListener.open('a' * 40)
                operation = {'listener': s.server.close, 'channel': s.channel.close,
                             'unlink': s.removed}[failure]
                operation.side_effect = OSError('synthetic close failure')
                self.denied(listener.accept_once)
                self.assertEqual(s.owned, set())
                self.assertEqual(s.fs.fs.opened, {})
                self.assertIn(s.fs.consumed, s.fs.data)
                listener.close()
                operation.assert_called_once()


if __name__ == '__main__':
    unittest.main()
