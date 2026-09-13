"""Actual C ownership core; syscall semantics are explicitly synthetic here."""
from pathlib import Path
import subprocess
import tempfile
import unittest
import json


class EgressNativeTests(unittest.TestCase):
    def test_linux_fixed_creation_backend_at_explicit_synthetic_kernel_boundary(self):
        base = Path(__file__).parent
        self.assertTrue((base / 'egress_native_linux.c').is_file(), 'Linux listener backend missing')
        with tempfile.TemporaryDirectory(prefix='he-linux-') as directory:
            binary = Path(directory) / 'linux-boundary'
            result = subprocess.run(['/usr/bin/clang', '-std=c11', '-Wall', '-Wextra', '-Werror',
                '-DHD_EGRESS_LINUX_TEST=1', str(base / 'egress_native_core.c'),
                str(base / 'egress_native_linux.c'), str(base / 'tests-fixtures/egress_native_linux_seam.c'),
                '-o', str(binary)], capture_output=True, timeout=20)
            self.assertEqual(result.returncode, 0, result.stderr.decode())
            result = subprocess.run([str(binary)], capture_output=True, timeout=5)
            self.assertEqual((result.returncode, result.stdout, result.stderr), (0, b'', b''))

    def test_napi_real_node_fd_adoption_preserves_replaced_leaf(self):
        base = Path(__file__).parent
        self.assertTrue((base / 'egress_native_napi.c').is_file(), 'N-API listener missing')
        node = '/Users/yaleiqi/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node'
        for mode in ('adopt', 'gc-before', 'gc-after'):
            with self.subTest(mode=mode), tempfile.TemporaryDirectory(prefix='he-', dir='/tmp') as directory:
                module = Path(directory) / 'listener.node'
                leaf = str(Path(directory) / 'e.sock')
                result = subprocess.run(['/usr/bin/clang', '-std=c11', '-Wall', '-Wextra', '-Werror',
                    '-bundle', '-undefined', 'dynamic_lookup', '-I/usr/local/include/node',
                    '-DHD_EGRESS_FINALIZER_OBSERVER=1', '-DHE_TEST_PATH=' + json.dumps(leaf),
                    str(base / 'egress_native_core.c'), str(base / 'egress_native_napi.c'),
                    str(base / 'tests-fixtures/egress_native_socket.c'),
                    '-o', str(module)], capture_output=True, timeout=20)
                self.assertEqual(result.returncode, 0, result.stderr.decode())
                result = subprocess.run([node, '--expose-gc', str(base / 'tests-fixtures/egress_native_adoption.cjs'),
                    str(module), leaf, mode], capture_output=True, timeout=10)
                self.assertEqual((result.returncode, result.stdout, result.stderr), (0, b'', b''))

    def test_original_fd_core_failure_deadline_and_one_shot_transfer(self):
        base = Path(__file__).parent
        self.assertTrue((base / 'egress_native_core.c').is_file(), 'fixed original Node listener core missing')
        with tempfile.TemporaryDirectory(prefix='holaday-egress-native-') as directory:
            binary = Path(directory) / 'ownership'
            result = subprocess.run(['/usr/bin/clang', '-std=c11', '-Wall', '-Wextra', '-Werror',
                str(base / 'egress_native_core.c'), str(base / 'tests-fixtures/egress_native_kernel.c'),
                '-o', str(binary)], capture_output=True, timeout=20)
            self.assertEqual(result.returncode, 0, result.stderr.decode())
            result = subprocess.run([str(binary)], capture_output=True, timeout=5)
            self.assertEqual((result.returncode, result.stdout, result.stderr), (0, b'', b''))


if __name__ == '__main__':
    unittest.main()
