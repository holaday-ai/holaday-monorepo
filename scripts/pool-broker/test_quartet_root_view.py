"""Real file trees and hashes, synthetic root/readonly Linux mount metadata."""

import contextlib
import hashlib
import json
import os
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import resource_journal
import test_resource_journal

try:
    import quartet_root_view as view
except ModuleNotFoundError as error:
    if error.name != 'quartet_root_view':
        raise
    view = None


NATIVE = test_resource_journal.NATIVE


class RootViewTests(unittest.TestCase):
    def test_short_outer_scope_covers_tail_after_journal_releases_its_scope(self):
        with self.system() as s:
            returning, valid, roots = [], [True], []
            original, monotonic = s.journal._run, view.time.monotonic
            def transaction(*args, **kwargs):
                result = original(*args, **kwargs)
                returning.append(True)
                return result
            def clock():
                if returning and not s.journal._busy: valid[0] = False
                return monotonic()
            try:
                with patch.object(s.journal, '_run', side_effect=transaction), patch.object(
                        view, 'time', SimpleNamespace(monotonic=clock)):
                    with self.assertRaises(ValueError):
                        roots.append(view._RootView.open(s.journal, scope_guard=lambda: .1 if valid[0] else 0))
            finally:
                for root in roots: root.close()
            self.assertTrue(returning)
            self.assertFalse(valid[0])
            self.assertEqual(s.extra_fds, {})

    @contextlib.contextmanager
    def system(self):
        self.assertIsNotNone(view, 'fixed original root view missing')
        with test_resource_journal.JournalTests().system() as s, contextlib.ExitStack() as stack:
            journal = resource_journal.ResourceJournal.open(s.registration)
            s.journal = journal
            s.root = s.path.parents[3]
            base = '/usr/local/lib/holaday-pool-broker/releases/' + 'a' * 40 + '/rootfs'
            tree = s.root / base[1:]
            tree.mkdir(parents=True)
            directories = ('/', '/usr', '/usr/bin', '/usr/lib', '/dev', '/proc', '/sys', '/run', '/tmp', '/profile')
            files = ('/usr/bin/python3', '/usr/bin/Xvfb', '/usr/bin/brave-browser', '/usr/bin/x11vnc',
                     '/usr/bin/websockify', '/quartet_worker_guard.py')
            nodes = []
            for path in directories:
                target = tree / path[1:]
                target.mkdir(exist_ok=True)
                nodes.append({'path': path, 'kind': 'directory', 'mode': 0o555})
            for path in files:
                target = tree / path[1:]
                raw = ('synthetic file ' + path).encode()
                target.write_bytes(raw)
                target.chmod(0o555 if path.startswith('/usr/bin/') else 0o444)
                nodes.append({'path': path, 'kind': 'file', 'mode': target.stat().st_mode & 0o777,
                              'size': len(raw), 'sha256': hashlib.sha256(raw).hexdigest()})
            for path in reversed(directories):
                (tree / path[1:]).chmod(0o555)
            s.policy = {'version': 1, 'status': 'linux-verified', 'candidate': 'a' * 40, 'nodes': nodes}
            s.tree, s.base, s.extra_fds, s.flags, s.hook = tree, base, {}, {}, lambda _event: None
            proxy = SimpleNamespace(**vars(NATIVE))
            def opened(path, flags, **kw):
                target = str(s.root) if path == '/' else path
                fd = NATIVE.open(target, flags, **kw)
                s.extra_fds[fd] = target
                s.hook('open')
                return fd
            def info(fd):
                actual = NATIVE.fstat(fd)
                data = {name: getattr(actual, name) for name in dir(actual) if name.startswith('st_')}
                data.update(st_uid=0, st_gid=0)
                return SimpleNamespace(**data)
            def close(fd):
                self.assertIn(fd, s.extra_fds)
                s.extra_fds.pop(fd)
                NATIVE.close(fd)
                s.hook('close')
            proxy.open, proxy.fstat, proxy.close = opened, info, close
            proxy.listxattr = lambda fd: []
            proxy.fstatvfs = lambda fd: SimpleNamespace(f_flag=s.flags.get(NATIVE.fstat(fd).st_ino, 1))
            proxy.getresuid, proxy.getresgid = lambda: (0, 0, 0), lambda: (0, 0, 0)
            stack.enter_context(patch.object(view, 'os', proxy))
            stack.enter_context(patch.object(view, '_POLICY', json.dumps(s.policy).encode(), create=True))
            try:
                yield s
            finally:
                journal.close()
                self.assertEqual(s.extra_fds, {})
                # The fixture, not production, owns removal of its temp tree.
                for directory in reversed(directories):
                    path = tree / directory[1:]
                    if path.is_dir():
                        path.chmod(0o755)

    def deny(self, call):
        with self.assertRaises(ValueError) as caught:
            call()
        self.assertEqual(str(caught.exception), 'POOL_BROKER_ROOT_VIEW_UNPROVEN')
        self.assertIsNone(caught.exception.__context__)

    def test_holds_only_original_ancestor_and_root_fds_and_hashes_complete_tree(self):
        with self.system() as s:
            before = s.journal._expected
            with view._RootView.open(s.journal) as root:
                self.assertIsNone(root._check())
                self.assertLess(len(s.extra_fds), len(s.policy['nodes']))
                self.assertFalse(hasattr(root, 'ready'))
                self.assertNotIn(s.base, repr(root))
            self.assertEqual(s.journal._expected, before)

    def test_unverified_missing_candidate_and_extra_policy_fields_fail_closed(self):
        with self.system() as s:
            for raw in (None, b'', b'{}', b' ' * 1048577,
                        json.dumps(s.policy | {'status': 'unverified'}).encode(),
                        json.dumps(s.policy | {'candidate': 'b' * 40}).encode(),
                        json.dumps(s.policy | {'root': '/'}).encode(),
                        json.dumps(s.policy | {'version': True}).encode()):
                with patch.object(view, '_POLICY', raw):
                    self.deny(lambda: view._RootView.open(s.journal))

    def test_complete_tree_rejects_extra_missing_symlink_writable_or_wrong_hash(self):
        for mode in ('extra', 'missing', 'symlink', 'writable', 'hash'):
            with self.system() as s:
                target = s.tree / 'usr/bin/Xvfb'
                target.parent.chmod(0o755)
                if mode == 'extra':
                    (target.parent / 'unexpected').write_bytes(b'not listed')
                elif mode == 'missing':
                    target.unlink()
                elif mode == 'symlink':
                    target.unlink()
                    target.symlink_to('python3')
                elif mode == 'writable':
                    target.chmod(0o755)
                else:
                    target.chmod(0o755)
                    target.write_bytes(b'x' * target.stat().st_size)
                    target.chmod(0o555)
                target.parent.chmod(0o555)
                self.deny(lambda: view._RootView.open(s.journal))

    def test_identity_configuration_and_non_closed_node_schema_never_read(self):
        with self.system() as s:
            for node in ({'path': '/etc/passwd', 'kind': 'file', 'mode': 0o444, 'size': 1, 'sha256': 'a' * 64},
                         {'path': '/../root', 'kind': 'directory', 'mode': 0o555},
                         {'path': '/usr/bin/shell', 'kind': 'symlink', 'target': '/bin/sh'},
                         {'path': '/usr/bin/shell', 'kind': 'file', 'mode': 0o4555, 'size': 1, 'sha256': 'a' * 64}):
                policy = s.policy | {'nodes': s.policy['nodes'] + [node]}
                with patch.object(view, '_POLICY', json.dumps(policy).encode()):
                    self.deny(lambda: view._RootView.open(s.journal))

    def test_readonly_mount_and_original_path_metadata_are_not_cached_authority(self):
        for mode in ('mount', 'replace', 'content', 'close'):
            with self.system() as s:
                root = view._RootView.open(s.journal)
                try:
                    if mode == 'mount':
                        s.flags[s.tree.stat().st_ino] = 0
                    elif mode == 'replace':
                        s.tree.chmod(0o755)
                        s.tree.rename(s.tree.with_name('retired-rootfs'))
                        s.tree.with_name('retired-rootfs').chmod(0o555)
                        s.tree.mkdir()
                    elif mode == 'content':
                        target = s.tree / 'usr/bin/python3'
                        target.chmod(0o755)
                        target.write_bytes(b'x' * target.stat().st_size)
                        target.chmod(0o555)
                    else:
                        root.close()
                    self.deny(root._check)
                finally:
                    root.close()

    def test_original_journal_revocation_during_native_open_cannot_return_view(self):
        with self.system() as s:
            s.hook = lambda event: s.journal.close() if event == 'open' else None
            self.deny(lambda: view._RootView.open(s.journal))


if __name__ == '__main__':
    unittest.main()
