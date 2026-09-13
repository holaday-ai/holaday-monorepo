"""Actual X11 byte stream with explicit Linux O_PATH/SCM/mount metadata seams."""
import array
import contextlib
import selectors
import socket
import stat
import struct
import unittest
from unittest.mock import patch
import test_quartet_egress_source as fixture
from test_quartet_probe_exchange import x11_setup

guard, NATIVE, Socket = fixture.guard, fixture.NATIVE, fixture.fixture.Socket


class X11ProbeTests(unittest.TestCase):
    @contextlib.contextmanager
    def system(self, missing=False):
        with fixture.EgressSourceTests().system(authority=True) as s, contextlib.ExitStack() as stack:
            directory = s.root / 'tmp/.X11-unix'
            directory.mkdir()
            leaf = directory / 'X99'
            if not missing: leaf.write_bytes(b'O_PATH stand-in')
            s.metadata['/tmp/.X11-unix'] = {'st_mode': stat.S_IFDIR | 0o1777, 'st_uid': 2001, 'st_gid': 2001}
            s.metadata['/tmp/.X11-unix/X99'] = {'st_mode': stat.S_IFSOCK | 0o777, 'st_uid': 2001, 'st_gid': 2001}
            s.flags['/tmp/.X11-unix'] = s.flags['/tmp/.X11-unix/X99'] = 14
            listener = stack.enter_context(Socket(socket.AF_UNIX, socket.SOCK_STREAM))
            endpoint = str(s.root / 'run/holaday-pool/x11.sock')
            listener.bind(endpoint)
            listener.listen(1)
            listener.settimeout(1)
            s.x11_connects, s.x11_hook, s.x11_peer = [], lambda: None, struct.pack('=iII', 321, 2001, 2001)
            original_open = guard.os.open
            assert_equal = self.assertEqual
            def opened(name, flags, **kw):
                if flags & 0x200000:
                    self.assertEqual(name, 'X99')
                    self.assertEqual(flags, 0x200000 | NATIVE.O_NOFOLLOW | NATIVE.O_CLOEXEC)
                    flags = NATIVE.O_RDONLY | NATIVE.O_NOFOLLOW | NATIVE.O_CLOEXEC
                return original_open(name, flags, **kw)
            class XStream(Socket):
                def connect_ex(self, path):
                    s.x11_connects.append(path)
                    self_path = int(path.rsplit('/', 1)[1])
                    assert_equal(s.opened[self_path], '/tmp/.X11-unix/X99')
                    assert_equal(self_path, s.probe._x11._leaf[0])
                    return super().connect_ex(endpoint)
                def getsockopt(self, level, option, *args):
                    if option == socket.SO_PEERCRED: return s.x11_peer
                    return super().getsockopt(level, option, *args)
                def setsockopt(self, level, option, value):
                    if option == socket.SO_PASSCRED: return
                    return super().setsockopt(level, option, value)
                def recvmsg(self, size, space, flags=0):
                    data, ancillary, flags, address = super().recvmsg(size, space)
                    for level, kind, raw in ancillary:
                        if level == socket.SOL_SOCKET and kind == socket.SCM_RIGHTS:
                            for fd in array.array('i', raw):
                                s.opened[fd] = '<x11-unwanted-right>'
                                NATIVE.set_inheritable(fd, False)
                    s.x11_hook()
                    return data, ancillary + [(socket.SOL_SOCKET, socket.SCM_CREDENTIALS, s.x11_peer)], flags, address
            stack.enter_context(patch.object(guard.os, 'open', side_effect=opened))
            stack.enter_context(patch.object(guard, '_ProbeSocket', XStream))
            probe = guard._ProtocolProbe.open(s.egress_source, 1, 321, s.now + 5)
            s.probe, s.x11_listener, s.x11_leaf = probe, listener, leaf
            try: yield s
            finally: probe.close()

    def connect(self, s):
        s.probe.advance(0)
        remote = s.x11_listener.accept()[0]
        remote.settimeout(1)
        for _ in range(3): s.probe.advance(selectors.EVENT_WRITE)
        self.assertTrue(remote.recv(256).endswith(b'c' * 16))
        return remote

    def test_original_xauthority_and_held_leaf_perform_real_setup(self):
        with self.system() as s, self.connect(s) as remote:
            remote.sendall(x11_setup())
            s.probe.advance(selectors.EVENT_READ)
            self.assertTrue(s.probe._observed)
            self.assertEqual(len(s.x11_connects), 1)

    def test_initial_missing_leaf_can_appear_within_same_deadline(self):
        with self.system(missing=True) as s:
            s.probe.advance(0)
            self.assertEqual(s.x11_connects, [])
            s.x11_leaf.write_bytes(b'created leaf')
            s.now += .11
            with self.connect(s) as remote:
                remote.sendall(x11_setup())
                s.probe.advance(selectors.EVENT_READ)
                self.assertTrue(s.probe._observed)

    def test_held_leaf_replacement_auth_mutation_sender_and_rights_are_terminal(self):
        for mode in ('leaf', 'authority', 'sender', 'rights', 'close-rights'):
            with self.subTest(mode=mode), self.system() as s, self.connect(s) as remote:
                if mode == 'leaf':
                    s.x11_leaf.rename(s.x11_leaf.with_name('retired'))
                    s.x11_leaf.write_bytes(b'replacement')
                if mode == 'authority': s.authority_file.write_bytes(s.authority_file.read_bytes()[:-1] + b'x')
                if mode == 'sender': s.x11_peer = struct.pack('=iII', 322, 2001, 2001)
                if mode in ('rights', 'close-rights'):
                    remote.sendmsg([x11_setup()], [(socket.SOL_SOCKET, socket.SCM_RIGHTS, array.array('i', [s.listeners[0].fileno()]))])
                    if mode == 'close-rights': s.x11_hook = s.probe.close
                else: remote.sendall(x11_setup())
                with self.assertRaises(ValueError): s.probe.advance(selectors.EVENT_READ)
                self.assertFalse(s.probe._observed)
                self.assertNotIn('<x11-unwanted-right>', s.opened.values())
                self.assertEqual(len(s.x11_connects), 1)

    def test_fixture_rejects_another_valid_held_leaf_instead_of_original_x99(self):
        with self.system() as s:
            with patch.object(s.probe._x11, 'path', return_value=s.egress_source._path()):
                with self.assertRaises(ValueError): s.probe.advance(0)


if __name__ == '__main__': unittest.main()
