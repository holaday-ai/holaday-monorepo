"""Root public mode uses actual authorization and registration; OS edges are synthetic."""
import contextlib
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import bootstrap
import installation
import launch_listener
import test_launch_listener
import test_manager_probe
import test_quartet_listener
import resource_journal
import threading
import test_quartet_boot


class RootBootstrapTests(unittest.TestCase):
    def test_actual_registered_root_keeps_one_runtime_across_idle_ticks_then_closes_originals(self):
        class Stop(BaseException): pass
        def setup(root, _package, _manifest):
            parent = root / 'var/lib/holaday-pool-broker'
            parent.mkdir(parents=True)
            parent.chmod(0o700)
            path = parent / 'resource-journal.jsonl'
            path.write_bytes(b'{"version":1,"action":"initialize"}\n')
            path.chmod(0o600)
        with test_quartet_listener.QuartetListenerTests().system(base=lambda:
                test_manager_probe.ProbeTests().system(setup, deferred_root=True)) as s, \
                contextlib.ExitStack() as stack:
            path = '/usr/local/lib/holaday-pool-broker/releases/' + 'a' * 40 + '/bootstrap.py'
            for target, value in (('__file__', path), ('sys.argv', [path, '--root-broker']),
                    ('sys.flags', SimpleNamespace(isolated=1, no_site=1, ignore_environment=1)),
                    ('sys.executable', '/usr/bin/python3')):
                stack.enter_context(patch('bootstrap.' + target, value))
            stack.enter_context(patch.object(bootstrap, '_verify_release', return_value={}))
            stack.enter_context(patch.object(bootstrap, '_load_modules', return_value={
                'installation': installation, 'launch_listener': launch_listener}))
            stack.enter_context(patch.object(resource_journal, 'os', s.proxy))
            original_open = launch_listener.RootLaunchListener.open
            def capture(candidate):
                s.listener = original_open(candidate)
                return s.listener
            stack.enter_context(patch.object(launch_listener.RootLaunchListener, 'open', side_effect=capture))
            seen, workers, failures = [], [], []
            original_accept = test_quartet_listener.module.Socket.accept
            def idle_tick(stream):
                if not workers:
                    def client():
                        try: test_quartet_boot.boot_client(s.connect())
                        except Exception as error: failures.append(type(error).__name__)
                    worker = threading.Thread(target=client)
                    workers.append(worker)
                    worker.start()
                    return original_accept(stream)
                owner = s.listener
                seen.append((owner._quartet, owner._journal, owner._manager, owner._registration._pin))
                if len(seen) == 3: raise Stop()
                raise TimeoutError()
            # Emulate only idle accept results, not root/runtime constructors.
            # The original listener still binds and owns its actual Unix FD.
            stack.enter_context(patch.object(test_quartet_listener.module.Socket, 'accept',
                idle_tick))
            try:
                with self.assertRaises(Stop): bootstrap.main()
            finally:
                for worker in workers: worker.join(4)
            self.assertEqual(failures, [])
            self.assertTrue(all(not worker.is_alive() for worker in workers))
            self.assertEqual(len(seen), 3)
            for item in seen[1:]:
                self.assertTrue(all(a is b for a, b in zip(item, seen[0])))
            runtime, journal, manager, pin = seen[0]
            self.assertTrue(runtime._retired and journal._retired and manager._retired)
            self.assertIsNone(pin._fd)
            self.assertEqual(s.opened, set())
            self.assertEqual(s.registration_base.events.count('bind'), 1)
            self.assertIn(s.registration_base.fs.consumed, s.registration_base.fs.data)

    @contextlib.contextmanager
    def system(self):
        with test_launch_listener.ListenerTests().system() as s, contextlib.ExitStack() as stack:
            path = '/usr/local/lib/holaday-pool-broker/releases/' + 'a' * 40 + '/bootstrap.py'
            stack.enter_context(patch.object(bootstrap, '__file__', path))
            stack.enter_context(patch.object(bootstrap.sys, 'argv', [path, '--root-broker']))
            stack.enter_context(patch.object(bootstrap.sys, 'flags',
                SimpleNamespace(isolated=1, no_site=1, ignore_environment=1)))
            stack.enter_context(patch.object(bootstrap.sys, 'executable', '/usr/bin/python3'))
            # The real candidate hash loader has its own suite. Already-imported
            # production modules here retain real authorization/registration IO.
            stack.enter_context(patch.object(bootstrap, '_verify_release', return_value={}))
            stack.enter_context(patch.object(bootstrap, '_load_modules', return_value={
                'installation': installation, 'launch_listener': launch_listener}))
            s.path_entry = path
            yield s

    def test_root_mode_consumes_once_then_preserves_failure_without_application_launch(self):
        with self.system() as s:
            with self.assertRaises(ValueError): bootstrap.main()
            self.assertIn(s.fs.consumed, s.fs.data,
                'root entry did not reach the original durable authorization consumer')
            self.assertEqual(s.closed.count(42), 1,
                'the actual registration pin must close when runtime initialization fails')
            self.assertEqual(s.owned, set())
            self.assertNotIn(s.path, s.fs.fs.paths)
            self.assertEqual(s.fs.fs.opened, {})
            # Retrying this same fixed entry must not reopen consumed permission.
            with self.assertRaises(ValueError): bootstrap.main()
            self.assertEqual(s.events.count('bind'), 1)

    def test_missing_authorization_cannot_bind_or_initialize_runtime(self):
        with self.system() as s:
            del s.fs.fs.paths[s.fs.authorization]
            with self.assertRaises(ValueError): bootstrap.main()
            self.assertEqual(s.events, [])
            self.assertEqual(s.owned, set())
            self.assertEqual(s.fs.fs.opened, {})

    def test_no_application_input_is_consumed_by_root_mode(self):
        with self.system() as s:
            input_reads = []
            with patch.object(bootstrap, '_consume_input', side_effect=lambda *_: input_reads.append(True)):
                with self.assertRaises(ValueError): bootstrap.main()
            self.assertEqual(input_reads, [])
            self.assertIn(s.fs.consumed, s.fs.data)


if __name__ == '__main__': unittest.main()
