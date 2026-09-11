"""Actual registration and sealing, simulated kernel and final setpriv exec."""

import json
import unittest
from contextlib import ExitStack
from types import SimpleNamespace
from unittest.mock import patch

from test_environment_handoff import CapsuleKernel
import test_launch_registration as registration_tests

try:
    import root_launch
except ModuleNotFoundError as error:
    if error.name != 'root_launch':
        raise
    root_launch = None


class ExecObserved(BaseException):
    pass


class RootLaunchTests(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(root_launch, 'registered launcher missing')
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        fixture = registration_tests.LaunchRegistrationTests()
        self.stack.enter_context(fixture.kernel())
        self.channel = fixture.channel()
        self.kernel = CapsuleKernel(self.stack)
        self.exec_path = None
        self.fd_flags = {}
        self.replace('os.getresuid', return_value=(0, 0, 0), create=True)
        self.replace('os.getresgid', return_value=(0, 0, 0), create=True)
        self.replace('os.listdir', return_value=['123'])
        self.replace('os.environ', {'PATH': '/usr/bin:/bin', 'LANG': 'C.UTF-8'})
        self.install = self.replace('installation.inspect_installation', return_value=SimpleNamespace(app_gid=998))
        self.replace('os.pidfd_open', side_effect=self.pidfd)
        self.kernel.mocks['set_inheritable'].side_effect = self.inheritable
        self.dup = self.replace('os.dup2', side_effect=self.dup2)
        self.replace('os.execve', side_effect=self.exec_seen)
        self.libc = SimpleNamespace(close_range=lambda *args: self.close_range(*args))
        self.replace('ctypes.CDLL', return_value=self.libc)

    def replace(self, name, *args, **kwargs):
        return self.stack.enter_context(patch('root_launch.' + name, *args, **kwargs))

    def pidfd(self, pid, flags):
        self.assertEqual((pid, flags), (123, 0))
        self.kernel.fds.add(9)
        return 9

    def inheritable(self, fd, value):
        self.assertIn(fd, self.kernel.fds)
        self.fd_flags[fd] = value

    def dup2(self, src, dst, *, inheritable):
        self.assertEqual((dst, inheritable), (3, True))
        self.assertIn(src, self.kernel.fds)
        self.channel.close.assert_called_once()
        self.kernel.fds.add(3)
        self.fd_flags[3] = True
        return 3

    def close_range(self, first, last, flags):
        self.assertEqual((first, last, flags), (4, 4294967295, 2))
        self.kernel.fds = {fd for fd in self.kernel.fds if fd < first}
        return 0

    def exec_seen(self, path, argv, env):
        self.exec_path = path
        self.assertEqual(path, '/usr/bin/setpriv')
        self.assertEqual(argv, ['/usr/bin/setpriv', '--reuid=998', '--regid=998', '--clear-groups',
            '--inh-caps=-all', '--ambient-caps=-all', '--bounding-set=-all', '--no-new-privs', '--',
            '/usr/bin/python3', '-I', '-S', '/usr/local/lib/holaday-pool-broker/releases/' + 'a' * 40 +
            '/application_guard.py', '998', 'a' * 40, 'b' * 32])
        self.assertEqual(env, {'PATH': '/usr/bin:/bin', 'LANG': 'C.UTF-8'})
        self.assertEqual(self.kernel.fds, {3})
        self.assertTrue(self.fd_flags[3])
        self.assertEqual(json.loads(self.kernel.data)[3], [['NODE_ENV', 'production']])
        raise ExecObserved()

    def launch(self):
        root_launch.launch_application(self.channel, 'a' * 40, 'b' * 32, {'NODE_ENV': 'production'})

    def test_seal_register_ack_and_fixed_drop_share_only_environment_fd(self):
        with self.assertRaises(ExecObserved):
            self.launch()
        self.install.assert_called_once_with('a' * 40)
        self.channel.sendmsg.assert_called_once()
        self.channel.recvmsg.assert_called_once()
        self.channel.close.assert_called_once()

    def rejected(self):
        try:
            self.launch()
        except ExecObserved:
            self.fail('unsafe drop executed')
        except ValueError as error:
            self.assertEqual(str(error), 'POOL_BROKER_LAUNCH_UNPROVEN')
            self.assertIsNone(error.__context__)
            self.assertIsNone(error.__cause__)
        else:
            self.fail('launch returned success')
        self.assertIsNone(self.exec_path)
        self.assertEqual(self.kernel.fds, set())
        self.channel.close.assert_called_once()

    def test_bad_root_context_refused_before_installation_or_registration(self):
        cases = [('os.getresuid', (998, 0, 0)), ('os.getresgid', (0, 998, 0)),
                 ('os.listdir', ['123', '456'])]
        for target, value in cases:
            with self.subTest(target=target), patch('root_launch.' + target, return_value=value):
                self.rejected()
                self.channel.reset_mock()
        for env in ({}, {'PATH': '/usr/bin:/bin', 'LANG': 'C.UTF-8', 'LD_PRELOAD': 'synthetic'}):
            with patch.object(root_launch.os, 'environ', env):
                self.rejected()
                self.channel.reset_mock()
        with patch.object(root_launch.sys, 'platform', 'darwin'):
            self.rejected()
        self.install.assert_not_called()
        self.dup.assert_not_called()

    def test_installation_and_sealing_failure_never_register(self):
        for target in ('installation.inspect_installation', 'application_guard.seal_application_environment'):
            with self.subTest(target=target), patch('root_launch.' + target,
                    side_effect=OSError('synthetic private error')):
                self.rejected()
                self.channel.sendmsg.assert_not_called()
                self.channel.reset_mock()

    def test_invalid_binding_rejected_and_channel_consumed(self):
        with patch.object(root_launch.application_guard, 'seal_application_environment',
                          side_effect=ValueError('synthetic private error')):
            self.rejected()
        self.dup.assert_not_called()

    def test_bad_ack_or_receive_failure_never_duplicates_or_executes(self):
        payload, ancillary, flags, address = self.channel.recvmsg.return_value
        self.channel.recvmsg.return_value = (b'x' * 48, ancillary, flags, address)
        self.rejected()
        self.dup.assert_not_called()

    def test_registration_exception_is_not_retried(self):
        self.channel.recvmsg.side_effect = TimeoutError('synthetic timeout')
        self.rejected()
        self.assertEqual(self.channel.sendmsg.call_count, 1)
        self.dup.assert_not_called()

    def test_post_ack_context_drift_prevents_fd_installation(self):
        self.replace('os.listdir', side_effect=[['123'], ['123'], ['123', '456']])
        self.rejected()
        self.channel.recvmsg.assert_called_once()
        self.dup.assert_not_called()

    def test_duplication_failure_closes_original_capsule(self):
        self.dup.side_effect = OSError('synthetic duplication')
        self.rejected()

    def test_original_close_failure_closes_fd3_without_retrying_original(self):
        close = self.kernel.close
        def fail(fd):
            close(fd)
            if fd == 42:
                raise OSError('synthetic close')
        self.kernel.mocks['close'].side_effect = fail
        self.rejected()
        self.assertEqual(self.kernel.events.count(('close', 42)), 1)
        self.assertEqual(self.kernel.events.count(('close', 3)), 1)

    def test_capsule_already_at_three_is_not_closed_before_exec(self):
        def create(name, flags):
            self.kernel.create(name, flags)
            self.kernel.fds = {3}
            return 3
        self.kernel.mocks['memfd_create'].side_effect = create
        with self.assertRaises(ExecObserved):
            self.launch()
        self.dup.assert_not_called()

    def test_range_and_exec_failures_close_owned_capsule(self):
        self.libc.close_range = lambda *args: -1
        self.rejected()

    def test_fd3_inheritance_failure_closes_capsule(self):
        def create(name, flags):
            self.kernel.create(name, flags)
            self.kernel.fds = {3}
            return 3
        self.kernel.mocks['memfd_create'].side_effect = create
        def fail(fd, value):
            if fd == 3 and value:
                raise OSError('synthetic inheritance')
            self.inheritable(fd, value)
        self.kernel.mocks['set_inheritable'].side_effect = fail
        self.rejected()
        self.assertEqual(self.kernel.events.count(('close', 3)), 1)

    def test_native_cleanup_loader_failure_releases_capsule(self):
        self.replace('ctypes.CDLL', side_effect=OSError('synthetic loader'))
        self.rejected()

    def test_final_context_read_failure_never_executes(self):
        self.replace('os.listdir', side_effect=[['123'], ['123'], ['123'], OSError('synthetic proc')])
        self.rejected()

    def test_exec_failure_or_unexpected_return_does_not_continue(self):
        self.replace('os.execve', side_effect=OSError('synthetic exec error'))
        self.rejected()

    def test_exec_return_is_not_success(self):
        self.replace('os.execve', return_value=None)
        self.rejected()

    def test_invalid_channel_is_not_called(self):
        self.channel = object()
        with self.assertRaises(ValueError) as caught:
            self.launch()
        self.assertEqual(str(caught.exception), 'POOL_BROKER_LAUNCH_UNPROVEN')
        self.assertEqual(self.kernel.fds, set())

    def test_active_caller_exception_not_retained(self):
        with patch.object(root_launch.sys, 'platform', 'darwin'):
            try:
                raise RuntimeError('synthetic private context')
            except RuntimeError:
                self.rejected()

    def test_context_drift_during_sealing_prevents_registration(self):
        original = self.kernel.control
        def drift(fd, command, arg=0):
            result = original(fd, command, arg)
            if command == 1033:
                root_launch.os.environ['LD_PRELOAD'] = 'synthetic'
            return result
        self.kernel.mocks['fcntl'].side_effect = drift
        self.rejected()
        self.channel.sendmsg.assert_not_called()

    def test_context_drift_after_final_descriptor_cleanup_prevents_exec(self):
        original = self.close_range
        def drift(*args):
            result = original(*args)
            root_launch.os.environ['LD_PRELOAD'] = 'synthetic'
            return result
        self.libc.close_range = drift
        self.rejected()


if __name__ == '__main__':
    unittest.main()
