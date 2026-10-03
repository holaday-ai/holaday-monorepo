"""Actual credential/FD lifetime with original HPB1 guard; Linux mount/O_PATH seams."""
import contextlib
import json
import stat
import unittest
from unittest.mock import patch
import test_quartet_bridge_receiver as fixture

guard, NATIVE = fixture.guard, fixture.NATIVE


class EgressSourceTests(unittest.TestCase):
    @contextlib.contextmanager
    def system(self, listening=False, authority=False):
        with fixture.BridgeReceiverTests().system(listening=listening) as s, contextlib.ExitStack() as stack:
            s.worker._receive_bridge()
            path = s.credential.rsplit('/', 1)[0] + '/egress'
            credential = s.root / path[1:]
            leaf = s.root / 'run/holaday-egress.sock'
            leaf.write_bytes(b'Linux O_PATH socket inode stand-in')
            binding = {'version': 1, 'candidate': s.binding['candidate'], 'resource': s.binding['resource'],
                'boot': s.binding['application']['boot'], 'key': 'f' * 64,
                'leaf': {'device': leaf.stat().st_dev, 'inode': leaf.stat().st_ino}}
            credential.write_bytes(json.dumps(binding).encode())
            s.metadata[path] = {'st_mode': stat.S_IFREG | 0o400, 'st_uid': 2001, 'st_gid': 0}
            s.metadata['/run/holaday-egress.sock'] = {'st_mode': stat.S_IFSOCK | 0o666,
                'st_uid': 998, 'st_gid': s.binding['application']['gid']}
            if authority:
                auth_path = path.rsplit('/', 1)[0] + '/xauthority'
                s.authority_file = s.root / auth_path[1:]
                s.authority_file.write_bytes(b'\xff\xff\0\0\0\x0299\0\x12MIT-MAGIC-COOKIE-1\0\x10' + b'c' * 16)
                s.metadata[auth_path] = {'st_mode': stat.S_IFREG | 0o400, 'st_uid': 2001, 'st_gid': 0}
            original_open = guard.os.open
            def opened(name, flags, **kw):
                if flags & 0x200000:
                    self.assertEqual(name, 'holaday-egress.sock')
                    self.assertEqual(flags, 0x200000 | NATIVE.O_NOFOLLOW | NATIVE.O_CLOEXEC)
                    flags = NATIVE.O_RDONLY | NATIVE.O_NOFOLLOW | NATIVE.O_CLOEXEC
                return original_open(name, flags, **kw)
            old_attrs = guard.os.listxattr
            def attrs(fd):
                if type(fd) is str and fd.startswith('/proc/self/fd/'):
                    fd = int(fd.rsplit('/', 1)[1])
                return old_attrs(fd)
            stack.enter_context(patch.object(guard.os, 'open', side_effect=opened))
            stack.enter_context(patch.object(guard.os, 'listxattr', side_effect=attrs))
            s.egress_credential, s.egress_leaf, s.egress_binding = credential, leaf, binding
            s.egress_path = path
            source = None
            try:
                cls = getattr(guard, '_EgressSource', None)
                self.assertIsNotNone(cls, 'original anchor egress source missing')
                source = cls.open(s.worker)
                s.egress_source = source
                yield s
            finally:
                if source is not None: source.close()

    def test_retains_exact_credential_and_leaf_then_closes_only_its_original_fds(self):
        with self.system() as s:
            source = s.egress_source
            source._check()
            self.assertEqual(source._data, s.egress_binding)
            self.assertEqual(source._path(), '/proc/self/fd/' + str(source._leaf))
            original = list(source._fds)
            self.assertTrue(original)
            source.close()
            for fd in original:
                with self.assertRaises(OSError): NATIVE.fstat(fd)
            s.worker._check()
            with self.assertRaises(ValueError): guard._EgressSource.open(s.worker)

    def test_mutated_same_inode_credential_or_replaced_leaf_cannot_be_used(self):
        for change in ('bytes', 'leaf', 'readwrite', 'owner', 'scope'):
            with self.subTest(change=change), self.system() as s:
                if change == 'bytes': s.egress_credential.write_bytes(s.egress_credential.read_bytes().replace(b'"version": 1', b'"version": 2'))
                elif change == 'leaf':
                    s.egress_leaf.rename(s.egress_leaf.with_name('retired-egress'))
                    s.egress_leaf.write_bytes(b'replacement')
                elif change == 'readwrite': s.flags['/run/holaday-egress.sock'] = 14
                elif change == 'owner': s.metadata['/run/holaday-egress.sock']['st_uid'] = 2001
                else: s.worker._binding = dict(s.worker._binding)
                with self.assertRaises(ValueError): s.egress_source._check()

    def test_original_application_exit_denies_source_after_capture(self):
        with self.system() as s:
            for fd in s.app_writers: NATIVE.close(fd)
            s.app_writers.clear()
            with self.assertRaises(ValueError): s.egress_source._check()
