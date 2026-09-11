"""Non-root final exec boundary; not registration, privilege drop, or readiness."""

import ctypes
import os
import re
import signal
import sys


class ApplicationGuardError(ValueError):
    """Fixed diagnostic; never carries status, environment or source errors."""


def _deny():
    try:
        raise ApplicationGuardError('POOL_BROKER_APPLICATION_UNPROVEN') from None
    except ApplicationGuardError as error:
        error.__context__ = None
        raise


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


def exec_application(expected_gid):
    """Only called in the trusted, already-dropped launcher; does not drop UID."""
    try:
        if (sys.platform != 'linux' or type(expected_gid) is not int
                or not 0 < expected_gid < 4294967295 or expected_gid == 65534):
            raise ValueError()
        _check_identity(expected_gid)
        env = dict(os.environ)
        if env.get('NODE_ENV') != 'production':
            raise ValueError()
        for key in env:
            if (not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*', key)
                    or key.startswith(('LD_', 'DYLD_', 'PYTHON'))
                    or (key.startswith('NODE_') and key != 'NODE_ENV')):
                raise ValueError()
        env.pop('PM2_HOME', None)
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
    """Trusted parent passes the installed GID; no command or env options."""
    try:
        if (len(argv) != 1 or type(argv[0]) is not str
                or re.fullmatch(r'[1-9][0-9]{0,9}', argv[0]) is None):
            return 1
        exec_application(int(argv[0]))
    except Exception:
        # Exit without traceback or inherited secret-bearing exception details.
        return 1
    return 1


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
