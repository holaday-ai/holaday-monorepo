"""Later credentials require the live original anchor, not a journal receipt."""
import json
import struct
import unittest
from unittest.mock import patch

import quartet_worker_guard
import test_quartet_worker_channel as channel_tests


class AnchorBindingTests(unittest.TestCase):
    def test_composed_anchor_check_does_not_repeat_the_same_material_scan(self):
        with channel_tests.WorkerChannelTests().system() as s:
            s.material.accept_role('anchor')
            with patch.object(s.material, '_verify', wraps=s.material._verify) as scan:
                s.material._run(s.material._workers['anchor']._check_locked)
            self.assertEqual(scan.call_count, 1)

    def test_running_child_keeps_original_view_but_accepts_bounded_threads(self):
        with channel_tests.WorkerChannelTests().system() as s:
            s.material.accept_role('anchor')
            s.material.prepare_role('xvfb')
            self.dispatch_observation(s, 'xvfb', 1)
            s.material.accept_role('xvfb')
            child = s.material._workers['xvfb']
            status = s.root / 'proc/778/status'
            status.write_bytes(status.read_bytes().replace(b'Threads: 1', b'Threads: 8'))
            self.assertTrue(hasattr(child._view, '_check_running_locked'), 'post-grant running view missing')
            s.material._run(child._view._check_running_locked)
            self.assertEqual(s.pin_events, ['pidfd_open'] * 2)
            status.write_bytes(status.read_bytes().replace(b'Threads: 8', b'Threads: 129'))
            with self.assertRaises(ValueError): s.material._run(child._view._check_running_locked)

    def test_running_view_cannot_relax_anchor_guard(self):
        with channel_tests.WorkerChannelTests().system() as s:
            s.material.accept_role('anchor')
            anchor = s.material._workers['anchor']
            self.assertTrue(hasattr(anchor._view, '_check_running_locked'))
            with self.assertRaises(ValueError): s.material._run(anchor._view._check_running_locked)

    def test_running_view_rejects_child_before_durable_grant(self):
        with channel_tests.WorkerChannelTests().system() as s:
            s.material.accept_role('anchor')
            s.material.prepare_role('xvfb')
            self.dispatch_observation(s, 'xvfb', 1)
            attempted = []
            def before_grant(event):
                if event == 'challenge-send':
                    attempted.append(True)
                    s.material._workers['xvfb']._view._check_running_locked()
            s.wire_hook = before_grant
            with self.assertRaises(ValueError): s.material.accept_role('xvfb')
            self.assertTrue(attempted)
            self.assertFalse(s.journal._resources[s.resource]['roles']['xvfb'].get('granted', False))

    def dispatch_observation(self, s, role, index, *, observed=True):
        """Synthetic systemd boundary only; actual pin/view/protocol remain real."""
        pid = 777 + index
        unit = 'holaday-pool-' + role + '-' + s.resource + '.service'
        group = '/holadaypool.slice/holadaypool-' + s.resource + '.slice/' + unit
        proc = s.root / ('proc/' + str(pid))
        (proc / 'ns').mkdir(parents=True)
        (proc / 'net').mkdir()
        (proc / 'root').symlink_to((s.proc / 'root').resolve())
        (proc / 'cgroup').write_bytes(('0::' + group + '\n').encode())
        (proc / 'status').write_bytes((s.proc / 'status').read_bytes())
        (proc / 'net/dev').write_bytes((s.proc / 'net/dev').read_bytes())
        for name in ('net', 'ipc'):
            (proc / 'ns' / name).symlink_to(s.proc / 'ns' / name)
        (proc / 'ns/mnt').write_bytes(b'independent worker mount namespace')
        invocation = ('%02x' % (17 + index)) * 16
        common = {'version': 2, 'resource': s.resource, 'role': role}
        for row in ({'action': 'role_dispatch', 'unit': unit, 'managerGuid': 'd' * 32, 'managerOwner': ':1.5'},
                    {'action': 'role_accepted', 'job': '/org/freedesktop/systemd1/job/' + str(7 + index)},
                    {'action': 'role_observe', 'invocation': invocation}):
            if observed:
                s.journal._run(lambda: s.journal._append(common | row))
        s.units[unit] = dict(s.properties) | {'Id': ('s', unit), 'MainPID': ('u', pid),
            'ControlGroup': ('s', group), 'InvocationID': ('ay', [17 + index] * 16)}
        s.worker_pids.add(pid)
        s.peer = struct.pack('=iII', pid, 2001, 2001)
        s.reset_peer(role)

    def test_all_five_roles_use_distinct_pins_and_original_anchor_namespaces(self):
        with channel_tests.WorkerChannelTests().system() as s:
            s.material.accept_role('anchor')
            for index, role in enumerate(('xvfb', 'brave', 'x11vnc', 'websockify'), 1):
                s.material.prepare_role(role)
                self.dispatch_observation(s, role, index)
                try:
                    s.material.accept_role(role)
                except ValueError:
                    self.fail('fixed later role cannot yet complete the original-anchor handshake')
            self.assertEqual(s.accepts, 5)
            self.assertEqual(s.pin_events, ['pidfd_open'] * 5)
            self.assertEqual(s.grant_durable, [True] * 5)
            self.assertEqual(s.sends, [b'challenge', b'grant'] * 5)
            rows = s.journal._resources[s.resource]['roles']
            self.assertEqual(len(rows), 5)
            self.assertTrue(all(row['granted'] for row in rows.values()))
            self.assertFalse(hasattr(s.material, 'ready'))

    def test_role_subclass_cannot_reach_listener(self):
        class Alias(str): pass
        with channel_tests.WorkerChannelTests().system() as s:
            with self.assertRaises(ValueError): s.material.accept_role(Alias('anchor'))
            self.assertEqual(s.accepts, 0)

    def test_child_namespace_mismatch_or_anchor_replacement_cannot_grant_child(self):
        for mode in ('foreign-child', 'changed-anchor'):
            with channel_tests.WorkerChannelTests().system() as s:
                s.material.accept_role('anchor')
                s.material.prepare_role('xvfb')
                self.dispatch_observation(s, 'xvfb', 1)
                if mode == 'foreign-child':
                    child_ns = s.root / 'proc/778/ns/net'
                    child_ns.unlink()
                    child_ns.write_bytes(b'foreign child network namespace')
                else:
                    def hook(event):
                        if event == 'challenge-send':
                            s.properties['InvocationID'] = ('ay', [29] * 16)
                    s.wire_hook = hook
                with self.assertRaises(ValueError): s.material.accept_role('xvfb')
                self.assertFalse(s.journal._resources[s.resource]['roles']['xvfb'].get('granted', False))
                self.assertEqual(s.sends.count(b'grant'), 1)  # Anchor only; child never authorized.
                self.assertEqual(s.fds, {})

    def test_final_child_send_setter_anchor_revocation_preserves_consumption_without_send(self):
        for target in ('pin', 'view', 'channel'):
            with channel_tests.WorkerChannelTests().system() as s:
                s.material.accept_role('anchor')
                s.material.prepare_role('xvfb')
                self.dispatch_observation(s, 'xvfb', 1)
                anchor, revoked = s.material._workers['anchor'], False
                def hook(event):
                    nonlocal revoked
                    if (event == 'settimeout' and not revoked
                            and s.journal._resources[s.resource]['roles']['xvfb'].get('granted', False)):
                        revoked = True
                        {'pin': anchor._pin, 'view': anchor._view, 'channel': anchor}[target].close()
                s.wire_hook = hook
                with self.assertRaises(ValueError): s.material.accept_role('xvfb')
                self.assertTrue(revoked)
                self.assertTrue(s.journal._resources[s.resource]['roles']['xvfb']['granted'])
                self.assertEqual(s.sends.count(b'grant'), 1)
                self.assertEqual(s.fds, {})

    def test_anchor_revocation_inside_child_view_stops_further_native_opens(self):
        with channel_tests.WorkerChannelTests().system() as s:
            s.material.accept_role('anchor')
            s.material.prepare_role('xvfb')
            self.dispatch_observation(s, 'xvfb', 1)
            revoked, late = False, []
            anchor = s.material._workers['anchor']
            def hook(event):
                nonlocal revoked
                if revoked and event.startswith('open:'): late.append(event)
                child = s.material._workers.get('xvfb')
                if (event == 'open:ns/net' and not revoked and child is not None
                        and child._pin is not None and child._pin._busy
                        and not anchor._pin._busy):
                    revoked = True
                    anchor._pin.close()
            s.view_hook = hook
            with self.assertRaises(ValueError): s.material.accept_role('xvfb')
            self.assertTrue(revoked)
            self.assertEqual(late, [])
            self.assertEqual(s.sends.count(b'grant'), 1)
            self.assertEqual(s.fds, {})

    def test_next_credential_binds_namespaces_from_original_live_anchor(self):
        with channel_tests.WorkerChannelTests().system() as s:
            s.material.accept_role('anchor')
            try:
                s.material.prepare_role('xvfb')
            except ValueError:
                self.fail('live original anchor cannot yet produce the next role binding')
            raw = (s.directory / 'credentials/xvfb.binding').read_bytes()
            binding = quartet_worker_guard._decode_binding(raw, 'a' * 40, s.resource, 'xvfb')
            actual = {name: [path.stat().st_dev, path.stat().st_ino] for name in ('net', 'ipc')
                      for path in [s.proc / 'ns' / name]}
            self.assertEqual(binding['groupNamespaces'], actual)
            self.assertEqual(binding['objects'], s.material._bindings['anchor']['objects'])
            self.assertNotEqual(binding['handshake'], s.material._bindings['anchor']['handshake'])
            self.assertEqual(s.pin_events, ['pidfd_open'])
            rows = [json.loads(row) for row in s.journal._expected.splitlines()][1:]
            self.assertEqual([(row['action'], row.get('role')) for row in rows[-3:]],
                             [('role_grant', 'anchor'), ('credential_claim', 'xvfb'), ('credential_ready', 'xvfb')])

    def test_durable_grant_without_original_anchor_cannot_produce_binding(self):
        with channel_tests.WorkerChannelTests().system() as s:
            row = channel_tests.WorkerChannelTests().grant(s)
            s.journal._run(lambda: s.journal._append(row))
            before = s.journal._expected
            with self.assertRaises(ValueError): s.material.prepare_role('xvfb')
            self.assertEqual(s.journal._expected, before)
            self.assertFalse((s.directory / 'credentials/xvfb.binding').exists())

    def test_dead_or_changed_anchor_refuses_next_credential_before_claim(self):
        for mode in ('exit', 'namespace', 'invocation'):
            with channel_tests.WorkerChannelTests().system() as s:
                s.material.accept_role('anchor')
                before = s.journal._expected
                if mode == 'exit': s.exited = True
                elif mode == 'namespace':
                    (s.proc / 'ns/ipc').rename(s.proc / 'ns/retired-ipc')
                    (s.proc / 'ns/ipc').write_bytes(b'replacement anchor namespace')
                else: s.properties['InvocationID'] = ('ay', [18] * 16)
                with self.assertRaises(ValueError): s.material.prepare_role('xvfb')
                self.assertEqual(s.journal._expected, before)
                self.assertFalse((s.directory / 'credentials/xvfb.binding').exists())

    def test_anchor_exit_during_credential_sync_cannot_publish_ready(self):
        with channel_tests.WorkerChannelTests().system() as s:
            s.material.accept_role('anchor')
            entered = False
            def hook(event):
                nonlocal entered
                if event == 'fsync' and 'xvfb' in s.material._credentials:
                    entered = True
                    s.exited = True
            s.hook = hook
            with self.assertRaises(ValueError): s.material.prepare_role('xvfb')
            self.assertTrue(entered)
            rows = [json.loads(row) for row in s.journal._expected.splitlines()][1:]
            self.assertEqual([(row['action'], row.get('role')) for row in rows[-2:]],
                             [('role_grant', 'anchor'), ('credential_claim', 'xvfb')])
            self.assertTrue((s.directory / 'credentials/xvfb.binding').exists())
            self.assertEqual(s.fds, {})


if __name__ == '__main__':
    unittest.main()
