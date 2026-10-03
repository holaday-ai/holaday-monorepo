"""Original application liveness: real pipe/FD lifetime, synthetic Linux proc."""

import contextlib
import copy
import json
import os
import unittest
from unittest.mock import patch

import quartet_worker_guard as guard
import test_quartet_worker_guard as fixture


class ApplicationMonitorTests(unittest.TestCase):
    @contextlib.contextmanager
    def system(self, role='anchor'):
        helper = fixture.WorkerGuardTests()
        with helper.system(role) as s, helper.open(role) as worker:
            s.packets = [helper.packet(s, 'challenge'), helper.packet(s, 'grant')]
            yield s, worker

    def test_first_hello_requires_preheld_original_application_reference(self):
        helper = fixture.WorkerGuardTests()
        with helper.system() as s, helper.open() as worker:
            s.packets = [helper.packet(s, 'challenge'), helper.packet(s, 'grant')]
            acquired = []
            def pidfd_open(pid, flags):
                acquired.append((pid, flags))
                raise OSError('synthetic unavailable original application')
            with patch.object(guard.os, 'pidfd_open', pidfd_open, create=True):
                try:
                    worker._await_grant()
                except ValueError:
                    pass
            self.assertEqual(s.sent, [], 'hello was sent without an original application reference')
            self.assertEqual(len(acquired), 1)

    def test_success_holds_one_reference_before_hello_and_never_reopens(self):
        with self.system() as (s, worker):
            worker._await_grant()
            self.assertEqual(len(s.app_fds), 1)
            self.assertFalse(os.get_inheritable(s.app_fds[0]))
            self.assertLess([e[0] for e in s.events].index('application-reference'),
                            [e[0] for e in s.events].index('send'))
            worker._check()
            with self.assertRaises(ValueError):
                worker._await_grant()
            self.assertEqual(len(s.app_fds), 1)
            with self.assertRaises(OSError):
                fixture.NATIVE.fstat(s.app_fds[0])

    def test_dead_or_wrong_namespace_or_proc_view_never_sends_hello(self):
        for mode in ('dead', 'namespace', 'pid-zero', 'pid-negative', 'pid-wrong', 'duplicate',
                     'missing', 'proc-view', 'inheritable', 'deadline'):
            with self.subTest(mode=mode), self.system() as (s, worker):
                if mode == 'namespace': s.namespaces['pid'] = [99, 999]
                if mode.startswith('pid-'):
                    s.app_info = {'pid-zero': b'Pid: 0\n', 'pid-negative': b'Pid: -1\n',
                                  'pid-wrong': b'Pid: 124\n'}[mode]
                if mode == 'duplicate': s.app_info = b'Pid: 123\nPid: 123\n'
                if mode == 'missing': s.app_info = b'flags: 0\n'
                if mode == 'proc-view':
                    (s.root / 'proc/self/status').write_bytes(fixture.STATUS + b'Pid: 0\n')
                def hook(event):
                    if event == 'pidfd_open':
                        if mode == 'dead': os.write(s.app_writers[0], b'x')
                        if mode == 'inheritable': os.set_inheritable(s.app_fds[0], True)
                        if mode == 'deadline': s.now += 6
                s.hook = hook
                with self.assertRaises(ValueError): worker._await_grant()
                self.assertFalse(s.sent)
                self.assertIsNone(worker._binding)

    def test_death_during_grant_and_later_pid_reuse_permanently_closes(self):
        with self.system() as (s, worker):
            helper = fixture.WorkerGuardTests()
            def died():
                os.write(s.app_writers[0], b'x')
                return helper.packet(s, 'grant')
            s.packets[-1] = died
            with self.assertRaises(ValueError): worker._await_grant()
            self.assertIsNone(worker._binding)
            with self.assertRaises(ValueError): worker._await_grant()
            self.assertEqual(len(s.app_fds), 1)

    def test_later_death_or_namespace_change_rejects_original_guard(self):
        for mode in ('death', 'namespace', 'fdinfo'):
            with self.subTest(mode=mode), self.system() as (s, worker):
                worker._await_grant()
                if mode == 'death': os.write(s.app_writers[0], b'x')
                if mode == 'namespace': s.namespaces['pid'] = [99, 999]
                if mode == 'fdinfo': s.app_info = b'Pid: -1\n'
                with self.assertRaises(ValueError): worker._check()
                self.assertIsNone(worker._binding)

    def test_death_in_final_temporary_fd_cleanup_cannot_return_success(self):
        for target in ('/proc/self/ns/pid', '/run/holaday-pool'):
            with self.subTest(target=target), self.system() as (s, worker):
                original_close = guard.os.close
                fired = False
                def close(fd):
                    nonlocal fired
                    path = s.opened.get(fd)
                    original_close(fd)
                    if (not fired and path == target and not s.packets and s.channels
                            and all(c.closed for c in s.channels)):
                        fired = True
                        os.write(s.app_writers[0], b'x')
                with patch.object(guard.os, 'close', close):
                    with self.assertRaises(ValueError): worker._await_grant()
                self.assertTrue(fired, 'test must reach terminal native cleanup')
                self.assertIsNone(worker._binding)

    def test_other_roles_do_not_acquire_application_descriptor(self):
        for role in ('xvfb', 'brave', 'x11vnc', 'websockify'):
            with self.subTest(role=role), self.system(role) as (s, worker):
                worker._await_grant()
                self.assertFalse(s.app_fds)

    def test_application_binding_is_closed_anchor_only_and_never_accepts_foreign_identity(self):
        helper = fixture.WorkerGuardTests()
        with helper.system() as s:
            original = copy.deepcopy(s.binding)
            variants = [None, {}, dict(original['application'], extra=True)]
            variants += [dict(original['application'], **change) for change in (
                {'pid': True}, {'pid': 0}, {'uid': 2001}, {'gid': 2001}, {'gid': True},
                {'boot': '0' * 32}, {'pidNamespace': [99, 0]}, {'pidNamespace': [True, 40]})]
            for variant in variants:
                with self.subTest(variant=variants.index(variant)):
                    s.raw = json.dumps(dict(original, application=variant)).encode()
                    with self.assertRaises(ValueError): helper.open()
                    self.assertEqual(s.socket_created, 0)
        with helper.system('brave') as s:
            s.binding['application'] = original['application']
            with self.assertRaises(ValueError): helper.open('brave')
            self.assertFalse(s.app_fds)


if __name__ == '__main__':
    unittest.main()
