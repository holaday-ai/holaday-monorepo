"""Disposable-container kernel checks; never discover or signal host processes.

The synthetic child is Python, not a Node application. Kernel descriptors,
start identity, UID and cwd are real; only its exact test command is mapped to
the main role. Production command recognition is separately required to reject it.
"""
import importlib.util
import os
import pathlib
import signal
import subprocess
import sys
import unittest

spec = importlib.util.spec_from_file_location('maintenance_signal',
    pathlib.Path(__file__).with_name('browser-maintenance-signal.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
ROOT = '/opt/holaday-releases/' + 'a' * 40 + '/apps/orchestrator'
COMMAND = [sys.executable, '-c', 'import time; time.sleep(60)']


class FixtureKernel(module.LinuxKernel):
    def inspect(self, pid):
        actual = super().inspect(pid)
        with open('/proc/' + str(pid) + '/cmdline', 'rb') as stream:
            args = [part.decode() for part in stream.read().split(b'\0') if part]
        if args == COMMAND:
            actual['role'] = 'main'
        return actual


class KernelTests(unittest.TestCase):
    def setUp(self):
        if sys.platform != 'linux' or os.geteuid() != 0:
            self.skipTest('isolated Linux root container required')
        os.makedirs(ROOT, exist_ok=True)
        self.child = subprocess.Popen(COMMAND, cwd=ROOT, user=998, group=998)
        # Popen returns only after successful exec (the exec-error pipe closes).
        self.start = FixtureKernel().inspect(self.child.pid)['start']

    def tearDown(self):
        if hasattr(self, 'child') and self.child.poll() is None:
            self.child.terminate()
            self.child.wait(timeout=5)

    def test_actual_pidfd_signals_only_the_observed_synthetic_child(self):
        module.signal_original(self.child.pid, self.start, ROOT, 'main', FixtureKernel())
        self.assertEqual(self.child.wait(timeout=5), -signal.SIGTERM)

    def test_mismatched_start_never_signals(self):
        with self.assertRaisesRegex(RuntimeError, 'MAINTENANCE_PROCESS_IDENTITY'):
            module.signal_original(self.child.pid, str(int(self.start) + 1), ROOT, 'main', FixtureKernel())
        self.assertIsNone(self.child.poll())

    def test_production_role_parser_refuses_the_python_fixture(self):
        with self.assertRaisesRegex(RuntimeError, 'MAINTENANCE_PROCESS_IDENTITY'):
            module.signal_original(self.child.pid, self.start, ROOT, 'main', module.LinuxKernel())
        self.assertIsNone(self.child.poll())


if __name__ == '__main__':
    unittest.main()
