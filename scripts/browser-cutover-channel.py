"""Fixed SSH entry for the approved Vultr -> Aliyun deployment identity.

Probe/observe remain read-only. The fixed ingress session additionally requires
a separately installed protected bundle and attempt approval on the receiving
host. This is NOT a remote shell, installer, or replacement release journal.
"""
import base64
import hashlib
import json
import os
import pathlib
import re
import socket
import stat
import subprocess
import sys

ROOT = pathlib.Path('/var/lib/holaday-deploy/channel')
ENTRY = ROOT / 'browser-cutover-channel.py'
SOURCE_IP = '207.148.70.106'
ERROR = 'CUTOVER_CHANNEL_UNPROVEN'
INGRESS_MODULES = frozenset([
    'browser-backup-age.mjs', 'browser-cutover-evidence.mjs',
    'browser-first-cutover-backup.mjs', 'browser-first-cutover-fence.mjs',
    'browser-first-cutover-host.mjs', 'browser-first-cutover-ingress-files.mjs',
    'browser-first-cutover-ingress-session.mjs', 'browser-first-cutover-inventory.mjs',
    'browser-first-cutover-nginx.mjs', 'browser-first-cutover-runtime.mjs',
    'browser-maintenance-host.mjs', 'browser-maintenance-journal.mjs',
    'browser-maintenance-linux.mjs', 'browser-maintenance-manifest.mjs',
    'browser-maintenance-policy.mjs', 'browser-maintenance-release-tail.mjs',
    'browser-maintenance-runtime-system.mjs', 'browser-maintenance-runtime.mjs',
    'browser-maintenance-transition.mjs', 'browser-payment-port-fence.mjs',
])


def parse_command(value):
    if value == 'holaday-cutover-v1 probe':
        return 'probe', None
    match = re.fullmatch(r'holaday-cutover-v1 observe ([a-f0-9]{32})', value)
    if match:
        return 'observe', match[1]
    match = re.fullmatch(r'holaday-cutover-v1 ingress ([a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})', value)
    if match:
        return 'ingress', match[1]
    raise RuntimeError(ERROR)


def authorized_key_line(public_key):
    match = re.fullmatch(r'ssh-ed25519 ([A-Za-z0-9+/]{68})', public_key)
    if not match:
        raise RuntimeError(ERROR)
    raw = base64.b64decode(match[1], validate=True)
    if len(raw) != 51 or raw[:19] != b'\x00\x00\x00\x0bssh-ed25519\x00\x00\x00\x20':
        raise RuntimeError(ERROR)
    return (f'restrict,from="{SOURCE_IP}",command="/usr/bin/python3 -I {ENTRY}" '
            f'{public_key} holaday-cutover-v1\n')


def append_authorization(previous, public_key):
    line = authorized_key_line(public_key).encode()
    key_bytes = public_key.split(' ')[1].encode()
    matches = [item for item in previous.splitlines() if key_bytes in item.split()]
    if matches:
        if matches != [line.rstrip(b'\n')]:
            raise RuntimeError(ERROR)
        return previous
    return previous + (b'\n' if previous and not previous.endswith(b'\n') else b'') + line


def read_verified_file(path, expected_digest=None, owner=0, limit=1024 * 1024):
    def check(value):
        if (not stat.S_ISREG(value.st_mode) or value.st_uid != owner or
                stat.S_IMODE(value.st_mode) != 0o600 or value.st_nlink != 1 or
                value.st_size < 1 or value.st_size > limit):
            raise RuntimeError(ERROR)
    fd = None
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        before = os.fstat(fd)
        check(before)
        with os.fdopen(os.dup(fd), 'rb') as stream:
            value = stream.read(limit + 1)
        after = os.fstat(fd)
        current = os.lstat(path)
        check(after)
        check(current)
        identity = lambda s: (s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns, s.st_ctime_ns)
        if (identity(before) != identity(after) or identity(after) != identity(current) or
                len(value) != before.st_size or
                (expected_digest is not None and hashlib.sha256(value).hexdigest() != expected_digest)):
            raise RuntimeError(ERROR)
        return value
    except OSError as error:
        raise RuntimeError(ERROR) from error
    finally:
        if fd is not None:
            os.close(fd)


def verify_ingress_bundle(root, owner=0):
    """Fixed complete module closure, immutable to application users. No upload API."""
    root = pathlib.Path(root)
    before = root.lstat()
    if (not stat.S_ISDIR(before.st_mode) or before.st_uid != owner or
            stat.S_IMODE(before.st_mode) != 0o700 or root.resolve() != root or
            {p.name for p in root.iterdir()} != INGRESS_MODULES | {'bundle.json'}):
        raise RuntimeError(ERROR)
    manifest = json.loads(read_verified_file(root / 'bundle.json', owner=owner, limit=16 * 1024))
    if (set(manifest) != {'schemaVersion', 'files'} or manifest['schemaVersion'] != 1 or
            not isinstance(manifest['files'], dict) or set(manifest['files']) != INGRESS_MODULES):
        raise RuntimeError(ERROR)
    for name, digest in manifest['files'].items():
        if not isinstance(digest, str) or not re.fullmatch('[a-f0-9]{64}', digest):
            raise RuntimeError(ERROR)
        read_verified_file(root / name, digest, owner=owner)
    current = root.lstat()
    if (before.st_dev, before.st_ino, before.st_mtime_ns, before.st_ctime_ns) != (
            current.st_dev, current.st_ino, current.st_mtime_ns, current.st_ctime_ns):
        raise RuntimeError(ERROR)
    return root / 'browser-first-cutover-ingress-session.mjs'


def install_sender(target, trusted_host, owner=0):
    """Administrator-only setup: generate locally; return public material only."""
    target = pathlib.Path(target)
    pieces = trusted_host.rstrip('\n').split(' ')
    if len(pieces) != 3 or pieces[0] != '47.99.169.186' or trusted_host != ' '.join(pieces) + '\n':
        raise RuntimeError(ERROR)
    authorized_key_line(' '.join(pieces[1:]))  # Validate exact ed25519 blob.
    parent = target.parent.lstat()
    if (not stat.S_ISDIR(parent.st_mode) or parent.st_uid != owner or
            parent.st_mode & 0o022 or target.parent.resolve() != target.parent):
        raise RuntimeError(ERROR)
    target.mkdir(mode=0o700)  # An uncertain/partial prior run must be inspected.
    previous_umask = os.umask(0o077)
    try:
        subprocess.run(['/usr/bin/ssh-keygen', '-q', '-t', 'ed25519', '-N', '',
                        '-C', 'holaday-cutover-v1', '-f', str(target / 'identity')],
                       check=True, stdin=subprocess.DEVNULL,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for name in ['identity', 'identity.pub']:
            value = (target / name).lstat()
            if (not stat.S_ISREG(value.st_mode) or value.st_uid != owner or
                    stat.S_IMODE(value.st_mode) != 0o600 or value.st_nlink != 1):
                raise RuntimeError(ERROR)
        public_key = ' '.join((target / 'identity.pub').read_text().split()[:2])
        authorized_key_line(public_key)
        fd = os.open(target / 'known_hosts', os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, 'wb') as stream:
            stream.write(trusted_host.encode())
            stream.flush()
            os.fsync(stream.fileno())
        for path in [target / 'identity', target / 'identity.pub', target]:
            fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
            try:
                os.fsync(fd)
            finally:
                os.close(fd)
        return {'publicKey': public_key, 'knownHostsDigest': hashlib.sha256(trusted_host.encode()).hexdigest()}
    finally:
        os.umask(previous_umask)


def install_receiver(target, authorization, public_key, bundle, owner=0):
    """Called only by the existing administrator SSH setup, NEVER by forced entry.

    Exact new directory only; backup existing authorization bytes before an
    atomic append. No SSH daemon/config changes or existing-key removal.
    """
    target, authorization = pathlib.Path(target), pathlib.Path(authorization)
    expected = {'browser-cutover-channel.py', 'browser-cutover-evidence.mjs', 'observer.sha256'}
    if set(bundle) != expected or not all(isinstance(v, bytes) and 0 < len(v) <= 1024 * 1024 for v in bundle.values()):
        raise RuntimeError(ERROR)
    if bundle['observer.sha256'].decode().strip() != hashlib.sha256(bundle['browser-cutover-evidence.mjs']).hexdigest():
        raise RuntimeError(ERROR)
    for parent in [target.parent, authorization.parent]:
        s = parent.lstat()
        if not stat.S_ISDIR(s.st_mode) or s.st_uid != owner or s.st_mode & 0o022 or parent.resolve() != parent:
            raise RuntimeError(ERROR)
    # Empty existing authorized_keys is valid. Do not create or replace an unknown path.
    before = authorization.lstat()
    if not stat.S_ISREG(before.st_mode) or before.st_uid != owner or stat.S_IMODE(before.st_mode) != 0o600 or before.st_nlink != 1:
        raise RuntimeError(ERROR)
    fd = os.open(authorization, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        with os.fdopen(os.dup(fd), 'rb') as stream:
            original = stream.read(1024 * 1024 + 1)
        if len(original) != before.st_size or len(original) > 1024 * 1024:
            raise RuntimeError(ERROR)
    finally:
        os.close(fd)
    replacement = append_authorization(original, public_key)
    target.mkdir(mode=0o700)  # Never overwrite an existing installation/partial run.
    def write_new(path, value):
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, 'wb') as stream:
            stream.write(value)
            stream.flush()
            os.fsync(stream.fileno())
    for name, value in bundle.items():
        write_new(target / name, value)
    write_new(target / 'authorized_keys.before', original)
    pending = authorization.parent / 'holaday-cutover-authorized_keys.pending'
    write_new(pending, replacement)
    current = authorization.lstat()
    signature = lambda s: (s.st_dev, s.st_ino, s.st_mode, s.st_uid, s.st_gid, s.st_nlink, s.st_size, s.st_mtime_ns, s.st_ctime_ns)
    if signature(before) != signature(current) or authorization.read_bytes() != original:
        raise RuntimeError(ERROR)
    os.chown(pending, -1, before.st_gid)
    os.replace(pending, authorization)
    for folder in [target, target.parent, authorization.parent]:
        directory_fd = os.open(folder, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
    if authorization.read_bytes() != replacement:
        raise RuntimeError(ERROR)
    return {'authorizationDigest': hashlib.sha256(replacement).hexdigest(),
            'previousAuthorizationDigest': hashlib.sha256(original).hexdigest(),
            'entryDigest': hashlib.sha256(bundle['browser-cutover-channel.py']).hexdigest(),
            'observerDigest': hashlib.sha256(bundle['browser-cutover-evidence.mjs']).hexdigest()}


def main():
    if sys.platform != 'linux' or os.geteuid() != 0 or len(sys.argv) != 1:
        raise RuntimeError(ERROR)
    connection = os.environ.get('SSH_CONNECTION', '').split(' ')
    if (len(connection) != 4 or connection[0] != SOURCE_IP or
            not all(p.isdigit() and 0 < int(p) <= 65535 for p in [connection[1], connection[3]]) or
            os.environ.get('SSH_TTY')):
        raise RuntimeError(ERROR)
    action, request_id = parse_command(os.environ.get('SSH_ORIGINAL_COMMAND', ''))
    for folder in [ROOT.parent, ROOT]:
        s = folder.lstat()
        if (not stat.S_ISDIR(s.st_mode) or s.st_uid != 0 or
                s.st_mode & (0o077 if folder == ROOT else 0o022) or folder.resolve() != folder):
            raise RuntimeError(ERROR)
    entry_digest = hashlib.sha256(read_verified_file(ENTRY)).hexdigest()
    if action == 'ingress':
        entry = verify_ingress_bundle(ROOT / 'ingress')
        os.chdir('/')
        os.execve('/usr/bin/node', ['/usr/bin/node', str(entry), request_id],
                  {'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'HOME': '/root',
                   'PM2_HOME': '/root/.pm2', 'LANG': 'C', 'GIT_OPTIONAL_LOCKS': '0'})
    if action == 'probe':
        print(json.dumps({'protocol': 1, 'host': 'aliyun', 'hostname': socket.gethostname(),
                          'entryDigest': entry_digest, 'actions': ['probe', 'observe']}))
        return
    expected = read_verified_file(ROOT / 'observer.sha256', limit=65).decode().strip()
    if not re.fullmatch('[a-f0-9]{64}', expected):
        raise RuntimeError(ERROR)
    source = read_verified_file(ROOT / 'browser-cutover-evidence.mjs', expected, limit=96 * 1024).decode('utf-8')
    program = source + '''\ntry {
      const snapshot = await readCutoverHostSnapshot();
      snapshot.observer = snapshot.processes.find(p => p.pid === process.pid);
      if (!snapshot.observer) throw new Error('observer');
      process.stdout.write(JSON.stringify({protocol:1,host:'aliyun',requestId:REQUEST_ID,sourceDigest:SOURCE_DIGEST,sourceCandidate:null,snapshot}));
    } catch { process.stderr.write('CUTOVER_CHANNEL_UNPROVEN'); process.exitCode=1; }\n'''.replace(
        'REQUEST_ID', json.dumps(request_id)).replace('SOURCE_DIGEST', json.dumps(expected))
    # Replace this process: retaining a Python parent named holaday would correctly
    # appear as an additional unknown launcher in the existing complete observer.
    # Only public pinned collector source enters argv; no config or key material.
    os.chdir('/')
    os.execve('/usr/bin/node', ['/usr/bin/node', '--input-type=module', '--eval', program],
              {'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'HOME': '/root', 'PM2_HOME': '/root/.pm2',
               'LANG': 'C', 'GIT_OPTIONAL_LOCKS': '0'})


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print(ERROR, file=sys.stderr)
        sys.exit(1)
