"""Complete root start chain with real files/sockets and explicit Linux/peer seams."""
import array
import contextlib
import json
import socket
import struct
import unittest
from types import SimpleNamespace
from unittest.mock import patch

import quartet_launch as launch
import quartet_bridge_channel
import quartet_probe_channel
from quartet_worker_guard import _bridge_frame, _probe_control_frame, _BRIDGE_FRAME, _PROBE_CONTROL_FRAME
import test_quartet_worker_channel as worker_fixture
import test_quartet_bridge_channel as bridge_fixture
import test_quartet_egress as egress_fixture
import test_quartet_probe_clock as clock_fixture
import test_quartet_launch as dispatch_fixture
import test_quartet_anchor_binding as role_fixture
import test_quartet_material as material_fixture
from quartet_protocol import decode_quartet_request

NATIVE = bridge_fixture.NATIVE


class FullStartTests(unittest.TestCase):
    def test_wrapper_last_clock_rechecks_all_original_terminal_owners(self):
        with self.system() as s:
            original_start, original_clock = launch._launch_material, launch.time.monotonic_ns
            completed, revoked = [], []
            def start(material):
                original_start(material)
                completed.append(True)
            def clock():
                value = original_clock()
                if completed and not revoked:
                    revoked.append(True)
                    s.material._workers['xvfb']._pin.close()
                return value
            request = decode_quartet_request(json.dumps({'version': 2, 'action': 'create',
                'requestId': 'c'*32, 'boot': 'b'*32, 'slot': 0}).encode())
            # Reservation/material acquisition already happened in this real
            # graph. The whole launch and its terminal validation remain real.
            with patch.object(launch._GroupMaterial, 'create', return_value=s.material), \
                    patch.object(launch, '_launch_material', side_effect=start), \
                    patch.object(launch, 'time', SimpleNamespace(monotonic_ns=clock)):
                with self.assertRaises(ValueError): launch.launch_quartet(s.journal, s.manager, request)
            self.assertEqual(completed, [True])
            self.assertEqual(revoked, [True])
            self.assertTrue(s.material._retired)

    def test_final_clock_cannot_hide_revocation_of_an_earlier_checked_worker(self):
        with self.system() as s:
            revoked = []
            def late_close():
                protocol = s.material._protocol
                if protocol is not None and protocol._complete and not revoked:
                    revoked.append(True)
                    s.material._workers['xvfb']._pin.close()
            s.time_hook = late_close
            with self.assertRaises(ValueError): launch._launch_material(s.material)
            self.assertTrue(revoked)
            self.assertTrue(s.material._retired)

    def test_public_create_does_not_return_partial_material_as_a_completed_group(self):
        self.assertTrue(callable(getattr(launch, 'launch_quartet', None)), 'public fixed create chain missing')
        with material_fixture.MaterialTests().system() as s:
            request = decode_quartet_request(json.dumps({'version': 2, 'action': 'create',
                'requestId': 'c'*32, 'boot': 'b'*32, 'slot': 0}).encode())
            captured = []
            with patch.object(launch, '_launch_material', side_effect=lambda item: captured.append(item)):
                with self.assertRaises(ValueError): launch.launch_quartet(s.journal, s.manager, request)
            self.assertEqual(len(captured), 1)
            self.assertTrue(captured[0]._retired)
            self.assertEqual(s.journal._resources[s.resource]['state'], 'material_prepared')

    @contextlib.contextmanager
    def system(self):
        @contextlib.contextmanager
        def setup(s):
            with bridge_fixture.BridgeChannelTests().setup_endpoints(s, create=False), \
                    egress_fixture.EgressTests().system(base=lambda: contextlib.nullcontext(s), create_endpoints=False):
                yield
        @contextlib.contextmanager
        def base():
            with worker_fixture.WorkerChannelTests().system(observed=False, prepare_anchor=False, material_setup=setup) as s:
                yield s
        with clock_fixture.ProbeClockTests().system(base=base, accept_anchor=False) as s, \
                dispatch_fixture.QuartetLaunchTests().system(base=lambda: contextlib.nullcontext(s)), contextlib.ExitStack() as stack:
            worker_accept, worker_timeout = s.material._socket.accept, s.material._socket.settimeout
            s.control_rights, s.control_packets, s.control_instances = [], [], []
            s.control_mode = ''
            roles = ('anchor', 'xvfb', 'brave', 'x11vnc', 'websockify')
            def dispatch_hook(method):
                if method != 'StartTransientUnit': return
                role = list(s.journal._resources[s.resource]['roles'])[-1]
                stage = roles.index(role)
                group = s.journal._resources[s.resource]
                if stage:
                    self.assertEqual(group['protocol']['state'], 'accepted')
                    self.assertEqual(len(group['protocol']['stages']), stage - 1)
                    self.assertTrue(all(row['state'] == 'observed' for row in group['protocol']['stages'].values()))
                    role_fixture.AnchorBindingTests().dispatch_observation(s, role, stage, observed=False)
            s.dispatch_hook = dispatch_hook
            def packet(protocol):
                left, right = socket.socketpair(socket.AF_UNIX, socket.SOCK_DGRAM)
                stack.callback(left.close); stack.callback(right.close)
                left.settimeout(1); right.settimeout(1)
                binding = s.material._bindings['anchor']
                peer = struct.pack('=iII', 777, 2001, 2001)
                hello = (_bridge_frame(0, binding, '0'*32, binding['handshake'], (0, 0, 0, 0)) if protocol == 'bridge' else
                    _probe_control_frame(1, 0, binding, '0'*32, 0, bytes.fromhex(binding['handshake']), 0, 0))
                right.send(hello)
                outer = self
                class Connection:
                    def settimeout(self, value): left.settimeout(value)
                    def set_inheritable(self, value): left.set_inheritable(value)
                    def setsockopt(self, *args): outer.assertEqual(args, (socket.SOL_SOCKET, 16, 1))
                    def getsockopt(self, *args): return peer
                    def recvmsg(self, size, space, flags):
                        data, ancillary, flags, address = left.recvmsg(size, space)
                        return data, ancillary + [(socket.SOL_SOCKET, 2, peer)], flags, address
                    def sendmsg(self, buffers, ancillary=()):
                        sent = left.sendmsg(buffers, ancillary)
                        data, rights, _flags, _address = right.recvmsg(256, socket.CMSG_SPACE(32))
                        for level, kind, raw in rights:
                            outer.assertEqual((level, kind), (socket.SOL_SOCKET, socket.SCM_RIGHTS))
                            s.control_rights.extend(array.array('i', raw))
                        codec = _BRIDGE_FRAME if protocol == 'bridge' else _PROBE_CONTROL_FRAME
                        fields = list(codec.unpack(data))
                        kind = fields[1]
                        s.control_packets.append((protocol, kind))
                        responds = kind in (1, 3) if protocol == 'bridge' else kind in (2, 4) or kind == 6 and fields[2] == 4
                        if responds:
                            fields[1] += 1
                            if protocol == 'protocol' and kind == 4 and s.control_mode == 'wrong-report': fields[8] = bytes(32)
                            right.send(codec.pack(*fields))
                        return sent
                    def close(self): left.close()
                instance = Connection()
                s.control_instances.append(instance)
                return instance, ''
            def accept():
                current = s.material._workers[roles[len(s.material._workers) - 1]]
                if current._pin is None:
                    s.reset_peer(current._role)
                    return worker_accept()
                if s.material._protocol is not None: return packet('protocol')
                return packet('bridge')
            stack.enter_context(patch.object(s.material._socket, 'accept', side_effect=accept))
            # Listener's timeout is checked by material; each accepted socket
            # receives its own actual timeout in the producer.
            stack.enter_context(patch.object(s.material._socket, 'settimeout', lambda _value: None))
            stack.enter_context(patch.object(quartet_bridge_channel, 'os', NATIVE))
            stack.enter_context(patch.object(quartet_probe_channel, 'os', NATIVE))
            try: yield s
            finally:
                s.material.close()
                for fd in s.control_rights: NATIVE.close(fd)

    def test_whole_original_material_launches_five_roles_only_after_prior_observation(self):
        self.assertTrue(callable(getattr(launch, '_launch_material', None)), 'whole original-material start chain missing')
        with self.system() as s:
            launch._launch_material(s.material)
            self.assertEqual(len(s.starts), 5)
            self.assertEqual(s.pin_events, ['pidfd_open'] * 5)
            self.assertEqual(s.grant_durable, [True] * 5)
            self.assertEqual(s.journal._resources[s.resource]['protocol']['state'], 'complete')
            self.assertTrue(s.material._protocol._complete)
            self.assertEqual(len(s.control_rights), 2)
            self.assertNotEqual(s.journal._resources[s.resource]['state'], 'exited')

    def test_failed_first_protocol_never_dispatches_the_remaining_roles(self):
        self.assertTrue(callable(getattr(launch, '_launch_material', None)))
        with self.system() as s:
            s.control_mode = 'wrong-report'
            with self.assertRaises(ValueError): launch._launch_material(s.material)
            self.assertEqual(len(s.starts), 2)
            self.assertTrue(s.material._retired)
            self.assertEqual(s.journal._resources[s.resource]['protocol']['stages']['1']['state'], 'commanded')


if __name__ == '__main__': unittest.main()
