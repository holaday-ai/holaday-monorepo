"""Trusted-file IO and module loading, not Linux artifact attestation."""

import hashlib
import json
from pathlib import Path
import stat
import sys
import unittest
from contextlib import ExitStack
from types import SimpleNamespace
from unittest.mock import patch

import bootstrap
import test_installation


class BootstrapTrustTests(unittest.TestCase):
    def setUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.fs = self.stack.enter_context(test_installation.InstallationTests().system())
        self.base = self.fs.package
        names = ('installation.py', 'process_pin.py', 'protocol.py', 'launch_authorization.py', 'launch_registration.py',
                 'application_guard.py', 'root_launch.py', 'runtime_channel.py', 'resource_journal.py', 'manager_probe.py', 'launch_listener.py', 'bootstrap_input.py', 'bootstrap.py',
                 'application_env_keys.json', 'xvfb_launch.py', 'resource_recovery.py')
        self.sources = {name: (Path(__file__).parent / name).read_bytes() for name in names}
        self.sources['native-entry'] = b'synthetic artifact - not a real Linux ELF'
        self.payloads = {self.base + '/' + name: data for name, data in self.sources.items()}
        tools = ('/usr/bin/python3', '/usr/bin/setpriv', '/opt/node22/bin/node', '/usr/bin/busctl', '/usr/bin/Xvfb')
        self.payloads.update({tool: ('synthetic tool ' + tool).encode() for tool in tools})
        self.manifest = {'version': 1, 'status': 'linux-verified', 'candidate': 'a' * 40,
            'architecture': 'x86_64', 'files': {name: hashlib.sha256(data).hexdigest()
                for name, data in self.sources.items()}, 'tools': {tool: {'resolved': tool,
                'sha256': hashlib.sha256(self.payloads[tool]).hexdigest()} for tool in tools}}
        self.manifest_path = self.base + '/native-build-manifest.json'
        self.payloads[self.manifest_path] = json.dumps(self.manifest).encode()
        def add(path, regular=False):
            if path != '/' and str(Path(path).parent) not in self.fs.paths:
                add(str(Path(path).parent))
            self.fs.paths[path] = SimpleNamespace(st_uid=0, st_gid=0,
                st_mode=(stat.S_IFREG | (0o755 if path in tools or path.endswith('/native-entry') else 0o644))
                    if regular else stat.S_IFDIR | 0o755,
                st_nlink=1 if regular else 2, st_size=len(self.payloads.get(path, b'')), attrs=[])
        for path in self.payloads:
            add(path, regular=True)
        self.stack.enter_context(patch.object(bootstrap.os, 'pread', side_effect=self.read, create=True))
        self.stack.enter_context(patch.object(bootstrap.os, 'uname', return_value=SimpleNamespace(machine='x86_64')))
        self.stack.enter_context(patch.object(bootstrap.os.path, 'realpath', side_effect=lambda path: path))
        self.stack.enter_context(patch.object(bootstrap, '__file__', self.base + '/bootstrap.py'))

    def read(self, fd, count, offset):
        return self.payloads[self.fs.opened[fd]][offset:offset + count]

    def sync_manifest(self):
        self.payloads[self.manifest_path] = json.dumps(self.manifest).encode()
        self.fs.paths[self.manifest_path].st_size = len(self.payloads[self.manifest_path])

    def verify(self):
        return bootstrap._verify_release('a' * 40)

    def test_verifies_exact_files_and_tools_before_returning_module_bytes(self):
        sources = self.verify()
        self.assertEqual(sources, self.sources)
        self.assertEqual(self.fs.opened, {})
        self.assertEqual(set(self.payloads), {path for path, _, _ in self.fs.calls if path in self.payloads})

    def test_bad_manifest_bindings_and_extra_keys_are_not_accepted(self):
        for field, value in [('status', 'unverified'), ('candidate', 'b' * 40),
                             ('architecture', 'aarch64'), ('version', True), ('extra', 'ignored')]:
            with self.subTest(field=field):
                old = dict(self.manifest)
                self.manifest[field] = value
                self.sync_manifest()
                with self.assertRaises(ValueError):
                    self.verify()
                self.assertEqual(self.fs.opened, {})
                self.manifest = old
        self.sync_manifest()

    def test_digest_mismatch_and_missing_module_fail_before_loading(self):
        for name in ('bootstrap.py', 'bootstrap_input.py', 'application_env_keys.json', 'native-entry'):
            with self.subTest(name=name):
                old = self.payloads[self.base + '/' + name]
                self.payloads[self.base + '/' + name] = b'x' + old[1:]
                with self.assertRaises(ValueError):
                    self.verify()
                self.payloads[self.base + '/' + name] = old
        del self.manifest['files']['root_launch.py']
        self.sync_manifest()
        with self.assertRaises(ValueError):
            self.verify()

    def test_untrusted_ancestor_or_file_never_returns_sources(self):
        for path, field, bad in [('/usr/local', 'st_uid', 998),
                (self.base, 'st_mode', stat.S_IFDIR | 0o777),
                (self.manifest_path, 'attrs', ['system.posix_acl_access']),
                (self.manifest_path, 'st_nlink', 2),
                (self.manifest_path, 'st_mode', stat.S_IFIFO | 0o644)]:
            with self.subTest(path=path, field=field):
                info = self.fs.paths[path]
                old = getattr(info, field)
                setattr(info, field, bad)
                with self.assertRaises(ValueError):
                    self.verify()
                self.assertEqual(self.fs.opened, {})
                setattr(info, field, old)

    def test_duplicate_json_fields_are_rejected(self):
        self.payloads[self.manifest_path] = b'{"version":1,"version":1}'
        self.fs.paths[self.manifest_path].st_size = len(self.payloads[self.manifest_path])
        with self.assertRaises(ValueError):
            self.verify()

    def test_verified_source_bytes_are_loaded_without_adding_app_sys_path(self):
        sources = self.verify()
        old_path = list(sys.path)
        names = [name[:-3] for name in sources if name.endswith('.py') and name != 'bootstrap.py']
        original = {name: sys.modules.pop(name, None) for name in names}
        try:
            # A changed second path read must never replace the verified bytes.
            with patch.object(Path, 'read_text', return_value='{"keys": {}}') as reread:
                modules = bootstrap._load_modules(sources)
            raw = b'HPR1' + b'a' * 40 + b'NODE_ENV=production\0\0'
            self.assertEqual(modules['bootstrap_input'].decode_bootstrap_input(raw, 'a' * 40), {'NODE_ENV': 'production'})
            reread.assert_not_called()
            self.assertEqual(modules['root_launch'].__file__, self.base + '/root_launch.py')
            self.assertIs(modules['launch_registration'].LaunchWindow, modules['launch_authorization'].LaunchWindow)
            self.assertIs(modules['launch_listener'].LaunchRegistration, modules['launch_registration'].LaunchRegistration)
            self.assertIs(modules['resource_journal'].LaunchRegistration, modules['launch_registration'].LaunchRegistration)
            self.assertIs(modules['manager_probe'].LaunchRegistration, modules['launch_registration'].LaunchRegistration)
            self.assertIs(modules['xvfb_launch'].ResourceJournal, modules['resource_journal'].ResourceJournal)
            self.assertIs(modules['xvfb_launch'].manager_probe, modules['manager_probe'])
            self.assertIs(modules['resource_recovery'].ResourceJournal, modules['resource_journal'].ResourceJournal)
            self.assertIs(modules['resource_recovery'].manager_probe, modules['manager_probe'])
            self.assertIs(modules['launch_listener'].launch_authorization, modules['launch_authorization'])
            self.assertIs(modules['launch_listener'].runtime_channel, modules['runtime_channel'])
            self.assertEqual(sys.path, old_path)
        finally:
            for name in names:
                sys.modules.pop(name, None)
                if original[name] is not None:
                    sys.modules[name] = original[name]

    def test_preexisting_broker_modules_are_not_trusted(self):
        with self.assertRaises(ValueError):
            bootstrap._load_modules(self.sources)

    def test_ordinary_decoder_import_has_no_default_policy(self):
        namespace = {'__name__': 'synthetic_uninitialized_decoder'}
        exec(compile(self.sources['bootstrap_input.py'], 'synthetic', 'exec'), namespace)
        self.assertNotIn('_KEYS', namespace)
        with self.assertRaisesRegex(ValueError, '^POOL_BROKER_BOOTSTRAP_INPUT_UNPROVEN$'):
            namespace['decode_bootstrap_input'](b'HPR1' + b'a' * 40 + b'NODE_ENV=production\0\0', 'a' * 40)

    def test_read_and_close_failures_never_return_trusted_bytes(self):
        with patch.object(bootstrap.os, 'pread', return_value=b''):
            with self.assertRaises(ValueError):
                self.verify()
        self.assertEqual(self.fs.opened, {})
        close = self.fs.mocks['close'].side_effect
        def fail(fd):
            close(fd)
            raise OSError('synthetic close failure')
        self.fs.mocks['close'].side_effect = fail
        with self.assertRaises(ValueError):
            self.verify()
        self.assertEqual(self.fs.opened, {})
        self.assertEqual(len(self.fs.closed), len(set(self.fs.closed)))

    def test_only_root_owned_conventional_python_symlink_is_supported(self):
        path = '/usr/bin/python3.10'
        self.payloads[path] = self.payloads['/usr/bin/python3']
        self.fs.paths[path] = self.fs.paths['/usr/bin/python3']
        self.manifest['tools']['/usr/bin/python3']['resolved'] = path
        self.sync_manifest()
        link = SimpleNamespace(st_mode=stat.S_IFLNK | 0o777, st_uid=0, st_gid=0, st_nlink=1)
        with patch.object(bootstrap.os.path, 'realpath', side_effect=lambda p: path if p == '/usr/bin/python3' else p), \
                patch.object(bootstrap.os, 'lstat', return_value=link), \
                patch.object(bootstrap.os, 'readlink', return_value='python3.10'):
            self.verify()
            link.st_uid = 998
            with self.assertRaises(ValueError):
                self.verify()
