"""Root creates fixed original listeners only; it never forwards business IO."""
import os
import socket
from socket import socket as Socket
import stat

from quartet_material import _GroupMaterial, _sig

_PARTS = ('/', 'run', 'holaday-pool-data')
_NAMES = ('cdp.sock', 'vnc.sock')


class _GroupEndpoints:
    def __init__(self):
        raise TypeError('private original group endpoints')

    def __reduce_ex__(self, _protocol):
        raise TypeError('private original group endpoints')

    @classmethod
    def create(cls, material):
        if type(material) is not _GroupMaterial:
            raise ValueError('POOL_BROKER_ENDPOINTS_UNPROVEN')
        item = object.__new__(cls)
        item._material, item._chain, item._listeners = material, [], []
        item._retired, item._complete = False, False
        def create():
            material._verify()
            row = material._journal._resources[material._resource]
            if (material._endpoints is not None or row['state'] != 'material_prepared'
                    or row['roles'] or row.get('material', {}).get('credentials') or 'endpoints' in row):
                raise ValueError()
            # Outer failure cleanup owns every acquisition before the first IO.
            material._endpoints = item
            item._gid = material._registration._gid
            if type(item._gid) is not int or not 0 < item._gid <= 4294967294 or item._gid == material._gid:
                raise ValueError()
            item._create_locked()
        material._run(create)
        return item

    def _veto(self):
        material = self._material
        material._remaining()
        if (self._retired or material._endpoints is not self or not material._journal._busy
                or material._registration._gid != self._gid):
            raise ValueError()

    def _io(self, call, *args, **kw):
        self._veto()
        result = call(*args, **kw)
        self._veto()
        return result

    def _create_locked(self):
        m = self._material
        for index, name in enumerate(_PARTS):
            fd = m._open(name, self._chain[-1][0] if self._chain else None)
            info = m._metadata(fd, gid=self._gid if index == 2 else 0, mode=0o750 if index == 2 else None)
            self._chain.append((fd, _sig(info)))
        m._append('endpoint_claim')
        parent = self._chain[-1][0]
        self._io(os.mkdir, m._resource, 0o700, dir_fd=parent)
        group = m._open(m._resource, parent)
        self._io(os.fchown, group, 0, self._gid)
        self._io(os.fchmod, group, 0o750)
        self._group = (group, _sig(m._metadata(group, gid=self._gid, mode=0o750)))
        self._io(os.fsync, group)
        self._io(os.fsync, parent)
        for name in _NAMES:
            self._veto()
            listener = Socket(socket.AF_UNIX, socket.SOCK_STREAM | getattr(socket, 'SOCK_CLOEXEC', 0))
            entry = {'socket': listener, 'name': name}
            self._listeners.append(entry)
            self._veto()
            self._io(listener.set_inheritable, False)
            self._io(listener.setblocking, False)
            self._io(listener.bind, '/run/holaday-pool-data/' + m._resource + '/' + name)
            self._io(os.chown, name, 0, self._gid, dir_fd=group, follow_symlinks=False)
            self._io(os.chmod, name, 0o660, dir_fd=group, follow_symlinks=False)
            self._io(listener.listen, 8)
            # A socket FD's kernel inode is not its filesystem directory entry.
            info = self._io(os.fstat, listener.fileno())
            entry['fdIdentity'] = (info.st_dev, info.st_ino)
            entry['leafIdentity'] = _sig(self._io(os.stat, name, dir_fd=group, follow_symlinks=False))
        self._complete = True
        self._verify_locked()
        self._io(os.fsync, group)
        self._io(os.fsync, parent)
        m._verify()
        m._append('endpoint_ready')
        m._verify()

    def _verify_locked(self):
        self._veto()
        m = self._material
        if not self._complete or len(self._chain) != 3 or len(self._listeners) != 2:
            raise ValueError()
        for index, (fd, signature) in enumerate(self._chain):
            if _sig(m._metadata(fd, gid=self._gid if index == 2 else 0,
                                mode=0o750 if index == 2 else None)) != signature:
                raise ValueError()
            if index and _sig(self._io(os.stat, _PARTS[index], dir_fd=self._chain[index - 1][0],
                                      follow_symlinks=False)) != signature:
                raise ValueError()
        group, signature = self._group
        if (_sig(m._metadata(group, gid=self._gid, mode=0o750)) != signature
                or _sig(self._io(os.stat, m._resource, dir_fd=self._chain[-1][0], follow_symlinks=False)) != signature
                or set(self._io(os.listdir, group)) != set(_NAMES)):
            raise ValueError()
        identities = set()
        for name, entry in zip(_NAMES, self._listeners):
            listener = entry['socket']
            info = self._io(os.fstat, listener.fileno())
            identity = (info.st_dev, info.st_ino)
            leaf = self._io(os.stat, name, dir_fd=group, follow_symlinks=False)
            if (entry['name'] != name or identity != entry['fdIdentity'] or identity in identities
                    or not stat.S_ISSOCK(info.st_mode) or listener.family != socket.AF_UNIX
                    or self._io(listener.getsockopt, socket.SOL_SOCKET, socket.SO_TYPE) != socket.SOCK_STREAM
                    or self._io(listener.getsockopt, socket.SOL_SOCKET, socket.SO_ACCEPTCONN) != 1
                    or self._io(listener.get_inheritable) or self._io(listener.getblocking)
                    or self._io(listener.getsockname) != '/run/holaday-pool-data/' + m._resource + '/' + name
                    or _sig(leaf) != entry['leafIdentity'] or not stat.S_ISSOCK(leaf.st_mode)
                    or leaf.st_nlink != 1 or leaf.st_uid != 0 or leaf.st_gid != self._gid
                    or stat.S_IMODE(leaf.st_mode) != 0o660):
                raise ValueError()
            identities.add(identity)
        self._veto()

    def close(self):
        # Does not revoke copies already transferred elsewhere or prove exit.
        self._retired = True
        listeners, self._listeners = self._listeners, []
        failed = False
        for entry in reversed(listeners):
            try:
                entry['socket'].close()
            except Exception:
                failed = True
        if failed:
            raise ValueError('POOL_BROKER_ENDPOINTS_UNPROVEN')
