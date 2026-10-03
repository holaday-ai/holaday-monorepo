"""Registered root entry with actual journal/manager/listener ownership; OS seams only."""
import contextlib
import inspect
import socket
import unittest
from unittest.mock import patch

import launch_listener
import manager_probe
import resource_journal
import test_manager_probe
import test_quartet_listener
import test_quartet_ready
import test_quartet_boot


class QuartetEntryTests(unittest.TestCase):
    def test_final_root_observation_cannot_hide_original_group_or_worker_retirement(self):
        for mode in ('group', 'worker'):
            with self.subTest(mode=mode), patch('tempfile.tempdir', '/private/tmp'), \
                    test_quartet_ready.RuntimeReadyTests().system(control_socket=True) as s, \
                    test_quartet_listener.QuartetListenerTests().system(base=lambda: contextlib.nullcontext(s)):
                live = s.controls[0]._start_material(s.material)
                runtime = test_quartet_listener.module._QuartetListener.open(s.journal)
                # Stage only the parent tail from actual core/adopt objects.
                # No ready records or live source dictionaries are invented.
                runtime._groups.append(live)
                root = s.listener
                root._journal, root._manager, root._quartet = s.journal, s.manager, runtime
                root._runtime_mode = 'v2'
                test_quartet_boot.confirm_root(self, s)
                original = s.registration._require_registered
                root_checks, revoked = [], []
                def check():
                    result = original()
                    caller = inspect.currentframe().f_back
                    if caller.f_code.co_name == '_runtime_check':
                        root_checks.append(True)
                        if len(root_checks) == 2:
                            revoked.append(True)
                            if mode == 'group': live.retire()
                            else: s.material._workers['xvfb']._pin.close()
                    return result
                try:
                    s.registration._require_registered = check
                    with patch.object(runtime._socket, 'accept', side_effect=TimeoutError()):
                        with self.assertRaises(ValueError): root.serve_quartet_once()
                    self.assertEqual(revoked, [True])
                    self.assertTrue(runtime._retired)
                finally:
                    s.registration._require_registered = original
                    root.close()

    def test_independently_closed_child_source_blocks_further_acquisition_and_return(self):
        for stage in ('journal', 'manager', 'quartet'):
            with self.subTest(stage=stage), self.system() as s:
                original = s.registration._require_registered
                revoked, captures_after = [], []
                capture = manager_probe._capture
                def check():
                    result = original()
                    owned = getattr(s.listener, '_' + stage)
                    if owned is not None and not revoked:
                        revoked.append(True)
                        owned.close()
                    return result
                def collector(*args):
                    if revoked: captures_after.append(True)
                    return capture(*args)
                with patch.object(s.registration, '_require_registered', side_effect=check), \
                        patch.object(manager_probe, '_capture', side_effect=collector):
                    with self.assertRaises(ValueError): s.listener.start_quartet_runtime()
                self.assertEqual(revoked, [True])
                self.assertEqual(captures_after, [], 'child veto did not stop the next native acquisition')
                self.assertEqual(s.opened, set())

    @contextlib.contextmanager
    def system(self):
        self.assertTrue(callable(getattr(launch_listener.RootLaunchListener, 'start_quartet_runtime', None)),
            'registered root entry is not wired')
        def setup(root, _package, _manifest):
            parent = root / 'var/lib/holaday-pool-broker'
            parent.mkdir(parents=True)
            parent.chmod(0o700)
            (parent / 'resource-journal.jsonl').write_bytes(b'{"version":1,"action":"initialize"}\n')
            (parent / 'resource-journal.jsonl').chmod(0o600)
        with test_quartet_listener.QuartetListenerTests().system(
                base=lambda: test_manager_probe.ProbeTests().system(setup)) as s, \
                patch.object(resource_journal, 'os', s.proxy):
            try: yield s
            finally: s.listener.close()

    def test_real_original_sources_are_acquired_and_closed_by_registered_root(self):
        with self.system() as s:
            self.assertIsNone(s.listener.start_quartet_runtime())
            journal, manager, runtime = s.listener._journal, s.listener._manager, s.listener._quartet
            self.assertIs(type(journal), resource_journal.ResourceJournal)
            self.assertIs(type(manager), manager_probe.SystemManagerProbe)
            self.assertIs(journal._registration, s.registration)
            self.assertIs(manager._registration, s.registration)
            self.assertIs(runtime._journal, journal)
            self.assertIs(runtime._pin, s.registration._pin)
            test_quartet_boot.confirm_root(self, s)
            with patch.object(runtime._socket, 'accept', side_effect=TimeoutError()):
                s.listener.serve_quartet_once()
                s.listener.serve_quartet_once()
            self.assertIs(s.listener._quartet, runtime)
            self.assertFalse(runtime._retired)
            self.assertEqual(journal._resources, {})
            s.listener.close()
            self.assertTrue(runtime._retired and journal._retired and manager._retired)
            self.assertEqual(s.opened, set())
            self.assertTrue(s.channel.closed)

    def test_v1_cannot_replace_an_active_v2_listener(self):
        with self.system() as s:
            s.listener.start_quartet_runtime()
            runtime = s.listener._quartet
            with self.assertRaises(ValueError): s.listener.serve_runtime_once()
            self.assertTrue(runtime._retired)
            self.assertEqual(s.opened, set())

    def test_failed_bind_closes_original_sources_but_preserves_existing_leaf(self):
        with self.system() as s, test_quartet_listener.NativeSocket(socket.AF_UNIX, socket.SOCK_STREAM) as occupied:
            occupied.bind(s.path_runtime)
            identity = test_quartet_listener.NATIVE.stat(s.path_runtime).st_ino
            with self.assertRaises(ValueError): s.listener.start_quartet_runtime()
            self.assertEqual(s.opened, set())
            self.assertTrue(s.channel.closed)
            self.assertEqual(test_quartet_listener.NATIVE.stat(s.path_runtime).st_ino, identity)
            self.assertEqual(s.removed, [])

    def test_close_inside_manager_acquisition_cannot_leave_late_owned_sources(self):
        with self.system() as s:
            original = manager_probe._capture
            closed = []
            def capture(*args):
                if not closed:
                    closed.append(True)
                    s.listener.close()
                return original(*args)
            with patch.object(manager_probe, '_capture', side_effect=capture):
                with self.assertRaises(ValueError): s.listener.start_quartet_runtime()
            self.assertEqual(closed, [True])
            self.assertEqual(s.opened, set())
            self.assertTrue(s.channel.closed)
