"""Synthetic sealed-file kernel; never read real environment or change host IDs."""

import json
import stat
import unittest
from contextlib import ExitStack
from types import SimpleNamespace
from unittest.mock import patch

import application_guard as guard


class CapsuleKernel:
    def __init__(self, stack):
        self.data = b''
        self.seals = 0
        self.mode = stat.S_IFREG | 0o777
        self.uid = self.gid = self.links = 0
        self.fds = set()
        self.events = []
        self.write_limit = 4096
        self.mocks = {}
        for name, value in {'F_ADD_SEALS': 1033, 'F_GET_SEALS': 1034,
                            'F_SEAL_SEAL': 1, 'F_SEAL_SHRINK': 2,
                            'F_SEAL_GROW': 4, 'F_SEAL_WRITE': 8}.items():
            stack.enter_context(patch.object(guard.fcntl, name, value, create=True))
        for name, value in {'MFD_CLOEXEC': 1, 'MFD_ALLOW_SEALING': 2}.items():
            stack.enter_context(patch.object(guard.os, name, value, create=True))
        for name, fn in [('memfd_create', self.create), ('fchmod', self.chmod),
                         ('write', self.write), ('fstat', self.status),
                         ('pread', self.read), ('close', self.close),
                         ('set_inheritable', self.inheritable)]:
            self.mocks[name] = stack.enter_context(patch.object(guard.os, name, side_effect=fn, create=True))
        self.mocks['fcntl'] = stack.enter_context(patch.object(guard.fcntl, 'fcntl', side_effect=self.control))

    def create(self, name, flags):
        assert (name, flags) == ('holaday-application-env', 3)
        assert not self.fds
        self.fds.add(42)
        self.events.append('create')
        return 42

    def chmod(self, fd, mode):
        assert fd in self.fds
        self.mode = stat.S_IFREG | mode

    def write(self, fd, data):
        assert fd in self.fds and not self.seals
        n = min(len(data), self.write_limit)
        self.data += data[:n]
        return n

    def control(self, fd, command, arg=0):
        assert fd in self.fds
        if command == 1033:
            self.seals |= arg
            self.events.append('seal')
            return 0
        assert command == 1034
        return self.seals

    def status(self, fd):
        assert fd in self.fds
        return SimpleNamespace(st_uid=self.uid, st_gid=self.gid, st_mode=self.mode,
                               st_nlink=self.links, st_size=len(self.data))

    def read(self, fd, size, offset):
        assert fd == 3 and fd in self.fds and offset == 0
        self.events.append('read')
        return self.data[:size]

    def inheritable(self, fd, value):
        assert fd == 3 and fd in self.fds and value is False
        self.events.append('cloexec')

    def close(self, fd):
        assert fd in self.fds
        self.fds.remove(fd)
        self.events.append(('close', fd))

    def inherit(self):
        assert self.fds == {42}
        self.fds = {3}

    def load(self, values=None):
        # Kernel fixture for guard tests; producer tests exercise actual encoding.
        self.data = json.dumps(['HPE1', 'a' * 40, 'b' * 32, list((values or {
            'NODE_ENV': 'production', 'SYNTHETIC_SETTING': 'kept', 'EMPTY_SETTING': ''
        }).items())]).encode()
        self.mode = stat.S_IFREG | 0o600
        self.seals = 15
        self.fds = {3}


class EnvironmentTests(unittest.TestCase):
    def setUp(self):
        self.assertTrue(callable(getattr(guard, 'seal_application_environment', None)),
                        'environment handoff missing')
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.stack.enter_context(patch.object(guard.sys, 'platform', 'linux'))
        self.stack.enter_context(patch.object(guard.os, 'getresuid', return_value=(0, 0, 0), create=True))
        self.stack.enter_context(patch.object(guard.os, 'getresgid', return_value=(0, 0, 0), create=True))
        self.kernel = CapsuleKernel(self.stack)

    def test_sealed_producer_preserves_exact_values_and_keeps_fd_private(self):
        values = {'NODE_ENV': 'production', 'EMPTY': '', 'SYNTHETIC': '中文\nvalue',
                  'PM2_HOME': '/synthetic/private'}
        fd = guard.seal_application_environment('a' * 40, 'b' * 32, values)
        self.assertEqual(fd, 42)
        self.assertEqual(self.kernel.seals, 15)
        self.assertEqual(self.kernel.mode, stat.S_IFREG | 0o600)
        self.assertEqual(json.loads(self.kernel.data), ['HPE1', 'a' * 40, 'b' * 32,
                         [['NODE_ENV', 'production'], ['EMPTY', ''], ['SYNTHETIC', '中文\nvalue']]])
        self.assertEqual(self.kernel.fds, {42})
        self.assertNotIn('cloexec', self.kernel.events)
        self.assertEqual(values['PM2_HOME'], '/synthetic/private')

    def produce(self, values=None, candidate='a' * 40, boot='b' * 32):
        return guard.seal_application_environment(candidate, boot,
            {'NODE_ENV': 'production'} if values is None else values)

    def reject(self, fn):
        with self.assertRaises(ValueError) as caught:
            fn()
        self.assertEqual(str(caught.exception), 'POOL_BROKER_APPLICATION_UNPROVEN')
        self.assertIsNone(caught.exception.__context__)
        self.assertIsNone(caught.exception.__cause__)

    def test_producer_rejects_identity_and_invalid_binding_before_allocating(self):
        for target, result in [('sys.platform', 'darwin'), ('os.getresuid', (0, 998, 0)),
                               ('os.getresgid', (0, 0, 998))]:
            kwargs = {'return_value': result} if target.startswith('os.') else {}
            args = () if kwargs else (result,)
            with self.subTest(target=target), patch('application_guard.' + target, *args, **kwargs):
                self.reject(self.produce)
        for candidate, boot in [('0' * 40, 'b' * 32), ('A' * 40, 'b' * 32),
                                ('a' * 40, '0' * 32), ('a' * 40, 'b'), (None, 'b' * 32)]:
            with self.subTest(candidate=candidate):
                self.reject(lambda: self.produce(candidate=candidate, boot=boot))
        self.assertEqual(self.kernel.events, [])

    def test_bad_environment_and_byte_budgets_rejected_before_allocating(self):
        cases = [{}, [], {'NODE_ENV': 'development'}, {'NODE_ENV': 'production', 'BAD=KEY': 'x'},
                 {'NODE_ENV': 'production', 'A': 'x\x00y'}, {'NODE_ENV': 'production', 'A': 2},
                 {'NODE_ENV': 'production', 'A': '\ud800'},
                 {'NODE_ENV': 'production', 'A': '😀' * 2049},
                 {'NODE_ENV': 'production', 'A' * 129: 'x'},
                 dict(NODE_ENV='production', **{'V' + str(i): 'x' for i in range(512)}),
                 dict(NODE_ENV='production', **{'V' + str(i): 'x' * 8192 for i in range(9)})]
        cases += [{'NODE_ENV': 'production', key: ''} for key in
                  ('LD_PRELOAD', 'DYLD_LIBRARY_PATH', 'PYTHONPATH', 'NODE_OPTIONS')]
        for values in cases:
            with self.subTest(index=cases.index(values)):
                self.reject(lambda: self.produce(values))
        self.assertEqual(self.kernel.events, [])

    def test_short_writes_complete_but_zero_write_is_terminal(self):
        self.kernel.write_limit = 3
        fd = self.produce({'NODE_ENV': 'production', 'A': '中文'})
        self.assertEqual(json.loads(self.kernel.data)[3][1], ['A', '中文'])
        self.kernel.close(fd)
        self.kernel.mocks['write'].side_effect = [0, OSError('synthetic secret')]
        before = self.kernel.mocks['write'].call_count
        self.reject(self.produce)
        self.assertEqual(self.kernel.mocks['write'].call_count - before, 1)
        self.assertEqual(self.kernel.fds, set())

    def test_producer_errors_close_owned_fd_only_without_retry(self):
        for name in ('fchmod', 'write', 'fcntl', 'fstat'):
            with self.subTest(name=name), patch.object(guard.os if name != 'fcntl' else guard.fcntl,
                    name, side_effect=OSError('synthetic secret')):
                self.reject(self.produce)
                self.assertEqual(self.kernel.fds, set())
        self.kernel.mocks['write'].side_effect = OSError('synthetic write')
        def close_error(fd):
            self.kernel.close(fd)
            raise OSError('synthetic close')
        self.kernel.mocks['close'].side_effect = close_error
        before = self.kernel.mocks['close'].call_count
        self.reject(self.produce)
        self.assertEqual(self.kernel.mocks['close'].call_count - before, 1)

    def test_consumer_matches_binding_and_consumes_exact_sealed_object(self):
        self.assertTrue(callable(getattr(guard, '_consume_environment', None)), 'consumer missing')
        self.produce({'NODE_ENV': 'production', 'EMPTY': '', 'A': '中文'})
        self.kernel.inherit()
        result = guard._consume_environment('a' * 40, 'b' * 32)
        self.assertEqual(result, {'NODE_ENV': 'production', 'EMPTY': '', 'A': '中文'})
        self.assertEqual(self.kernel.fds, set())
        self.assertLess(self.kernel.events.index('cloexec'), self.kernel.events.index('read'))

    def test_consumer_rejects_untrusted_metadata_before_reading_and_closes(self):
        self.assertTrue(callable(getattr(guard, '_consume_environment', None)), 'consumer missing')
        for field, value in [('uid', 998), ('gid', 998), ('links', 1), ('mode', stat.S_IFREG | 0o644),
                             ('mode', stat.S_IFSOCK | 0o600), ('seals', 7), ('seals', 11),
                             ('seals', 13), ('seals', 14)]:
            with self.subTest(field=field, value=value):
                self.kernel.load()
                setattr(self.kernel, field, value)
                before = self.kernel.mocks['pread'].call_count
                self.reject(lambda: guard._consume_environment('a' * 40, 'b' * 32))
                self.assertEqual(self.kernel.mocks['pread'].call_count, before)
                self.assertEqual(self.kernel.fds, set())
                setattr(self.kernel, field, 0)

    def test_consumer_rejects_bad_schema_binding_duplicates_and_truncation(self):
        self.assertTrue(callable(getattr(guard, '_consume_environment', None)), 'consumer missing')
        good = ['HPE1', 'a' * 40, 'b' * 32, [['NODE_ENV', 'production']]]
        cases = [b'', b'x' * 65537, b'not-json', json.dumps(good + [1]).encode(),
                 json.dumps(['HPE1', 'c' * 40, *good[2:]]).encode(),
                 json.dumps(['HPE1', 'a' * 40, 'c' * 32, good[3]]).encode(),
                 json.dumps([*good[:3], good[3] * 2]).encode(),
                 json.dumps([*good[:3], [['NODE_ENV', 'production'], ['LD_PRELOAD', 'x']]]).encode()]
        for raw in cases:
            with self.subTest(size=len(raw)):
                self.kernel.load()
                self.kernel.data = raw
                self.reject(lambda: guard._consume_environment('a' * 40, 'b' * 32))
                self.assertEqual(self.kernel.fds, set())
        self.kernel.load()
        self.kernel.mocks['pread'].side_effect = lambda *args: self.kernel.data[:-1]
        self.reject(lambda: guard._consume_environment('a' * 40, 'b' * 32))

    def test_consumer_close_error_has_no_retry_and_no_success(self):
        self.assertTrue(callable(getattr(guard, '_consume_environment', None)), 'consumer missing')
        self.kernel.load()
        def close_error(fd):
            self.kernel.close(fd)
            raise OSError('synthetic secret')
        self.kernel.mocks['close'].side_effect = close_error
        self.reject(lambda: guard._consume_environment('a' * 40, 'b' * 32))
        self.assertEqual(self.kernel.mocks['close'].call_count, 1)
        self.assertEqual(self.kernel.fds, set())

    def test_consumer_io_failures_close_once_and_never_return_values(self):
        for name in ('set_inheritable', 'fstat', 'fcntl', 'pread'):
            with self.subTest(name=name):
                self.kernel.load()
                before = self.kernel.mocks['close'].call_count
                target = guard.fcntl if name == 'fcntl' else guard.os
                with patch.object(target, name, side_effect=OSError('synthetic secret')):
                    self.reject(lambda: guard._consume_environment('a' * 40, 'b' * 32))
                self.assertEqual(self.kernel.fds, set())
                self.assertEqual(self.kernel.mocks['close'].call_count - before, 1)

    def test_failed_create_does_not_close_unowned_descriptors(self):
        with patch.object(guard.os, 'memfd_create', side_effect=OSError('synthetic secret')):
            self.reject(self.produce)
        self.assertEqual(self.kernel.mocks['close'].call_count, 0)

    def test_seal_readback_and_producer_metadata_must_be_proven(self):
        original = self.kernel.control
        def missing_write_seal(fd, command, arg=0):
            return 7 if command == 1034 else original(fd, command, arg)
        with patch.object(guard.fcntl, 'fcntl', side_effect=missing_write_seal):
            self.reject(self.produce)
        self.assertEqual(self.kernel.fds, set())
        self.kernel.seals = 0
        self.kernel.data = b''
        self.kernel.uid = 998
        self.reject(self.produce)
        self.assertEqual(self.kernel.fds, set())

    def test_active_context_never_leaks_from_either_side(self):
        self.kernel.load()
        self.kernel.seals = 0
        try:
            raise RuntimeError('synthetic secret')
        except RuntimeError:
            self.reject(lambda: guard._consume_environment('a' * 40, 'b' * 32))
            self.reject(lambda: self.produce({'NODE_ENV': 'test'}))

    def test_bootstrap_values_are_independent_and_not_business_environment(self):
        first = guard.bootstrap_environment()
        first['NODE_ENV'] = 'test'
        self.assertEqual(guard.bootstrap_environment(), {'PATH': '/usr/bin:/bin', 'LANG': 'C.UTF-8'})


if __name__ == '__main__':
    unittest.main()
