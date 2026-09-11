"""Compile the real freestanding core with synthetic syscall boundary only."""

from pathlib import Path
import subprocess
import tempfile
import unittest

import test_bootstrap_input as input_tests

bootstrap_input = input_tests.bootstrap_input


class NativeEntryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.base = Path(__file__).parent
        if not (cls.base / 'native_entry.c').is_file():
            return
        cls.temp = tempfile.TemporaryDirectory(prefix='holaday-native-test-')
        cls.addClassCleanup(cls.temp.cleanup)
        cls.binary = Path(cls.temp.name) / 'native-boundary'
        result = subprocess.run(['/usr/bin/clang', '-std=c11', '-Wall', '-Wextra', '-Werror',
                                 '-ffreestanding', '-fno-builtin', '-fno-stack-protector',
                                 '-DHD_CANDIDATE="' + 'a' * 40 + '"',
                                 str(cls.base / 'native_entry.c'),
                                 str(cls.base / 'tests-fixtures/native_kernel.c'),
                                 '-o', str(cls.binary)], capture_output=True, timeout=20)
        if result.returncode:
            raise AssertionError(result.stderr.decode())

    def test_native_first_exec_outputs_sealed_input_and_only_minimal_environment(self):
        self.assertTrue((self.base / 'native_entry.c').is_file(), 'native first entry missing')
        result = subprocess.run([str(self.binary)], env={'NODE_ENV': 'production', 'LOG_LEVEL': '',
                                'LD_PRELOAD': 'synthetic', 'PYTHONPATH': 'synthetic',
                                'NODE_CHANNEL_FD': '99'}, capture_output=True, timeout=5)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(bootstrap_input.decode_bootstrap_input(result.stdout, 'a' * 40),
                         {'NODE_ENV': 'production', 'LOG_LEVEL': ''})

    def rejected(self, env, args=()):
        result = subprocess.run([str(self.binary), *args], env=env, capture_output=True, timeout=5)
        self.assertEqual((result.returncode, result.stdout, result.stderr), (111, b'', b''))

    def test_all_syscall_errors_stop_before_first_interpreter(self):
        for op, nth in [(0, 1), (0, 2), (1, 1), (1, 2), (2, 1), (2, 4), (3, 1), (3, 2),
                        (4, 1), (5, 1), (6, 1), (7, 1), (7, 2), (7, 3), (10, 1)]:
            with self.subTest(op=op, nth=nth):
                self.rejected({'NODE_ENV': 'production', 'HD_TEST_FAILURE': '%d:%d' % (op, nth)})
        for op in (8, 9):
            with self.subTest(op=op):
                self.rejected({'NODE_ENV': 'production', 'HD_TEST_FD': '9', 'HD_TEST_FAILURE': '%d:1' % op})

    def test_capsule_descriptor_not_three_is_remapped(self):
        result = subprocess.run([str(self.binary)], env={'NODE_ENV': 'production', 'HD_TEST_FD': '9'},
                                capture_output=True, timeout=5)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(bootstrap_input.decode_bootstrap_input(result.stdout, 'a' * 40), {'NODE_ENV': 'production'})

    def test_untrusted_stdio_and_capsule_metadata_are_rejected(self):
        for bad in ('owner', 'stdio_file', 'size', 'mask', 'zero_write', 'seals'):
            with self.subTest(bad=bad):
                self.rejected({'NODE_ENV': 'production', 'HD_TEST_CORRUPT': bad})

    def test_entry_rejects_extra_arguments_empty_env_and_native_budgets(self):
        self.rejected({'NODE_ENV': 'production'}, ('unexpected',))
        self.rejected({})
        self.rejected({'X': 'x' * 131070})
        self.rejected({'X%d' % i: 'x' for i in range(1025)})

    def test_linux_abi_sources_compile_without_host_libc(self):
        for target in ('x86_64-linux-gnu', 'aarch64-linux-gnu'):
            for source in ('native_entry.c', 'native_linux.c', 'native_entry_start.S'):
                with self.subTest(target=target, source=source):
                    self.assertTrue((self.base / source).is_file(), 'Linux first-entry source missing')
                    result = subprocess.run(['/usr/bin/clang', '--target=' + target, '-ffreestanding',
                        '-fno-builtin', '-fno-stack-protector', '-nostdinc', '-Wall', '-Wextra', '-Werror',
                        '-DHD_CANDIDATE="' + 'a' * 40 + '"', '-c', str(self.base / source), '-o',
                        str(Path(self.temp.name) / (target + source + '.o'))], capture_output=True, timeout=20)
                    self.assertEqual(result.returncode, 0, result.stderr.decode())


if __name__ == '__main__':
    unittest.main()
