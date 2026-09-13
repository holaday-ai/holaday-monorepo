"""Original manager/journal control flow; Linux pidfd/proc/busctl seams only."""

import contextlib
import json
import os
import struct
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import manager_probe
import quartet_journal
import resource_journal
import test_manager_probe
import test_slot_identity
from quartet_protocol import decode_quartet_request

try:
    import quartet_worker_pin as worker_pin
except ModuleNotFoundError as error:
    if error.name != 'quartet_worker_pin':
        raise
    worker_pin = None


NATIVE = test_manager_probe.NATIVE
REAL_CAPTURE = manager_probe._capture


class WorkerPinTests(unittest.TestCase):
    def test_collector_last_cleanup_clock_never_returns_after_worker_revocation(self):
        with self.system() as s:
            pin = self.open(s)
            native_clock, native_spawn = manager_probe.time.monotonic, manager_probe.subprocess.Popen
            closed, tail_clocks, returned = [], [], []
            class Stream:
                def __init__(self, stream): self.stream = stream
                def fileno(self): return self.stream.fileno()
                def close(self):
                    self.stream.close()
                    closed.append(True)
            def spawn(*args, **kwargs):
                child = native_spawn(*args, **kwargs)
                child.stdout, child.stderr = Stream(child.stdout), Stream(child.stderr)
                return child
            def clock():
                if len(closed) == 2 and sys._getframe(1).f_code.co_name == 'budget':
                    tail_clocks.append(True)
                    if len(tail_clocks) == 2: pin.close()
                return native_clock()
            try:
                with open(sys.executable, 'rb') as tool, \
                        patch.object(manager_probe.subprocess, 'os', NATIVE), \
                        patch.object(manager_probe, 'time', SimpleNamespace(monotonic=clock)), \
                        patch.object(manager_probe.subprocess, 'Popen', side_effect=spawn):
                    def collect():
                        REAL_CAPTURE((sys.executable, '-c', 'print("bounded")'), tool.fileno(),
                            s.manager._deadline, s.manager._live_budget)
                        returned.append(True)
                    self.deny(lambda: pin._run(collect, None))
                self.assertEqual(len(closed), 2)
                self.assertEqual(returned, [], 'collector must veto before returning bytes to any consumer')
            finally: pin.close()

    def test_collector_last_clock_cannot_dispatch_after_original_worker_veto(self):
        with self.system() as s:
            pin = self.open(s)
            native_clock, clocks = manager_probe.time.monotonic, []
            def clock():
                if sys._getframe(1).f_code.co_name == 'budget':
                    clocks.append(True)
                    if len(clocks) == 2: pin.close()
                return native_clock()
            try:
                with patch.object(manager_probe, 'time', SimpleNamespace(monotonic=clock)), \
                        patch.object(manager_probe.subprocess, 'Popen') as popen:
                    self.deny(lambda: pin._run(lambda: REAL_CAPTURE(
                        ('/proc/self/fd/' + str(s.manager._tool),), s.manager._tool,
                        s.manager._deadline, s.manager._live_budget), None))
                    popen.assert_not_called()
                self.assertGreaterEqual(len(clocks), 2)
            finally: pin.close()

    def test_fixed_two_interface_batches_keep_final_pid_and_invocation_reads(self):
        with self.system() as s:
            calls = []
            original = manager_probe._capture.side_effect
            def capture(argv, *args):
                if argv[8] == ':1.5': calls.append(argv)
                return original(argv, *args)
            with patch.object(manager_probe, '_capture', side_effect=capture):
                with self.open(s) as pin:
                    self.assertEqual([argv[7] for argv in calls],
                        ['get-property', 'get-property', 'call', 'call'])
                    self.assertEqual(calls[0][11:], ('Id', 'InvocationID', 'ActiveState'))
                    self.assertEqual(calls[1][11:], ('Type', 'Restart', 'UID', 'GID', 'MainPID', 'ControlGroup'))
                    self.assertEqual([argv[-1] for argv in calls[2:]], ['MainPID', 'InvocationID'])
                    calls.clear()
                    pin.check_sender(s.peer)
                    self.assertEqual(len(calls), 4, 'no cached verification across calls')

    def test_batches_reject_partial_extra_duplicate_wrong_order_and_collector_failure(self):
        for mode in ('partial', 'extra', 'duplicate', 'order', 'oversize', 'failure', 'scope'):
            with self.subTest(mode=mode), self.system() as s:
                original = manager_probe._capture.side_effect
                def capture(argv, fd, deadline, scope):
                    raw = original(argv, fd, deadline, scope)
                    if argv[7] != 'get-property': return raw
                    self.assertLessEqual(deadline, s.manager._deadline)
                    self.assertLessEqual(deadline - worker_pin.time.monotonic(), 2)
                    rows = raw.splitlines()
                    if mode == 'partial': return rows[0] + b'\n'
                    if mode == 'extra': return raw + rows[0] + b'\n'
                    if mode == 'duplicate': return raw.replace(b'"type": "s"', b'"type": "s", "type": "s"', 1)
                    if mode == 'order': return b'\n'.join(reversed(rows)) + b'\n'
                    if mode == 'oversize': return b' ' * 16385
                    if mode == 'failure': raise ValueError('scripted second property failed; no partial success')
                    if mode == 'scope': s.registration.close()
                    return raw
                with patch.object(manager_probe, '_capture', side_effect=capture):
                    self.deny(lambda: self.open(s))
                self.assertEqual(s.worker_fds, {})

    def test_final_independent_pid_and_invocation_reads_still_reject_replacement(self):
        for property in ('MainPID', 'InvocationID'):
            with self.subTest(property=property), self.system() as s:
                reads = 0
                def hook(name):
                    nonlocal reads
                    if name == property:
                        reads += 1
                        if reads == 2:
                            s.properties[property] = ('u', 778) if property == 'MainPID' else ('ay', [18] * 16)
                s.hook = hook
                self.deny(lambda: self.open(s))
                self.assertEqual(reads, 2)

    @contextlib.contextmanager
    def system(self):
        self.assertIsNotNone(worker_pin, 'original worker pin missing')
        def setup(root, _package, _manifest):
            folder = root / 'var/lib/holaday-pool-broker'
            folder.mkdir(parents=True)
            folder.chmod(0o700)
            file = folder / 'resource-journal.jsonl'
            file.write_bytes(resource_journal._HEADER)
            file.chmod(0o600)
            (root / 'proc/777').mkdir(parents=True)
            (root / 'proc/self/fdinfo').mkdir(parents=True)
            (root / 'pidfd-stand-in').write_bytes(b'not a real Linux pidfd')
        with test_manager_probe.ProbeTests().system(setup) as s, contextlib.ExitStack() as stack:
            stack.enter_context(patch.object(resource_journal, 'os', s.proxy))
            manager = manager_probe.SystemManagerProbe.open(s.registration)
            journal = resource_journal.ResourceJournal.open(s.registration)
            identities = stack.enter_context(test_slot_identity.SlotIdentityTests().system())
            quartet_journal.prepare_quartet(journal, decode_quartet_request(json.dumps({
                'version': 2, 'action': 'create', 'requestId': 'c' * 32, 'boot': 'b' * 32, 'slot': 0}).encode()))
            resource = next(iter(journal._resources))
            unit = 'holaday-pool-anchor-' + resource + '.service'
            common = {'version': 2, 'resource': resource, 'role': 'anchor'}
            for fields in ({'action': 'role_dispatch', 'unit': unit, 'managerGuid': 'd' * 32, 'managerOwner': ':1.5'},
                           {'action': 'role_accepted', 'job': '/org/freedesktop/systemd1/job/7'},
                           {'action': 'role_observe', 'invocation': '1' * 32}):
                journal._run(lambda: journal._append(common | fields))
            s.journal, s.manager, s.resource, s.unit, s.identities = journal, manager, resource, unit, identities
            s.cgroup = '/holadaypool.slice/holadaypool-' + resource + '.slice/' + unit
            s.properties = {'Id': ('s', unit), 'InvocationID': ('ay', [17] * 16), 'ActiveState': ('s', 'active'),
                            'MainPID': ('u', 777), 'Type': ('s', 'exec'), 'Restart': ('s', 'no'),
                            'ControlGroup': ('s', s.cgroup), 'UID': ('u', 2001), 'GID': ('u', 2001)}
            s.hook = lambda _event: None
            s.events, s.worker_fds, s.exited = [], {}, False
            s.peer = struct.pack('=iII', 777, 2001, 2001)
            (s.root / 'proc/777/cgroup').write_bytes(('0::' + s.cgroup + '\n').encode())
            (s.root / 'proc/777/status').write_bytes(b'Uid: 2001 2001 2001 2001\nGid: 2001 2001 2001 2001\n')
            proxy = SimpleNamespace(**vars(NATIVE))
            def opened(path, flags, **kw):
                target = str(s.root) + path if path.startswith('/') else path
                fd = NATIVE.open(target, flags, **kw)
                s.worker_fds[fd] = path
                return fd
            def close(fd):
                self.assertIn(fd, s.worker_fds)
                s.worker_fds.pop(fd)
                NATIVE.close(fd)
                s.hook('close')
            def pidfd_open(pid, flags):
                self.assertEqual((pid, flags), (777, 0))
                s.events.append('pidfd_open')
                fd = opened('/pidfd-stand-in', os.O_RDONLY | os.O_CLOEXEC)
                (s.root / ('proc/self/fdinfo/' + str(fd))).write_bytes(b'Pid:\t777\n')
                s.hook('pidfd_open')
                return fd
            proxy.open, proxy.close, proxy.pidfd_open = opened, close, pidfd_open
            proxy.getresuid, proxy.getresgid = lambda: (0, 0, 0), lambda: (0, 0, 0)
            signal = SimpleNamespace(pidfd_send_signal=lambda fd, number, info, flags:
                                     s.events.append('signal-zero') if fd in s.worker_fds and number == 0 else self.fail('bad signal'))
            class Poll:
                def register(self, fd, events):
                    self.fd = fd
                def poll(self, timeout):
                    s.hook('poll')
                    return [(self.fd, 1)] if s.exited else []
            select = SimpleNamespace(poll=Poll, POLLIN=1, POLLHUP=16, POLLERR=8)
            for obj, name, value in ((worker_pin, 'os', proxy), (worker_pin, 'signal', signal), (worker_pin, 'select', select)):
                stack.enter_context(patch.object(obj, name, value))
            original = manager_probe._capture.side_effect
            def capture(argv, fd, deadline, scope):
                if argv[8] == 'org.freedesktop.DBus':
                    return original(argv, fd, deadline, scope)
                scope()
                if argv[7] == 'get-property':
                    self.assertEqual(argv[8], ':1.5')
                    self.assertEqual(argv[9], '/org/freedesktop/systemd1/unit/' + unit.replace('-', '_2d').replace('.', '_2e'))
                    expected = (('Id', 'InvocationID', 'ActiveState') if argv[10].endswith('.Unit')
                        else ('Type', 'Restart', 'UID', 'GID', 'MainPID', 'ControlGroup'))
                    self.assertEqual(argv[11:], expected)
                    rows = []
                    for name in expected:
                        s.events.append('Get')
                        s.hook(name)
                        signature, value = s.properties[name]
                        rows.append(json.dumps({'type': signature, 'data': value}).encode())
                    return b'\n'.join(rows) + b'\n'
                s.events.append(argv[11])
                s.hook(argv[-1])
                self.assertEqual(argv[8], ':1.5')
                self.assertEqual(argv[11], 'Get')
                self.assertEqual(argv[9], '/org/freedesktop/systemd1/unit/' + unit.replace('-', '_2d').replace('.', '_2e'))
                name = argv[-1]
                interface = '.Unit' if name in ('Id', 'InvocationID', 'ActiveState') else '.Service'
                self.assertEqual(argv[-2], 'org.freedesktop.systemd1' + interface)
                signature, value = s.properties[name]
                return json.dumps({'type': 'v', 'data': [{'type': signature, 'data': value}]}).encode()
            stack.enter_context(patch.object(manager_probe, '_capture', side_effect=capture))
            try:
                yield s
            finally:
                journal.close()
                manager.close()
                self.assertEqual(s.worker_fds, {})

    def open(self, s):
        return worker_pin._WorkerPin.from_received_peer(s.journal, s.manager, s.resource, 'anchor', s.peer)

    def open_locked(self, s, scope=None):
        self.assertTrue(callable(getattr(worker_pin._WorkerPin, '_from_received_peer_locked', None)),
                        'worker pin cannot yet join the original held journal transaction')
        return worker_pin._WorkerPin._from_received_peer_locked(
            s.journal, s.manager, s.resource, 'anchor', s.peer, scope_guard=scope)

    def test_locked_pin_uses_original_writer_and_keeps_same_pidfd_for_reply(self):
        with self.system() as s:
            before = s.journal._expected
            def transaction():
                with self.open_locked(s) as pin:
                    self.assertTrue(s.journal._busy)
                    self.assertIsNone(pin._check_sender_locked(s.peer))
                    self.assertEqual(s.events.count('pidfd_open'), 1)
                    # Actual flock, not a boolean assertion alone: a second
                    # writer cannot enter even after both kernel observations.
                    with self.assertRaises(ValueError):
                        resource_journal.ResourceJournal.open(s.registration)
            s.journal._run(transaction)
            self.assertEqual(s.journal._expected, before)
            self.assertFalse(s.journal._retired)

    def test_locked_entry_without_original_transaction_does_not_pin(self):
        with self.system() as s:
            self.deny(lambda: self.open_locked(s))
            self.assertNotIn('pidfd_open', s.events)

    def test_locked_reply_cannot_be_used_after_transaction_or_sender_change(self):
        for mode in ('outside', 'sender', 'invocation'):
            with self.system() as s:
                pin = s.journal._run(lambda: self.open_locked(s))
                try:
                    if mode == 'outside':
                        self.deny(lambda: pin._check_sender_locked(s.peer))
                    else:
                        if mode == 'invocation':
                            s.properties['InvocationID'] = ('ay', [18] * 16)
                        peer = struct.pack('=iII', 778, 2001, 2001) if mode == 'sender' else s.peer
                        s.journal._run(lambda: self.deny(lambda: pin._check_sender_locked(peer)))
                    self.assertEqual(s.events.count('pidfd_open'), 1)
                finally:
                    pin.close()

    def test_locked_pin_revocation_keeps_writer_until_physical_pin_cleanup(self):
        with self.system() as s:
            checked = []
            def hook(event):
                if event == 'pidfd_open':
                    s.journal.close()
                elif event == 'close':
                    with self.assertRaises(ValueError):
                        resource_journal.ResourceJournal.open(s.registration)
                    checked.append(True)
            s.hook = hook
            with self.assertRaises(ValueError):
                s.journal._run(lambda: self.open_locked(s))
            self.assertTrue(checked)
            self.assertEqual(s.worker_fds, {})
            s.hook = lambda _: None
            reopened = resource_journal.ResourceJournal.open(s.registration)
            reopened.close()

    def deny(self, call):
        with self.assertRaises(ValueError) as caught:
            call()
        self.assertEqual(str(caught.exception), 'POOL_BROKER_WORKER_PIN_UNPROVEN')
        self.assertIsNone(caught.exception.__context__)

    def test_original_worker_pidfd_manager_invocation_cgroup_without_dispatch_or_grant(self):
        with self.system() as s:
            before = s.journal._expected
            with self.open(s) as pin:
                self.assertIsNone(pin.check_sender(s.peer))
                self.assertEqual(s.events.count('pidfd_open'), 1)
                self.assertLess(s.events.index('pidfd_open'), s.events.index('Get'))
                self.assertFalse(hasattr(pin, 'ready'))
                self.assertNotIn(s.resource, repr(pin))
            self.assertEqual(s.journal._expected, before)
            self.assertNotIn('StartTransientUnit', s.events)

    def test_wrong_sender_does_not_use_application_pin_or_lookup_other_pids(self):
        for peer in (b'', struct.pack('=iII', 777, 998, 998), struct.pack('=iII', 777, 2002, 2002)):
            with self.system() as s:
                original = s.registration._pin
                s.peer = peer
                self.deny(lambda: self.open(s))
                self.assertIs(s.registration._pin, original)
                self.assertNotIn('pidfd_open', s.events)

    def test_main_pid_invocation_cgroup_identity_restart_and_state_all_bound(self):
        variants = {'MainPID': ('u', 778), 'InvocationID': ('ay', [18] * 16), 'ControlGroup': ('s', '/other'),
                    'UID': ('u', 998), 'GID': ('u', True), 'Type': ('s', 'forking'),
                    'Restart': ('s', 'always'), 'ActiveState': ('s', 'inactive')}
        for key, value in variants.items():
            with self.system() as s:
                s.properties[key] = value
                self.deny(lambda: self.open(s))

    def test_proc_membership_and_identity_must_match_not_only_manager_report(self):
        for file, raw in (('cgroup', b'0::/other\n'), ('cgroup', b'1:cpu:/legacy\n'),
                          ('status', b'Uid: 2001 0 2001 2001\nGid: 2001 2001 2001 2001\n')):
            with self.system() as s:
                (s.root / ('proc/777/' + file)).write_bytes(raw)
                self.deny(lambda: self.open(s))

    def test_original_pin_cannot_recover_from_exit_or_replacement(self):
        for mode in ('exit', 'invocation', 'manager', 'registration'):
            with self.system() as s:
                pin = self.open(s)
                try:
                    if mode == 'exit':
                        s.exited = True
                    elif mode == 'invocation':
                        s.properties['InvocationID'] = ('ay', [18] * 16)
                    elif mode == 'manager':
                        s.state['owner'] = ':1.6'
                    else:
                        s.registration.close()
                    self.deny(lambda: pin.check_sender(s.peer))
                    s.exited = False
                    self.deny(lambda: pin.check_sender(s.peer))
                    self.assertEqual(s.events.count('pidfd_open'), 1)
                finally:
                    pin.close()

    def test_close_after_native_pidfd_open_and_late_exit_deny_and_release(self):
        for mode in ('close', 'exit'):
            with self.system() as s:
                if mode == 'close':
                    s.hook = lambda event: s.journal.close() if event == 'pidfd_open' else None
                else:
                    s.hook = lambda event: setattr(s, 'exited', True) if event == 'ControlGroup' else None
                self.deny(lambda: self.open(s))

    def test_final_scope_callback_revocation_cannot_return_success(self):
        with self.system() as s:
            pin = self.open(s)
            entered = False
            def scope():
                nonlocal entered
                if s.journal._busy:
                    entered = True
                elif entered:
                    pin.close()
            try:
                self.deny(lambda: pin.check_sender(s.peer, scope_guard=scope))
                self.assertTrue(entered)
            finally:
                pin.close()

    def test_actual_collector_scope_revocation_vetoes_popen(self):
        with self.system() as s:
            pin = self.open(s)
            collecting = False
            original = manager_probe._capture.side_effect
            def capture(argv, fd, deadline, scope):
                nonlocal collecting
                if argv[8] == 'org.freedesktop.DBus':
                    return original(argv, fd, deadline, scope)
                collecting = True
                return REAL_CAPTURE(argv, fd, deadline, scope)
            try:
                with patch.object(manager_probe, '_capture', side_effect=capture), patch.object(manager_probe.subprocess, 'Popen') as popen:
                    self.deny(lambda: pin.check_sender(s.peer, scope_guard=lambda: pin.close() if collecting else None))
                    popen.assert_not_called()
            finally:
                pin.close()


if __name__ == '__main__':
    unittest.main()
