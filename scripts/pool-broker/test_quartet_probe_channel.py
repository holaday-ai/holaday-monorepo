"""Real original root graph/journal/socket; Linux identity and peer report seams."""
import array
import contextlib
import json
import socket
import time
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from quartet_worker_guard import _PROBE_CONTROL_FRAME, _probe_control_frame
import test_quartet_bridge_channel as bridge_fixture
import test_quartet_egress as egress_fixture
import test_quartet_probe_clock as clock_fixture
import test_quartet_anchor_binding as role_fixture
import quartet_material
import resource_journal

NATIVE = bridge_fixture.NATIVE

try:
    import quartet_probe_channel as channel
except ModuleNotFoundError as error:
    if error.name != 'quartet_probe_channel': raise
    channel = None


class ProbeChannelTests(unittest.TestCase):
    @contextlib.contextmanager
    def system(self):
        self.assertIsNotNone(channel, 'original root protocol producer missing')
        bridge, egress = bridge_fixture.BridgeChannelTests(), egress_fixture.EgressTests()
        endpoints = bridge.setup_endpoints
        @contextlib.contextmanager
        def setup(s):
            with endpoints(s), egress.system(base=lambda: contextlib.nullcontext(s)):
                egress.create(s)
                yield
        bridge.setup_endpoints = setup
        @contextlib.contextmanager
        def base():
            with bridge.system() as s:
                bridge.transfer(s)
                yield s
        with clock_fixture.ProbeClockTests().system(base=base) as s, contextlib.ExitStack() as stack:
            left, right = socket.socketpair(socket.AF_UNIX, socket.SOCK_DGRAM)
            stack.callback(left.close); stack.callback(right.close)
            left.settimeout(1); right.settimeout(1)
            peer = s.peer  # Anchor identity must not follow subsequent HPW role fixtures.
            s.protocol_sends, s.protocol_durable, s.unwanted = [], [], []
            s.protocol_mode, s.protocol_hook = '', lambda _event: None
            binding = s.material._bindings['anchor']
            right.sendmsg([_probe_control_frame(1, 0, binding, '0' * 32, 0,
                bytes.fromhex(binding['handshake']), 0, 0)])
            outer = self
            class Connection:
                def settimeout(self, value): left.settimeout(value)
                def set_inheritable(self, value): left.set_inheritable(value)
                def setsockopt(self, *args): outer.assertEqual(args, (socket.SOL_SOCKET, 16, 1))
                def getsockopt(self, *args): return peer
                def recvmsg(self, size, space, flags):
                    data, ancillary, flags, address = left.recvmsg(size, space)
                    for level, kind, raw in ancillary:
                        if level == socket.SOL_SOCKET and kind == socket.SCM_RIGHTS:
                            s.unwanted.extend(array.array('i', raw))
                    s.protocol_hook('receive')
                    return data, ancillary + [(socket.SOL_SOCKET, 2, peer)], flags, address
                def sendmsg(self, buffers):
                    data = b''.join(buffers)
                    kind = data[4]
                    s.protocol_sends.append(kind)
                    rows = [json.loads(row) for row in s.journal._expected.splitlines()][1:]
                    s.protocol_durable.append((kind, rows[-1]['action']))
                    sent = left.sendmsg(buffers)
                    fields = list(_PROBE_CONTROL_FRAME.unpack(right.recv(256)))
                    if kind in (2, 4) or kind == 6 and fields[2] == 4:
                        fields[1] = kind + 1
                        if s.protocol_mode == 'nonce': fields[8] = bytes(32)
                        rights = [(socket.SOL_SOCKET, socket.SCM_RIGHTS,
                            array.array('i', [right.fileno()]))] if s.protocol_mode == 'rights' else []
                        right.sendmsg([_PROBE_CONTROL_FRAME.pack(*fields)], rights)
                    s.protocol_hook('send-' + str(kind))
                    return sent - 1 if s.protocol_mode == 'short' else sent
                def close(self): left.close()
            stack.enter_context(patch.object(s.material._socket, 'accept', return_value=(Connection(), '')))
            stack.enter_context(patch.object(s.material._socket, 'settimeout', left.settimeout))
            stack.enter_context(patch.object(channel, 'os', NATIVE))
            try: yield s
            finally: s.material.close()

    def acquire(self, s):
        s.material._run(lambda: channel._ProtocolChannel._open_locked(s.material), handshake=True)
        return s.material._protocol

    def grant(self, s, stage):
        role = ('anchor', 'xvfb', 'brave', 'x11vnc', 'websockify')[stage]
        s.material.prepare_role(role)
        role_fixture.AnchorBindingTests().dispatch_observation(s, role, stage)
        with patch.object(s.material._socket, 'accept', s.worker_accept), patch.object(
                s.material._socket, 'settimeout', s.worker_settimeout):
            s.material.accept_role(role)

    def test_original_root_commits_each_observation_before_ack_without_ready(self):
        with self.system() as s:
            owned = self.acquire(s)
            for stage in range(1, 5):
                self.grant(s, stage)
                s.material._run(lambda: owned._observe_locked(stage), handshake=True)
            self.assertTrue(owned._complete)
            self.assertIsNone(owned._channel)
            self.assertEqual(s.protocol_durable, [(2, 'probe_open')] +
                [(kind, action) for _ in range(4) for kind, action in
                    ((4, 'protocol_command'), (6, 'protocol_observed'))])
            group = s.journal._resources[s.resource]
            self.assertEqual(group['protocol']['state'], 'complete')
            self.assertNotEqual(group['state'], 'ready')
            self.assertNotEqual(group['state'], 'exited')
            self.assertEqual(s.pin_events, ['pidfd_open'] * 5)

    def test_consumed_short_send_is_not_reopened(self):
        with self.system() as s:
            s.protocol_mode = 'short'
            with self.assertRaises(ValueError): self.acquire(s)
            self.assertEqual(s.journal._resources[s.resource]['protocol']['state'], 'offered')
            with self.assertRaises(ValueError): self.acquire(s)
            self.assertEqual(s.protocol_sends, [2])

    def test_wrong_nonce_and_real_unexpected_rights_never_accept(self):
        for mode in ('nonce', 'rights'):
            with self.subTest(mode=mode), self.system() as s:
                s.protocol_mode = mode
                with self.assertRaises(ValueError): self.acquire(s)
                self.assertEqual(s.journal._resources[s.resource]['protocol']['state'], 'offered')
                for fd in s.unwanted:
                    with self.assertRaises(OSError): NATIVE.fstat(fd)

    def test_parent_close_inside_recv_closes_delivered_rights(self):
        with self.system() as s:
            s.protocol_mode = 'rights'
            def revoke(event):
                if event == 'receive' and s.protocol_sends: s.material.close()
            s.protocol_hook = revoke
            with self.assertRaises(ValueError): self.acquire(s)
            self.assertTrue(s.unwanted)
            for fd in s.unwanted:
                with self.assertRaises(OSError): NATIVE.fstat(fd)

    def test_expired_or_changed_clock_after_response_never_records_acceptance(self):
        for mode in ('deadline', 'namespace'):
            with self.subTest(mode=mode), self.system() as s:
                def change(event):
                    if event == 'receive' and s.protocol_sends:
                        if mode == 'deadline': s.material._deadline = -1
                        else: s.time_different = True
                s.protocol_hook = change
                with self.assertRaises(ValueError): self.acquire(s)
                self.assertEqual(s.journal._resources[s.resource]['protocol']['state'], 'offered')
                self.assertEqual(s.protocol_sends, [2])

    def test_original_phase_covers_journal_native_write_under_default_outer_budget(self):
        with self.system() as s:
            base, base_ns = time.monotonic(), time.monotonic_ns()
            offset, armed, writes = [0], [False], []
            append, pread, write = s.journal._append, resource_journal.os.pread, resource_journal.os.write
            def after_time_read():
                offset[0] = 4
                return base + offset[0]
            precise = lambda: base_ns + offset[0] * 1000000000
            def append_hook(row):
                if row['action'] == 'probe_open': armed[0] = True
                return append(row)
            def read_hook(fd, *args):
                if armed[0] and fd == s.journal._fd: offset[0] = 6
                return pread(fd, *args)
            def write_hook(fd, *args):
                if armed[0] and offset[0] >= 5: writes.append(True)
                return write(fd, *args)
            with patch.object(channel, 'time', SimpleNamespace(monotonic=after_time_read, monotonic_ns=precise)), patch.object(
                    quartet_material, 'time', SimpleNamespace(monotonic=lambda: base + offset[0], monotonic_ns=precise)), patch.object(
                    s.journal, '_append', side_effect=append_hook), patch.object(
                    resource_journal.os, 'pread', side_effect=read_hook), patch.object(
                    resource_journal.os, 'write', side_effect=write_hook):
                with self.assertRaises(ValueError):
                    s.material._run(lambda: channel._ProtocolChannel._open_locked(s.material))
            self.assertTrue(armed[0])
            self.assertEqual(writes, [])

    def test_channel_phase_reset_does_not_release_original_transaction_tail(self):
        with self.system() as s:
            original = channel._ProtocolChannel._handshake
            tail, original_time = [], quartet_material.time
            def completed(owned):
                original(owned)
                self.assertEqual(owned._phase_ns, owned._total_ns)
                precise = s.material._transaction_deadline_ns
                tail.append(precise)
                # The final journal guard still runs after this callback returns.
                s.tail_clock = precise
            with patch.object(channel._ProtocolChannel, '_handshake', completed), patch.object(
                    quartet_material, 'time', SimpleNamespace(monotonic=original_time.monotonic,
                    monotonic_ns=lambda: s.tail_clock if hasattr(s, 'tail_clock') else original_time.monotonic_ns())):
                with self.assertRaises(ValueError): self.acquire(s)
            self.assertEqual(len(tail), 1)
            self.assertTrue(s.material._retired)
            self.assertIsNone(s.material._protocol)


if __name__ == '__main__': unittest.main()
