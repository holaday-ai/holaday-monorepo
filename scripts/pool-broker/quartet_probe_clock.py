"""Same original Linux time namespace, prerequisite for absolute HPT1 deadlines."""
import fcntl
import math
import os
import time

from quartet_material import _GroupMaterial
from quartet_worker_channel import _WorkerChannel
from quartet_worker_pin import _WorkerPin
from quartet_worker_view import _WorkerView


def _pair(info):
    return (info.st_dev, info.st_ino)


class _ProtocolClock:
    def __init__(self):
        raise TypeError('original root clock required')

    @classmethod
    def _open_locked(cls, material):
        if (type(material) is not _GroupMaterial or not material._busy or not material._journal._busy
                or material._probe_clock is not None): raise ValueError()
        anchor = material._workers.get('anchor')
        if type(anchor) is not _WorkerChannel: raise ValueError()
        self = object.__new__(cls)
        self._material, self._anchor, self._pin, self._view = material, anchor, anchor._pin, anchor._view
        self._fds, self._retired, self._busy, self._scope_guard = [], False, False, None
        self._root_proc = self._root_namespace = self._anchor_namespace = self._identity = None
        self._root_pid = os.getpid()
        material._probe_clock = self
        try:
            self._run(self._capture)
            return self
        except Exception:
            self.close()
            raise ValueError('POOL_BROKER_CLOCK_UNPROVEN') from None

    def _veto(self):
        material, anchor, pin, view = self._material, self._anchor, self._pin, self._view
        if (self._retired or material._probe_clock is not self or material._workers.get('anchor') is not anchor
                or anchor._retired or anchor._material is not material or anchor._pin is not pin or anchor._view is not view
                or type(pin) is not _WorkerPin or pin._retired or pin._fd is None or pin._proc is None
                or type(view) is not _WorkerView or view._retired or view._pin is not pin): raise ValueError()

    def _budget(self):
        self._veto()
        outer = self._scope_guard() if self._scope_guard is not None else None
        remaining = self._material._remaining()
        if outer is not None:
            if type(outer) not in (int, float) or not math.isfinite(outer) or outer <= 0: raise ValueError()
            remaining = min(remaining, outer)
        if self._pin._busy:
            # Do not call pin._budget: its manager scope calls back here.
            now = time.monotonic()
            limit = self._material._manager._deadline - now
            if not math.isfinite(now) or not math.isfinite(limit) or limit <= 0: raise ValueError()
            remaining = min(remaining, limit)
        self._veto()
        return remaining

    def _io(self, call, *args, **kwargs):
        self._budget()
        result = call(*args, **kwargs)
        self._budget()
        return result

    def _open(self, path, flags, parent=None):
        self._budget()
        fd = os.open(path, flags, **({'dir_fd': parent} if parent is not None else {}))
        self._fds.append(fd)
        self._budget()
        return fd

    def _namespace(self, parent):
        fd = self._open('ns/time', os.O_RDONLY | os.O_CLOEXEC, parent)
        self._metadata(fd)
        return fd

    def _metadata(self, fd):
        if (self._io(fcntl.ioctl, fd, 0xb703) != 0x80 or self._io(os.get_inheritable, fd)):
            raise ValueError()
        pair = _pair(self._io(os.fstat, fd))
        if any(type(value) is not int or not 0 <= value < 2**64 for value in pair) or pair[1] == 0: raise ValueError()
        return pair

    def _capture(self):
        self._pin._verify()
        self._root_proc = self._open('/proc/' + str(self._root_pid), os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC)
        self._root_namespace = self._namespace(self._root_proc)
        self._anchor_namespace = self._namespace(self._pin._proc)
        self._identity = self._metadata(self._root_namespace)
        if self._metadata(self._anchor_namespace) != self._identity: raise ValueError()
        self._inspect()

    def _inspect(self):
        self._pin._verify()
        self._namespaces()
        self._pin._verify()
        self._namespaces()
        self._budget()

    def _namespaces(self):
        if self._io(os.getpid) != self._root_pid: raise ValueError()
        count = len(self._fds)
        try:
            current_root = self._open('/proc/' + str(self._root_pid), os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC)
            if (_pair(self._io(os.fstat, current_root)) != _pair(self._io(os.fstat, self._root_proc))
                    or self._io(os.get_inheritable, self._root_proc)): raise ValueError()
            for original, parent in ((self._root_namespace, current_root), (self._anchor_namespace, self._pin._proc)):
                current = self._namespace(parent)
                if self._metadata(current) != self._identity or self._metadata(original) != self._identity: raise ValueError()
        finally:
            failed = False
            while len(self._fds) > count:
                try: os.close(self._fds.pop())
                except Exception: failed = True
            if failed: raise ValueError()
        self._budget()

    def _run(self, operation, scope_guard=None):
        if self._retired or self._busy:
            self.close()
            raise ValueError()
        self._busy, self._scope_guard = True, scope_guard
        try:
            self._budget()
            self._pin._run(operation, self._budget, locked=True, terminal_veto=self._veto)
            self._budget()
        except Exception:
            self._retired = True
            raise
        finally:
            self._busy, self._scope_guard = False, None
            if self._retired: self._discard()

    def _check_locked(self, *, scope_guard=None):
        self._run(self._inspect, scope_guard)

    def _discard(self):
        failed = False
        while self._fds:
            try: os.close(self._fds.pop())
            except Exception: failed = True
        if failed: raise ValueError('POOL_BROKER_CLOCK_CLEANUP_UNPROVEN')

    def close(self):
        self._retired = True
        if not self._busy: self._discard()
