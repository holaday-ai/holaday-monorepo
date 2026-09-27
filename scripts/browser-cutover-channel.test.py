"""Boundary tests use real files and parsing; deployment SSH is tested separately."""
import importlib.util
import os
import pathlib
import tempfile
import unittest

path = pathlib.Path(__file__).with_name('browser-cutover-channel.py')
spec = importlib.util.spec_from_file_location('channel', path)
channel = importlib.util.module_from_spec(spec) if path.exists() else None
if channel:
    spec.loader.exec_module(channel)


class ChannelTest(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(channel, 'restricted channel implementation missing')

    def test_exact_probe_and_observe_only(self):
        self.assertEqual(channel.parse_command('holaday-cutover-v1 probe'), ('probe', None))
        nonce = 'a' * 32
        self.assertEqual(channel.parse_command('holaday-cutover-v1 observe ' + nonce), ('observe', nonce))

    def test_shell_subsystems_mutations_and_extra_arguments_never_dispatch(self):
        for command in ['', 'sh', 'bash -s', 'scp -t /tmp/x', 'internal-sftp',
                        'holaday-cutover-v1 probe;id', 'holaday-cutover-v1 probe\nid',
                        'holaday-cutover-v1 probe extra', 'holaday-cutover-v1 execute',
                        'holaday-cutover-v1 observe ' + 'a' * 31,
                        ' holaday-cutover-v1 probe', 'holaday-cutover-v1 probe\n']:
            with self.subTest(command=command), self.assertRaises(RuntimeError):
                channel.parse_command(command)

    def test_authorization_cannot_become_a_general_root_key(self):
        key = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
        line = channel.authorized_key_line(key)
        self.assertTrue(line.startswith('restrict,from="207.148.70.106",command="/usr/bin/python3 -I /var/lib/holaday-deploy/channel/browser-cutover-channel.py" '))
        self.assertTrue(line.endswith(key + ' holaday-cutover-v1\n'))
        for bad in [key + '\nssh-rsa AAAA', key + ' comment', 'ssh-rsa AAAA', key.replace('AAAAC3', 'BBBBB3')]:
            with self.assertRaises(RuntimeError):
                channel.authorized_key_line(bad)

    def test_append_preserves_existing_keys_and_does_not_duplicate_or_loosen(self):
        key = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
        prior = b'# operator\nssh-ed25519 AAAA unrelated'
        after = channel.append_authorization(prior, key)
        self.assertTrue(after.startswith(prior + b'\n'))
        self.assertEqual(channel.append_authorization(after, key), after)
        for prior in [(key + '\n').encode(), ('command="sh" ' + key + ' different\n').encode()]:
            with self.assertRaises(RuntimeError):
                channel.append_authorization(prior, key)

    def test_bundle_hash_and_file_permissions_are_checked_before_execution(self):
        import hashlib
        with tempfile.TemporaryDirectory() as folder:
            root = pathlib.Path(folder).resolve()
            file = root / 'observer.mjs'
            file.write_bytes(b'export const tested = true;\n')
            file.chmod(0o600)
            digest = hashlib.sha256(file.read_bytes()).hexdigest()
            self.assertEqual(channel.read_verified_file(file, digest, os.geteuid()), file.read_bytes())
            file.write_bytes(b'changed')
            with self.assertRaises(RuntimeError):
                channel.read_verified_file(file, digest, os.geteuid())
            file.chmod(0o666)
            with self.assertRaises(RuntimeError):
                channel.read_verified_file(file, hashlib.sha256(file.read_bytes()).hexdigest(), os.geteuid())
            file.chmod(0o600)
            link = root / 'linked'
            link.symlink_to(file)
            with self.assertRaises(RuntimeError):
                channel.read_verified_file(link, hashlib.sha256(file.read_bytes()).hexdigest(), os.geteuid())

    def test_installer_preserves_original_authorizations_and_refuses_changed_material(self):
        import hashlib
        key = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
        with tempfile.TemporaryDirectory() as folder:
            root = pathlib.Path(folder).resolve()
            auth = root / 'authorized_keys'
            auth.write_bytes(b'# keep this existing access\n')
            auth.chmod(0o600)
            bundle = {'browser-cutover-channel.py': b'entry', 'browser-cutover-evidence.mjs': b'observer',
                      'observer.sha256': hashlib.sha256(b'observer').hexdigest().encode()}
            target = root / 'channel'
            self.assertTrue(hasattr(channel, 'install_receiver'))
            receipt = channel.install_receiver(target, auth, key, bundle, os.geteuid())
            self.assertEqual((target / 'authorized_keys.before').read_bytes(), b'# keep this existing access\n')
            self.assertTrue(auth.read_bytes().startswith(b'# keep this existing access\n'))
            self.assertEqual(auth.stat().st_mode & 0o777, 0o600)
            self.assertEqual(receipt['authorizationDigest'], hashlib.sha256(auth.read_bytes()).hexdigest())
            with self.assertRaises((RuntimeError, FileExistsError)):
                channel.install_receiver(target, auth, key, bundle, os.geteuid())
            self.assertEqual(auth.read_bytes().count(b'holaday-cutover-v1\n'), 1)

    def test_sender_generates_local_identity_and_pins_existing_host_trust(self):
        trusted = '47.99.169.186 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIJ8mqMZRS/GZWclOC6CHDTgvRLDCGEkCo1HIze8h2L0Q\n'
        with tempfile.TemporaryDirectory() as folder:
            target = pathlib.Path(folder).resolve() / 'channel'
            self.assertTrue(hasattr(channel, 'install_sender'))
            receipt = channel.install_sender(target, trusted, os.geteuid())
            self.assertEqual(set(receipt), {'publicKey', 'knownHostsDigest'})
            channel.authorized_key_line(receipt['publicKey'])
            for name in ['identity', 'identity.pub', 'known_hosts']:
                self.assertEqual((target / name).stat().st_mode & 0o777, 0o600)
            self.assertEqual((target / 'known_hosts').read_text(), trusted)
            private_before = (target / 'identity').read_bytes()
            with self.assertRaises((RuntimeError, FileExistsError)):
                channel.install_sender(target, trusted, os.geteuid())
            self.assertEqual((target / 'identity').read_bytes(), private_before)
            with self.assertRaises(RuntimeError):
                channel.install_sender(target.parent / 'bad', trusted + '* ssh-rsa AAAA\n', os.geteuid())
            self.assertFalse((target.parent / 'bad').exists())


if __name__ == '__main__':
    unittest.main()
