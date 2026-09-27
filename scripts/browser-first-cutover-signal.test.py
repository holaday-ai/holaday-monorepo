import copy
import importlib.util
import pathlib
import unittest

spec = importlib.util.spec_from_file_location('first_cutover_signal', pathlib.Path(__file__).with_name('browser-first-cutover-signal.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
TARGET = dict(host='fixture', bootId='a' * 32, pid=101, ppid=1, start='200',
              uids=[998, 998, 998, 998], exe='/opt/node22/bin/node',
              cwd='/opt/holaday-monorepo/apps/orchestrator', argvDigest='b' * 64,
              role='main', managerIdentity={'kind': 'unmanaged'})


class Kernel:
    def __init__(self):
        self.actual = {k: copy.deepcopy(v) for k, v in TARGET.items() if k not in ('role', 'managerIdentity')}
        self.events = []

    def open(self, pid):
        self.events.append(('pin', pid))
        return 9

    def inspect(self, pid):
        return self.actual

    def term(self, fd):
        self.events.append(('term-fd', fd))

    def close(self, fd):
        self.events.append(('close', fd))


class Tests(unittest.TestCase):
    def test_case_sensitive_kernel_hostname_is_not_a_lowercase_route_alias(self):
        kernel = Kernel()
        actual = {**TARGET, 'host': 'iZbp1ActualNodeZ'}
        kernel.actual['host'] = actual['host']
        module.signal_legacy(actual, kernel)
        self.assertIn(('term-fd', 9), kernel.events)
        kernel = Kernel()
        kernel.actual['host'] = actual['host'].lower()
        with self.assertRaisesRegex(RuntimeError, 'CUTOVER_PROCESS_IDENTITY'):
            module.signal_legacy(actual, kernel)
        self.assertNotIn(('term-fd', 9), kernel.events)

    def test_only_pinned_original_receives_term(self):
        kernel = Kernel()
        module.signal_legacy(TARGET, kernel)
        self.assertEqual(kernel.events, [('pin', 101), ('term-fd', 9), ('close', 9)])

    def test_changed_identity_after_pin_never_receives_signal(self):
        for key, value in [('pid', 102), ('ppid', 12), ('start', '201'), ('uids', [0, 998, 998, 998]),
                           ('exe', '/tmp/node'), ('argvDigest', 'c' * 64), ('cwd', '/opt/other'),
                           ('host', 'foreign'), ('bootId', 'c' * 32)]:
            with self.subTest(key=key):
                kernel = Kernel()
                kernel.actual[key] = value
                with self.assertRaisesRegex(RuntimeError, 'CUTOVER_PROCESS_IDENTITY'):
                    module.signal_legacy(TARGET, kernel)
                self.assertEqual(kernel.events, [('pin', 101), ('close', 9)])

    def test_managed_or_unknown_target_never_pins(self):
        for change in [dict(managerIdentity={'kind': 'pm2'}), dict(role='unknown'), dict(pid=1),
                       dict(cwd='/opt/holaday-monorepo/../other'), dict(uids=[0]*4), dict(exe='/bin/sh')]:
            kernel = Kernel()
            with self.assertRaisesRegex(RuntimeError, 'CUTOVER_SIGNAL_INPUT'):
                module.signal_legacy({**TARGET, **change}, kernel)
            self.assertEqual(kernel.events, [])

    def test_independent_gateway_keeps_its_own_path_and_role(self):
        kernel = Kernel()
        cwd = '/opt/holaday-cn-payment/releases/083a6232aca7-20260804125641'
        kernel.actual['cwd'] = cwd
        module.signal_legacy({**TARGET, 'cwd': cwd, 'role': 'gateway'}, kernel)
        self.assertIn(('term-fd', 9), kernel.events)

    def test_kernel_failure_never_falls_back_to_numeric_kill(self):
        kernel = Kernel()
        def fail(_pid):
            raise PermissionError('denied')
        kernel.inspect = fail
        with self.assertRaises(PermissionError):
            module.signal_legacy(TARGET, kernel)
        self.assertEqual(kernel.events, [('pin', 101), ('close', 9)])

    def test_root_gateway_system_node_uses_exact_pidfd_identity(self):
        p = {**TARGET, 'role': 'gateway', 'uids': [0]*4, 'exe': '/usr/bin/node',
             'cwd': '/opt/holaday-cn-payment/releases/083a6232aca7-20260804125641/apps/cn-payment'}
        kernel = Kernel()
        kernel.actual = {k: p[k] for k in module.KEYS}
        module.signal_legacy(p, kernel)
        self.assertEqual(kernel.events, [('pin', 101), ('term-fd', 9), ('close', 9)])
        for change in [dict(exe='/usr/bin/dash'), dict(role='main'),
                       dict(cwd=p['cwd'].replace('/apps/cn-payment', '')),
                       dict(uids=[0, 998, 0, 0]), dict(exe='/tmp/node')]:
            with self.subTest(change=change):
                kernel = Kernel()
                with self.assertRaisesRegex(RuntimeError, 'CUTOVER_SIGNAL_INPUT'):
                    module.signal_legacy({**p, **change}, kernel)
                self.assertEqual(kernel.events, [])

    def test_root_gateway_release_drift_after_pinning_never_signals(self):
        p = {**TARGET, 'role': 'gateway', 'uids': [0]*4, 'exe': '/usr/bin/node',
             'cwd': '/opt/holaday-cn-payment/releases/083a6232aca7-20260804125641/apps/cn-payment'}
        kernel = Kernel()
        kernel.actual = {k: p[k] for k in module.KEYS}
        kernel.actual['cwd'] = p['cwd'].replace('083a6232aca7', 'aaaaaaaaaaaa')
        with self.assertRaisesRegex(RuntimeError, 'CUTOVER_PROCESS_IDENTITY'):
            module.signal_legacy(p, kernel)
        self.assertEqual(kernel.events, [('pin', 101), ('close', 9)])


if __name__ == '__main__':
    unittest.main()
