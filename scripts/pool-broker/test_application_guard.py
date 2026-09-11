"""Exercise the real guard with synthetic OS boundaries; never exec on host."""

import importlib
import io
import pathlib
import subprocess
import sys
import unittest
from contextlib import ExitStack
from unittest.mock import patch

try:
    guard = importlib.import_module('application_guard')
except ModuleNotFoundError:
    guard = None


class ExecObserved(BaseException):
    pass


SAFE = b'''Name:\tsynthetic
Uid:\t998\t998\t998\t998
Gid:\t998\t998\t998\t998
Groups:\t
CapInh:\t0000000000000000
CapPrm:\t0000000000000000
CapEff:\t0000000000000000
CapBnd:\t0000000000000000
CapAmb:\t0000000000000000
NoNewPrivs:\t1
Threads:\t1
TracerPid:\t0
'''


class GuardTests(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(guard, 'application guard missing')
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.events = []
        self.status = SAFE
        self.executed = None
        self.environment = None
        self.replace('sys.platform', 'linux')
        self.replace('os.getresuid', return_value=(998, 998, 998), create=True)
        self.replace('os.getresgid', return_value=(998, 998, 998), create=True)
        self.replace('os.getgroups', return_value=[])
        self.replace('os.environ', {'NODE_ENV': 'production', 'SYNTHETIC_SETTING': 'kept',
                                   'EMPTY_SETTING': '', 'PM2_HOME': '/synthetic/private'})
        self.replace('os.chdir', side_effect=lambda p: self.events.append(('cwd', p)))
        self.replace('os.umask', side_effect=lambda m: self.events.append(('umask', m)))
        self.replace('os.execve', side_effect=self.exec_seen)
        self.replace('signal.pthread_sigmask', return_value=set(), create=True)
        self.replace('signal.signal', return_value=None)
        self.stack.enter_context(patch('builtins.open', side_effect=self.open_status))
        self.libc = type('Libc', (), {})()
        self.libc.close_range = lambda a, b, c: self.events.append(('close', a, b, c)) or 0
        self.replace('ctypes.CDLL', return_value=self.libc)

    def replace(self, name, *args, **kwargs):
        return self.stack.enter_context(patch('application_guard.' + name, *args, **kwargs))

    def open_status(self, path, mode):
        self.assertEqual((path, mode), ('/proc/self/status', 'rb'))
        self.events.append(('status',))
        return io.BytesIO(self.status)

    def exec_seen(self, path, argv, env):
        self.executed = (path, argv)
        self.environment = env
        self.events.append(('exec',))
        raise ExecObserved()

    def test_fixed_exec_preserves_business_env_after_descriptor_cleanup(self):
        with self.assertRaises(ExecObserved):
            guard.exec_application(998)
        self.assertEqual(self.executed, ('/opt/node22/bin/node', [
            '/opt/node22/bin/node', '--import', 'tsx',
            '/opt/holaday-monorepo/apps/orchestrator/src/index.ts']))
        self.assertEqual(self.environment, {'NODE_ENV': 'production',
                         'SYNTHETIC_SETTING': 'kept', 'EMPTY_SETTING': ''})
        self.assertIn(('cwd', '/opt/holaday-monorepo/apps/orchestrator'), self.events)
        self.assertIn(('umask', 0o077), self.events)
        close = self.events.index(('close', 3, 4294967295, 2))
        self.assertLess(close, self.events.index(('exec',)))
        self.assertIn(('status',), self.events[close + 1:])

    def denied(self, gid=998):
        self.executed = None
        try:
            guard.exec_application(gid)
        except ExecObserved:
            self.fail('unsafe application executed')
        except ValueError as error:
            self.assertEqual(str(error), 'POOL_BROKER_APPLICATION_UNPROVEN')
            self.assertIsNone(error.__context__)
            self.assertIsNone(error.__cause__)
        else:
            self.fail('unsafe application accepted')
        self.assertIsNone(self.executed)

    def test_invalid_gid_or_platform_never_launches(self):
        for gid in (True, '998', 0, -1, 65534, 4294967295, None):
            with self.subTest(gid=gid):
                self.denied(gid)
        with patch.object(guard.sys, 'platform', 'darwin'):
            self.denied()

    def test_uid_gid_and_supplementary_groups_must_all_match(self):
        for call, values in [('os.getresuid', [(0, 998, 998), (998, 0, 998), (998, 998, 0)]),
                             ('os.getresgid', [(0, 998, 998), (998, 0, 998), (998, 998, 0)]),
                             ('os.getgroups', [[0], [998], [997]])]:
            for value in values:
                with self.subTest(call=call, value=value), patch('application_guard.' + call,
                                                               return_value=value, create=True):
                    self.denied()

    def test_each_kernel_identity_and_capability_field_is_enforced(self):
        changes = [('Uid', b'998 998 998 0'), ('Gid', b'998 998 998 0'),
                   ('Groups', b'998'), ('NoNewPrivs', b'0'), ('Threads', b'2'),
                   ('TracerPid', b'12')]
        changes += [(name, b'0000000000000001') for name in
                    ('CapInh', 'CapPrm', 'CapEff', 'CapBnd', 'CapAmb')]
        for key, value in changes:
            with self.subTest(field=key):
                self.status = b'\n'.join(key.encode() + b':\t' + value
                    if line.startswith(key.encode() + b':') else line for line in SAFE.split(b'\n'))
                self.denied()

    def test_missing_duplicate_malformed_and_oversized_status_rejected(self):
        for data in (b'', b'x' * 65537, SAFE + b'Uid:\t998 998 998 998\n',
                     SAFE.replace(b'NoNewPrivs:\t1\n', b''),
                     SAFE.replace(b'NoNewPrivs:\t1', b'NoNewPrivs:\t+1'),
                     SAFE.replace(b'CapEff:\t0000000000000000', b'CapEff:\t'),
                     SAFE.replace(b'Uid:\t998\t998\t998\t998', b'Uid:\t998 998 998'),
                     SAFE.replace(b'Groups:\t', b'Groups:\tgarbage')):
            with self.subTest(size=len(data)):
                self.status = data
                self.denied()

    def test_environment_injection_or_nonproduction_refused_not_silently_stripped(self):
        for key in ('LD_PRELOAD', 'LD_LIBRARY_PATH', 'DYLD_INSERT_LIBRARIES',
                    'PYTHONPATH', 'PYTHONINSPECT', 'NODE_OPTIONS', 'NODE_PATH'):
            with self.subTest(key=key), patch.dict(guard.os.environ, {key: ''}):
                self.denied()
        for value in ('', 'development'):
            with patch.dict(guard.os.environ, {'NODE_ENV': value}):
                self.denied()
        with patch.dict(guard.os.environ, {'NODE_ENV': 'production', 'BAD=KEY': 'x'}, clear=True):
            self.denied()

    def test_cleanup_failure_and_missing_symbol_never_fall_back(self):
        for value in (-1, 1):
            self.libc.close_range = lambda *args: value
            self.denied()
        del self.libc.close_range
        self.denied()

    def test_privilege_change_after_close_is_detected(self):
        def change(*args):
            self.status = SAFE.replace(b'NoNewPrivs:\t1', b'NoNewPrivs:\t0')
            return 0
        self.libc.close_range = change
        self.denied()

    def test_os_failures_are_sanitized_without_exec(self):
        for name in ('os.getresuid', 'os.getresgid', 'os.getgroups', 'os.chdir',
                     'os.umask', 'signal.pthread_sigmask', 'signal.signal', 'ctypes.CDLL'):
            with self.subTest(name=name), patch('application_guard.' + name,
                    side_effect=OSError('synthetic-private-error'), create=True):
                self.denied()
        with patch('builtins.open', side_effect=OSError('synthetic-private-error')):
            self.denied()

    def test_exec_failure_or_unexpected_return_is_fixed_rejection(self):
        for kwargs in ({'side_effect': OSError('synthetic-private-error')}, {'return_value': None}):
            with patch.object(guard.os, 'execve', **kwargs):
                self.denied()

    def test_active_exception_is_not_retained(self):
        try:
            raise RuntimeError('synthetic-private-context')
        except RuntimeError:
            self.denied(0)

    def test_signal_mask_and_dispositions_reset_before_exec(self):
        with patch.object(guard.signal, 'pthread_sigmask') as mask, \
                patch.object(guard.signal, 'signal') as disposition:
            with self.assertRaises(ExecObserved):
                guard.exec_application(998)
            mask.assert_called_once_with(guard.signal.SIG_SETMASK, [])
            reset = {int(call.args[0]) for call in disposition.call_args_list}
            self.assertEqual(reset, {int(s) for s in guard.signal.valid_signals()
                                   if s not in (guard.signal.SIGKILL, guard.signal.SIGSTOP)})
            self.assertTrue(all(call.args[1] == guard.signal.SIG_DFL
                                for call in disposition.call_args_list))

    def test_cli_accepts_only_one_canonical_gid_and_execs_the_real_guard(self):
        self.assertTrue(callable(getattr(guard, 'main', None)), 'guard CLI missing')
        for args in ([], ['0'], ['0998'], ['+998'], ['998', 'extra'], ['--help'], ['1' * 100]):
            with self.subTest(args=args):
                self.assertEqual(guard.main(args), 1)
                self.assertIsNone(self.executed)
        with self.assertRaises(ExecObserved):
            guard.main(['998'])
        self.assertEqual(self.executed[0], '/opt/node22/bin/node')

    def test_cli_privilege_failure_returns_fixed_failure_without_traceback(self):
        self.assertTrue(callable(getattr(guard, 'main', None)), 'guard CLI missing')
        self.status = SAFE.replace(b'NoNewPrivs:\t1', b'NoNewPrivs:\t0')
        self.assertEqual(guard.main(['998']), 1)
        self.assertIsNone(self.executed)


@unittest.skipIf(sys.platform == 'linux', 'real launch path must not run on test host')
class NativeRejectionTests(unittest.TestCase):
    def test_isolated_cli_on_non_linux_exits_without_output(self):
        result = subprocess.run([
            sys.executable, '-I', '-S', str(pathlib.Path(__file__).with_name('application_guard.py')), '998'
        ], env={}, capture_output=True, timeout=5, check=False)
        self.assertEqual(result.returncode, 1)
        self.assertEqual((result.stdout, result.stderr), (b'', b''))


if __name__ == '__main__':
    unittest.main()
