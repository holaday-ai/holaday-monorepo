"""Real received SCM_RIGHTS and retained guard; Linux credential queries synthetic."""
import array
import contextlib
import socket
import struct
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch

import test_quartet_worker_guard as fixtures

guard, NATIVE = fixtures.guard, fixtures.NATIVE
Socket = socket.socket
FRAME = struct.Struct('!4sB20s16s16s32sQQQQ')


class BridgeReceiverTests(unittest.TestCase):
    def test_search_only_control_directory_uses_path_handle_not_read_or_flistxattr(self):
        with self.system() as s:
            original_open, original_attrs = guard.os.open, guard.os.listxattr
            attempts, attributes = [], []
            def opened(path, flags, **kw):
                relative = s.opened[kw['dir_fd']].rstrip('/') + '/' + path if 'dir_fd' in kw else path
                if relative == '/run/holaday-pool':
                    attempts.append(flags)
                    if not flags & 0x200000: raise PermissionError('search-only synthetic control directory')
                    flags &= ~0x200000  # Darwin backing file; Linux access rule checked above.
                return original_open(path, flags, **kw)
            def attrs(value):
                if type(value) is int and s.opened.get(value) == '/run/holaday-pool':
                    raise OSError('O_PATH does not support flistxattr')
                if type(value) is str and value.startswith('/proc/self/fd/'):
                    fd = int(value.rsplit('/', 1)[1])
                    self.assertEqual(s.opened[fd], '/run/holaday-pool')
                    attributes.append(fd)
                    return original_attrs(fd)
                return original_attrs(value)
            with patch.object(guard.os, 'open', side_effect=opened), patch.object(guard.os, 'listxattr', side_effect=attrs):
                s.worker._receive_bridge()
            self.assertTrue(attempts)
            self.assertTrue(attributes)
            self.assertTrue(all(flags == 0x200000 | NATIVE.O_DIRECTORY | NATIVE.O_NOFOLLOW | NATIVE.O_CLOEXEC for flags in attempts))
            self.assertIsNotNone(s.worker._bridge)

    @contextlib.contextmanager
    def system(self, role='anchor', listening=False):
        f = fixtures.WorkerGuardTests()
        with f.system(role) as s, f.open(role) as worker, contextlib.ExitStack() as stack:
            self.assertTrue(callable(getattr(worker, '_receive_bridge', None)), 'anchor FD consumer missing')
            s.worker = worker
            s.listeners, s.received = [], []
            # Anonymous addresses avoid macOS filesystem socket path limits.
            directory = stack.enter_context(tempfile.TemporaryDirectory(prefix='pool-', dir='/tmp')) if listening else None
            for index in range(2):
                item = Socket(socket.AF_UNIX, socket.SOCK_STREAM)
                if directory is not None:
                    item.bind(directory + '/' + str(index))
                    item.listen(80)
                item.setblocking(False)
                s.listeners.append(item)
            original_info, original_close = guard.os.fstat, guard.os.close
            def listener_info(fd):
                actual = NATIVE.fstat(fd)
                # Darwin exposes socket st_dev=-1; the Linux wire identity is
                # unsigned. Preserve the real inode, type and descriptor;
                # translate only this documented platform metadata seam.
                return SimpleNamespace(st_dev=actual.st_dev if actual.st_dev >= 0 else 42,
                                       st_ino=actual.st_ino, st_mode=actual.st_mode)
            s.listener_aliases = []
            def info(fd):
                return listener_info(fd) if fd in s.received or fd in s.listener_aliases else original_info(fd)
            def close(fd):
                if fd in s.received:
                    s.received.remove(fd)
                    NATIVE.close(fd)
                else: original_close(fd)
            stack.enter_context(patch.object(guard.os, 'fstat', info))
            stack.enter_context(patch.object(guard.os, 'close', close))
            # Actual rights are delivered over packet sockets. Linux listener
            # metadata/name is the platform seam; FD identity and CLOEXEC real.
            query = getattr(guard, '_bridge_socket_info', None)
            if query is not None:
                def metadata(fd):
                    index = s.received.index(fd)
                    return (socket.AF_UNIX, socket.SOCK_STREAM, 1,
                            '/run/holaday-pool-data/' + fixtures.RESOURCE + '/' + ('cdp.sock', 'vnc.sock')[index])
                stack.enter_context(patch.object(guard, '_bridge_socket_info', metadata))
            s.identities = tuple(v for item in s.listeners for v in (listener_info(item.fileno()).st_dev, listener_info(item.fileno()).st_ino))
            s.delivered = 0
            s.frame = lambda kind: FRAME.pack(b'HPB1', kind, bytes.fromhex(fixtures.CANDIDATE),
                bytes.fromhex(fixtures.RESOURCE), bytes.fromhex('1' * 32), bytes.fromhex('2' * 64), *s.identities)
            def packet(kind, rights=False):
                cmsgs = [(socket.SOL_SOCKET, socket.SCM_CREDENTIALS, s.peer)]
                if rights:
                    left, right = socket.socketpair(socket.AF_UNIX, socket.SOCK_DGRAM)
                    try:
                        left.sendmsg([s.frame(kind)], [(socket.SOL_SOCKET, socket.SCM_RIGHTS,
                            array.array('i', [item.fileno() for item in s.listeners]))])
                        payload, ancillary, flags, address = right.recvmsg(256, socket.CMSG_SPACE(32))
                        for _, _, raw in ancillary:
                            received = array.array('i', raw)
                            for fd in received:
                                NATIVE.set_inheritable(fd, False)  # Linux MSG_CMSG_CLOEXEC seam.
                                s.received.append(fd)
                                s.delivered += 1
                        return payload, ancillary + cmsgs, flags, address
                    finally:
                        left.close()
                        right.close()
                return s.frame(kind), cmsgs, 0, None
            s.packet = packet
            s.packets = [f.packet(s, 'challenge'), f.packet(s, 'grant'),
                         lambda: packet(1), lambda: packet(3, True), lambda: packet(5)]
            try:
                yield s
            finally:
                worker.close()
                self.assertEqual(s.received, [], 'received rights leaked')
                for item in s.listeners: item.close()

    def test_actual_rights_retained_only_after_exact_commit_and_not_exposed_as_ready(self):
        with self.system() as s:
            self.assertIsNone(s.worker._receive_bridge())
            self.assertEqual(len(s.received), 2)
            self.assertEqual([p[4] for p in s.sent if p.startswith(b'HPB1')], [0, 2, 4])
            self.assertTrue(all(not NATIVE.get_inheritable(fd) for fd in s.received))
            self.assertFalse(hasattr(s.worker, 'ready'))

    def test_application_dies_at_commit_closes_both_delivered_listeners(self):
        with self.system() as s:
            def commit_after_exit():
                NATIVE.write(s.app_writers[0], b'x')
                return s.packet(5)
            s.packets[-1] = commit_after_exit
            with self.assertRaises(ValueError): s.worker._receive_bridge()
            self.assertEqual(s.delivered, 2)
            self.assertFalse(s.received)
            self.assertIsNone(s.worker._bridge)
            self.assertEqual(len(s.app_fds), 1)
            with self.assertRaises(ValueError): s.worker._receive_bridge()
            self.assertEqual(len(s.app_fds), 1)

    def test_application_death_in_final_cleanup_cannot_retain_bridge(self):
        for target in ('/proc/self/ns/pid', '/run/holaday-pool'):
            with self.subTest(target=target), self.system() as s:
                original_close = guard.os.close
                fired = False
                def close(fd):
                    nonlocal fired
                    path = s.opened.get(fd)
                    original_close(fd)
                    if (not fired and path == target and not s.packets and len(s.channels) == 2
                            and all(c.closed for c in s.channels)):
                        fired = True
                        NATIVE.write(s.app_writers[0], b'x')
                with patch.object(guard.os, 'close', close):
                    with self.assertRaises(ValueError): s.worker._receive_bridge()
                self.assertTrue(fired, 'test must reach post-commit native cleanup')
                self.assertEqual(s.delivered, 2)
                self.assertFalse(s.received)
                self.assertIsNone(s.worker._bridge)

    def test_wrong_commit_nonce_type_or_sender_closes_every_received_fd(self):
        for mode in ('nonce', 'type', 'sender', 'truncated'):
            with self.subTest(mode=mode), self.system() as s:
                def invalid():
                    payload, ancillary, flags, address = s.packet(5)
                    if mode == 'nonce': payload = payload[:57] + bytes.fromhex('3' * 64) + payload[89:]
                    elif mode == 'type': payload = s.frame(3)
                    elif mode == 'sender': ancillary = [(socket.SOL_SOCKET, socket.SCM_CREDENTIALS, b'\0' * 12)]
                    else: flags = socket.MSG_TRUNC
                    return payload, ancillary, flags, address
                s.packets[-1] = invalid
                with self.assertRaises(ValueError): s.worker._receive_bridge()
                self.assertEqual(s.received, [])
                self.assertEqual([p[4] for p in s.sent if p.startswith(b'HPB1')], [0, 2, 4])
                count = len(s.sent)
                with self.assertRaises(ValueError): s.worker._receive_bridge()
                self.assertEqual(len(s.sent), count)

    def test_non_anchor_cannot_open_private_fd_channel(self):
        with self.system('brave') as s:
            with self.assertRaises(ValueError): s.worker._receive_bridge()
            self.assertEqual(s.socket_created, 0)

    def test_extra_right_is_owned_then_closed_on_offer_rejection(self):
        with self.system() as s:
            s.listeners.append(Socket(socket.AF_UNIX, socket.SOCK_STREAM))
            with self.assertRaises(ValueError): s.worker._receive_bridge()
            self.assertEqual(s.received, [])
            self.assertEqual(s.delivered, 3)

    def test_offer_binds_candidate_resource_invocation_nonce_and_ordered_socket_ids(self):
        for field in (0, 1, 2, 3, 4, 5, 6, 7, 8, 9):
            with self.subTest(field=field), self.system() as s:
                def wrong_offer():
                    payload, ancillary, flags, address = s.packet(3, True)
                    fields = list(FRAME.unpack(payload))
                    fields[field] = (fields[field] + 1 if isinstance(fields[field], int)
                                     else b'\xff' * len(fields[field]))
                    return FRAME.pack(*fields), ancillary, flags, address
                s.packets[3] = wrong_offer
                with self.assertRaises(ValueError): s.worker._receive_bridge()
                self.assertEqual(s.delivered, 2)
                self.assertEqual(s.received, [])
                self.assertEqual([p[4] for p in s.sent if p.startswith(b'HPB1')], [0, 2])

    def test_rejects_invalid_challenge_before_receiving_rights(self):
        for mode in ('zero-invocation', 'zero-nonce', 'old-nonce', 'same-socket', 'zero-inode'):
            with self.subTest(mode=mode), self.system() as s:
                def invalid():
                    payload, ancillary, flags, address = s.packet(1)
                    fields = list(FRAME.unpack(payload))
                    if mode == 'zero-invocation': fields[4] = bytes(16)
                    elif mode == 'zero-nonce': fields[5] = bytes(32)
                    elif mode == 'old-nonce': fields[5] = bytes.fromhex(s.binding['handshake'])
                    elif mode == 'same-socket': fields[8:] = fields[6:8]
                    else: fields[7] = 0
                    return FRAME.pack(*fields), ancillary, flags, address
                s.packets[2] = invalid
                with self.assertRaises(ValueError): s.worker._receive_bridge()
                self.assertEqual(s.delivered, 0)
                self.assertEqual([p[4] for p in s.sent if p.startswith(b'HPB1')], [0])

    def test_listener_properties_and_descriptor_flags_are_checked_before_accepted(self):
        for mode in ('family', 'type', 'not-listening', 'name', 'inheritable', 'blocking', 'swapped'):
            with self.subTest(mode=mode), self.system() as s:
                metadata = guard._bridge_socket_info
                def query(fd):
                    result = list(metadata(fd))
                    if mode == 'family': result[0] = socket.AF_INET
                    elif mode == 'type': result[1] = socket.SOCK_DGRAM
                    elif mode == 'not-listening': result[2] = 0
                    elif mode == 'name': result[3] = '/run/holaday-pool-data/other/cdp.sock'
                    return tuple(result)
                if mode == 'swapped': s.listeners.reverse()
                def offer():
                    result = s.packet(3, True)
                    if mode == 'inheritable': NATIVE.set_inheritable(s.received[0], True)
                    if mode == 'blocking': NATIVE.set_blocking(s.received[0], True)
                    return result
                s.packets[3] = offer
                with patch.object(guard, '_bridge_socket_info', query):
                    with self.assertRaises(ValueError): s.worker._receive_bridge()
                self.assertEqual(s.delivered, 2)
                self.assertEqual(s.received, [])
                self.assertEqual([p[4] for p in s.sent if p.startswith(b'HPB1')], [0, 2])

    def test_unexpected_rights_in_challenge_or_commit_are_closed(self):
        for stage, kind in ((2, 1), (4, 5)):
            with self.subTest(kind=kind), self.system() as s:
                s.packets[stage] = lambda: s.packet(kind, True)
                with self.assertRaises(ValueError): s.worker._receive_bridge()
                self.assertEqual(s.delivered, 2 if kind == 1 else 4)
                self.assertEqual(s.received, [])

    def test_offer_rejection_owns_all_rights_before_revocation_or_truncation(self):
        for mode in ('closed', 'deadline', 'truncated', 'missing-peer', 'extra-peer', 'bad-cmsg'):
            with self.subTest(mode=mode), self.system() as s:
                def offer():
                    payload, ancillary, flags, address = s.packet(3, True)
                    if mode == 'closed': s.worker.close()
                    elif mode == 'deadline': s.now += 6
                    elif mode == 'truncated': flags |= socket.MSG_CTRUNC
                    elif mode == 'missing-peer': ancillary = ancillary[:1]
                    elif mode == 'extra-peer': ancillary += ancillary[-1:]
                    else: ancillary += [(socket.SOL_SOCKET, 999, b'bad')]
                    return payload, ancillary, flags, address
                s.packets[3] = offer
                with self.assertRaises(ValueError): s.worker._receive_bridge()
                self.assertEqual(s.delivered, 2)
                self.assertEqual(s.received, [])
                self.assertEqual([p[4] for p in s.sent if p.startswith(b'HPB1')], [0, 2])

    def test_commit_loss_and_post_commit_deadline_never_retain_rights(self):
        for mode in ('lost', 'after-close'):
            with self.subTest(mode=mode), self.system() as s:
                if mode == 'lost':
                    def lost(): raise TimeoutError('synthetic missing commit')
                    s.packets[4] = lost
                else:
                    s.hook = lambda event: setattr(s, 'now', s.now + 6) if event == 'close' and s.delivered else None
                with self.assertRaises(ValueError): s.worker._receive_bridge()
                self.assertEqual(s.delivered, 2)
                self.assertEqual(s.received, [])
                self.assertIsNone(s.worker._bridge)

    def test_deadline_does_not_reset_between_original_grant_and_fd_channel(self):
        with self.system() as s:
            def expire(event):
                if event == 'close': s.now += 6
            s.hook = expire
            with self.assertRaises(ValueError): s.worker._receive_bridge()
            self.assertFalse(any(p.startswith(b'HPB1') for p in s.sent))


if __name__ == '__main__':
    unittest.main()
