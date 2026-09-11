"""One private root launch listener; no issuer, rearm, readiness or public CLI."""

import os
import socket
import stat
import threading
from socket import socket as Socket

import installation
import launch_authorization
from launch_registration import LaunchRegistration
import runtime_channel


def _deny():
    try:
        raise ValueError('POOL_BROKER_LAUNCH_LISTENER_UNPROVEN') from None
    except ValueError as error:
        error.__context__ = None
        raise


class RootLaunchListener:
    def __init__(self):
        raise TypeError('use root-owned launch listener')

    @classmethod
    def open(cls, candidate):
        obj = object.__new__(cls)
        obj._lock = threading.RLock()
        obj._socket, obj._registration, obj._window, obj._path_id = None, None, None, None
        obj._directories = []
        obj._attempted = obj._revoked = False
        obj._registered = obj._serving = False
        obj._path_mode = 0o700
        try:
            launch_authorization._context()
            identity = installation.inspect_installation(candidate)
            obj._window = launch_authorization.consume_launch_authorization(candidate)
            obj._registration = LaunchRegistration(candidate, identity.app_gid)
            launch_authorization._directory('/run/holaday-pool-broker', obj._directories)
            obj._socket = Socket(socket.AF_UNIX, socket.SOCK_SEQPACKET | socket.SOCK_CLOEXEC)
            obj._socket.set_inheritable(False)
            obj._socket.setsockopt(socket.SOL_SOCKET, socket.SO_PASSCRED, 1)
            obj._check()
            previous = os.umask(0o077)
            try:
                obj._socket.bind('/run/holaday-pool-broker/register.sock')
                info = obj._path_info()
                obj._path_id = (info.st_dev, info.st_ino)
                os.chmod('register.sock', 0o600, dir_fd=obj._directories[-1], follow_symlinks=False)
                obj._path_mode = 0o600
                obj._path_info()
            finally:
                os.umask(previous)
            obj._check()
            obj._socket.listen(1)
            obj._check()
            return obj
        except Exception:
            obj._abort()
            _deny()

    def _check(self):
        if self._revoked:
            raise ValueError()
        window, registration = self._window, self._registration
        launch_authorization._context()
        remaining = window.remaining()
        if (self._revoked or self._window is not window
                or self._registration is not registration or registration is None):
            raise ValueError()
        return remaining

    def _path_info(self):
        info = os.stat('register.sock', dir_fd=self._directories[-1], follow_symlinks=False)
        if (not stat.S_ISSOCK(info.st_mode) or stat.S_IMODE(info.st_mode) != self._path_mode
                or info.st_uid != 0 or info.st_gid != 0 or info.st_nlink != 1
                or (self._path_id is not None and (info.st_dev, info.st_ino) != self._path_id)):
            raise ValueError()
        return info

    def _close_transport(self):
        failed = False
        owned, self._socket = self._socket, None
        if owned is not None:
            try:
                owned.close()
            except Exception:
                failed = True
        if self._path_id is not None:
            try:
                self._path_info()
                self._path_id = None
                os.unlink('register.sock', dir_fd=self._directories[-1])
            except Exception:
                self._path_id = None
                failed = True
        while self._directories:
            fd = self._directories.pop()
            try:
                os.close(fd)
            except Exception:
                failed = True
        return failed

    def _abort(self):
        self._revoked = True
        owned, self._registration = self._registration, None
        failed = False
        if owned is not None:
            try:
                owned.close()
            except Exception:
                failed = True
        return self._close_transport() or failed

    def accept_once(self):
        with self._lock:
            channel = None
            try:
                if self._attempted:
                    raise ValueError()
                self._attempted = True
                remaining = self._check()
                self._socket.settimeout(min(5.0, remaining))
                channel, _address = self._socket.accept()
                self._check()
                channel.set_inheritable(False)
                owned, self._socket = self._socket, None
                owned.close()
                self._check()
                receiver = self._registration
                if receiver is None or self._revoked:
                    raise ValueError()
                owned, channel = channel, None
                receiver.receive(owned, window=self._window)
                if self._close_transport():
                    raise ValueError()
                self._check()
                self._registered = True
                return None
            except Exception:
                if channel is not None:
                    try:
                        channel.close()
                    except Exception:
                        pass
                self._abort()
                _deny()

    def close(self):
        with self._lock:
            if self._abort():
                _deny()

    def serve_runtime_once(self):
        with self._lock:
            try:
                if self._revoked or not self._registered or self._serving:
                    raise ValueError()
                self._serving = True
                receiver = self._registration
                runtime_channel.serve_closed(receiver)
                if self._revoked or self._registration is not receiver:
                    raise ValueError()
            except Exception:
                self._abort()
                _deny()
            finally:
                self._serving = False
