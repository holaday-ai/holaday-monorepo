"""Trusted launch orchestration only; no public CLI or readiness authority."""

import ctypes
import os
import socket
import sys

import application_guard
import installation
import launch_registration


class RootLaunchError(ValueError):
    """Fixed private failure; caller must terminate this unaccepted launch."""


def _deny():
    try:
        raise RootLaunchError('POOL_BROKER_LAUNCH_UNPROVEN') from None
    except RootLaunchError as error:
        error.__context__ = None
        raise


def _root_context():
    if (sys.platform != 'linux' or os.getresuid() != (0, 0, 0)
            or os.getresgid() != (0, 0, 0) or len(os.listdir('/proc/self/task')) != 1
            or dict(os.environ) != application_guard.bootstrap_environment()):
        raise ValueError()


def launch_application(channel, candidate, boot, values):
    """Consume root registration socket and exec fixed dropper after exact ACK.

    Only a trusted pre-interpreter-sanitized parent may call this. No public
    entrypoint is installed; live tool integrity and release gates are separate.
    """
    channel_owned = isinstance(channel, socket.socket)
    fd, three_owned = None, False
    try:
        if not channel_owned:
            raise ValueError()
        _root_context()
        identity = installation.inspect_installation(candidate)
        if type(identity.app_gid) is not int or not 0 < identity.app_gid < 4294967295 or identity.app_gid == 65534:
            raise ValueError()
        fd = application_guard.seal_application_environment(candidate, boot, values)
        _root_context()
        # register_self consumes the socket even on failure, never retry/close
        # the transferred object from here after it has been handed off.
        channel_owned = False
        launch_registration.register_self(channel, candidate, boot, identity.app_gid)
        _root_context()
        if fd == 3:
            fd, three_owned = None, True
            os.set_inheritable(3, True)
        else:
            os.dup2(fd, 3, inheritable=True)
            three_owned = True
            owned, fd = fd, None
            os.close(owned)
        close_range = ctypes.CDLL(None, use_errno=True).close_range
        close_range.argtypes = (ctypes.c_uint, ctypes.c_uint, ctypes.c_int)
        close_range.restype = ctypes.c_int
        if close_range(4, 4294967295, 2) != 0:
            raise ValueError()
        _root_context()
        os.execve('/usr/bin/setpriv', ['/usr/bin/setpriv', '--reuid=998', '--regid=' + str(identity.app_gid),
            '--clear-groups', '--inh-caps=-all', '--ambient-caps=-all', '--bounding-set=-all',
            '--no-new-privs', '--', '/usr/bin/python3', '-I', '-S',
            '/usr/local/lib/holaday-pool-broker/releases/' + candidate + '/application_guard.py',
            str(identity.app_gid), candidate, boot], application_guard.bootstrap_environment())
        raise ValueError()
    except Exception:
        if channel_owned:
            try:
                channel.close()
            except Exception:
                pass
        for owned in ([fd] if fd is not None else []) + ([3] if three_owned else []):
            try:
                os.close(owned)
            except Exception:
                pass
        _deny()
