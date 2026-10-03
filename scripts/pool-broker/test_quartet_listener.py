"""Actual fixed-leaf listener and create stream; Linux identities are explicit seams."""
import contextlib
import socket
import stat
import struct
import threading
import unittest
from types import SimpleNamespace
from unittest.mock import patch

import test_quartet_journal
import test_quartet_create_control
import test_resource_journal
import quartet_protocol
try:
    import quartet_listener as module
except ModuleNotFoundError as error:
    if error.name != 'quartet_listener': raise
    module = None

NATIVE = test_resource_journal.NATIVE
NativeSocket = socket.socket


class QuartetListenerTests(unittest.TestCase):
    def test_nested_accept_cannot_release_the_outer_pending_acquisition(self):
        with self.system() as s:
            listener = module._QuartetListener.open(s.journal)
            observed = []
            def reenter():
                with self.assertRaises(ValueError): listener.accept_control()
                observed.append((listener._busy, len(listener._chain)))
            with s.connect():
                s.state['before_accept'] = reenter
                with self.assertRaises(ValueError): listener.accept_control()
            self.assertEqual(observed, [(True, 3)])
            self.assertEqual(s.state['accepted'][0].fileno(), -1)
            listener.close()

    def test_idle_timeout_does_not_consume_or_reopen_the_original_listener(self):
        with self.system() as s:
            listener = module._QuartetListener.open(s.journal)
            original = listener._socket
            try:
                with patch.object(original, 'accept', side_effect=TimeoutError()):
                    self.assertIsNone(listener.accept_control())
                self.assertEqual(listener._count, 0)
                self.assertIs(listener._socket, original)
                with s.connect():
                    control = listener.accept_control()
                    self.assertIs(control._listener, listener)
            finally: listener.close()

    def test_last_timeout_clock_or_close_prevents_actual_accept(self):
        for mode in ('clock', 'close'):
            with self.subTest(mode=mode), self.system() as s:
                listener = module._QuartetListener.open(s.journal)
                stream = listener._socket
                native_timeout = stream.settimeout
                now = [module.time.monotonic()]
                injected = []
                def timeout(value):
                    native_timeout(value)
                    injected.append(True)
                    if mode == 'clock': now[0] += 6
                    else: listener.close()
                with patch.object(module, 'time', SimpleNamespace(monotonic=lambda: now[0])), \
                        patch.object(stream, 'settimeout', side_effect=timeout):
                    with self.assertRaises(ValueError): listener.accept_control()
                self.assertEqual(injected, [True])
                self.assertEqual(s.state['accepted'], [])
                listener.close()

    @contextlib.contextmanager
    def system(self, *, base=None):
        self.assertIsNotNone(module, 'fixed original quartet listener missing')
        with patch('tempfile.tempdir', '/private/tmp'), \
                (test_quartet_journal.QuartetJournalTests().system() if base is None else base()) as s, contextlib.ExitStack() as stack:
            root = s.root if hasattr(s, 'root') else s.path.parents[3]
            parent = root / 'run/holaday-pool-runtime'
            parent.mkdir(parents=True)
            parent.chmod(0o750)
            path = str(parent / 'control.sock')
            gids = {NATIVE.stat(parent).st_ino: 998}
            proxy = SimpleNamespace(**vars(s.proxy))
            def info(value):
                return SimpleNamespace(st_uid=0, st_gid=gids.get(value.st_ino, 0),
                    st_mode=value.st_mode, st_dev=value.st_dev, st_ino=value.st_ino,
                    st_nlink=value.st_nlink)
            proxy.fstat = lambda fd: info(NATIVE.fstat(fd))
            proxy.stat = lambda *a, **kw: info(NATIVE.stat(*a, **kw))
            def chown(name, uid, gid, **kw):
                self.assertEqual(uid, 0)
                gids[NATIVE.stat(name, **kw).st_ino] = gid
            proxy.chown = chown
            removed = []
            def unlink(*a, **kw):
                removed.append(a[0])
                return NATIVE.unlink(*a, **kw)
            proxy.unlink = unlink
            state = {'peer': struct.pack('=iII', 123, 998, 998), 'accepted': [], 'before_accept': None}
            class Peer(NativeSocket):
                def setsockopt(self, *a):
                    if a == (socket.SOL_SOCKET, 16, 1): return
                    return super().setsockopt(*a)
                def getsockopt(self, level, option, *a):
                    if (level, option) == (socket.SOL_SOCKET, 17): return state['peer']
                    return super().getsockopt(level, option, *a)
                def recvmsg(self, size, space, flags=0):
                    data, ancillary, flags, address = super().recvmsg(size, space)
                    return data, ancillary + ([(socket.SOL_SOCKET, 2, state['peer'])] if data else []), flags, address
            class Server(NativeSocket):
                def __init__(self, family, kind):
                    if family != socket.AF_UNIX or kind & 15 != socket.SOCK_STREAM:
                        raise AssertionError('wrong fixed socket type')
                    # Linux creation flag is synthetic on Darwin; actual FD is CLOEXEC.
                    super().__init__(family, socket.SOCK_STREAM)
                def getsockopt(self, level, option, *args):
                    if (level, option) == (socket.SOL_SOCKET, socket.SO_ACCEPTCONN):
                        # Darwin AF_UNIX rejects this option; actual listen/connect stay real.
                        return int(getattr(self, 'actual_listening', False))
                    return super().getsockopt(level, option, *args)
                def listen(self, backlog):
                    super().listen(backlog)
                    self.actual_listening = True
                def setsockopt(self, *a):
                    if a == (socket.SOL_SOCKET, 16, 1): return
                    return super().setsockopt(*a)
                def bind(self, name):
                    self.assert_path(name)
                    return super().bind(path)
                def assert_path(self, name):
                    if name != '/run/holaday-pool-runtime/control.sock': raise AssertionError('non-fixed listener')
                def accept(self):
                    channel, address = super().accept()
                    owned = Peer(fileno=channel.detach())
                    state['accepted'].append(owned)
                    if state['before_accept']: state['before_accept']()
                    return owned, address
            stack.enter_context(patch.object(module, 'os', proxy))
            stack.enter_context(patch.object(module, 'Socket', Server))
            stack.enter_context(patch.object(test_quartet_create_control.module, 'os', NATIVE))
            s.path_runtime, s.parent_runtime = path, parent
            s.state, s.removed = state, removed
            s.native = NATIVE
            s.connect = lambda: self.connect(path)
            yield s

    def connect(self, path):
        peer = NativeSocket(socket.AF_UNIX, socket.SOCK_STREAM)
        peer.settimeout(3)
        peer.connect(path)
        return peer

    def test_actual_listener_hands_original_registered_stream_to_durable_offer(self):
        with self.system() as s:
            baseline = set(s.opened)
            listener = module._QuartetListener.open(s.journal)
            failures = []
            def client():
                try:
                    with s.connect() as peer:
                        helper = test_quartet_create_control.CreateControlTests()
                        peer.sendall(helper.request())
                        raw = helper.read(peer)
                        data = quartet_protocol.decode_control_frame(raw)
                        scope = {key: data[key] for key in ('version', 'requestId', 'candidate', 'boot', 'resource', 'slot')}
                        peer.sendall(quartet_protocol.encode_control_frame(scope | {'phase': 'accepted',
                            'preparedDigest': quartet_protocol.control_prepared_digest(raw)}))
                        peer.recv(1)
                except Exception as error: failures.append(type(error).__name__)
            worker = threading.Thread(target=client)
            worker.start()
            try:
                control = listener.accept_control()
                offer = control.prepare()
                self.assertTrue(offer._accepted)
                self.assertEqual(s.journal._resources[offer._resource]['roles'], {})
                listener.close()
                with self.assertRaises(ValueError): offer._budget()
            finally:
                listener.close()
                worker.join(4)
            self.assertFalse(worker.is_alive())
            self.assertEqual(failures, [])
            self.assertEqual(s.opened, baseline)
            self.assertEqual(s.removed, ['control.sock'])

    def test_existing_socket_is_never_unlinked_or_adopted(self):
        with self.system() as s, NativeSocket(socket.AF_UNIX, socket.SOCK_STREAM) as existing:
            existing.bind(s.path_runtime)
            original = NATIVE.stat(s.path_runtime).st_ino
            baseline = set(s.opened)
            with self.assertRaises(ValueError): module._QuartetListener.open(s.journal)
            self.assertEqual(NATIVE.stat(s.path_runtime).st_ino, original)
            self.assertEqual(s.removed, [])
            self.assertEqual(s.opened, baseline)

    def test_replaced_leaf_is_not_accepted_or_removed(self):
        with self.system() as s, NativeSocket(socket.AF_UNIX, socket.SOCK_STREAM) as replacement:
            listener = module._QuartetListener.open(s.journal)
            NATIVE.unlink(s.path_runtime)
            replacement.bind(s.path_runtime)
            identity = NATIVE.stat(s.path_runtime).st_ino
            with self.assertRaises(ValueError): listener.accept_control()
            with self.assertRaises(ValueError): listener.close()
            self.assertEqual(NATIVE.stat(s.path_runtime).st_ino, identity)
            self.assertEqual(s.state['accepted'], [])
            self.assertEqual(s.removed, [])

    def test_accept_that_reenters_close_still_owns_the_late_channel(self):
        with self.system() as s:
            listener = module._QuartetListener.open(s.journal)
            with s.connect() as peer:
                s.state['before_accept'] = listener.close
                with self.assertRaises(ValueError): listener.accept_control()
                self.assertEqual(len(s.state['accepted']), 1)
                self.assertEqual(s.state['accepted'][0].fileno(), -1)
                self.assertEqual(peer.recv(1), b'')
            listener.close()

    def test_wrong_original_peer_is_rejected_before_any_create_record(self):
        with self.system() as s:
            before = s.contents()
            listener = module._QuartetListener.open(s.journal)
            try:
                with s.connect():
                    s.state['peer'] = struct.pack('=iII', 124, 998, 998)
                    with self.assertRaises(ValueError): listener.accept_control()
                self.assertEqual(s.contents(), before)
            finally: listener.close()
