"""Non-root final exec boundary; not registration, privilege drop, or readiness."""

import ctypes
import fcntl
import json
import os
import re
import signal
import stat
import sys


class ApplicationGuardError(ValueError):
    """Fixed diagnostic; never carries status, environment or source errors."""


def _deny():
    try:
        raise ApplicationGuardError('POOL_BROKER_APPLICATION_UNPROVEN') from None
    except ApplicationGuardError as error:
        error.__context__ = None
        raise


def _binding(candidate, boot):
    for value, length in ((candidate, 40), (boot, 32)):
        if (type(value) is not str or re.fullmatch(r'[0-9a-f]{%d}' % length, value) is None
                or value == '0' * length):
            raise ValueError()


def _application_environment(values):
    if type(values) is not dict or not 1 <= len(values) <= 512 or values.get('NODE_ENV') != 'production':
        raise ValueError()
    for key, value in values.items():
        if (type(key) is not str or re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]{0,127}', key) is None
                or key.startswith(('LD_', 'DYLD_', 'PYTHON'))
                or (key.startswith('NODE_') and key != 'NODE_ENV')
                or type(value) is not str or '\x00' in value
                or len(value.encode('utf-8')) > 8192):
            raise ValueError()
    env = dict(values)
    env.pop('PM2_HOME', None)
    return env


def _seals():
    return fcntl.F_SEAL_SEAL | fcntl.F_SEAL_SHRINK | fcntl.F_SEAL_GROW | fcntl.F_SEAL_WRITE


def _sealed_size(fd):
    info = os.fstat(fd)
    if (not stat.S_ISREG(info.st_mode) or stat.S_IMODE(info.st_mode) != 0o600
            or info.st_uid != 0 or info.st_gid != 0 or info.st_nlink != 0
            or not 0 < info.st_size <= 65536
            or fcntl.fcntl(fd, fcntl.F_GET_SEALS) & _seals() != _seals()):
        raise ValueError()
    return info.st_size


def seal_application_environment(candidate, boot, values):
    """Root producer; caller owns returned CLOEXEC FD, never installs it as 3."""
    fd = None
    try:
        if (sys.platform != 'linux' or os.getresuid() != (0, 0, 0)
                or os.getresgid() != (0, 0, 0)):
            raise ValueError()
        _binding(candidate, boot)
        env = _application_environment(values)
        raw = json.dumps(['HPE1', candidate, boot, list(env.items())], ensure_ascii=False).encode('utf-8')
        if len(raw) > 65536:
            raise ValueError()
        fd = os.memfd_create('holaday-application-env', os.MFD_CLOEXEC | os.MFD_ALLOW_SEALING)
        os.fchmod(fd, 0o600)
        offset = 0
        while offset < len(raw):
            count = os.write(fd, raw[offset:])
            if count <= 0 or count > len(raw) - offset:
                raise ValueError()
            offset += count
        fcntl.fcntl(fd, fcntl.F_ADD_SEALS, _seals())
        if _sealed_size(fd) != len(raw):
            raise ValueError()
        return fd
    except Exception:
        if fd is not None:
            owned, fd = fd, None
            try:
                os.close(owned)
            except Exception:
                pass
        _deny()


def _consume_environment(candidate, boot):
    # Only the already-verified non-root guard may consume its inherited FD 3.
    # Ownership ends exactly once, including close errors; no old-env fallback.
    failed, env = True, None
    try:
        _binding(candidate, boot)
        os.set_inheritable(3, False)
        size = _sealed_size(3)
        raw = os.pread(3, size + 1, 0)
        if len(raw) != size:
            raise ValueError()
        data = json.loads(raw.decode('utf-8'))
        if (type(data) is not list or len(data) != 4 or data[:3] != ['HPE1', candidate, boot]
                or type(data[3]) is not list or not 1 <= len(data[3]) <= 512):
            raise ValueError()
        values = {}
        for pair in data[3]:
            if (type(pair) is not list or len(pair) != 2 or type(pair[0]) is not str
                    or pair[0] in values):
                raise ValueError()
            values[pair[0]] = pair[1]
        env = _application_environment(values)
        failed = False
    except Exception:
        pass
    finally:
        try:
            os.close(3)
        except Exception:
            failed = True
    if failed:
        _deny()
    return env


def _check_identity(gid):
    if (os.getresuid() != (998, 998, 998) or os.getresgid() != (gid, gid, gid)
            or os.getgroups() != []):
        raise ValueError()
    with open('/proc/self/status', 'rb') as status:
        raw = status.read(65537)
    if not raw or len(raw) > 65536:
        raise ValueError()
    expected = {b'Uid': [998] * 4, b'Gid': [gid] * 4, b'Groups': [],
                b'NoNewPrivs': [1], b'Threads': [1], b'TracerPid': [0]}
    caps = {b'CapInh', b'CapPrm', b'CapEff', b'CapBnd', b'CapAmb'}
    seen = set()
    for line in raw.splitlines():
        key, sep, value = line.partition(b':')
        if key not in expected and key not in caps:
            continue
        if not sep or key in seen:
            raise ValueError()
        seen.add(key)
        values = value.split()
        if key in caps:
            if len(values) != 1 or not re.fullmatch(b'[0-9a-fA-F]{16}', values[0]):
                raise ValueError()
            if int(values[0], 16) != 0:
                raise ValueError()
        elif (any(not re.fullmatch(b'[0-9]{1,10}', v) for v in values)
              or [int(v) for v in values] != expected[key]):
            raise ValueError()
    if seen != set(expected) | caps:
        raise ValueError()


def bootstrap_environment():
    """Trusted parent must supply this BEFORE the first interpreter exec."""
    return {'PATH': '/usr/bin:/bin', 'LANG': 'C.UTF-8'}


def exec_application(expected_gid, candidate, boot):
    """Only called in the trusted, already-dropped launcher; does not drop UID."""
    try:
        if (sys.platform != 'linux' or type(expected_gid) is not int
                or not 0 < expected_gid < 4294967295 or expected_gid == 65534):
            raise ValueError()
        _binding(candidate, boot)
        _check_identity(expected_gid)
        # This assertion detects miswiring, not injection that already ran in
        # the loader. Parent-side pre-interpreter isolation is mandatory.
        if dict(os.environ) != bootstrap_environment():
            raise ValueError()
        env = _consume_environment(candidate, boot)
        # Routing metadata only, not a registration receipt. Never inherit an
        # input override or preserve a prior boot. Native peer proof is separate.
        env['HOLADAY_POOL_CANDIDATE'] = candidate
        env['HOLADAY_POOL_BOOT'] = boot
        close_range = ctypes.CDLL(None, use_errno=True).close_range
        close_range.argtypes = (ctypes.c_uint, ctypes.c_uint, ctypes.c_int)
        close_range.restype = ctypes.c_int
        # Unshare the FD table, close every non-stdio descriptor, fail closed on
        # unsupported libc/kernel. No proc scan or RLIMIT-based partial cleanup.
        if close_range(3, 4294967295, 2) != 0:
            raise ValueError()
        os.umask(0o077)
        for sig in signal.valid_signals():
            if sig not in (signal.SIGKILL, signal.SIGSTOP):
                signal.signal(sig, signal.SIG_DFL)
        signal.pthread_sigmask(signal.SIG_SETMASK, [])
        os.chdir('/opt/holaday-monorepo/apps/orchestrator')
        _check_identity(expected_gid)
        os.execve('/opt/node22/bin/node', [
            '/opt/node22/bin/node', '--import', 'tsx',
            '/opt/holaday-monorepo/apps/orchestrator/src/index.ts'], env)
        # Successful exec never returns. Do not continue a partly cleaned shell.
        raise ValueError()
    except Exception:
        _deny()


def main(argv):
    """Trusted parent passes GID/candidate/boot; no command or env options."""
    try:
        if (len(argv) != 3 or type(argv[0]) is not str
                or re.fullmatch(r'[1-9][0-9]{0,9}', argv[0]) is None):
            return 1
        exec_application(int(argv[0]), argv[1], argv[2])
    except Exception:
        # Exit without traceback or inherited secret-bearing exception details.
        return 1
    return 1


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
