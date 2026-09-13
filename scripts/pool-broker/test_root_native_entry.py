"""Actual root-service first entry; only the syscall boundary is synthetic."""
from pathlib import Path
import subprocess
import tempfile
import unittest


class RootNativeEntryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.base = Path(__file__).parent
        cls.temp = tempfile.TemporaryDirectory(prefix='holaday-root-entry-')
        cls.addClassCleanup(cls.temp.cleanup)
        cls.binary = Path(cls.temp.name) / 'root-boundary'
        cls.source = cls.base / 'root_native_entry.c'
        if cls.source.exists():
            result = subprocess.run(['/usr/bin/clang', '-std=c11', '-Wall', '-Wextra', '-Werror',
                '-ffreestanding', '-fno-builtin', '-fno-stack-protector', '-DHD_TEST_ROOT_ENTRY',
                '-DHD_CANDIDATE="' + 'a' * 40 + '"', str(cls.source),
                str(cls.base / 'tests-fixtures/native_kernel.c'), '-o', str(cls.binary)],
                capture_output=True, timeout=20)
            if result.returncode: raise AssertionError(result.stderr.decode())

    def run_entry(self, env, args=()):
        self.assertTrue(self.binary.exists(), 'root-service native entry missing')
        return subprocess.run([str(self.binary), *args], env=env, capture_output=True, timeout=5)

    def test_discards_all_inherited_environment_and_nonstdio_fds_before_interpreter(self):
        result = self.run_entry({'LD_PRELOAD': 'synthetic', 'PYTHONPATH': 'synthetic',
            'NODE_OPTIONS': 'synthetic', 'APP_SECRET': 'synthetic'})
        self.assertEqual((result.returncode, result.stdout, result.stderr), (0, b'', b''))

    def test_does_not_require_or_seal_application_environment(self):
        result = self.run_entry({})
        self.assertEqual((result.returncode, result.stdout, result.stderr), (0, b'', b''))

    def test_syscall_failure_never_dispatches_root_interpreter(self):
        for op, nth in ((0, 1), (0, 2), (1, 1), (1, 2), (2, 1), (2, 2), (2, 3), (3, 1), (10, 1)):
            with self.subTest(op=op, nth=nth):
                result = self.run_entry({'HD_TEST_FAILURE': '%d:%d' % (op, nth)})
                self.assertEqual((result.returncode, result.stdout, result.stderr), (111, b'', b''))

    def test_rejects_untrusted_stdio_or_runtime_arguments(self):
        for bad in ('owner', 'stdio_file', 'mask'):
            with self.subTest(bad=bad):
                result = self.run_entry({'HD_TEST_CORRUPT': bad})
                self.assertEqual((result.returncode, result.stdout, result.stderr), (111, b'', b''))
        result = self.run_entry({}, ('unexpected',))
        self.assertEqual((result.returncode, result.stdout, result.stderr), (111, b'', b''))

    def test_both_linux_targets_compile_without_libc(self):
        self.assertTrue(self.source.exists(), 'root-service native entry missing')
        for target in ('x86_64-linux-gnu', 'aarch64-linux-gnu'):
            with self.subTest(target=target):
                result = subprocess.run(['/usr/bin/clang', '--target=' + target, '-ffreestanding',
                    '-fno-builtin', '-fno-stack-protector', '-nostdinc', '-Wall', '-Wextra', '-Werror',
                    '-DHD_CANDIDATE="' + 'a' * 40 + '"', '-c', str(self.source), '-o',
                    str(Path(self.temp.name) / (target + '.o'))], capture_output=True, timeout=20)
                self.assertEqual(result.returncode, 0, result.stderr.decode())


if __name__ == '__main__': unittest.main()
