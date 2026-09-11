"""Synthetic durable filesystem; no host authorization or identity changes."""

import contextlib
import json
import os
import pickle
import stat
import unittest
from types import SimpleNamespace
from unittest.mock import patch

import test_installation

try:
    import launch_authorization
except ModuleNotFoundError as error:
    if error.name != 'launch_authorization':
        raise
    launch_authorization = None


class AuthorizationTests(unittest.TestCase):
    @contextlib.contextmanager
    def system(self):
        self.assertIsNotNone(launch_authorization, 'durable launch authorization missing')
        with contextlib.ExitStack() as stack:
            fs = stack.enter_context(test_installation.InstallationTests().system())
            authorization = '/etc/holaday-pool-broker/launch-authorization.json'
            consumed = '/var/lib/holaday-pool-broker/launch-consumed.json'
            values = {'version': 1, 'candidate': 'a' * 40, 'epoch': 'c' * 32,
                      'not_before_ms': 100000, 'expires_at_ms': 130000}
            data = {authorization: json.dumps(values).encode()}
            events, synced = [], set()
            clock = [110.0, 50.0]
            def add(path):
                fs.paths[path] = SimpleNamespace(st_uid=0, st_gid=0, st_mode=stat.S_IFREG | 0o600,
                    st_nlink=1, st_size=len(data.get(path, b'')), attrs=[])
            add(authorization)
            old_open, old_close = fs.mocks['open'].side_effect, fs.mocks['close'].side_effect
            def open_file(path, flags, mode=0o777, *, dir_fd=None):
                target = path if dir_fd is None else fs.opened[dir_fd].rstrip('/') + '/' + path
                if flags & os.O_CREAT:
                    assert target == consumed and flags & os.O_EXCL and flags & os.O_NOFOLLOW
                    assert mode == 0o600
                    if target in fs.paths:
                        raise FileExistsError('synthetic spent transaction')
                    data[target] = b''
                    add(target)
                    events.append('created')
                return old_open(path, flags, dir_fd=dir_fd)
            def write(fd, raw):
                path = fs.opened[fd]
                assert path == consumed
                n = min(7, len(raw))
                data[path] += raw[:n]
                fs.paths[path].st_size = len(data[path])
                events.append('write')
                return n
            def sync(fd):
                path = fs.opened[fd]
                synced.add(path)
                events.append(('fsync', path))
            fs.mocks['open'].side_effect = open_file
            mocks = {}
            for name, fn in [('pread', lambda fd, n, off: data[fs.opened[fd]][off:off+n]),
                             ('write', write), ('fsync', sync), ('getresuid', lambda: (0, 0, 0)),
                             ('getresgid', lambda: (0, 0, 0)), ('listdir', lambda p: ['123'])]:
                mocks[name] = stack.enter_context(patch.object(os, name, side_effect=fn, create=True))
            stack.enter_context(patch.object(os, 'environ', {'PATH': '/usr/bin:/bin', 'LANG': 'C.UTF-8'}))
            stack.enter_context(patch.object(launch_authorization.time, 'time', side_effect=lambda: clock[0]))
            stack.enter_context(patch.object(launch_authorization.time, 'monotonic', side_effect=lambda: clock[1]))
            yield SimpleNamespace(fs=fs, data=data, events=events, synced=synced, clock=clock, mocks=mocks,
                                  authorization=authorization, consumed=consumed, values=values, close=old_close)

    def test_consumes_authorization_durably_before_returning_window(self):
        with self.system() as s:
            window = launch_authorization.consume_launch_authorization('a' * 40)
            self.assertEqual(window.remaining(), 20.0)
            self.assertEqual(json.loads(s.data[s.consumed]),
                {'version': 1, 'candidate': 'a' * 40, 'epoch': 'c' * 32})
            self.assertEqual(s.synced, {s.consumed, '/var/lib/holaday-pool-broker'})
            self.assertEqual(s.fs.opened, {})
            with self.assertRaises(ValueError):
                launch_authorization.consume_launch_authorization('a' * 40)
            self.assertEqual(s.fs.opened, {})

    def rejected(self, candidate='a' * 40):
        with self.assertRaises(ValueError) as caught:
            launch_authorization.consume_launch_authorization(candidate)
        self.assertEqual(str(caught.exception), 'POOL_BROKER_LAUNCH_AUTHORIZATION_UNPROVEN')
        self.assertIsNone(caught.exception.__context__)
        self.assertIsNone(caught.exception.__cause__)

    def test_bad_schema_candidate_and_time_never_create_consumption(self):
        changes = [('version', True), ('version', 2), ('candidate', 'b' * 40),
                   ('epoch', '0' * 32), ('epoch', 'C' * 32), ('epoch', 123),
                   ('not_before_ms', True), ('not_before_ms', 111000),
                   ('expires_at_ms', 110000), ('expires_at_ms', 160001), ('extra', 'field')]
        for field, value in changes:
            with self.subTest(field=field, value=value), self.system() as s:
                s.values[field] = value
                s.data[s.authorization] = json.dumps(s.values).encode()
                s.fs.paths[s.authorization].st_size = len(s.data[s.authorization])
                self.rejected()
                self.assertNotIn(s.consumed, s.data)
                self.assertEqual(s.fs.opened, {})
        for raw in (b'', b'x' * 1025, b'{"version":1,"version":1}', b'[]', b'null', b'\xff'):
            with self.subTest(size=len(raw)), self.system() as s:
                s.data[s.authorization] = raw
                s.fs.paths[s.authorization].st_size = len(raw)
                self.rejected()
                self.assertNotIn(s.consumed, s.data)

    def test_root_context_and_file_metadata_are_mandatory(self):
        for field, value in [('st_uid', 998), ('st_gid', 998), ('st_nlink', 2),
                             ('st_mode', stat.S_IFREG | 0o644), ('st_mode', stat.S_IFLNK | 0o600),
                             ('attrs', ['security.capability']), ('attrs', ['system.posix_acl_access']),
                             ('attrs', ['system.posix_acl_default'])]:
            with self.subTest(field=field), self.system() as s:
                setattr(s.fs.paths[s.authorization], field, value)
                self.rejected()
                self.assertNotIn(s.consumed, s.data)
        with self.system() as s:
            s.mocks['getresuid'].side_effect = lambda: (0, 998, 0)
            self.rejected()
            self.assertEqual(s.fs.calls, [])

    def test_write_fsync_and_close_errors_keep_a_permanent_marker(self):
        for name in ('write', 'fsync', 'close'):
            with self.subTest(name=name), self.system() as s:
                mock = s.fs.mocks['close'] if name == 'close' else s.mocks[name]
                original = mock.side_effect
                def fail(*args):
                    if name == 'close':
                        original(*args)
                    raise OSError('synthetic storage failure')
                mock.side_effect = fail
                self.rejected()
                self.assertIn(s.consumed, s.fs.paths)
                self.assertEqual(s.fs.opened, {})
                mock.side_effect = original
                self.rejected()
                self.assertEqual(s.events.count('created'), 1)

    def test_new_epoch_cannot_bypass_an_existing_consumed_marker(self):
        with self.system() as s:
            launch_authorization.consume_launch_authorization('a' * 40)
            s.values['epoch'] = 'd' * 32
            s.data[s.authorization] = json.dumps(s.values).encode()
            s.fs.paths[s.authorization].st_size = len(s.data[s.authorization])
            self.rejected()
            self.assertEqual(json.loads(s.data[s.consumed])['epoch'], 'c' * 32)

    def test_window_cannot_revive_after_expiry_or_either_clock_rollback(self):
        for wall, mono in ((130.0, 50.0), (110.0, 70.0), (109.0, 50.0), (110.0, 49.0),
                           (float('nan'), 50.0), (110.0, float('inf'))):
            with self.subTest(wall=wall, mono=mono), self.system() as s:
                window = launch_authorization.consume_launch_authorization('a' * 40)
                s.clock[:] = [wall, mono]
                with self.assertRaises(ValueError):
                    window.remaining()
                s.clock[:] = [110.0, 50.0]
                with self.assertRaises(ValueError):
                    window.remaining()

    def test_expiry_during_final_cleanup_never_returns_a_window(self):
        with self.system() as s:
            def late(fd):
                s.close(fd)
                s.clock[0] = 130.0
            s.fs.mocks['close'].side_effect = late
            self.rejected()
            self.assertIn(s.consumed, s.data)
            self.assertEqual(s.fs.opened, {})

    def test_window_has_no_public_constructor_or_serializable_grant(self):
        with self.system():
            with self.assertRaises(TypeError):
                launch_authorization.LaunchWindow()
            window = launch_authorization.consume_launch_authorization('a' * 40)
            with self.assertRaises(TypeError):
                pickle.dumps(window)


if __name__ == '__main__':
    unittest.main()
