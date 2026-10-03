"""Real journal/material/pin/view and packet sockets; synthetic Linux boundary."""
import contextlib
import array
import json
import socket
import struct
import threading
import time
import unittest
from unittest.mock import patch

import resource_journal
import process_pin
import test_quartet_worker_view
import test_quartet_worker_guard

try:
    import quartet_worker_channel as channel
except ModuleNotFoundError as error:
    if error.name != 'quartet_worker_channel':
        raise
    channel = None


class WorkerChannelTests(unittest.TestCase):
    def test_original_application_death_after_response_never_issues_grant(self):
        with self.system() as s:
            original = process_pin.signal.pidfd_send_signal
            application_fd = s.registration._pin._fd
            application_observed = []
            dead = False
            def observe(*args):
                if dead and args[0] == application_fd:
                    application_observed.append(args[0])
                    raise ProcessLookupError('synthetic original application exit')
                return original(*args)
            def wire(event):
                nonlocal dead
                if event == 'recv' and s.receives == 2:
                    dead = True
            s.wire_hook = wire
            with patch.object(process_pin.signal, 'pidfd_send_signal', observe):
                with self.assertRaises(ValueError): s.material.accept_role('anchor')
            self.assertTrue(dead)
            self.assertTrue(application_observed)
            self.assertEqual(s.sends, [b'challenge'])
            self.assertFalse(s.grant_durable)

    def grant(self, s, **fields):
        return {'version': 2, 'action': 'role_grant', 'resource': s.resource, 'role': 'anchor',
                'invocation': '1' * 32, 'bindingDigest': s.material._credentials['anchor'][2],
                'challengeDigest': '4' * 64} | fields

    def test_grant_consumption_is_durable_once_without_creating_runtime_authority(self):
        with test_quartet_worker_view.WorkerViewTests().system(pin=False) as s:
            row = self.grant(s)
            try:
                s.journal._run(lambda: s.journal._append(row))
            except ValueError:
                self.fail('observed original role cannot yet durably consume a grant')
            raw = s.journal._expected
            self.assertTrue(s.journal._resources[s.resource]['roles']['anchor']['granted'])
            with self.assertRaises(ValueError):
                s.journal._run(lambda: s.journal._append(row))
            self.assertEqual(s.journal._expected, raw)
            # Original handles cannot be reconstructed from durable observations.
            s.journal.close()
            reopened = resource_journal.ResourceJournal.open(s.registration)
            try:
                self.assertEqual(reopened._handles, {})
                self.assertTrue(reopened._resources[s.resource]['roles']['anchor']['granted'])
            finally:
                reopened.close()

    def test_grant_rejects_wrong_binding_invocation_or_extra_fields_before_write(self):
        for fields in ({'bindingDigest': '2' * 64}, {'invocation': '2' * 32},
                       {'challengeDigest': '0' * 64}, {'pid': 777}):
            with test_quartet_worker_view.WorkerViewTests().system(pin=False) as s:
                before = s.journal._expected
                with self.assertRaises(ValueError):
                    s.journal._run(lambda: s.journal._append(self.grant(s, **fields)))
                self.assertEqual(s.journal._expected, before)

    @contextlib.contextmanager
    def system(self, *, automatic_peer=True, observed=True, material_setup=None, prepare_anchor=True):
        self.assertIsNotNone(channel, 'original root challenge producer missing')
        with test_quartet_worker_view.WorkerViewTests().system(pin=False, observed=observed, material_setup=material_setup, prepare_anchor=prepare_anchor) as s, contextlib.ExitStack() as stack:
            # The old application-pin fixture replaces process-wide os.close;
            # this new channel owns REAL SCM_RIGHTS, so close them for real.
            stack.enter_context(patch.object(channel, 'os', test_quartet_worker_view.NATIVE))
            root, worker = socket.socketpair(socket.AF_UNIX, socket.SOCK_DGRAM)
            root.settimeout(1)
            worker.settimeout(1)
            s.mode, s.accepts, s.receives, s.sends = '', 0, 0, []
            s.wire_hook = lambda _: None
            s.connection_closed = False
            s.grant_durable = []
            s.root_socket, s.worker_socket, s.received_rights = root, worker, []
            class Accepted:
                def settimeout(self, timeout):
                    if not 0 < timeout <= 5: raise AssertionError('unbounded handshake timeout')
                    root.settimeout(timeout)
                    s.wire_hook('settimeout')
                def set_inheritable(self, value):
                    if value: raise AssertionError('inheritable control socket')
                    root.set_inheritable(False)
                def setsockopt(self, level, option, value):
                    if (level, option, value) != (socket.SOL_SOCKET, 16, 1):
                        raise AssertionError('missing SO_PASSCRED')
                def getsockopt(self, level, option, size): return s.peer
                def recvmsg(self, size, space, flags):
                    payload, ancillary, actual_flags, address = root.recvmsg(size, space)
                    for level, name, raw in ancillary:
                        if level == socket.SOL_SOCKET and name == socket.SCM_RIGHTS:
                            s.received_rights.extend(array.array('i', raw))
                    s.receives += 1
                    peer = struct.pack('=iII', 778, 2001, 2001) if s.mode == 'sender' and s.receives == 2 else s.peer
                    s.wire_hook('recv')
                    return payload, ancillary + [(socket.SOL_SOCKET, 2, peer)], actual_flags, address
                def sendmsg(self, buffers):
                    payload = b''.join(buffers)
                    s.sends.append(payload.split(b' ')[1])
                    if payload.startswith(b'HPW1 grant '):
                        rows = [json.loads(line) for line in s.journal._expected.splitlines()][1:]
                        s.grant_durable.append(rows[-1]['action'] == 'role_grant')
                        s.wire_hook('grant-send')
                    count = root.sendmsg(buffers)
                    if not automatic_peer: return count
                    received = worker.recv(512)
                    if received.startswith(b'HPW1 challenge '):
                        nonce = received.rsplit(b' ', 1)[1]
                        if s.mode == 'nonce': nonce = b'1' * 64
                        if s.mode == 'old': nonce = s.material._bindings[s.peer_role]['handshake'].encode()
                        worker.sendmsg([b'HPW1 response ' + nonce])
                        s.wire_hook('challenge-send')
                    return count - 1 if s.mode == 'short' and payload.startswith(b'HPW1 grant ') else count
                def close(self):
                    if s.connection_closed: raise AssertionError('duplicate accepted close')
                    s.wire_hook('connection-close')
                    root.close()
                    s.connection_closed = True
            def accept():
                s.accepts += 1
                s.connection_closed = False
                s.wire_hook('accept')
                return Accepted(), ''
            stack.enter_context(patch.object(s.material._socket, 'accept', side_effect=accept, create=True))
            stack.enter_context(patch.object(s.material._socket, 'settimeout', lambda timeout: root.settimeout(timeout), create=True))
            s.peer_role = 'anchor'
            if automatic_peer and prepare_anchor:
                hello = ('HPW1 hello ' + s.resource + ' anchor ' + s.material._bindings['anchor']['handshake']).encode()
                worker.sendmsg([hello])
            def reset_peer(role):
                nonlocal root, worker
                root.close()
                worker.close()
                root, worker = socket.socketpair(socket.AF_UNIX, socket.SOCK_DGRAM)
                root.settimeout(1)
                worker.settimeout(1)
                s.root_socket, s.worker_socket, s.peer_role = root, worker, role
                s.receives = 0
                worker.sendmsg([('HPW1 hello ' + s.resource + ' ' + role + ' ' +
                    s.material._bindings[role]['handshake']).encode()])
            s.reset_peer = reset_peer
            try:
                yield s
            finally:
                s.material.close()
                worker.close()
                root.close()

    def test_original_producer_persists_before_one_grant_and_holds_anchor_pin(self):
        with self.system() as s:
            self.assertIsNone(s.material.accept_role('anchor'))
            self.assertEqual(s.accepts, 1)
            self.assertEqual(s.receives, 2)
            self.assertEqual(s.sends, [b'challenge', b'grant'])
            self.assertEqual(s.grant_durable, [True])
            self.assertEqual(s.pin_events, ['pidfd_open'])
            self.assertTrue(s.connection_closed)
            self.assertEqual(set(s.material._workers), {'anchor'})
            self.assertFalse(hasattr(s.material, 'ready'))
            self.assertTrue(s.fds)  # Original worker and namespace handles retained, not a PID receipt.
            with self.assertRaises(ValueError): s.material.accept_role('anchor')
            self.assertEqual(s.accepts, 1)
            self.assertEqual(s.fds, {})

    def test_wrong_response_sender_old_nonce_or_new_nonce_failure_never_grants(self):
        for mode in ('sender', 'old', 'nonce'):
            with self.system() as s:
                s.mode = mode
                with self.assertRaises(ValueError): s.material.accept_role('anchor')
                self.assertNotIn(b'grant', s.sends)
                self.assertEqual(s.fds, {})
                self.assertNotIn(b'role_grant', s.journal._expected)
                with self.assertRaises(ValueError): s.material.accept_role('anchor')
                self.assertEqual(s.accepts, 1)

    def test_short_grant_remains_consumed_and_does_not_resend_or_free_group(self):
        with self.system() as s:
            s.mode = 'short'
            with self.assertRaises(ValueError): s.material.accept_role('anchor')
            self.assertEqual(s.sends, [b'challenge', b'grant'])
            self.assertEqual(s.grant_durable, [True])
            self.assertTrue(s.journal._resources[s.resource]['roles']['anchor']['granted'])
            self.assertEqual(s.fds, {})
            with self.assertRaises(ValueError): s.material.accept_role('anchor')
            self.assertEqual(s.sends.count(b'grant'), 1)
            self.assertTrue(s.directory.exists())

    def test_namespace_change_after_challenge_refuses_durable_grant(self):
        with self.system() as s:
            def mutate(event):
                if event == 'challenge-send':
                    (s.proc / 'ns/net').rename(s.proc / 'ns/retired-net')
                    (s.proc / 'ns/net').write_bytes(b'changed after challenge')
            s.wire_hook = mutate
            with self.assertRaises(ValueError): s.material.accept_role('anchor')
            self.assertEqual(s.sends, [b'challenge'])
            self.assertNotIn(b'role_grant', s.journal._expected)
            self.assertEqual(s.fds, {})

    def test_journal_sync_failure_never_sends_grant_even_after_complete_append(self):
        for phase in ('file', 'directory'):
            with self.system() as s:
                original = resource_journal.os.fsync
                target = s.journal._fd if phase == 'file' else s.journal._parent
                def sync(fd):
                    raw = test_quartet_worker_view.NATIVE.pread(s.journal._fd, 262144, 0)
                    if fd == target and b'"action":"role_grant"' in raw:
                        raise OSError('synthetic grant fsync failure')
                    return original(fd)
                with patch.object(resource_journal.os, 'fsync', side_effect=sync):
                    with self.assertRaises(ValueError): s.material.accept_role('anchor')
                self.assertEqual(s.sends, [b'challenge'])
                self.assertEqual(s.fds, {})
                with self.assertRaises(ValueError): s.material.accept_role('anchor')
                self.assertEqual(s.accepts, 1)

    def test_outer_final_guard_failure_closes_owned_pin_and_view_before_unlock(self):
        with self.system() as s:
            original, checks = s.journal._guard, []
            def guard():
                original()
                if s.connection_closed:
                    raise ValueError('synthetic final outer guard failure')
            def check(event):
                if event == 'close' and s.connection_closed:
                    with self.assertRaises(ValueError): resource_journal.ResourceJournal.open(s.registration)
                    checks.append(True)
            s.view_hook = check
            with patch.object(s.journal, '_guard', side_effect=guard):
                with self.assertRaises(ValueError): s.material.accept_role('anchor')
            self.assertTrue(checks)
            self.assertEqual(s.fds, {})
            self.assertEqual(s.sends, [b'challenge', b'grant'])
            s.view_hook = lambda _: None
            reopened = resource_journal.ResourceJournal.open(s.registration)
            reopened.close()

    def test_clock_expiry_after_socket_setter_prevents_receive(self):
        with self.system() as s:
            real_clock, expired = time.monotonic, False
            def hook(event):
                nonlocal expired
                if event == 'settimeout': expired = True
            s.wire_hook = hook
            with patch.object(time, 'monotonic', lambda: real_clock() + (6 if expired else 0)):
                with self.assertRaises(ValueError): s.material.accept_role('anchor')
            self.assertTrue(expired)
            self.assertEqual(s.receives, 0)
            self.assertEqual(s.sends, [])

    def test_received_rights_are_closed_even_when_revoked_in_recv_boundary(self):
        with self.system() as s:
            hello = s.root_socket.recv(256)
            native = test_quartet_worker_view.NATIVE
            fd = native.open(str(s.root / 'pidfd'), native.O_RDONLY | native.O_CLOEXEC)
            try:
                s.worker_socket.sendmsg([hello], [(socket.SOL_SOCKET, socket.SCM_RIGHTS, array.array('i', [fd]))])
                s.wire_hook = lambda event: s.material.close() if event == 'recv' else None
                with self.assertRaises(ValueError): s.material.accept_role('anchor')
                self.assertEqual(len(s.received_rights), 1)
                for received in s.received_rights:
                    with self.assertRaises(OSError): native.fstat(received)
                native.fstat(fd)  # Sender's original was not transferred away.
                self.assertEqual(s.sends, [])
            finally:
                native.close(fd)

    def test_producer_and_real_worker_guard_consumer_exchange_over_packet_sockets(self):
        with self.system(automatic_peer=False) as s, contextlib.ExitStack() as stack:
            original_clock = time.monotonic
            stack.enter_context(patch.object(test_quartet_worker_guard, 'RESOURCE', s.resource))
            g = stack.enter_context(test_quartet_worker_guard.WorkerGuardTests().system())
            # Guard fixture's standalone clock starts at 1; combined original
            # manager may never move backwards from its real acquisition clock.
            g.now = original_clock()
            g.binding.update(s.material._bindings['anchor'])
            g.raw = (s.directory / 'credentials/anchor.binding').read_bytes()
            for name, path in (('root', '/'), ('tmp', '/tmp'), ('shm', '/dev/shm')):
                pair = g.binding['objects'][name]
                g.metadata[path] = {'st_dev': pair[0], 'st_ino': pair[1]}
            g.namespaces = {name: [file.stat().st_dev, file.stat().st_ino]
                            for name in ('net', 'ipc', 'mnt') for file in [s.proc / 'ns' / name]}
            g.peer = struct.pack('=iII', g.binding['brokerPid'], 0, 0)
            g.namespaces['pid'] = list(g.binding['application']['pidNamespace'])
            hello_sent, outcomes = threading.Event(), []
            class GuardSocket:
                def __init__(self, family, kind): pass
                def set_inheritable(self, value): s.worker_socket.set_inheritable(value)
                def setsockopt(self, *args): pass  # Linux kernel credentials below; real socket payloads.
                def settimeout(self, value): s.worker_socket.settimeout(value)
                def connect(self, path):
                    prefix, suffix = '/proc/self/fd/', '/control.sock'
                    if (not path.startswith(prefix) or not path.endswith(suffix)
                            or g.opened.get(int(path[len(prefix):-len(suffix)])) != '/run/holaday-pool'):
                        raise AssertionError('guard used non-original endpoint')
                def getsockopt(self, *args): return g.peer
                def sendmsg(self, buffers):
                    count = s.worker_socket.sendmsg(buffers)
                    if b''.join(buffers).startswith(b'HPW1 hello '): hello_sent.set()
                    return count
                def recvmsg(self, size, space, flags):
                    data, ancillary, flags, address = s.worker_socket.recvmsg(size, space)
                    return data, ancillary + [(socket.SOL_SOCKET, 2, g.peer)], flags, address
                def close(self): s.worker_socket.close()
            guard = test_quartet_worker_guard.guard
            stack.enter_context(patch.object(guard, 'Socket', GuardSocket))
            worker = guard._WorkerGuard.open('a' * 40, s.resource, 'anchor')
            def consume():
                try:
                    worker._await_grant()
                    outcomes.append('accepted')
                except Exception:
                    outcomes.append('rejected')
            thread = threading.Thread(target=consume, daemon=True)
            try:
                thread.start()
                self.assertTrue(hello_sent.wait(2))
                s.material.accept_role('anchor')
                thread.join(2)
                self.assertFalse(thread.is_alive())
                self.assertEqual(outcomes, ['accepted'])
                self.assertEqual(s.sends, [b'challenge', b'grant'])
                self.assertEqual(s.grant_durable, [True])
            finally:
                s.worker_socket.close()
                thread.join(2)
                worker.close()


if __name__ == '__main__':
    unittest.main()
