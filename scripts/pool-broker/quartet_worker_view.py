"""Root-owned inspection of a pinned pre-work process. Never a grant or exec."""
import fcntl
import os
import re
import stat

from quartet_material import _GroupMaterial
from quartet_worker_pin import _WorkerPin

_NS = {'net': 0x40000000, 'ipc': 0x08000000, 'mnt': 0x00020000}
_DIR = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC


def _deny():
    try:
        raise ValueError('POOL_BROKER_WORKER_VIEW_UNPROVEN') from None
    except ValueError as error:
        error.__context__ = None
        raise


def _pair(info):
    return (info.st_dev, info.st_ino)


class _WorkerView:
    def __init__(self):
        raise TypeError('use original material and worker pin')

    def __reduce_ex__(self, _protocol):
        raise TypeError('private original worker view')

    @classmethod
    def _open_locked(cls, material, pin, *, scope_guard=None):
        view = object.__new__(cls)
        view._fds, view._namespaces = [], {}
        view._retired, view._busy = False, False
        try:
            if (type(material) is not _GroupMaterial or type(pin) is not _WorkerPin
                    or pin._journal is not material._journal or pin._manager is not material._manager
                    or pin._resource != material._resource or pin._role not in material._bindings):
                raise ValueError()
            view._material, view._pin = material, pin
            view._run(scope_guard)
            return view
        except Exception:
            view.close()
            _deny()

    def _veto(self):
        self._material._remaining()
        self._owner_veto()

    def _owner_veto(self):
        material, pin = self._material, self._pin
        material._owner_veto()
        if (self._retired or not self._busy or not material._journal._busy
                or pin._retired or pin._fd is None or pin._proc is None
                or pin._journal is not material._journal or pin._manager is not material._manager
                or pin._resource != material._resource):
            raise ValueError()

    def _io(self, call, *args, **kw):
        self._budget()
        value = call(*args, **kw)
        self._budget()
        return value

    def _budget(self):
        self._veto()
        self._pin._budget()
        self._veto()

    def _open(self, path, flags, parent):
        self._budget()
        fd = os.open(path, flags, dir_fd=parent)
        self._fds.append(fd)
        self._budget()
        return fd

    def _close(self, fd):
        self._fds.remove(fd)
        os.close(fd)
        self._budget()

    def _namespace(self, name):
        # Only these fixed proc magic links beneath the original proc FD.
        fd = self._open('ns/' + name, os.O_RDONLY | os.O_CLOEXEC, self._pin._proc)
        if self._io(fcntl.ioctl, fd, 0xb703) != _NS[name]:
            raise ValueError()
        return fd, _pair(self._io(os.fstat, fd))

    def _identity(self):
        pin, material = self._pin, self._material
        raw = pin._read('status', 65536, parent=pin._proc)
        expected = {b'Uid': [material._uid] * 4, b'Gid': [material._gid] * 4,
                    b'NoNewPrivs': [1], b'Threads': [1], b'TracerPid': [0]}
        caps = {b'CapInh', b'CapPrm', b'CapEff', b'CapBnd', b'CapAmb'}
        seen = set()
        for line in raw.splitlines():
            key, sep, value = line.partition(b':')
            if key not in expected and key not in caps and key != b'Groups':
                continue
            if not sep or key in seen:
                raise ValueError()
            seen.add(key)
            values = value.split()
            if key in caps:
                if len(values) != 1 or re.fullmatch(b'0{16}', values[0]) is None:
                    raise ValueError()
            else:
                if any(re.fullmatch(b'[0-9]{1,10}', v) is None for v in values):
                    raise ValueError()
                parsed = [int(v) for v in values]
                if key == b'Threads' and self._running:
                    if len(parsed) != 1 or not 1 <= parsed[0] <= 128: raise ValueError()
                    continue
                if (parsed not in ([], [material._gid]) if key == b'Groups' else parsed != expected[key]):
                    raise ValueError()
        if seen != set(expected) | caps | {b'Groups'}:
            raise ValueError()
        lines = pin._read('net/dev', 8192, parent=pin._proc).splitlines()
        if (len(lines) != 3 or not lines[0].startswith(b'Inter-|') or not lines[1].lstrip().startswith(b'face |')
                or re.fullmatch(rb'\s*lo:\s+[0-9]+(?:\s+[0-9]+){15}\s*', lines[2]) is None):
            raise ValueError()

    def _objects(self):
        material = self._material
        count = len(self._fds)
        try:
            # root is a deliberate kernel magic link, all descendants NOFOLLOW.
            root = self._open('root', os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC, self._pin._proc)
            dev = self._open('dev', _DIR, root)
            dev_info = self._io(os.fstat, dev)
            if (not stat.S_ISDIR(dev_info.st_mode) or dev_info.st_uid != 0 or dev_info.st_gid != 0
                    or dev_info.st_mode & 0o7022):
                raise ValueError()
            objects = {'root': root, 'tmp': self._open('tmp', _DIR, root),
                       'shm': self._open('shm', _DIR, dev), 'profile': self._open('profile', _DIR, root)}
            for name, fd in objects.items():
                original = material._view._root if name == 'root' else material._objects[name][0]
                info, source = self._io(os.fstat, fd), self._io(os.fstat, original)
                flags = self._io(os.fstatvfs, fd).f_flag
                if (not stat.S_ISDIR(info.st_mode) or _pair(info) != _pair(source)
                        or set(self._io(os.listxattr, fd)) & {'system.posix_acl_access', 'system.posix_acl_default', 'security.capability'}):
                    raise ValueError()
                if name == 'root':
                    if not flags & 1 or info.st_uid != 0 or info.st_gid != 0 or info.st_mode & 0o7022:
                        raise ValueError()
                elif (info.st_uid != material._uid or info.st_gid != material._gid
                      or stat.S_IMODE(info.st_mode) != 0o700 or flags & 14 != 14 or flags & 1):
                    raise ValueError()
        finally:
            while len(self._fds) > count:
                self._close(self._fds[-1])

    def _check_namespaces(self):
        for name in _NS:
            current, pair = self._namespace(name)
            if pair == self._material._host_ns[name][1]:
                raise ValueError()
            group = self._material._bindings[self._pin._role]['groupNamespaces']
            if name in ('net', 'ipc') and group is not None and list(pair) != group[name]:
                raise ValueError()
            if name in self._namespaces:
                original, identity = self._namespaces[name]
                if (_pair(self._io(os.fstat, original)) != identity or pair != identity
                        or self._io(fcntl.ioctl, original, 0xb703) != _NS[name]):
                    raise ValueError()
                self._close(current)
            else:
                self._namespaces[name] = (current, pair)

    def _inspect(self):
        self._pin._verify()
        self._check_namespaces()
        self._identity()
        self._objects()
        self._pin._verify()
        self._check_namespaces()
        self._budget()

    def _run(self, scope_guard=None, *, running=False):
        if self._busy or self._retired:
            self.close()
            _deny()
        self._busy = True
        self._running = running
        try:
            self._veto()
            self._material._verify()
            # The caller can only shorten/veto the original pin budget. In a
            # child handshake this also preserves the original anchor source
            # across every native view operation, not merely after return.
            self._pin._run(self._inspect,
                scope_guard if scope_guard is not None else self._material._remaining, locked=True,
                terminal_veto=self._owner_veto)
            self._veto()
        except Exception:
            self._retired = True
            _deny()
        finally:
            self._busy = False
            self._running = False
            if self._retired:
                self._discard()

    def _check_locked(self, *, scope_guard=None):
        self._run(scope_guard)

    def _check_running_locked(self, *, scope_guard=None):
        from quartet_worker_channel import _WorkerChannel
        material, pin = self._material, self._pin
        worker = material._workers.get(pin._role)
        row = material._journal._resources[material._resource]['roles'].get(pin._role, {})
        if (pin._role == 'anchor' or type(worker) is not _WorkerChannel or worker._retired
                or worker._pin is not pin or worker._view is not self or not row.get('granted')
                or row.get('invocation') != pin._record[3]):
            self.close()
            _deny()
        self._run(scope_guard, running=True)

    def _discard(self):
        failed = False
        while self._fds:
            fd = self._fds.pop()
            try:
                os.close(fd)
            except Exception:
                failed = True
        if failed:
            _deny()

    def close(self):
        self._retired = True
        if not self._busy:
            self._discard()
