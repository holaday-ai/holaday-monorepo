"""Authenticated runtime transport in closed state; no resource dispatch API."""

import array
import math
import os
import socket
import stat
import time
from socket import socket as Socket

import installation
import launch_authorization
from launch_registration import LaunchRegistration, _close_fds
from protocol import decode_request


def _deny():
    try:
        raise ValueError('POOL_BROKER_RUNTIME_UNPROVEN') from None
    except ValueError as error:
        error.__context__ = None
        raise


def serve_closed(registration):
    """Consume one fixed listener transaction; even valid requests remain blocked."""
    directories, received = [], []
    server = channel = identity = None
    mode, gid = 0o700, 0
    failed = True
    deadline = last = None

    def guard():
        nonlocal last
        launch_authorization._context()
        now = time.monotonic()
        if not math.isfinite(now) or now < last or now >= deadline:
            raise ValueError()
        last = now
        registration._require_registered()
        # The pin observation itself crosses kernel boundaries.
        launch_authorization._context()
        now = time.monotonic()
        if not math.isfinite(now) or now < last or now >= deadline:
            raise ValueError()
        last = now
        if registration._revoked or registration._pin is None:
            raise ValueError()
        return deadline - now

    def path_info():
        info = os.stat('control.sock', dir_fd=directories[-1], follow_symlinks=False)
        if (not stat.S_ISSOCK(info.st_mode) or stat.S_IMODE(info.st_mode) != mode
                or info.st_uid != 0 or info.st_gid != gid or info.st_nlink != 1
                or (identity is not None and (info.st_dev, info.st_ino) != identity)):
            raise ValueError()
        return info

    def prepare_io(stream):
        nonlocal last
        remaining = guard()
        pin = registration._pin
        stream.settimeout(remaining)
        now = time.monotonic()
        if (not math.isfinite(now) or now < last or now >= deadline
                or registration._revoked or registration._pin is not pin or pin is None):
            raise ValueError()
        last = now
        # No pin observation or filesystem IO between this check and dispatch.

    try:
        if type(registration) is not LaunchRegistration:
            raise ValueError()
        last = time.monotonic()
        if not math.isfinite(last) or last < 0:
            raise ValueError()
        deadline = last + 5.0
        guard()
        for index, part in enumerate(('/', 'run', 'holaday-pool-runtime')):
            fd = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC,
                         **({} if index == 0 else {'dir_fd': directories[-1]}))
            directories.append(fd)
            installation._object(fd, gid=registration._gid if index == 2 else 0,
                                 mode=0o750 if index == 2 else None)
        guard()
        server = Socket(socket.AF_UNIX, socket.SOCK_STREAM | socket.SOCK_CLOEXEC)
        server.set_inheritable(False)
        server.setsockopt(socket.SOL_SOCKET, socket.SO_PASSCRED, 1)
        previous = os.umask(0o077)
        try:
            server.bind('/run/holaday-pool-runtime/control.sock')
            info = path_info()
            identity = (info.st_dev, info.st_ino)
            os.chown('control.sock', 0, registration._gid, dir_fd=directories[-1], follow_symlinks=False)
            gid = registration._gid
            path_info()
            os.chmod('control.sock', 0o660, dir_fd=directories[-1], follow_symlinks=False)
            mode = 0o660
            path_info()
        finally:
            os.umask(previous)
        guard()
        server.listen(1)
        prepare_io(server)
        channel, _address = server.accept()
        guard()
        owned, server = server, None
        owned.close()
        if (not isinstance(channel, socket.socket) or channel.family != socket.AF_UNIX
                or channel.getsockopt(socket.SOL_SOCKET, socket.SO_TYPE) != socket.SOCK_STREAM):
            raise ValueError()
        channel.set_inheritable(False)
        channel.setsockopt(socket.SOL_SOCKET, socket.SO_PASSCRED, 1)
        peer = channel.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12)
        registration.check_runtime_sender(peer)
        payload = b''
        while True:
            prepare_io(channel)
            chunk, ancillary, flags, _address = channel.recvmsg(
                4097 - len(payload), socket.CMSG_SPACE(253 * array.array('i').itemsize) + socket.CMSG_SPACE(12),
                socket.MSG_CMSG_CLOEXEC)
            credentials, invalid = [], False
            for level, kind, data in ancillary:
                if level == socket.SOL_SOCKET and kind == socket.SCM_RIGHTS:
                    invalid = True
                    width = array.array('i').itemsize
                    for fd in array.array('i', data[:len(data) // width * width]):
                        if fd >= 0 and fd not in received:
                            received.append(fd)
                elif level == socket.SOL_SOCKET and kind == socket.SCM_CREDENTIALS:
                    credentials.append(data)
                else:
                    invalid = True
            if (invalid or flags & ~socket.MSG_CMSG_CLOEXEC or type(chunk) is not bytes
                    or (credentials != [peer] if chunk else credentials not in ([], [peer]))):
                raise ValueError()
            registration.check_runtime_sender(peer)
            guard()
            if not chunk:
                break
            payload += chunk
            if len(payload) > 4096:
                raise ValueError()
        request = decode_request(payload)
        registration.check_runtime_sender(peer, request.boot)
        registration.check_runtime_sender(peer, request.boot)
        prepare_io(channel)
        reply = b'{"version":1,"status":"blocked","code":"POOL_BROKER_RESOURCES_UNPROVEN"}'
        if channel.sendmsg([reply]) != len(reply):
            raise ValueError()
        guard()
        failed = False
    except Exception:
        pass
    finally:
        failed = _close_fds(received) or failed
        owned, channel = channel, None
        if owned is not None:
            try:
                owned.close()
            except Exception:
                failed = True
        owned, server = server, None
        if owned is not None:
            try:
                owned.close()
            except Exception:
                failed = True
        if identity is not None:
            try:
                path_info()
                identity = None
                os.unlink('control.sock', dir_fd=directories[-1])
            except Exception:
                failed = True
        failed = _close_fds(directories) or failed
        if not failed:
            try:
                guard()
            except Exception:
                failed = True
    if failed:
        if type(registration) is LaunchRegistration:
            try:
                registration.close()
            except Exception:
                pass
        _deny()
