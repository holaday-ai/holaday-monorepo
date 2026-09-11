"""Real launch/identity/protocol chain, synthetic Linux kernel/filesystem only."""

import array
import contextlib
import json
import os
import socket
import stat
import struct
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

import launch_listener
import test_launch_listener

try:
    import runtime_channel
except ModuleNotFoundError as error:
    if error.name != 'runtime_channel':
        raise
    runtime_channel = None


class RuntimeTests(unittest.TestCase):
    @contextlib.contextmanager
    def system(self):
        self.assertIsNotNone(runtime_channel, 'runtime channel missing')
        with test_launch_listener.ListenerTests().system() as s, contextlib.ExitStack() as stack:
            listener = launch_listener.RootLaunchListener.open('a' * 40)
            listener.accept_once()
            parent = '/run/holaday-pool-runtime'
            path = parent + '/control.sock'
            s.fs.fs.paths[parent] = SimpleNamespace(st_uid=0, st_gid=998, st_mode=stat.S_IFDIR | 0o750,
                st_nlink=2, st_dev=1, st_ino=300, attrs=[])
            server, channel = Mock(spec=socket.socket), Mock(spec=socket.socket)
            server.family = channel.family = socket.AF_UNIX
            peer = struct.pack('=iII', 123, 998, 998)
            channel.getsockopt.side_effect = lambda level, opt, *args: (
                socket.SOCK_STREAM if opt == socket.SO_TYPE else peer)
            values = {'version': 1, 'action': 'create', 'requestId': 'c' * 32,
                      'boot': 'b' * 32, 'component': 'brave', 'slot': 1}
            packet = [json.dumps(values).encode(), [(socket.SOL_SOCKET, socket.SCM_CREDENTIALS, peer)], 0, None]
            channel.recvmsg.side_effect = lambda *args: tuple(packet) if channel.recvmsg.call_count == 1 else (b'', [], 0, None)
            reply = b'{"version":1,"status":"blocked","code":"POOL_BROKER_RESOURCES_UNPROVEN"}'
            channel.sendmsg.return_value = len(reply)
            server.accept.return_value = (channel, '')
            def bind(name):
                assert name == path
                if path in s.fs.fs.paths:
                    raise FileExistsError()
                server.setsockopt.assert_called_with(socket.SOL_SOCKET, socket.SO_PASSCRED, 1)
                s.fs.fs.paths[path] = SimpleNamespace(st_uid=0, st_gid=0, st_mode=stat.S_IFSOCK | 0o700,
                    st_nlink=1, st_dev=1, st_ino=301)
            server.bind.side_effect = bind
            factory = stack.enter_context(patch.object(runtime_channel, 'Socket', return_value=server))
            def target(name, dir_fd):
                result = s.fs.fs.opened[dir_fd] + '/' + name
                assert result == path
                return result
            def status(name, *, dir_fd, follow_symlinks):
                assert follow_symlinks is False
                return s.fs.fs.paths[target(name, dir_fd)]
            def chmod(name, mode, *, dir_fd, follow_symlinks):
                assert follow_symlinks is False
                s.fs.fs.paths[target(name, dir_fd)].st_mode = stat.S_IFSOCK | mode
            def chown(name, uid, gid, *, dir_fd, follow_symlinks):
                assert follow_symlinks is False and uid == 0 and gid == 998
                s.fs.fs.paths[target(name, dir_fd)].st_gid = gid
            def unlink(name, *, dir_fd):
                del s.fs.fs.paths[target(name, dir_fd)]
            stack.enter_context(patch.object(os, 'stat', side_effect=status))
            stack.enter_context(patch.object(os, 'chmod', side_effect=chmod))
            stack.enter_context(patch.object(os, 'chown', side_effect=chown))
            removed = stack.enter_context(patch.object(os, 'unlink', side_effect=unlink))
            yield SimpleNamespace(base=s, listener=listener, server=server, channel=channel, peer=peer,
                packet=packet, values=values, parent=parent, path=path, removed=removed, factory=factory, reply=reply)

    def deny(self, call):
        with self.assertRaises(ValueError) as caught:
            call()
        self.assertEqual(str(caught.exception), 'POOL_BROKER_LAUNCH_LISTENER_UNPROVEN')
        self.assertIsNone(caught.exception.__context__)

    def test_actual_registered_uid998_request_gets_only_blocked_response(self):
        with self.system() as s:
            self.assertIsNone(s.listener.serve_runtime_once())
            self.assertEqual(s.channel.sendmsg.call_args.args, ([s.reply],))
            self.assertEqual(s.base.owned, {42})
            self.assertNotIn(s.path, s.base.fs.fs.paths)
            self.assertEqual(s.base.fs.fs.opened, {})
            s.channel.close.assert_called_once()
            s.server.close.assert_called_once()
            s.listener.close()
            self.assertEqual(s.base.owned, set())

    def test_all_valid_actions_remain_blocked_after_launch_window_expires(self):
        for action in ('create', 'query', 'close'):
            with self.subTest(action=action), self.system() as s:
                s.base.fs.clock[0] = 500.0
                s.values['action'] = action
                if action != 'create':
                    del s.values['component'], s.values['slot']
                    s.values['capability'] = 'd' * 64
                s.packet[0] = json.dumps(s.values).encode()
                s.listener.serve_runtime_once()
                self.assertEqual(s.channel.sendmsg.call_args.args, ([s.reply],))
                self.assertEqual(s.base.owned, {42})
                s.listener.close()

    def test_wrong_original_sender_or_boot_never_receives_reply(self):
        for field, value in (('pid', 124), ('uid', 0), ('uid', 997), ('gid', 997), ('boot', 'e' * 32)):
            with self.subTest(field=field, value=value), self.system() as s:
                ids = {'pid': 123, 'uid': 998, 'gid': 998}
                if field == 'boot':
                    s.values['boot'] = value
                    s.packet[0] = json.dumps(s.values).encode()
                else:
                    ids[field] = value
                    peer = struct.pack('=iII', ids['pid'], ids['uid'], ids['gid'])
                    s.channel.getsockopt.side_effect = lambda level, opt, *args: (
                        socket.SOCK_STREAM if opt == socket.SO_TYPE else peer)
                    s.packet[1] = [(socket.SOL_SOCKET, socket.SCM_CREDENTIALS, peer)]
                self.deny(s.listener.serve_runtime_once)
                s.channel.sendmsg.assert_not_called()
                self.assertEqual(s.base.owned, set())

    def test_missing_duplicate_or_changed_message_credentials_are_rejected(self):
        for kind in ('missing', 'duplicate', 'changed', 'unknown'):
            with self.subTest(kind=kind), self.system() as s:
                if kind == 'missing': s.packet[1] = []
                elif kind == 'duplicate': s.packet[1] *= 2
                elif kind == 'changed': s.packet[1] = [(socket.SOL_SOCKET, socket.SCM_CREDENTIALS, struct.pack('=iII', 124, 998, 998))]
                else: s.packet[1].append((socket.SOL_SOCKET, 9999, b''))
                self.deny(s.listener.serve_runtime_once)
                s.channel.sendmsg.assert_not_called()
                self.assertEqual(s.base.owned, set())

    def test_received_rights_are_closed_even_when_truncated(self):
        for flags in (0, socket.MSG_CTRUNC, socket.MSG_TRUNC):
            with self.subTest(flags=flags), self.system() as s:
                s.base.owned.add(9)
                s.packet[1].append((socket.SOL_SOCKET, socket.SCM_RIGHTS, array.array('i', [9]).tobytes()))
                s.packet[2] = flags
                self.deny(s.listener.serve_runtime_once)
                s.channel.sendmsg.assert_not_called()
                self.assertEqual(s.base.owned, set())
                self.assertEqual(s.base.closed.count(9), 2)  # one earlier launch FD, one newly received FD

    def test_bad_request_data_never_receives_reply(self):
        for payload in (b'', b'x' * 4097, b'[]', b'null', b'\xff', b'{"version":1,"version":1}',
                        b'{"version":1,"action":"shell"}'):
            with self.subTest(size=len(payload)), self.system() as s:
                s.packet[0] = payload
                self.deny(s.listener.serve_runtime_once)
                s.channel.sendmsg.assert_not_called()
                self.assertEqual(s.base.owned, set())

    def test_dead_original_pin_cannot_receive_runtime_reply(self):
        with self.system() as s:
            with patch.object(runtime_channel.launch_authorization.os, 'read', return_value=b'Pid:\t0\n'):
                self.deny(s.listener.serve_runtime_once)
            s.channel.sendmsg.assert_not_called()
            s.factory.assert_not_called()
            self.assertEqual(s.base.owned, set())

    def test_runtime_transaction_deadline_includes_cleanup(self):
        for boundary in ('accept', 'recv', 'send', 'close'):
            with self.subTest(boundary=boundary), self.system() as s:
                def advance(value):
                    s.base.fs.clock[1] += 6.0
                    return value
                if boundary == 'accept': s.server.accept.side_effect = lambda: advance((s.channel, ''))
                elif boundary == 'recv': s.channel.recvmsg.side_effect = lambda *args: advance(tuple(s.packet))
                elif boundary == 'send': s.channel.sendmsg.side_effect = lambda *args: advance(len(s.reply))
                else: s.channel.close.side_effect = lambda: advance(None)
                self.deny(s.listener.serve_runtime_once)
                if boundary in ('accept', 'recv'): s.channel.sendmsg.assert_not_called()
                s.channel.close.assert_called_once()
                self.assertEqual(s.base.owned, set())

    def test_context_drift_during_receive_is_terminal(self):
        with self.system() as s:
            def drift(*args):
                os.environ['NODE_OPTIONS'] = 'synthetic'
                return tuple(s.packet)
            s.channel.recvmsg.side_effect = drift
            self.deny(s.listener.serve_runtime_once)
            s.channel.sendmsg.assert_not_called()
            self.assertEqual(s.base.owned, set())

    def test_reentrant_close_never_revives_or_replies(self):
        for boundary in ('accept', 'recv', 'guard'):
            with self.subTest(boundary=boundary), self.system() as s:
                def revoke(value):
                    s.listener.close()
                    return value
                if boundary == 'accept': s.server.accept.side_effect = lambda: revoke((s.channel, ''))
                elif boundary == 'recv': s.channel.recvmsg.side_effect = lambda *args: revoke(tuple(s.packet))
                else:
                    def tasks(path):
                        if s.channel.recvmsg.called:
                            s.listener.close()
                        return ['1']
                    s.base.fs.mocks['listdir'].side_effect = tasks
                self.deny(s.listener.serve_runtime_once)
                s.channel.sendmsg.assert_not_called()
                self.assertEqual(s.base.owned, set())
                s.channel.close.assert_called_once()

    def test_existing_and_replaced_socket_paths_are_not_removed(self):
        for replaced in (False, True):
            with self.subTest(replaced=replaced), self.system() as s:
                other = SimpleNamespace(st_uid=0, st_gid=998, st_mode=stat.S_IFSOCK | 0o660,
                    st_nlink=1, st_dev=1, st_ino=999)
                if replaced:
                    def replace(*args):
                        s.base.fs.fs.paths[s.path] = other
                        return tuple(s.packet)
                    s.channel.recvmsg.side_effect = replace
                else:
                    s.base.fs.fs.paths[s.path] = other
                self.deny(s.listener.serve_runtime_once)
                self.assertIs(s.base.fs.fs.paths[s.path], other)
                s.removed.assert_not_called()
                self.assertEqual(s.base.owned, set())

    def test_untrusted_runtime_directory_prevents_socket_creation(self):
        for field, value in (('st_gid', 997), ('st_uid', 998), ('st_mode', stat.S_IFDIR | 0o770),
                             ('attrs', ['system.posix_acl_access'])):
            with self.subTest(field=field), self.system() as s:
                setattr(s.base.fs.fs.paths[s.parent], field, value)
                self.deny(s.listener.serve_runtime_once)
                s.factory.assert_not_called()
                self.assertEqual(s.base.fs.fs.opened, {})

    def test_short_reply_or_close_errors_revoke_without_retry(self):
        for boundary in ('send', 'channel', 'listener', 'unlink'):
            with self.subTest(boundary=boundary), self.system() as s:
                if boundary == 'send': s.channel.sendmsg.return_value = 1
                elif boundary == 'channel': s.channel.close.side_effect = OSError()
                elif boundary == 'listener': s.server.close.side_effect = OSError()
                else: s.removed.side_effect = OSError()
                self.deny(s.listener.serve_runtime_once)
                s.listener.close()
                self.assertEqual(s.base.owned, set())
                s.channel.close.assert_called_once()
                s.server.close.assert_called_once()

    def test_closed_listener_and_reentry_cannot_start_new_transaction(self):
        with self.system() as s:
            s.listener.close()
            self.deny(s.listener.serve_runtime_once)
            s.factory.assert_not_called()
        with self.system() as s:
            def reentry():
                self.deny(s.listener.serve_runtime_once)
                return s.channel, ''
            s.server.accept.side_effect = reentry
            self.deny(s.listener.serve_runtime_once)
            s.channel.sendmsg.assert_not_called()
            s.channel.close.assert_called_once()
            self.assertEqual(s.base.owned, set())

    def test_fragmented_stream_requires_eof_and_checks_every_fragment_sender(self):
        for forged in (False, True):
            with self.subTest(forged=forged), self.system() as s:
                data = s.packet[0]
                second_peer = struct.pack('=iII', 124, 998, 998) if forged else s.peer
                s.channel.recvmsg.side_effect = [
                    (data[:30], [(socket.SOL_SOCKET, socket.SCM_CREDENTIALS, s.peer)], 0, None),
                    (data[30:], [(socket.SOL_SOCKET, socket.SCM_CREDENTIALS, second_peer)], 0, None),
                    (b'', [], 0, None)]
                if forged:
                    self.deny(s.listener.serve_runtime_once)
                    s.channel.sendmsg.assert_not_called()
                    self.assertEqual(s.base.owned, set())
                else:
                    s.listener.serve_runtime_once()
                    self.assertEqual(s.channel.sendmsg.call_args.args, ([s.reply],))
                    self.assertEqual(s.channel.recvmsg.call_count, 3)
                    s.listener.close()

    def test_complete_json_without_write_shutdown_does_not_get_early_reply(self):
        with self.system() as s:
            s.channel.recvmsg.side_effect = [tuple(s.packet), TimeoutError()]
            self.deny(s.listener.serve_runtime_once)
            s.channel.sendmsg.assert_not_called()
            self.assertEqual(s.base.owned, set())

    def test_stale_launch_without_completed_receive_has_no_runtime_access(self):
        with test_launch_listener.ListenerTests().system() as s:
            listener = launch_listener.RootLaunchListener.open('a' * 40)
            with patch.object(runtime_channel, 'Socket') as factory:
                self.deny(listener.serve_runtime_once)
            factory.assert_not_called()
            self.assertEqual(s.owned, set())
            self.assertEqual(s.fs.fs.opened, {})

    def test_total_stream_limit_and_second_json_are_not_a_second_command(self):
        for second in (b' ' * 4096, b'{}'):
            with self.subTest(size=len(second)), self.system() as s:
                s.channel.recvmsg.side_effect = [tuple(s.packet),
                    (second, [(socket.SOL_SOCKET, socket.SCM_CREDENTIALS, s.peer)], 0, None), (b'', [], 0, None)]
                self.deny(s.listener.serve_runtime_once)
                s.channel.sendmsg.assert_not_called()
                self.assertEqual(s.base.owned, set())

    def test_nonfinite_or_backward_runtime_clock_revokes(self):
        for value in (float('nan'), float('inf'), 49.0):
            with self.subTest(value=value), self.system() as s:
                def drift(*args):
                    s.base.fs.clock[1] = value
                    return tuple(s.packet)
                s.channel.recvmsg.side_effect = drift
                self.deny(s.listener.serve_runtime_once)
                s.channel.sendmsg.assert_not_called()
                self.assertEqual(s.base.owned, set())

    def test_runtime_credentials_rechecked_after_send(self):
        with self.system() as s:
            def revoked(*args):
                s.listener.close()
                return len(s.reply)
            s.channel.sendmsg.side_effect = revoked
            self.deny(s.listener.serve_runtime_once)
            self.assertEqual(s.base.owned, set())
            s.channel.close.assert_called_once()

    def test_eof_with_rights_is_rejected_and_closed(self):
        with self.system() as s:
            def receive(*args):
                if s.channel.recvmsg.call_count == 1:
                    return tuple(s.packet)
                s.base.owned.add(9)
                return b'', [(socket.SOL_SOCKET, socket.SCM_RIGHTS, array.array('i', [9]).tobytes())], 0, None
            s.channel.recvmsg.side_effect = receive
            self.deny(s.listener.serve_runtime_once)
            s.channel.sendmsg.assert_not_called()
            self.assertEqual(s.base.owned, set())

    def test_timeout_setter_revocation_or_expiry_prevents_receive(self):
        for boundary in ('close', 'expiry'):
            with self.subTest(boundary=boundary), self.system() as s:
                def changed(value):
                    if boundary == 'close': s.listener.close()
                    else: s.base.fs.clock[1] += 6.0
                s.channel.settimeout.side_effect = changed
                self.deny(s.listener.serve_runtime_once)
                s.channel.recvmsg.assert_not_called()
                s.channel.sendmsg.assert_not_called()
                self.assertEqual(s.base.owned, set())

    def test_send_timeout_includes_last_identity_check_cost(self):
        with self.system() as s:
            def read(*args):
                if s.channel.recvmsg.call_count >= 2:
                    s.base.fs.clock[1] += 0.01
                return b'Pid:\t123\nNSpid:\t123\n'
            def send(*args):
                self.assertLessEqual(s.channel.settimeout.call_args.args[0], 55.0 - s.base.fs.clock[1])
                return len(s.reply)
            s.channel.sendmsg.side_effect = send
            with patch.object(os, 'read', side_effect=read):
                s.listener.serve_runtime_once()
            s.listener.close()

    def test_socket_setup_revocation_or_expiry_prevents_listen(self):
        for boundary in ('close', 'expiry'):
            with self.subTest(boundary=boundary), self.system() as s:
                chmod = os.chmod
                def changed(*args, **kwargs):
                    chmod(*args, **kwargs)
                    if boundary == 'close': s.listener.close()
                    else: s.base.fs.clock[1] += 6.0
                with patch.object(os, 'chmod', side_effect=changed):
                    self.deny(s.listener.serve_runtime_once)
                s.server.listen.assert_not_called()
                self.assertEqual(s.base.owned, set())


if __name__ == '__main__':
    unittest.main()
