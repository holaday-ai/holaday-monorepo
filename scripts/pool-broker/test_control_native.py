"""Actual bounded native core; kernel substitutions are explicit, not Linux proof."""
from pathlib import Path
import subprocess
import tempfile
import unittest
import json


class ControlNativeTests(unittest.TestCase):
    def test_napi_keeps_actual_socket_private_and_exposes_only_checked_bytes(self):
        base = Path(__file__).parent
        node = '/Users/yaleiqi/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node'
        with tempfile.TemporaryDirectory(prefix='hc-', dir='/tmp') as directory:
            module = Path(directory) / 'control.node'
            leaf = str(Path(directory) / 'c.sock')
            result = subprocess.run(['/usr/bin/clang', '-std=c11', '-Wall', '-Wextra', '-Werror',
                '-bundle', '-undefined', 'dynamic_lookup', '-I/usr/local/include/node',
                '-DHC_TEST_PATH=' + json.dumps(leaf), str(base / 'control_native_core.c'),
                str(base / 'control_native_napi.c'), str(base / 'tests-fixtures/control_native_socket.c'),
                '-o', str(module)], capture_output=True, timeout=20)
            self.assertEqual(result.returncode, 0, result.stderr.decode())
            result = subprocess.run([node, str(base / 'tests-fixtures/control_native_io.cjs'),
                str(module), leaf], capture_output=True, timeout=10)
            self.assertEqual((result.returncode, result.stdout, result.stderr), (0, b'', b''))

    def test_linux_receiver_rejects_ancillary_identity_and_original_object_changes(self):
        base = Path(__file__).parent
        with tempfile.TemporaryDirectory(prefix='hc-linux-') as directory:
            binary = Path(directory) / 'control'
            result = subprocess.run(['/usr/bin/clang', '-std=c11', '-Wall', '-Wextra', '-Werror',
                '-DHD_CONTROL_LINUX_TEST=1', str(base / 'control_native_core.c'),
                str(base / 'control_native_linux.c'), str(base / 'tests-fixtures/control_native_linux_seam.c'),
                '-o', str(binary)], capture_output=True, timeout=20)
            self.assertEqual(result.returncode, 0, result.stderr.decode())
            result = subprocess.run([str(binary)], capture_output=True, timeout=5)
            self.assertEqual((result.returncode, result.stdout, result.stderr), (0, b'', b''))

    def test_original_native_control_owns_io_and_cleanup_until_close(self):
        base = Path(__file__).parent
        self.assertTrue((base / 'control_native_core.c').is_file(), 'native control owner missing')
        with tempfile.TemporaryDirectory(prefix='hc-core-') as directory:
            binary = Path(directory) / 'control'
            result = subprocess.run(['/usr/bin/clang', '-std=c11', '-Wall', '-Wextra', '-Werror',
                str(base / 'control_native_core.c'), str(base / 'tests-fixtures/control_native_kernel.c'),
                '-o', str(binary)], capture_output=True, timeout=20)
            self.assertEqual(result.returncode, 0, result.stderr.decode())
            result = subprocess.run([str(binary)], capture_output=True, timeout=5)
            self.assertEqual((result.returncode, result.stdout, result.stderr), (0, b'', b''))
