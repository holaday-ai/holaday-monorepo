import importlib.util
import pathlib
import unittest

spec = importlib.util.spec_from_file_location('maintenance_signal', pathlib.Path(__file__).with_name('browser-maintenance-signal.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
ROOT = '/opt/holaday-releases/' + 'a' * 40 + '/apps/orchestrator'


class Kernel:
    def __init__(self):
        self.start = '1234'
        self.uid = 998
        self.cwd = ROOT
        self.role = 'main'
        self.events = []

    def open(self, pid):
        self.events.append(('pin', pid))
        return 9

    def inspect(self, pid):
        return {'start': self.start, 'uid': self.uid, 'cwd': self.cwd, 'role': self.role}

    def term(self, descriptor):
        self.events.append(('term-fd', descriptor))

    def close(self, descriptor):
        self.events.append(('close-fd', descriptor))


class SignalTests(unittest.TestCase):
    def test_signal_uses_pinned_descriptor_and_releases_it(self):
        kernel = Kernel()
        module.signal_original(101, '1234', ROOT, 'main', kernel)
        self.assertEqual(kernel.events, [('pin', 101), ('term-fd', 9), ('close-fd', 9)])

    def test_pid_reuse_after_pin_is_not_signalled(self):
        for key, bad in [('start', '2345'), ('uid', 0), ('cwd', '/opt/other'), ('role', 'worker')]:
            kernel = Kernel()
            setattr(kernel, key, bad)
            with self.assertRaisesRegex(RuntimeError, '^MAINTENANCE_PROCESS_IDENTITY$'):
                module.signal_original(101, '1234', ROOT, 'main', kernel)
            self.assertEqual(kernel.events, [('pin', 101), ('close-fd', 9)])

    def test_invalid_target_is_rejected_before_pinning(self):
        for pid, start, cwd, role in [(1, '1234', ROOT, 'main'), (101, 'x', ROOT, 'main'),
                (101, '1234', '/opt/holaday-releases/../other/apps/orchestrator', 'main'),
                (101, '1234', ROOT, 'unknown')]:
            kernel = Kernel()
            with self.assertRaisesRegex(RuntimeError, '^MAINTENANCE_SIGNAL_INPUT$'):
                module.signal_original(pid, start, cwd, role, kernel)
            self.assertEqual(kernel.events, [])

    def test_inspection_failure_closes_descriptor_without_signal(self):
        kernel = Kernel()
        def fail(_pid):
            raise PermissionError('denied')
        kernel.inspect = fail
        with self.assertRaises(PermissionError):
            module.signal_original(101, '1234', ROOT, 'main', kernel)
        self.assertEqual(kernel.events, [('pin', 101), ('close-fd', 9)])


if __name__ == '__main__':
    unittest.main()
