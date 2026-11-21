"""Original cgroup/event FD ownership; cgroup2 kernel type is an explicit Mac seam."""
import unittest
from unittest.mock import patch

import quartet_worker_pin as module
import test_quartet_worker_pin as fixture


class CgroupPinTests(unittest.TestCase):
    def test_success_dictionary_cannot_replace_an_original_job_receipt(self):
        with fixture.WorkerPinTests().system() as s:
            pin = fixture.WorkerPinTests().open(s)
            with self.assertRaises(ValueError):
                pin._run(lambda: pin._cgroup._observe_terminal({'groupExitProven': True}), None)
            self.assertTrue(pin._retired)
            self.assertEqual(s.worker_fds, {})

    def test_worker_owns_original_cgroup_and_events_before_return_and_never_reopens_them(self):
        self.assertTrue(hasattr(module, '_CgroupPin'), 'original cgroup/events references missing')
        with fixture.WorkerPinTests().system() as s:
            with fixture.WorkerPinTests().open(s) as pin:
                group = pin._cgroup
                self.assertIs(group._owner, pin)
                original = tuple(group._fds)
                self.assertGreaterEqual(len(original), 8)
                self.assertIn(group._events, original)
                with patch.object(module.os, 'open', wraps=module.os.open) as opened:
                    pin.check_sender(s.peer)
                self.assertEqual(tuple(group._fds), original)
                self.assertFalse(any(call.args[0] == 'cgroup.events' for call in opened.call_args_list))
                self.assertFalse(group._retired)
            self.assertTrue(group._retired)
            self.assertEqual(group._fds, [])

    def test_replacement_events_or_directory_is_rejected_without_rebinding(self):
        self.assertTrue(hasattr(module, '_CgroupPin'))
        for mode in ('directory', 'events', 'empty', 'duplicate', 'type'):
            with self.subTest(mode=mode), fixture.WorkerPinTests().system() as s:
                pin = fixture.WorkerPinTests().open(s)
                held = pin._cgroup
                path = s.root / ('sys/fs/cgroup' + s.cgroup)
                if mode == 'directory':
                    path.rename(path.with_name(path.name + '-old'))
                    path.mkdir()
                elif mode == 'events':
                    (path / 'cgroup.events').rename(path / 'old.events')
                    (path / 'cgroup.events').write_bytes(b'populated 1\nfrozen 0\n')
                elif mode == 'empty': (path / 'cgroup.events').write_bytes(b'populated 0\nfrozen 0\n')
                elif mode == 'duplicate': (path / 'cgroup.events').write_bytes(b'populated 1\npopulated 1\n')
                elif mode == 'type': s.cgroup_fs_type = 0x1021994
                with self.assertRaises(ValueError): pin.check_sender(s.peer)
                self.assertTrue(pin._retired)
                self.assertTrue(held._retired)
                self.assertEqual(s.worker_fds, {})

    def test_revocation_during_acquisition_closes_even_the_newly_returned_fd(self):
        self.assertTrue(hasattr(module, '_CgroupPin'))
        with fixture.WorkerPinTests().system() as s:
            original = module.os.open
            seen = []
            def opened(path, *args, **kwargs):
                fd = original(path, *args, **kwargs)
                if path == 'cgroup.events':
                    seen.append(fd)
                    s.registration.close()
                return fd
            with patch.object(module.os, 'open', side_effect=opened):
                with self.assertRaises(ValueError): fixture.WorkerPinTests().open(s)
            self.assertEqual(len(seen), 1)
            self.assertEqual(s.worker_fds, {})
            with self.assertRaises(OSError): fixture.NATIVE.fstat(seen[0])


if __name__ == '__main__': unittest.main()
