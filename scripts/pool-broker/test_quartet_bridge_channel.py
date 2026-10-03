"""Original endpoints/pins/journal and real rights; Linux boundaries synthetic."""
import array
import contextlib
import json
import socket
import struct
import threading
import time
import unittest
from types import SimpleNamespace
from unittest.mock import patch

import resource_journal
import test_quartet_endpoints as endpoint_fixture
import test_quartet_worker_channel as channel_fixture
import test_quartet_worker_guard as guard_fixture

try:
    import quartet_bridge_channel as bridge
except ModuleNotFoundError as error:
    if error.name != 'quartet_bridge_channel': raise
    bridge = None

FRAME = struct.Struct('!4sB20s16s16s32sQQQQ')
NATIVE = endpoint_fixture.NATIVE


class BridgeChannelTests(unittest.TestCase):
    def test_child_accept_composes_bridge_and_anchor_checks_before_first_io(self):
        import test_quartet_anchor_binding
        with self.system() as s:
            self.transfer(s)
            s.material.prepare_role('xvfb')
            test_quartet_anchor_binding.AnchorBindingTests().dispatch_observation(s, 'xvfb', 1)
            anchor = s.material._workers['anchor']
            before_accept = []
            with patch.object(anchor, '_check_locked', wraps=anchor._check_locked) as check:
                def accept():
                    before_accept.append(check.call_count)
                    return s.worker_accept()
                with patch.object(s.material._socket, 'accept', side_effect=accept), \
                        patch.object(s.material._socket, 'settimeout', s.worker_settimeout):
                    s.material.accept_role('xvfb')
            self.assertEqual(before_accept, [1], 'same pre-accept source is inspected twice')

    def test_next_credential_does_not_duplicate_its_initial_anchor_inspection(self):
        with self.system() as s:
            self.transfer(s)
            anchor = s.material._workers['anchor']
            with patch.object(anchor, '_check_locked', wraps=anchor._check_locked) as check:
                s.material.prepare_role('xvfb')
            # One initial inspection, then mandatory checks before AND after
            # credential_ready fsync. Never collapse checks across native IO.
            self.assertEqual(check.call_count, 3, 'initial boundary repeats the complete anchor inspection')

    @contextlib.contextmanager
    def setup_endpoints(self, s, create=True):
        fixture = endpoint_fixture.EndpointTests()
        with fixture.environment(s, s.material):
            original = endpoint_fixture.endpoints.os
            proxy = SimpleNamespace(**vars(original))
            def info(fd):
                actual = original.fstat(fd)
                if actual.st_dev >= 0: return actual
                fields = {key: getattr(actual, key) for key in dir(actual) if key.startswith('st_')}
                fields['st_dev'] = 42  # Darwin socket device seam, real inode retained.
                return SimpleNamespace(**fields)
            proxy.fstat = info
            with patch.object(endpoint_fixture.endpoints, 'os', proxy):
                if create: fixture.create(s)
                yield

    @contextlib.contextmanager
    def system(self, automatic_peer=True):
        self.assertIsNotNone(bridge, 'root FD handoff producer missing')
        with channel_fixture.WorkerChannelTests().system(material_setup=self.setup_endpoints, automatic_peer=automatic_peer) as s, contextlib.ExitStack() as stack:
            if automatic_peer: s.material.accept_role('anchor')
            s.rights, s.bridge_sends, s.durable, s.accepted_count = [], [], [], 0
            s.bridge_mode = ''
            s.bridge_hook = lambda _event: None
            left, right = socket.socketpair(socket.AF_UNIX, socket.SOCK_DGRAM)
            left.settimeout(1)
            right.settimeout(1)
            s.left, s.right = left, right
            class Connection:
                def settimeout(self, value): left.settimeout(value)
                def set_inheritable(self, value): left.set_inheritable(value)
                def setsockopt(self, level, option, value):
                    if (level, option, value) != (socket.SOL_SOCKET, 16, 1):
                        raise AssertionError('missing credential option')
                def getsockopt(self, *args): return s.peer
                def recvmsg(self, size, space, flags):
                    data, ancillary, flags, address = left.recvmsg(size, space)
                    peer = s.peer if s.bridge_mode != 'sender' else struct.pack('=iII', 778, 2001, 2001)
                    s.bridge_hook('receive')
                    return data, ancillary + [(socket.SOL_SOCKET, 2, peer)], flags, address
                def sendmsg(self, buffers, ancillary=()):
                    data = b''.join(buffers)
                    kind = data[4]
                    s.bridge_sends.append(kind)
                    rows = [json.loads(line) for line in s.journal._expected.splitlines()][1:]
                    s.durable.append((kind, rows[-1]['action']))
                    sent = left.sendmsg(buffers, ancillary)
                    if not automatic_peer: return sent
                    received, rights, _flags, _address = right.recvmsg(256, socket.CMSG_SPACE(32))
                    for level, name, raw in rights:
                        if (level, name) != (socket.SOL_SOCKET, socket.SCM_RIGHTS): raise AssertionError()
                        s.rights.extend(array.array('i', raw))
                    fields = list(FRAME.unpack(received))
                    if kind in (1, 3):
                        fields[1] = kind + 1
                        if s.bridge_mode == 'nonce': fields[5] = bytes(32)
                        right.sendmsg([FRAME.pack(*fields)])
                    s.bridge_hook('send-' + str(kind))
                    return sent - 1 if s.bridge_mode == 'short' and kind == 3 else sent
                def close(self):
                    left.close()
                    s.bridge_hook('close')
            def accept():
                s.accepted_count += 1
                return Connection(), ''
            stack.enter_context(patch.object(bridge, 'os', NATIVE))
            s.worker_accept = s.material._socket.accept
            s.worker_settimeout = s.material._socket.settimeout
            def begin_bridge():
                stack.enter_context(patch.object(s.material._socket, 'accept', accept, create=True))
                stack.enter_context(patch.object(s.material._socket, 'settimeout', left.settimeout, create=True))
            s.begin_bridge = begin_bridge
            if automatic_peer:
                begin_bridge()
                right.sendmsg([FRAME.pack(b'HPB1', 0, bytes.fromhex('a' * 40), bytes.fromhex(s.resource),
                    bytes(16), bytes.fromhex(s.material._bindings['anchor']['handshake']), 0, 0, 0, 0)])
            try:
                yield s
            finally:
                s.material.close()
                for fd in s.rights: NATIVE.close(fd)
                left.close()
                right.close()

    def transfer(self, s):
        s.material._run(lambda: bridge._BridgeChannel._transfer_locked(s.material), handshake=True)

    def test_original_anchor_receives_two_real_listeners_after_durable_offer_and_commit(self):
        with self.system() as s:
            self.transfer(s)
            self.assertEqual(s.bridge_sends, [1, 3, 5])
            self.assertEqual(s.durable[-2:], [(3, 'bridge_offer'), (5, 'bridge_commit')])
            self.assertEqual(len(s.rights), 2)
            self.assertEqual([NATIVE.fstat(fd).st_ino for fd in s.rights],
                             [NATIVE.fstat(item.fileno()).st_ino for item in s.listeners])
            self.assertEqual(s.pin_events, ['pidfd_open'], 'must not reconstruct anchor')
            self.assertNotEqual(s.journal._resources[s.resource]['state'], 'exited')
            self.assertFalse(hasattr(s.material, 'ready'))

    def test_failed_offer_send_is_consumed_and_not_retried_or_released(self):
        with self.system() as s:
            s.bridge_mode = 'short'
            with self.assertRaises(ValueError): self.transfer(s)
            self.assertEqual(s.bridge_sends, [1, 3])
            self.assertEqual(s.journal._resources[s.resource]['bridge']['state'], 'offered')
            with self.assertRaises(ValueError): self.transfer(s)
            self.assertEqual(s.accepted_count, 1)
            # Closing root originals does not revoke the remote SCM_RIGHTS copy.
            self.assertEqual(len(s.rights), 2)
            for fd in s.rights: NATIVE.fstat(fd)

    def test_wrong_sender_or_response_nonce_never_offers_rights(self):
        for mode in ('sender', 'nonce'):
            with self.subTest(mode=mode), self.system() as s:
                s.bridge_mode = mode
                with self.assertRaises(ValueError): self.transfer(s)
                self.assertEqual(s.rights, [])
                self.assertNotIn(b'"action":"bridge_offer"', s.journal._expected)

    def test_child_credentials_cannot_skip_original_fd_handoff(self):
        with self.system() as s:
            with self.assertRaises(ValueError): s.material.prepare_role('xvfb')
            self.assertNotIn(b'"role":"xvfb"', s.journal._expected)

    def test_completed_live_handoff_allows_next_credential_but_not_a_second_offer(self):
        with self.system() as s:
            self.transfer(s)
            s.material.prepare_role('xvfb')
            self.assertEqual(s.journal._resources[s.resource]['material']['credentials']['xvfb']['state'], 'ready')
            with self.assertRaises(ValueError): self.transfer(s)
            self.assertEqual(s.accepted_count, 1)
            self.assertEqual(s.bridge_sends, [1, 3, 5])

    def test_original_anchor_revoked_inside_journal_guard_prevents_offer_write(self):
        with self.system() as s:
            append, check = s.journal._append, s.journal._guard
            state = {'armed': False}
            def record(row):
                if row['action'] == 'bridge_offer': state['armed'] = True
                return append(row)
            def revoke():
                check()
                if state['armed']:
                    state['armed'] = False
                    s.material._workers['anchor']._pin.close()
            observed = NATIVE.dup(s.journal._fd)
            try:
                with patch.object(s.journal, '_append', record), patch.object(s.journal, '_guard', revoke):
                    with self.assertRaises(ValueError): self.transfer(s)
                self.assertFalse(b'"action":"bridge_offer"' in NATIVE.pread(observed, 262144, 0),
                                 'offer was physically written after original anchor revocation')
            finally:
                NATIVE.close(observed)
            self.assertEqual(s.rights, [])

    def test_default_outer_scope_cannot_extend_bridge_beyond_five_seconds(self):
        with self.system() as s:
            original_clock = time.monotonic
            state = {'receives': 0, 'expired': False}
            def advance(event):
                if event == 'receive':
                    state['receives'] += 1
                    if state['receives'] == 2: state['expired'] = True
            s.bridge_hook = advance
            with patch.object(time, 'monotonic', lambda: original_clock() + (6 if state['expired'] else 0)):
                with self.assertRaises(ValueError):
                    # Deliberately omit handshake=True: producer owns its limit.
                    s.material._run(lambda: bridge._BridgeChannel._transfer_locked(s.material))
            self.assertTrue(state['expired'])
            self.assertEqual(s.bridge_sends, [1])
            self.assertEqual(s.rights, [])
            self.assertFalse(b'"action":"bridge_offer"' in s.journal._expected)

    def test_default_scope_still_enforces_deadline_in_outer_final_guard(self):
        with self.system() as s:
            original_clock, original_handshake = time.monotonic, bridge._BridgeChannel._handshake
            state = {'returned': False}
            def handshake(item):
                original_handshake(item)
                state['returned'] = True
            with patch.object(bridge._BridgeChannel, '_handshake', handshake), patch.object(
                    time, 'monotonic', lambda: original_clock() + (6 if state['returned'] else 0)):
                with self.assertRaises(ValueError):
                    s.material._run(lambda: bridge._BridgeChannel._transfer_locked(s.material))
            self.assertTrue(state['returned'])
            self.assertEqual(s.bridge_sends, [1, 3, 5])
            self.assertTrue(s.material._retired)

    def test_completed_handoff_deadline_is_not_a_permanent_lease_for_later_transactions(self):
        with self.system() as s:
            self.transfer(s)
            original_clock = time.monotonic
            with patch.object(time, 'monotonic', lambda: original_clock() + 6):
                s.material.prepare_role('xvfb')
            self.assertEqual(s.journal._resources[s.resource]['material']['credentials']['xvfb']['state'], 'ready')

    def test_fsync_failure_never_sends_corresponding_offer_or_commit(self):
        for action, kind in (('bridge_offer', 3), ('bridge_commit', 5)):
            for phase in ('file', 'directory'):
                with self.subTest(action=action, phase=phase), self.system() as s:
                    original = resource_journal.os.fsync
                    target = s.journal._fd if phase == 'file' else s.journal._parent
                    def sync(fd):
                        if fd == target and ('"action":"' + action + '"').encode() in NATIVE.pread(s.journal._fd, 262144, 0):
                            raise OSError('synthetic bridge sync failure')
                        return original(fd)
                    with patch.object(resource_journal.os, 'fsync', sync):
                        with self.assertRaises(ValueError): self.transfer(s)
                    self.assertNotIn(kind, s.bridge_sends)
                    self.assertEqual(len(s.rights), 0 if kind == 3 else 2)
                    with self.assertRaises(ValueError): self.transfer(s)
                    self.assertEqual(s.accepted_count, 1)

    def test_final_writer_failure_closes_originals_under_lock_but_cannot_revoke_remote_fds(self):
        with self.system() as s:
            original_handshake, original_guard = bridge._BridgeChannel._handshake, s.journal._guard
            state, lock_available = {'returned': False}, []
            def handshake(item):
                original_handshake(item)
                state['returned'] = True
            def fail():
                original_guard()
                if state['returned']: raise ValueError('synthetic outer final failure')
            def closed(event):
                if event != 'listener-close': return
                try: other = resource_journal.ResourceJournal.open(s.registration)
                except ValueError: lock_available.append(False)
                else:
                    lock_available.append(True)
                    other.close()
            s.endpoint_hook = closed
            with patch.object(bridge._BridgeChannel, '_handshake', handshake), patch.object(s.journal, '_guard', fail):
                with self.assertRaises(ValueError): self.transfer(s)
            self.assertTrue(state['returned'])
            self.assertEqual(lock_available, [False, False])
            self.assertEqual(s.bridge_sends, [1, 3, 5])
            self.assertEqual(len(s.rights), 2)
            for fd in s.rights: NATIVE.fstat(fd)

    def test_bridge_record_fields_and_phase_are_closed_before_write(self):
        for fields in ({'invocation': '2' * 32}, {'challengeDigest': '0' * 64},
                       {'endpointDigest': '0' * 64}, {'fd': 7}, {'action': 'bridge_commit'}):
            with self.subTest(fields=fields), self.system() as s:
                row = {'version': 2, 'action': 'bridge_offer', 'resource': s.resource,
                       'invocation': '1' * 32, 'challengeDigest': '3' * 64, 'endpointDigest': '4' * 64} | fields
                before = s.journal._expected
                with self.assertRaises(ValueError): s.journal._run(lambda: s.journal._append(row))
                self.assertEqual(s.journal._expected, before)

    def test_real_guard_consumes_grant_and_handoff_over_two_real_packet_connections(self):
        with self.system(automatic_peer=False) as s, contextlib.ExitStack() as stack:
            original_clock = time.monotonic
            stack.enter_context(patch.object(guard_fixture, 'RESOURCE', s.resource))
            g = stack.enter_context(guard_fixture.WorkerGuardTests().system())
            g.now = original_clock()
            g.binding.update(s.material._bindings['anchor'])
            g.raw = (s.directory / 'credentials/anchor.binding').read_bytes()
            for name, path in (('root', '/'), ('tmp', '/tmp'), ('shm', '/dev/shm')):
                pair = g.binding['objects'][name]
                g.metadata[path] = {'st_dev': pair[0], 'st_ino': pair[1]}
            g.namespaces = {name: [p.stat().st_dev, p.stat().st_ino]
                            for name in ('net', 'ipc', 'mnt') for p in [s.proc / 'ns' / name]}
            g.peer = struct.pack('=iII', g.binding['brokerPid'], 0, 0)
            g.namespaces['pid'] = list(g.binding['application']['pidNamespace'])
            guard = guard_fixture.guard
            received, duplicates, created, outcomes = [], [], [], []
            hello = threading.Event()
            original_info, original_close = guard.os.fstat, guard.os.close
            def info(fd):
                if fd not in received: return original_info(fd)
                actual = NATIVE.fstat(fd)
                return SimpleNamespace(st_dev=actual.st_dev if actual.st_dev >= 0 else 42,
                                       st_ino=actual.st_ino, st_mode=actual.st_mode)
            def close(fd):
                if fd in received:
                    received.remove(fd)
                    NATIVE.close(fd)
                else: original_close(fd)
            stack.enter_context(patch.object(guard.os, 'fstat', info))
            stack.enter_context(patch.object(guard.os, 'close', close))
            actual_fromfd = socket.fromfd
            class Query:
                def __init__(self, fd, family, kind):
                    self.actual = actual_fromfd(fd, family, kind)
                    duplicates.append(self.actual)
                def __enter__(self): return self
                def __exit__(self, *exc): self.actual.close()
                def getsockopt(self, level, option):
                    if option == getattr(socket, 'SO_DOMAIN', 39): return self.actual.family
                    if option == socket.SO_ACCEPTCONN: return 1  # Real listen/connect tested separately.
                    return self.actual.getsockopt(level, option)
                def getsockname(self):
                    # Darwin relative bind name mapped back to fixed Linux path.
                    return '/run/holaday-pool-data/' + s.resource + '/' + self.actual.getsockname()
            stack.enter_context(patch.object(socket, 'fromfd', Query))
            class GuardSocket:
                def __init__(self, family, kind):
                    self.actual = s.worker_socket if not created else s.right
                    created.append(self)
                def set_inheritable(self, value): self.actual.set_inheritable(value)
                def setsockopt(self, *args): pass  # Linux credentials attached at kernel seam.
                def settimeout(self, value): self.actual.settimeout(value)
                def connect(self, path):
                    prefix, suffix = '/proc/self/fd/', '/control.sock'
                    if (not path.startswith(prefix) or not path.endswith(suffix)
                            or g.opened.get(int(path[len(prefix):-len(suffix)])) != '/run/holaday-pool'):
                        raise AssertionError('non-original connection path')
                def getsockopt(self, *args): return g.peer
                def sendmsg(self, buffers):
                    count = self.actual.sendmsg(buffers)
                    if b''.join(buffers).startswith(b'HPW1 hello '): hello.set()
                    return count
                def recvmsg(self, size, space, flags):
                    data, ancillary, flags, address = self.actual.recvmsg(size, space)
                    for level, kind, raw in ancillary:
                        if (level, kind) != (socket.SOL_SOCKET, socket.SCM_RIGHTS): raise AssertionError()
                        for fd in array.array('i', raw):
                            NATIVE.set_inheritable(fd, False)
                            received.append(fd)
                    return data, ancillary + [(socket.SOL_SOCKET, 2, g.peer)], flags, address
                def close(self): self.actual.close()
            stack.enter_context(patch.object(guard, 'Socket', GuardSocket))
            worker = guard._WorkerGuard.open('a' * 40, s.resource, 'anchor')
            def consume():
                try:
                    worker._receive_bridge()
                    outcomes.append('received')
                except Exception: outcomes.append('rejected')
            thread = threading.Thread(target=consume, daemon=True)
            try:
                thread.start()
                self.assertTrue(hello.wait(2))
                s.material.accept_role('anchor')
                s.begin_bridge()
                self.transfer(s)
                thread.join(2)
                self.assertFalse(thread.is_alive())
                self.assertEqual(outcomes, ['received'])
                self.assertEqual(len(received), 2)
                self.assertEqual(s.bridge_sends, [1, 3, 5])
                self.assertEqual([NATIVE.fstat(fd).st_ino for fd in received],
                                 [NATIVE.fstat(item.fileno()).st_ino for item in s.listeners])
                self.assertTrue(duplicates)
                self.assertTrue(all(item.fileno() == -1 for item in duplicates), 'temporary duplicate leaked')
                self.assertFalse(hasattr(worker, 'ready'))
            finally:
                s.worker_socket.close()
                s.right.close()
                thread.join(2)
                worker.close()
            self.assertEqual(received, [])


if __name__ == '__main__': unittest.main()
