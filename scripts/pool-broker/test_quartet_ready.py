"""Original group-ready transition; journal facts alone are not runtime objects."""
import contextlib
import copy
import unittest
import threading
from types import SimpleNamespace
from unittest.mock import patch

import quartet_records as records
import quartet_journal
import quartet_material
import quartet_launch
import quartet_protocol
from quartet_create_offer import _CreateOffer
import test_quartet_full_start as full_fixture
try:
    import quartet_runtime as runtime
except ModuleNotFoundError as error:
    if error.name != 'quartet_runtime': raise
    runtime = None


class ReadyRecordTests(unittest.TestCase):
    def test_ready_needs_accepted_offer_all_original_role_facts_and_four_protocols(self):
        resource = 'd'*32
        group = {'version': 2, 'state': 'observed', 'createOffer': {'state': 'accepted', 'preparedDigest': 'a'*64},
            'material': {'state': 'ready'}, 'endpoints': {'state': 'ready'}, 'egress': {'state': 'ready'},
            'bridge': {'state': 'committed'}, 'roles': {role: {'state': 'observed', 'granted': True} for role in records.ROLES},
            'protocol': {'state': 'complete', 'stages': {str(stage): {'state': 'observed'} for stage in range(1, 5)}}}
        row = {'version': 2, 'revision': 1, 'action': 'group_ready', 'resource': resource, 'preparedDigest': 'a'*64}
        values = {resource: copy.deepcopy(group)}
        try: records.replay(row, values, {})
        except ValueError: self.fail('complete group cannot yet record ready')
        self.assertEqual(values[resource]['state'], 'ready')
        self.assertNotIn('groupExitProven', values[resource])
        with self.assertRaises(ValueError): records.replay(row, values, {})
        for key in ('createOffer', 'material', 'endpoints', 'egress', 'bridge', 'roles', 'protocol'):
            incomplete = copy.deepcopy(group)
            del incomplete[key]
            before = copy.deepcopy(incomplete)
            with self.subTest(key=key), self.assertRaises(ValueError): records.replay(row, {resource: incomplete}, {})
            self.assertEqual(incomplete, before)


class RuntimeReadyTests(unittest.TestCase):
    @contextlib.contextmanager
    def system(self, *, control_socket=False, supply_scope=True):
        self.assertIsNotNone(runtime, 'original runtime owner missing')
        offers, controls, received, failures, clients = [], [], [], [], []
        stack = contextlib.ExitStack()
        original_create = quartet_material._GroupMaterial.create
        def prepare(journal, request, **_kwargs):
            if control_socket:
                import test_quartet_create_control as control_fixture
                fixture = control_fixture.CreateControlTests()
                _s, owned, peer, state = stack.enter_context(fixture.system(
                    base=lambda: contextlib.nullcontext(SimpleNamespace(journal=journal))))
                peer.settimeout(65)
                def client():
                    try:
                        peer.sendall(fixture.request())
                        raw = fixture.read(peer)
                        data = quartet_protocol.decode_control_frame(raw)
                        scope = {key: data[key] for key in ('version', 'requestId', 'candidate', 'boot', 'resource', 'slot')}
                        peer.sendall(quartet_protocol.encode_control_frame(scope | {'phase': 'accepted',
                            'preparedDigest': quartet_protocol.control_prepared_digest(raw)}))
                        received.append(quartet_protocol.decode_control_frame(fixture.read(peer)))
                    except Exception as error: failures.append(type(error).__name__)
                client_thread = threading.Thread(target=client)
                clients.append(client_thread)
                client_thread.start()
                control = control_fixture.module._CreateControl.accept(journal, owned)
                controls.append(control)
                offer = control.prepare()
                offers.append(offer)
                return offer.consume()
            offer = _CreateOffer.open(journal, request)
            offers.append(offer)
            raw = offer.take_prepared()
            data = quartet_protocol.decode_control_frame(raw)
            scope = {key: data[key] for key in ('version', 'requestId', 'candidate', 'boot', 'resource', 'slot')}
            offer.accept_frame(quartet_protocol.encode_control_frame(scope | {'phase': 'accepted',
                'preparedDigest': quartet_protocol.control_prepared_digest(raw)}))
            return offer.consume()
        def create(*args, **kwargs):
            return original_create(*args, **kwargs, deadline_ns=offers[0]._deadline_ns,
                **({'scope_guard': offers[0]._budget} if supply_scope else {}))
        # The real single-use offer precedes actual material acquisition. No
        # prepared/accepted/ready records or original objects are fabricated.
        with stack, patch.object(quartet_journal, 'prepare_quartet', side_effect=prepare), \
                patch.object(quartet_material._GroupMaterial, 'create', side_effect=create), \
                full_fixture.FullStartTests().system() as s:
            s.offer = offers[0]
            s.controls, s.ready_received, s.client_failures, s.clients = controls, received, failures, clients
            try: yield s
            finally:
                for control in controls: control.close()
                for thread in clients: thread.join(3)
                self.assertTrue(all(not thread.is_alive() for thread in clients))

    def test_original_control_returns_ready_only_after_complete_start_and_transfers_owner(self):
        import quartet_create_control
        self.assertTrue(callable(getattr(quartet_create_control._CreateControl, '_start_material', None)),
            'accepted control cannot yet deliver ready from the original complete group')
        with self.system(control_socket=True) as s:
            control = s.controls[0]
            original_timeout = control._stream.settimeout
            ready_timeouts = []
            def timeout(value):
                if control._runtime is not None: ready_timeouts.append(value)
                original_timeout(value)
            control._stream.settimeout = timeout
            live = control._start_material(s.material)
            self.assertIs(live._material, s.material)
            self.assertTrue(control._retired)
            self.assertIsNone(control._stream)
            control.close()
            self.assertFalse(live._retired, 'closed original create stream must not discard transferred owner')
            self.assertEqual(s.journal._resources[s.resource]['state'], 'ready')
            # The peer observes the real sent frame, not a local ready dictionary.
            for thread in s.clients: thread.join(1)
            self.assertEqual(s.client_failures, [])
            self.assertEqual([frame['phase'] for frame in s.ready_received], ['ready'])
            self.assertTrue(ready_timeouts)
            self.assertTrue(all(0 < value <= 5 for value in ready_timeouts), 'ready delivery has its own 5s cap')
            live.retire()

    def test_ready_settimeout_revocation_does_not_send_ready(self):
        with self.system(control_socket=True) as s:
            control = s.controls[0]
            stream, sends, revoked = control._stream, [], []
            original_timeout, original_send = stream.settimeout, stream.sendmsg
            def timeout(value):
                original_timeout(value)
                if control._runtime is not None and not revoked:
                    revoked.append(True)
                    s.material._workers['xvfb']._pin.close()
            def send(*args):
                if control._runtime is not None: sends.append(True)
                return original_send(*args)
            stream.settimeout, stream.sendmsg = timeout, send
            with self.assertRaises(ValueError): control._start_material(s.material)
            self.assertEqual(revoked, [True])
            self.assertEqual(sends, [])
            self.assertEqual(s.ready_received, [])

    def test_core_binds_original_offer_even_when_caller_did_not_supply_scope(self):
        with self.system(supply_scope=False) as s:
            revoked, after = [], []
            original_read, original_write = s.journal._io, s.journal._append
            def io(call, *args, **kwargs):
                value = original_read(call, *args, **kwargs)
                if not revoked:
                    revoked.append(True)
                    s.offer.close()
                return value
            def write(*args, **kwargs):
                if revoked: after.append(True)
                return original_write(*args, **kwargs)
            with patch.object(s.journal, '_io', side_effect=io), patch.object(s.journal, '_append', side_effect=write):
                with self.assertRaises(ValueError): quartet_launch._launch_material(s.material, ready_offer=s.offer)
            self.assertEqual(revoked, [True])
            self.assertEqual(after, [], 'no durable mutation after original create source is revoked')

    def test_control_budget_does_not_recursively_rescan_child_owner_at_every_child_boundary(self):
        with self.system(control_socket=True) as s:
            control = s.controls[0]
            control._material = s.material
            with patch.object(s.material, '_owner_veto', wraps=s.material._owner_veto) as check:
                control._budget()
                self.assertEqual(check.call_count, 0, 'child already performs its own final owner veto')
                control._check()
                self.assertGreater(check.call_count, 0, 'actual control IO still verifies the original child')


    def test_only_original_completed_creation_can_continue_past_start_deadline(self):
        with self.system() as s:
            quartet_launch._launch_material(s.material, ready_offer=s.offer)
            live = runtime._RunningQuartet.adopt(s.material, s.offer)
            now = s.material._create_deadline_ns + 5000000000
            with patch.object(quartet_material.time, 'monotonic_ns', return_value=now):
                live.check()
            self.assertEqual(s.journal._resources[s.resource]['state'], 'ready')
            self.assertIs(s.material._runtime, live)
            self.assertFalse(s.material._retired)
            s.material._workers['xvfb']._pin.close()
            with self.assertRaises(ValueError): live.check()
            self.assertTrue(s.material._retired)
            self.assertTrue(live._retired)

    def test_expired_or_partial_creation_cannot_switch_off_total_deadline(self):
        with self.system() as s:
            with self.assertRaises(ValueError): runtime._RunningQuartet.adopt(s.material, s.offer)
            self.assertTrue(s.material._retired)
        with self.system() as s:
            now = s.material._create_deadline_ns
            with patch.object(quartet_material.time, 'monotonic_ns', return_value=now):
                with self.assertRaises(ValueError): runtime._RunningQuartet.adopt(s.material, s.offer)
            self.assertTrue(s.material._retired)


if __name__ == '__main__': unittest.main()
