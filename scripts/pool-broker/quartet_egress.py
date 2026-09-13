"""Pin the original app egress leaf by a protected link; fixed control probes only."""
import array
import hashlib
import json
import os
import socket
from socket import socket as Socket
import stat
import struct

from quartet_material import _GroupMaterial, _sig
from quartet_worker_guard import _decode_egress_binding

_TARGET = '/run/holaday-pool-egress-links/'
_FRAME = struct.Struct('!4sB20s16s16s32s')


class _GroupEgress:
    def __init__(self):
        raise TypeError('original group material required')

    def __reduce_ex__(self, _protocol):
        raise TypeError('private original egress object')

    @classmethod
    def create(cls, material):
        if type(material) is not _GroupMaterial:
            raise ValueError('POOL_BROKER_EGRESS_UNPROVEN')
        self = object.__new__(cls)
        self._material, self._retired = material, False
        self._chain, self._sockets, self._rights, self._nonces = [], [], [], []
        self._group = self._leaf = self._target_parent = None
        self._complete = False
        self._credential = None
        def create():
            material._verify()
            row = material._journal._resources[material._resource]
            if (material._egress is not None or 'egress' in row or row['roles']
                    or row.get('endpoints', {}).get('state') != 'ready'
                    or row.get('material', {}).get('credentials')):
                raise ValueError()
            material._egress = self  # All later acquisition belongs to outer cleanup.
            self._create_locked()
        material._run(create, handshake=True)
        return self

    def _veto(self):
        if self._retired or self._material._egress is not self:
            raise ValueError()

    def _budget(self):
        self._veto()
        return self._material._remaining()

    def _io(self, call, *args, **kwargs):
        self._budget()
        result = call(*args, **kwargs)
        self._budget()
        return result

    def _create_locked(self):
        m = self._material
        for index, name in enumerate(('/', 'run', 'holaday-pool-egress')):
            fd = m._open(name, self._chain[-1][0] if self._chain else None)
            args = {'uid': 998, 'gid': m._registration._gid, 'mode': 0o700} if index == 2 else {}
            self._chain.append((fd, _sig(m._metadata(fd, **args))))
        parent = m._open('holaday-pool-egress-links', self._chain[1][0])
        self._target_parent = (parent, _sig(m._metadata(parent, mode=0o700)))
        leaf = m._raw_fd('egress.sock', getattr(os, 'O_PATH', 0x200000) | os.O_NOFOLLOW | os.O_CLOEXEC,
                         dir_fd=self._chain[-1][0])
        self._leaf = (leaf, _sig(self._io(os.fstat, leaf)))
        self._verify_locked()
        first = self._probe('/proc/self/fd/' + str(leaf))
        m._append('egress_claim')
        self._io(os.mkdir, m._resource, 0o700, dir_fd=parent)
        group = m._open(m._resource, parent)
        self._group = (group, _sig(m._metadata(group, mode=0o700)))
        self._io(os.link, 'egress.sock', 'egress.sock', src_dir_fd=self._chain[-1][0],
                 dst_dir_fd=group, follow_symlinks=False)
        self._verify_locked()
        second = self._probe(_TARGET + m._resource + '/egress.sock')
        self._io(os.fsync, group)
        self._io(os.fsync, parent)
        self._verify_locked()
        self._create_credential()
        m._verify()
        identity = self._leaf[1]
        m._append('egress_ready', leafDevice=identity[0], leafInode=identity[1],
                  challengeDigest=hashlib.sha256(first + second).hexdigest())
        self._complete = True
        m._verify()

    def _create_credential(self):
        m = self._material
        data = {'version': 1, 'candidate': m._candidate, 'resource': m._resource,
            'boot': m._pin._boot, 'key': m._journal._resources[m._resource]['egressCapability'],
            'leaf': {'device': self._leaf[1][0], 'inode': self._leaf[1][1]}}
        raw = json.dumps(data, separators=(',', ':')).encode()
        _decode_egress_binding(raw, m._candidate, m._resource, m._pin._boot)
        parent = m._objects['credentials'][0]
        fd = m._raw_fd('egress', os.O_RDWR | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC,
            mode=0o400, dir_fd=parent)
        self._io(os.fchown, fd, 0, 0)
        self._io(os.fchmod, fd, 0o400)
        offset = 0
        while offset < len(raw):
            count = self._io(os.write, fd, raw[offset:])
            if type(count) is not int or not 0 < count <= len(raw) - offset: raise ValueError()
            offset += count
        self._credential = (fd, _sig(self._io(os.fstat, fd)), hashlib.sha256(raw).hexdigest(), len(raw))
        m._check_private_file('egress', self._credential)
        self._io(os.fsync, fd)
        self._io(os.fsync, parent)
        self._verify_locked()

    def _verify_locked(self):
        self._budget()
        m = self._material
        if len(self._chain) != 3 or self._leaf is None or self._target_parent is None:
            raise ValueError()
        for index, (fd, signature) in enumerate(self._chain):
            args = {'uid': 998, 'gid': m._registration._gid, 'mode': 0o700} if index == 2 else {}
            if _sig(m._metadata(fd, **args)) != signature:
                raise ValueError()
            if index and _sig(self._io(os.stat, ('run', 'holaday-pool-egress')[index - 1],
                    dir_fd=self._chain[index - 1][0], follow_symlinks=False)) != signature:
                raise ValueError()
        parent, signature = self._target_parent
        if (_sig(m._metadata(parent, mode=0o700)) != signature
                or _sig(self._io(os.stat, 'holaday-pool-egress-links', dir_fd=self._chain[1][0],
                    follow_symlinks=False)) != signature):
            raise ValueError()
        leaf, signature = self._leaf
        actual = self._io(os.fstat, leaf)
        if (not stat.S_ISSOCK(actual.st_mode) or actual.st_uid != 998 or actual.st_gid != m._registration._gid
                or stat.S_IMODE(actual.st_mode) != 0o666 or actual.st_nlink < 1
                or self._io(os.get_inheritable, leaf) or _sig(actual) != signature
                or _sig(self._io(os.stat, 'egress.sock', dir_fd=self._chain[-1][0], follow_symlinks=False)) != signature
                or set(self._io(os.listxattr, '/proc/self/fd/' + str(leaf)))
                   & {'system.posix_acl_access', 'system.posix_acl_default', 'security.capability'}):
            raise ValueError()
        if self._group is not None:
            group, group_signature = self._group
            if (_sig(m._metadata(group, mode=0o700)) != group_signature
                    or _sig(self._io(os.stat, m._resource, dir_fd=parent, follow_symlinks=False)) != group_signature
                    or set(self._io(os.listdir, group)) != {'egress.sock'}
                    or _sig(self._io(os.stat, 'egress.sock', dir_fd=group, follow_symlinks=False)) != signature):
                raise ValueError()
        if self._credential is not None:
            m._check_private_file('egress', self._credential)
        self._budget()

    def _check(self):
        self._budget()
        self._material._verify()
        self._material._pin._require_live()
        self._budget()

    def _probe(self, path):
        m = self._material
        self._check()
        stream = Socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self._sockets.append(stream)
        self._budget()
        try:
            self._io(stream.set_inheritable, False)
            self._io(stream.setsockopt, socket.SOL_SOCKET, getattr(socket, 'SO_PASSCRED', 16), 1)
            self._io(stream.settimeout, self._budget())
            self._io(stream.connect, path)
            credentials = self._io(stream.getsockopt, socket.SOL_SOCKET, getattr(socket, 'SO_PEERCRED', 17), 12)
            self._io(m._pin.check_sender, credentials, m._pin._boot)
            self._check()
            nonce = self._io(os.urandom, 32)
            if type(nonce) is not bytes or len(nonce) != 32 or nonce == b'\0' * 32 or nonce in self._nonces:
                raise ValueError()
            self._nonces.append(nonce)
            fields = (bytes.fromhex(m._candidate), bytes.fromhex(m._resource), bytes.fromhex(m._pin._boot), nonce)
            request = _FRAME.pack(b'HPE1', 1, *fields)
            expected = _FRAME.pack(b'HPE1', 2, *fields)
            self._check()
            self._io(stream.settimeout, self._budget())
            if stream.sendmsg([request]) != len(request): raise ValueError()
            self._check()
            received = b''
            while len(received) < _FRAME.size:
                self._check()
                self._io(stream.settimeout, self._budget())
                data, ancillary, flags, _address = stream.recvmsg(_FRAME.size + 1 - len(received),
                    socket.CMSG_SPACE(253 * array.array('i').itemsize) + socket.CMSG_SPACE(12),
                    getattr(socket, 'MSG_CMSG_CLOEXEC', 0x40000000))
                peers, invalid = [], False
                for level, kind, raw in ancillary:
                    if level == socket.SOL_SOCKET and kind == socket.SCM_RIGHTS:
                        invalid = True
                        width = array.array('i').itemsize
                        for fd in array.array('i', raw[:len(raw) // width * width]):
                            if fd >= 0 and fd not in self._rights: self._rights.append(fd)
                    elif level == socket.SOL_SOCKET and kind == getattr(socket, 'SCM_CREDENTIALS', 2):
                        peers.append(raw)
                    else: invalid = True
                self._check()
                if (invalid or len(peers) != 1 or flags & ~getattr(socket, 'MSG_CMSG_CLOEXEC', 0x40000000)
                        or type(data) is not bytes or not data or len(received) + len(data) > _FRAME.size):
                    raise ValueError()
                self._io(m._pin.check_sender, peers[0], m._pin._boot)
                self._check()
                received += data
            if received != expected: raise ValueError()
        finally:
            stream.close()
        self._check()  # Close/cleanup cannot be the last unobserved operation.
        return hashlib.sha256(request + received).digest()

    def close(self):
        self._retired = True
        sockets, self._sockets = self._sockets, []
        failed = False
        for stream in sockets:
            try: stream.close()
            except Exception: failed = True
        while self._rights:
            try: os.close(self._rights.pop())
            except Exception: failed = True
        # Original O_PATH/directories belong to material's exact FD collection.
        self._nonces = []
        if failed: raise ValueError('POOL_BROKER_EGRESS_UNPROVEN')
