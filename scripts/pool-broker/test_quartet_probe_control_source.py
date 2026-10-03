"""HPT1 metadata endpoint preserves the original search-only directory and leaf."""
import contextlib
import stat
import unittest
from unittest.mock import patch
import test_quartet_egress_source as fixture

guard, NATIVE = fixture.guard, fixture.NATIVE


class ProbeControlSourceTests(unittest.TestCase):
    @contextlib.contextmanager
    def system(self, authority=False, base=None):
        context = fixture.EgressSourceTests().system(authority=authority) if base is None else base()
        with context as s, contextlib.ExitStack() as stack:
            s.metadata['/run/holaday-pool'] = {'st_mode': stat.S_IFDIR | 0o710, 'st_uid': 0, 'st_gid': 2001}
            original_open = guard.os.open
            s.control_opens = []
            def opened(name, flags, **kw):
                if name in ('holaday-pool', 'control.sock'):
                    s.control_opens.append((name, flags))
                    self.assertTrue(flags & 0x200000)
                    flags &= ~0x200000
                return original_open(name, flags, **kw)
            stack.enter_context(patch.object(guard.os, 'open', side_effect=opened))
            cls = getattr(guard, '_ProbeControlSource', None)
            self.assertIsNotNone(cls, 'original metadata control source missing')
            s.control_deadline = s.now + 5
            def budget():
                if s.now >= s.control_deadline: raise ValueError('synthetic deadline')
            source = cls.open(s.egress_source, budget)
            s.control_source = source
            try: yield s
            finally: source.close()

    def test_original_path_handles_and_cleanup_leave_shared_source_alive(self):
        with self.system() as s:
            self.assertEqual([name for name, _ in s.control_opens], ['holaday-pool', 'control.sock'])
            self.assertEqual(s.control_source.path(), '/proc/self/fd/' + str(s.control_source._leaf[0]))
            fds = list(s.control_source._fds)
            s.control_source.close()
            for fd in fds:
                with self.assertRaises(OSError): NATIVE.fstat(fd)
            s.egress_source._check()

    def test_replaced_leaf_weak_directory_mount_or_original_source_denies(self):
        for mode in ('leaf', 'directory', 'mount', 'source'):
            with self.subTest(mode=mode), self.system() as s:
                if mode == 'leaf':
                    leaf = s.root / 'run/holaday-pool/control.sock'
                    leaf.rename(leaf.with_name('retired'))
                    leaf.write_bytes(b'replacement')
                elif mode == 'directory': s.metadata['/run/holaday-pool']['st_mode'] = stat.S_IFDIR | 0o770
                elif mode == 'mount': s.flags['/run/holaday-pool'] = 14
                else: s.egress_source.close()
                with self.assertRaises(ValueError): s.control_source.path()

    def test_source_final_native_check_crosses_deadline_before_next_io(self):
        with self.system() as s:
            original = guard.os.get_inheritable
            fired = False
            def inheritable(fd):
                nonlocal fired
                result = original(fd)
                if not fired and fd == s.egress_source._leaf:
                    fired = True
                    s.now = s.control_deadline
                return result
            with patch.object(guard.os, 'get_inheritable', side_effect=inheritable), \
                    patch.object(guard.os, 'open', wraps=guard.os.open) as opened:
                with self.assertRaises(ValueError):
                    s.control_source._open('control.sock', 0x200000 | NATIVE.O_NOFOLLOW | NATIVE.O_CLOEXEC, s.control_source._directory[0])
                self.assertTrue(fired)
                self.assertFalse(any(call.args[0] == 'control.sock' for call in opened.call_args_list))
            with self.assertRaises(ValueError): s.control_source.path()


if __name__ == '__main__': unittest.main()
