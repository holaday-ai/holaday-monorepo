"""Original root/anchor time-namespace descriptors; Linux ioctl is a seam."""
import contextlib
import unittest
from types import SimpleNamespace
from unittest.mock import patch
import test_quartet_worker_channel as fixture
import quartet_worker_view
import manager_probe

try:
    import quartet_probe_clock as clock
except ModuleNotFoundError as error:
    if error.name != 'quartet_probe_clock': raise
    clock = None


class ProbeClockTests(unittest.TestCase):
    @contextlib.contextmanager
    def system(self, different=False, base=None, accept_anchor=True):
        self.assertIsNotNone(clock, 'original same-clock domain gate missing')
        with (fixture.WorkerChannelTests().system() if base is None else base()) as s, contextlib.ExitStack() as stack:
            if accept_anchor and not s.material._workers: s.material.accept_role('anchor')
            native = fixture.test_quartet_worker_view.NATIVE
            root = s.root / ('proc/' + str(native.getpid()))
            (root / 'ns').mkdir(parents=True)
            (root / 'ns/time').write_bytes(b'synthetic root time namespace')
            (s.proc / 'ns/time').write_bytes(b'synthetic anchor time namespace')
            original_time_inode = (s.proc / 'ns/time').stat().st_ino
            original = quartet_worker_view.os
            s.time_different, s.time_hook, s.time_capture = different, lambda: None, []
            proxy = SimpleNamespace(**vars(original))
            def info(fd):
                if s.fds.get(fd) == 'ns/time':
                    actual = native.fstat(fd)
                    fields = {key: getattr(actual, key) for key in dir(actual) if key.startswith('st_')}
                    root_ino = (root / 'ns/time').stat().st_ino
                    fields.update(st_dev=4, st_ino=5 if actual.st_ino == root_ino or
                        actual.st_ino == original_time_inode and not s.time_different else 6)
                    s.time_hook()
                    return SimpleNamespace(**fields)
                return original.fstat(fd)
            proxy.fstat = info
            old_ioctl = quartet_worker_view.fcntl.ioctl
            def ioctl(fd, request):
                if s.fds.get(fd) == 'ns/time':
                    self.assertEqual(request, 0xb703)
                    return 0x80
                return old_ioctl(fd, request)
            stack.enter_context(patch.object(clock, 'os', proxy))
            stack.enter_context(patch.object(clock.fcntl, 'ioctl', ioctl))
            s.clock_module = clock
            try: yield s
            finally: s.material.close()

    def acquire(self, s):
        s.material._run(lambda: clock._ProtocolClock._open_locked(s.material))
        return s.material._probe_clock

    def test_original_namespace_handles_survive_and_are_rechecked_without_new_pid_pin(self):
        with self.system() as s:
            owned = self.acquire(s)
            self.assertEqual(owned._identity, (4, 5))
            s.material._run(owned._check_locked)
            self.assertEqual(s.pin_events, ['pidfd_open'])
            fds = list(owned._fds)
            s.material.close()
            for fd in fds:
                with self.assertRaises(OSError): fixture.test_quartet_worker_view.NATIVE.fstat(fd)

    def test_different_or_changed_time_namespace_denies(self):
        with self.system(different=True) as s:
            with self.assertRaises(ValueError): self.acquire(s)
        with self.system() as s:
            owned = self.acquire(s)
            s.time_different = True
            with self.assertRaises(ValueError): s.material._run(owned._check_locked)

    def test_namespace_final_native_expiry_cannot_return_a_clock_proof(self):
        with self.system() as s:
            owned = self.acquire(s)
            def late(): s.material._deadline = -1
            s.time_hook = late
            with self.assertRaises(ValueError): s.material._run(owned._check_locked)
            self.assertTrue(s.material._retired)

    def test_manager_deadline_during_namespace_read_blocks_the_next_native_open(self):
        with self.system() as s:
            owned = self.acquire(s)
            after, triggered = [], []
            original = clock.os.open
            def opened(*args, **kw):
                if triggered: after.append(args[0])
                return original(*args, **kw)
            def late():
                triggered.append(True)
                s.manager._deadline = -1
            s.time_hook = late
            with patch.object(clock.os, 'open', side_effect=opened):
                with self.assertRaises(ValueError): s.material._run(owned._check_locked)
            self.assertTrue(triggered)
            self.assertEqual(after, [])

    def test_final_pin_observation_namespace_replacement_cannot_return_old_proof(self):
        with self.system() as s:
            owned = self.acquire(s)
            observed, replaced = [], []
            s.time_hook = lambda: observed.append(True)
            def changed(event):
                if observed and not replaced and event == 'open:status':
                    path = s.proc / 'ns/time'
                    path.rename(path.with_name('old-time'))
                    path.write_bytes(b'new synthetic namespace inode')
                    replaced.append(True)
            s.view_hook = changed
            with self.assertRaises(ValueError): s.material._run(owned._check_locked)
            self.assertEqual(replaced, [True])

    def test_short_outer_scope_reaches_original_manager_capture(self):
        with self.system() as s:
            owned = self.acquire(s)
            original, budgets = manager_probe._capture.side_effect, []
            def capture(argv, fd, deadline, scope):
                budgets.append(scope())
                return original(argv, fd, deadline, scope)
            with patch.object(manager_probe, '_capture', side_effect=capture):
                s.material._run(lambda: owned._check_locked(scope_guard=lambda: .2))
            self.assertTrue(budgets)
            self.assertTrue(all(0 < value <= .2 for value in budgets))


if __name__ == '__main__': unittest.main()
