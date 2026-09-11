"""Fixed first-exec consumer. No application imports or public launch options."""

import fcntl
import hashlib
import json
import os
import re
import stat
import socket
import sys
import types


_MODULES = ('installation', 'process_pin', 'protocol', 'launch_authorization', 'launch_registration',
            'application_guard', 'root_launch', 'runtime_channel', 'launch_listener', 'bootstrap_input')
_FILES = {name + '.py' for name in _MODULES} | {'bootstrap.py', 'application_env_keys.json', 'native-entry'}
_TOOLS = ('/usr/bin/python3', '/usr/bin/setpriv', '/opt/node22/bin/node')


def _consume_input(candidate, decoder):
    failed, values = True, None
    try:
        os.set_inheritable(3, False)
        info = os.fstat(3)
        seals = fcntl.F_SEAL_SEAL | fcntl.F_SEAL_SHRINK | fcntl.F_SEAL_GROW | fcntl.F_SEAL_WRITE
        if (not stat.S_ISREG(info.st_mode) or stat.S_IMODE(info.st_mode) != 0o600
                or info.st_uid != 0 or info.st_gid != 0 or info.st_nlink != 0
                or not 46 < info.st_size <= 262144
                or fcntl.fcntl(3, fcntl.F_GET_SEALS) & seals != seals):
            raise ValueError()
        raw = os.pread(3, info.st_size + 1, 0)
        if len(raw) != info.st_size:
            raise ValueError()
        values = decoder.decode_bootstrap_input(raw, candidate)
        failed = False
    finally:
        # Never retry a close: the FD number may already have been reused.
        os.close(3)
    if failed:
        raise ValueError()
    return values


def _runtime_environment(values, identity):
    if (identity.app_home != '/var/lib/holaday'
            or re.fullmatch(r'[a-z_][a-z0-9_-]{0,31}', identity.app_name) is None
            or type(values.get('PATH')) is not str or not values['PATH']):
        raise ValueError()
    env = dict(values)
    env.update(HOME=identity.app_home, USER=identity.app_name, LOGNAME=identity.app_name,
               XDG_RUNTIME_DIR=identity.app_home + '/.runtime', PATH='/opt/node22/bin:' + values['PATH'])
    return env


def _context():
    if (sys.platform != 'linux' or os.getresuid() != (0, 0, 0)
            or os.getresgid() != (0, 0, 0) or len(os.listdir('/proc/self/task')) != 1
            or dict(os.environ) != {'PATH': '/usr/bin:/bin', 'LANG': 'C.UTF-8'}
            or not (sys.flags.isolated and sys.flags.no_site and sys.flags.ignore_environment)
            or sys.executable != '/usr/bin/python3'):
        raise ValueError()


def _metadata(fd, mode=None):
    info = os.fstat(fd)
    regular = mode is not None
    if (info.st_uid != 0 or info.st_gid != 0 or stat.S_IMODE(info.st_mode) & 0o7022
            or (regular and (not stat.S_ISREG(info.st_mode) or info.st_nlink != 1
                             or stat.S_IMODE(info.st_mode) != mode))
            or (not regular and not stat.S_ISDIR(info.st_mode))):
        raise ValueError()
    if set(os.listxattr(fd)) & {'system.posix_acl_access', 'system.posix_acl_default', 'security.capability'}:
        raise ValueError()
    return info


def _trusted_bytes(path, limit, *, mode=0o644, digest_only=False):
    if not path.startswith('/') or any(part in ('', '.', '..') for part in path.split('/')[1:]):
        raise ValueError()
    fds, failed, result = [], True, None
    try:
        fds.append(os.open('/', os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC | os.O_NOFOLLOW))
        _metadata(fds[-1])
        parts = path.split('/')[1:]
        for index, part in enumerate(parts):
            leaf = index == len(parts) - 1
            flags = os.O_RDONLY | os.O_CLOEXEC | os.O_NOFOLLOW
            flags |= os.O_NONBLOCK if leaf else os.O_DIRECTORY
            fds.append(os.open(part, flags, dir_fd=fds[-1]))
            info = _metadata(fds[-1], mode if leaf else None)
        if not 0 < info.st_size <= limit:
            raise ValueError()
        size, offset, chunks, digest = info.st_size, 0, [], hashlib.sha256()
        while offset < size:
            chunk = os.pread(fds[-1], min(65536, size - offset), offset)
            if not chunk or len(chunk) > size - offset:
                raise ValueError()
            offset += len(chunk)
            digest.update(chunk)
            if not digest_only:
                chunks.append(chunk)
        if os.pread(fds[-1], 1, size) or _metadata(fds[-1], mode).st_size != size:
            raise ValueError()
        result = digest.hexdigest() if digest_only else b''.join(chunks)
        failed = False
    finally:
        while fds:
            owned = fds.pop()
            try:
                os.close(owned)
            except Exception:
                failed = True
    if failed:
        raise ValueError()
    return result


def _unique(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError()
        result[key] = value
    return result


def _verify_release(candidate):
    base = '/usr/local/lib/holaday-pool-broker/releases/' + candidate
    manifest = json.loads(_trusted_bytes(base + '/native-build-manifest.json', 65536), object_pairs_hook=_unique)
    if (type(manifest) is not dict or set(manifest) != {'version', 'status', 'candidate', 'architecture', 'files', 'tools'}
            or type(manifest['version']) is not int or manifest['version'] != 1
            or manifest['status'] != 'linux-verified' or manifest['candidate'] != candidate
            or manifest['architecture'] not in ('x86_64', 'aarch64')
            or os.uname().machine != manifest['architecture']
            or type(manifest['files']) is not dict or set(manifest['files']) != _FILES
            or type(manifest['tools']) is not dict or set(manifest['tools']) != set(_TOOLS)):
        raise ValueError()
    sources = {}
    for name in sorted(_FILES):
        expected = manifest['files'][name]
        if type(expected) is not str or re.fullmatch(r'[0-9a-f]{64}', expected) is None:
            raise ValueError()
        source = _trusted_bytes(base + '/' + name, 262144, mode=0o755 if name == 'native-entry' else 0o644)
        if hashlib.sha256(source).hexdigest() != expected:
            raise ValueError()
        sources[name] = source
    for tool in _TOOLS:
        item = manifest['tools'][tool]
        if type(item) is not dict or set(item) != {'resolved', 'sha256'}:
            raise ValueError()
        resolved = item['resolved']
        if (type(resolved) is not str or type(item['sha256']) is not str
                or re.fullmatch(r'[0-9a-f]{64}', item['sha256']) is None
                or os.path.realpath(tool) != resolved):
            raise ValueError()
        if resolved != tool:
            # Only the conventional root-owned Python version symlink is
            # supported. All other tool/parent redirects require a new review.
            if tool != '/usr/bin/python3' or re.fullmatch(r'/usr/bin/python3\.[0-9]+', resolved) is None:
                raise ValueError()
            link = os.lstat(tool)
            if (not stat.S_ISLNK(link.st_mode) or link.st_uid != 0 or link.st_gid != 0
                    or link.st_nlink != 1 or os.readlink(tool) not in (resolved, resolved.rsplit('/', 1)[1])):
                raise ValueError()
        if _trusted_bytes(resolved, 134217728, mode=0o755, digest_only=True) != item['sha256']:
            raise ValueError()
    return sources


def _load_modules(sources):
    if any(name in sys.modules for name in _MODULES):
        raise ValueError()
    policy = json.loads(sources['application_env_keys.json'], object_pairs_hook=_unique)
    if (type(policy) is not dict or set(policy) != {'version', 'scope', 'keys'}
            or type(policy['version']) is not int or policy['version'] != 1
            or type(policy['scope']) is not str or type(policy['keys']) is not dict
            or not 1 <= len(policy['keys']) <= 512):
        raise ValueError()
    for key, references in policy['keys'].items():
        if (re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]{0,127}', key) is None
                or key.startswith(('LD_', 'DYLD_', 'PYTHON'))
                or (key.startswith('NODE_') and key != 'NODE_ENV') or key == 'PM2_HOME'
                or type(references) is not list or not references
                or any(type(ref) is not str or not ref for ref in references)):
            raise ValueError()
    loaded = {}
    try:
        for name in _MODULES:
            path = __file__.rsplit('/', 1)[0] + '/' + name + '.py'
            module = types.ModuleType(name)
            module.__file__ = path
            if name == 'bootstrap_input':
                module.__dict__['_KEYS'] = frozenset(policy['keys'])
            loaded[name] = module
            sys.modules[name] = module
            exec(compile(sources[name + '.py'], path, 'exec', dont_inherit=True), module.__dict__)
        return loaded
    except BaseException:
        for name in loaded:
            sys.modules.pop(name, None)
        raise


def _connect_registration():
    channel = socket.socket(socket.AF_UNIX, socket.SOCK_SEQPACKET | socket.SOCK_CLOEXEC)
    try:
        channel.settimeout(5.0)
        channel.connect('/run/holaday-pool-broker/register.sock')
        return channel
    except BaseException:
        channel.close()
        raise


def main():
    input_owned, channel = True, None
    try:
        os.set_inheritable(3, False)
        _context()
        match = re.fullmatch(r'/usr/local/lib/holaday-pool-broker/releases/([0-9a-f]{40})/bootstrap.py', __file__)
        if match is None or match[1] == '0' * 40 or sys.argv != [__file__]:
            raise ValueError()
        candidate = match[1]
        sources = _verify_release(candidate)
        modules = _load_modules(sources)
        identity = modules['installation'].inspect_installation(candidate)
        _context()
        input_owned = False
        values = _consume_input(candidate, modules['bootstrap_input'])
        values = _runtime_environment(values, identity)
        random = os.urandom(16)
        if type(random) is not bytes or len(random) != 16 or random == b'\0' * 16:
            raise ValueError()
        boot = random.hex()
        _context()
        channel = _connect_registration()
        owned, channel = channel, None
        modules['root_launch'].launch_application(owned, candidate, boot, values)
        raise ValueError()
    except Exception:
        if input_owned:
            try:
                os.close(3)
            except Exception:
                pass
        if channel is not None:
            try:
                channel.close()
            except Exception:
                pass
        try:
            raise ValueError('POOL_BROKER_BOOTSTRAP_UNPROVEN') from None
        except ValueError as error:
            error.__context__ = None
            raise


if __name__ == '__main__':
    try:
        main()
    except BaseException:
        # No exception, raw data or contextual diagnostics reach PM2 logs.
        os._exit(111)
    os._exit(111)
