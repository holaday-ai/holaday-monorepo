"""First-exec consumer: only synthetic files, identities and sockets."""

import stat
import subprocess
import unittest
from contextlib import ExitStack
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import test_bootstrap_input as input_tests
from test_environment_handoff import CapsuleKernel
import test_root_launch
import test_native_entry as native_tests

bootstrap_input = input_tests.bootstrap_input

try:
    import bootstrap
except ModuleNotFoundError as error:
    if error.name != 'bootstrap':
        raise
    bootstrap = None


class BootstrapTests(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(bootstrap, 'first-exec bootstrap missing')
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.kernel = CapsuleKernel(self.stack)
        self.kernel.fds = {3}
        self.kernel.mode = stat.S_IFREG | 0o600
        self.kernel.seals = 15
        self.kernel.data = b'HPR1' + b'a' * 40 + b'NODE_ENV=production\0LOG_LEVEL=\0\0'

    def test_consumes_only_sealed_raw_input_and_closes_before_returning(self):
        self.assertEqual(bootstrap._consume_input('a' * 40, bootstrap_input),
                         {'NODE_ENV': 'production', 'LOG_LEVEL': ''})
        self.assertEqual(self.kernel.fds, set())
        self.assertEqual(self.kernel.events, ['cloexec', 'read', ('close', 3)])

    def test_runtime_identity_is_produced_not_inherited_from_root_pm2(self):
        values = {'NODE_ENV': 'production', 'PATH': '/usr/bin:/bin', 'HOME': '/root',
                  'USER': 'root', 'LOGNAME': 'root', 'XDG_RUNTIME_DIR': '/run/user/0', 'LOG_LEVEL': ''}
        result = bootstrap._runtime_environment(values, SimpleNamespace(app_name='holaday', app_home='/var/lib/holaday'))
        self.assertEqual(result, {'NODE_ENV': 'production', 'PATH': '/opt/node22/bin:/usr/bin:/bin',
            'HOME': '/var/lib/holaday', 'USER': 'holaday', 'LOGNAME': 'holaday',
            'XDG_RUNTIME_DIR': '/var/lib/holaday/.runtime', 'LOG_LEVEL': ''})
        self.assertEqual(values['HOME'], '/root')

    def test_input_metadata_and_io_failures_close_once(self):
        original = self.kernel.data
        for field, value in [('uid', 998), ('gid', 998), ('links', 1),
                             ('seals', 7), ('mode', stat.S_IFREG | 0o644),
                             ('data', b'x' * 262145)]:
            with self.subTest(field=field):
                old = getattr(self.kernel, field)
                self.kernel.fds = {3}
                self.kernel.events.clear()
                setattr(self.kernel, field, value)
                with self.assertRaises(ValueError):
                    bootstrap._consume_input('a' * 40, bootstrap_input)
                self.assertEqual(self.kernel.fds, set())
                self.assertEqual(self.kernel.events.count(('close', 3)), 1)
                self.assertNotIn('read', self.kernel.events)
                setattr(self.kernel, field, old)
        for name in ('set_inheritable', 'fstat', 'pread'):
            with self.subTest(name=name):
                self.kernel.data, self.kernel.fds = original, {3}
                self.kernel.events.clear()
                with patch.object(bootstrap.os, name, side_effect=OSError('synthetic IO')):
                    with self.assertRaises(OSError):
                        bootstrap._consume_input('a' * 40, bootstrap_input)
                self.assertEqual(self.kernel.events.count(('close', 3)), 1)

    def test_short_or_extended_reads_and_missing_runtime_path_are_rejected(self):
        for data in (self.kernel.data[:-1], self.kernel.data + b'x'):
            self.kernel.fds = {3}
            with patch.object(bootstrap.os, 'pread', return_value=data), self.assertRaises(ValueError):
                bootstrap._consume_input('a' * 40, bootstrap_input)
            self.assertEqual(self.kernel.fds, set())
        for values in ({'NODE_ENV': 'production'}, {'NODE_ENV': 'production', 'PATH': ''}):
            with self.assertRaises(ValueError):
                bootstrap._runtime_environment(values, SimpleNamespace(app_name='holaday', app_home='/var/lib/holaday'))

    def test_registration_connect_is_fixed_bounded_cloexec_and_owned_on_failure(self):
        channel = MagicMock()
        with patch.object(bootstrap.socket, 'SOCK_CLOEXEC', 524288, create=True), \
                patch.object(bootstrap.socket, 'socket', return_value=channel) as factory:
            self.assertIs(bootstrap._connect_registration(), channel)
            factory.assert_called_once_with(bootstrap.socket.AF_UNIX, bootstrap.socket.SOCK_SEQPACKET | 524288)
            channel.settimeout.assert_called_once_with(5.0)
            channel.connect.assert_called_once_with('/run/holaday-pool-broker/register.sock')
            channel.close.assert_not_called()
            channel.reset_mock()
            channel.connect.side_effect = TimeoutError('synthetic timeout')
            with self.assertRaises(TimeoutError):
                bootstrap._connect_registration()
            channel.close.assert_called_once()


class BootstrapFlowTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        native_tests.NativeEntryTests.setUpClass()
        cls.addClassCleanup(native_tests.NativeEntryTests.doClassCleanups)
        cls.raw = subprocess.run([str(native_tests.NativeEntryTests.binary)], env={
            'NODE_ENV': 'production', 'LOG_LEVEL': '', 'PATH': '/usr/bin:/bin',
            'HOME': '/root', 'LD_PRELOAD': 'synthetic', 'NODE_CHANNEL_FD': '99',
            'PYTHONPATH': 'synthetic'}, capture_output=True, check=True, timeout=5).stdout

    def setUp(self):
        self.assertTrue(callable(getattr(bootstrap, 'main', None)), 'bootstrap main missing')
        self.fixture = test_root_launch.RootLaunchTests()
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        self.stack = self.fixture.stack
        self.kernel = self.fixture.kernel
        self.kernel.data, self.kernel.seals, self.kernel.mode = self.raw, 15, stat.S_IFREG | 0o600
        self.kernel.fds = {3}
        self.fixture.install.return_value = SimpleNamespace(app_gid=998, app_name='holaday', app_home='/var/lib/holaday')
        self.expected = {'NODE_ENV': 'production', 'LOG_LEVEL': '', 'PATH': '/opt/node22/bin:/usr/bin:/bin',
                         'HOME': '/var/lib/holaday', 'USER': 'holaday', 'LOGNAME': 'holaday',
                         'XDG_RUNTIME_DIR': '/var/lib/holaday/.runtime'}
        self.p('sys.flags', SimpleNamespace(isolated=1, no_site=1, ignore_environment=1))
        self.path = '/usr/local/lib/holaday-pool-broker/releases/' + 'a' * 40 + '/bootstrap.py'
        self.p('__file__', self.path)
        self.p('sys.argv', [self.path])
        self.p('sys.executable', '/usr/bin/python3')
        self.verify = self.p('_verify_release', return_value={})
        # Package trust has a separate real loader suite. This flow uses the
        # actual already-imported decoder, registration, seal and launch code.
        self.p('_load_modules', return_value={
            'bootstrap_input': bootstrap_input, 'root_launch': test_root_launch.root_launch,
            'installation': test_root_launch.root_launch.installation})
        self.random = self.p('os.urandom', return_value=bytes.fromhex('b' * 32))
        self.connect = self.p('_connect_registration', side_effect=self.connected)
        self.p('os.execve', side_effect=self.exec_seen)
        create = self.kernel.create
        def fresh(name, flags):
            self.assertEqual(self.kernel.fds, set(), 'raw capsule not consumed before new HPE1')
            self.kernel.data, self.kernel.seals = b'', 0
            return create(name, flags)
        self.kernel.mocks['memfd_create'].side_effect = fresh
        self.launched = False

    def p(self, target, *args, **kwargs):
        return self.stack.enter_context(patch('bootstrap.' + target, *args, **kwargs))

    def connected(self):
        self.assertEqual(self.kernel.fds, set())
        self.assertEqual(self.kernel.events.count(('close', 3)), 1)
        return self.fixture.channel

    def exec_seen(self, path, args, env):
        self.assertEqual(path, '/usr/bin/setpriv')
        self.assertEqual(args[-3:], ['998', 'a' * 40, 'b' * 32])
        self.assertEqual(env, {'PATH': '/usr/bin:/bin', 'LANG': 'C.UTF-8'})
        self.assertEqual(self.kernel.fds, {3})
        values = test_root_launch.root_launch.application_guard._consume_environment('a' * 40, 'b' * 32)
        self.assertEqual(values, self.expected)
        self.launched = True
        raise test_root_launch.ExecObserved()

    def test_native_bytes_reach_actual_registration_sealing_and_guard(self):
        with self.assertRaises(test_root_launch.ExecObserved):
            bootstrap.main()
        self.assertTrue(self.launched)
        self.fixture.channel.sendmsg.assert_called_once()
        self.fixture.channel.recvmsg.assert_called_once()
        self.fixture.channel.close.assert_called_once()
        self.assertEqual(self.kernel.fds, set())
        self.assertEqual(self.kernel.events.count(('close', 3)), 2)
        self.random.assert_called_once_with(16)

    def test_empty_start_path_overrides_survive_main_and_real_handoff(self):
        self.kernel.data = self.raw[:-1] + b'ORCHESTRATOR_NODE_BIN=\0ORCHESTRATOR_REPO_ROOT=\0\0'
        self.expected.update(ORCHESTRATOR_NODE_BIN='', ORCHESTRATOR_REPO_ROOT='')
        with self.assertRaises(test_root_launch.ExecObserved):
            bootstrap.main()
        self.assertTrue(self.launched)

    def denied(self):
        with self.assertRaises(ValueError) as caught:
            bootstrap.main()
        self.assertEqual(str(caught.exception), 'POOL_BROKER_BOOTSTRAP_UNPROVEN')
        self.assertIsNone(caught.exception.__context__)
        self.assertIsNone(caught.exception.__cause__)
        self.assertFalse(self.launched)
        self.assertEqual(self.kernel.fds, set())

    def test_package_failure_never_reads_raw_data_or_connects(self):
        flags = []
        def fail(candidate):
            flags.append(self.fixture.fd_flags.get(3))
            raise OSError('synthetic private path')
        self.verify.side_effect = fail
        self.denied()
        self.assertEqual(flags, [False])
        self.kernel.mocks['pread'].assert_not_called()
        self.connect.assert_not_called()

    def test_bad_raw_binding_never_connects(self):
        self.kernel.data = b'HPR1' + b'c' * 40 + self.raw[44:]
        self.denied()
        self.connect.assert_not_called()

    def test_zero_or_short_random_never_connects(self):
        self.random.return_value = b'\0' * 16
        self.denied()
        self.connect.assert_not_called()

    def test_connect_failure_does_not_reclose_consumed_input(self):
        self.connect.side_effect = TimeoutError('synthetic socket')
        self.denied()
        self.assertEqual(self.kernel.events.count(('close', 3)), 1)

    def test_bad_ack_releases_new_capsule_and_socket_once(self):
        _, anc, flags, addr = self.fixture.channel.recvmsg.return_value
        self.fixture.channel.recvmsg.return_value = (b'x' * 48, anc, flags, addr)
        self.denied()
        self.fixture.channel.close.assert_called_once()

    def test_extra_arguments_rejected_before_package_inspection(self):
        self.p('sys.argv', [self.path, 'override'])
        self.denied()
        self.verify.assert_not_called()

    def test_input_close_failure_is_terminal_without_retry(self):
        close = self.kernel.close
        def fail(fd):
            close(fd)
            raise OSError('synthetic close')
        self.kernel.mocks['close'].side_effect = fail
        self.denied()
        self.connect.assert_not_called()
        self.assertEqual(self.kernel.events.count(('close', 3)), 1)

    def test_non_root_or_non_isolated_interpreter_never_reads_input(self):
        for target, value in [('sys.flags', SimpleNamespace(isolated=0, no_site=1, ignore_environment=1)),
                              ('sys.executable', '/tmp/python3'), ('sys.platform', 'darwin')]:
            with self.subTest(target=target), patch('bootstrap.' + target, value):
                self.kernel.fds = {3}
                self.denied()
                self.verify.assert_not_called()
        with patch.object(bootstrap.os, 'getresuid', return_value=(998, 0, 0)):
            self.kernel.fds = {3}
            self.denied()
        self.kernel.mocks['pread'].assert_not_called()

    def test_random_failure_and_wrong_length_never_connect(self):
        for value in (b'a' * 15, b'a' * 17, None):
            with self.subTest(size=len(value) if value is not None else None):
                self.kernel.fds, self.kernel.data = {3}, self.raw
                self.random.return_value = value
                self.denied()
        self.connect.assert_not_called()

    def test_registered_launcher_return_is_not_success_or_socket_reclosed(self):
        def returned(channel, *args):
            channel.close()
        with patch.object(test_root_launch.root_launch, 'launch_application', side_effect=returned):
            self.denied()
        self.fixture.channel.close.assert_called_once()

    def test_active_exception_context_is_not_exposed(self):
        self.verify.side_effect = ValueError('synthetic private detail')
        try:
            raise RuntimeError('synthetic caller detail')
        except RuntimeError:
            self.denied()


if __name__ == '__main__':
    unittest.main()
