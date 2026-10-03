"""Fixed original root listener. No CLI, path parameters, retry or exit proof."""
import math
import os
import socket
import stat
import time
from socket import socket as Socket

import launch_authorization
from resource_journal import ResourceJournal
from quartet_create_control import _CreateControl
from quartet_runtime import _RunningQuartet
from manager_probe import SystemManagerProbe

_PARTS = ('/', 'run', 'holaday-pool-runtime')
_NAME = 'control.sock'
_PATH = '/run/holaday-pool-runtime/control.sock'


def _deny():
    try:
        raise ValueError('POOL_BROKER_QUARTET_LISTENER_UNPROVEN') from None
    except ValueError as error:
        error.__context__ = None
        raise


def _sig(info):
    # Directory child count is mutable even when the original directory is not.
    return info.st_dev, info.st_ino, info.st_uid, info.st_gid, info.st_mode


class _QuartetListener:
    def __init__(self): raise TypeError('private original root listener')
    def __reduce_ex__(self, _protocol): raise TypeError('private original root listener')

    @classmethod
    def open(cls, journal):
        item = object.__new__(cls)
        item._retired = item._cleanup_failed = False
        item._busy = True
        item._chain, item._controls, item._groups = [], [], []
        item._socket = item._path_identity = item._socket_identity = None
        item._mode, item._gid, item._count = 0o700, 0, 0
        item._boot_window = None
        item._boot_attempted = False
        try:
            if type(journal) is not ResourceJournal: raise ValueError()
            item._journal, item._registration, item._pin = journal, journal._registration, journal._pin
            item._begin()
            item._io(launch_authorization._context)
            item._io(item._registration._require_registered)
            for index, part in enumerate(_PARTS):
                item._budget()
                fd = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC,
                    **({'dir_fd': item._chain[-1][0]} if index else {}))
                item._chain.append((fd, None))  # Ownership precedes post-IO veto.
                item._budget()
                item._chain[-1] = (fd, _sig(item._metadata(fd, index)))
            item._budget()
            item._socket = Socket(socket.AF_UNIX, socket.SOCK_STREAM | getattr(socket, 'SOCK_CLOEXEC', 0))
            item._budget()
            item._io(item._socket.set_inheritable, False)
            item._io(item._socket.setsockopt, socket.SOL_SOCKET, getattr(socket, 'SO_PASSCRED', 16), 1)
            previous = os.umask(0o077)
            try:
                item._io(item._socket.bind, _PATH)
                info = item._path_info()
                item._path_identity = (info.st_dev, info.st_ino)
                item._io(os.chown, _NAME, 0, item._registration._gid,
                    dir_fd=item._chain[-1][0], follow_symlinks=False)
                item._gid = item._registration._gid
                item._path_info()
                item._io(os.chmod, _NAME, 0o660, dir_fd=item._chain[-1][0], follow_symlinks=False)
                item._mode = 0o660
                item._path_info()
            finally: os.umask(previous)
            item._io(item._socket.listen, 8)
            info = item._io(os.fstat, item._socket.fileno())
            item._socket_identity = (info.st_dev, info.st_ino)
            item._check()
            return item
        except Exception:
            item._retired = True
            _deny()
        finally:
            item._busy = False
            if item._retired: item._release()

    def _veto(self):
        if self._retired: raise ValueError()
        journal, reg, pin = self._journal, self._registration, self._pin
        journal._owner_veto()
        if journal._registration is not reg or journal._pin is not pin or reg._pin is not pin:
            raise ValueError()
        # Root's final registration IO can revoke a previously accepted group.
        # Keep this terminal owner walk pure: no IO or renewed runtime budget.
        for live in self._groups:
            if type(live) is not _RunningQuartet: raise ValueError()
            live._veto()
            live._material._owner_veto()

    def _begin(self):
        now = time.monotonic()
        if type(now) not in (int, float) or not math.isfinite(now) or now < 0: raise ValueError()
        self._last, self._deadline = now, now + 5
        self._veto()

    def _budget(self):
        now = time.monotonic()
        self._veto()
        if type(now) not in (int, float) or not math.isfinite(now) or now < self._last or now >= self._deadline:
            raise ValueError()
        self._last = now
        remaining = float('inf') if self._boot_window is None else self._boot_window.remaining()
        if self._boot_window is not None:
            last = time.monotonic()
            if (type(last) not in (int, float) or not math.isfinite(last) or last < now
                    or last >= self._deadline or self._boot_window._revoked): raise ValueError()
            remaining -= last - now
            if remaining <= 0: raise ValueError()
            now = self._last = last
        self._veto()
        return min(remaining, self._deadline - now)

    def _io(self, call, *args, **kwargs):
        self._budget()
        result = call(*args, **kwargs)
        self._budget()
        return result

    def _metadata(self, fd, index):
        info = self._io(os.fstat, fd)
        if (not stat.S_ISDIR(info.st_mode) or info.st_uid != 0
                or info.st_gid != (self._registration._gid if index == 2 else 0)
                or stat.S_IMODE(info.st_mode) & 0o7022
                or index == 2 and stat.S_IMODE(info.st_mode) != 0o750): raise ValueError()
        if set(self._io(os.listxattr, fd)) & {'system.posix_acl_access', 'system.posix_acl_default', 'security.capability'}:
            raise ValueError()
        return info

    def _path_info(self):
        info = os.stat(_NAME, dir_fd=self._chain[-1][0], follow_symlinks=False)
        if (not stat.S_ISSOCK(info.st_mode) or stat.S_IMODE(info.st_mode) != self._mode
                or info.st_uid != 0 or info.st_gid != self._gid or info.st_nlink != 1
                or self._path_identity is not None and (info.st_dev, info.st_ino) != self._path_identity):
            raise ValueError()
        return info

    def _check(self):
        self._io(launch_authorization._context)
        self._io(self._registration._require_registered)
        for index, (fd, signature) in enumerate(self._chain):
            if _sig(self._metadata(fd, index)) != signature: raise ValueError()
            if index and _sig(self._io(os.stat, _PARTS[index], dir_fd=self._chain[index - 1][0],
                                      follow_symlinks=False)) != signature: raise ValueError()
        self._io(self._path_info)
        stream = self._socket
        info = self._io(os.fstat, stream.fileno())
        if (not stat.S_ISSOCK(info.st_mode) or (info.st_dev, info.st_ino) != self._socket_identity
                or self._io(stream.getsockopt, socket.SOL_SOCKET, socket.SO_ACCEPTCONN) != 1): raise ValueError()
        self._budget()
        if self._socket is not stream: raise ValueError()

    def accept_control(self):
        return self._accept_control(None)

    def _accept_control(self, window):
        if self._busy:
            self._retired = True
            _deny()  # The original outer acquisition alone may release its FDs.
        channel = None
        try:
            if window is None:
                if self._count >= 32: raise ValueError()
            else:
                if (self._boot_attempted or self._count != 0
                        or type(window) is not launch_authorization.LaunchWindow
                        or window._candidate != self._journal._candidate): raise ValueError()
                self._boot_attempted = True
                self._boot_window = window
            self._busy = True
            self._begin()
            self._check()
            stream = self._socket
            stream.settimeout(self._budget())
            self._budget()
            if self._socket is not stream: raise ValueError()
            try:
                channel, _address = stream.accept()
            except TimeoutError:
                if window is not None: raise ValueError()
                # Idle is not a received transaction and cannot extend one.
                self._veto()
                return None
            if window is None: self._count += 1
            self._budget()
            self._check()
            owned, channel = channel, None
            control = (_CreateControl.accept(self._journal, owned, listener=self) if window is None
                else _CreateControl.accept_boot(self._journal, owned, window, listener=self))
            self._controls.append(control)
            self._budget()
            return control
        except Exception:
            self._retired = True
            _deny()
        finally:
            if channel is not None:
                try: channel.close()
                except Exception: self._cleanup_failed = True
            self._busy = False
            if self._retired: self._release()

    def confirm_boot(self, window):
        if self._busy:
            self._retired = True
            _deny()  # This invocation owns neither the outer busy bit nor its FDs.
        try:
            control = self._accept_control(window)
            self._busy = True
            control.confirm_boot()
            self._check()
            self._budget()
            self._boot_window = None
        except Exception:
            self._retired = True
            _deny()
        finally:
            self._busy = False
            if self._retired: self._release()

    def serve_create_once(self, manager):
        if self._busy:
            self._retired = True
            _deny()
        try:
            if (type(manager) is not SystemManagerProbe or manager._registration is not self._registration
                    or manager._pin is not self._pin): raise ValueError()
            manager._veto()
            control = self.accept_control()
            if control is None: return
            self._busy = True
            control.prepare()
            live = control.launch(manager)
            self._groups.append(live)
            self._veto()
            if type(live) is not _RunningQuartet: raise ValueError()
            live._veto()
        except Exception:
            self._retired = True
            _deny()
        finally:
            self._busy = False
            if self._retired: self._release()

    def _release(self):
        for owned in self._groups:
            try: owned.retire()
            except Exception: self._cleanup_failed = True
        self._groups.clear()
        for owned in self._controls:
            try: owned.close()
            except Exception: self._cleanup_failed = True
        self._controls.clear()
        owned, self._socket = self._socket, None
        if owned is not None:
            try: owned.close()
            except Exception: self._cleanup_failed = True
        if self._path_identity is not None:
            try:
                self._path_info()
                os.unlink(_NAME, dir_fd=self._chain[-1][0])
            except Exception: self._cleanup_failed = True
            self._path_identity = None
        while self._chain:
            fd, _signature = self._chain.pop()
            try: os.close(fd)
            except Exception: self._cleanup_failed = True

    def close(self):
        self._retired = True
        if not self._busy: self._release()
        if self._cleanup_failed: _deny()
