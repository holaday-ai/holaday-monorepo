"""Original root listener: fresh challenge, durable consume, one send only."""
import array
import hashlib
import os
import socket

from quartet_material import _GroupMaterial
from quartet_records import ROLES
from quartet_worker_pin import _WorkerPin
from quartet_worker_view import _WorkerView


def _deny():
    try:
        raise ValueError('POOL_BROKER_WORKER_CHANNEL_UNPROVEN') from None
    except ValueError as error:
        error.__context__ = None
        raise


class _WorkerChannel:
    def __init__(self):
        raise TypeError('private original worker channel')

    def __reduce_ex__(self, _protocol):
        raise TypeError('private original worker channel')

    @classmethod
    def _accept_locked(cls, material, role):
        item = object.__new__(cls)
        item._channel, item._pin, item._view = None, None, None
        item._anchor = None
        item._fds, item._retired = [], False
        try:
            if (type(material) is not _GroupMaterial or type(role) is not str
                    or len(material._workers) >= len(ROLES) or role != ROLES[len(material._workers)]
                    or not material._busy or not material._journal._busy):
                raise ValueError()
            item._material, item._role = material, role
            if role != 'anchor':
                anchor = material._workers.get('anchor')
                if type(anchor) is not cls:
                    raise ValueError()
                item._anchor = (anchor, anchor._pin, anchor._view)
            # Ownership precedes acquisition, including final outer-guard failure.
            material._workers[role] = item
            item._budget()
            item._handshake()
        except Exception:
            item.close()
            _deny()

    def _budget(self):
        material = self._material
        remaining = material._remaining()
        self._veto()
        return remaining

    def _veto(self):
        material = self._material
        material._owner_veto()
        if (self._retired or not material._journal._busy or material._workers.get(self._role) is not self
                or self._pin is not None and self._pin._retired
                or self._view is not None and self._view._retired):
            raise ValueError()
        if self._anchor is not None:
            anchor, pin, view = self._anchor
            if (material._workers.get('anchor') is not anchor or anchor._material is not material
                    or anchor._role != 'anchor' or anchor._retired
                    or type(pin) is not _WorkerPin or anchor._pin is not pin
                    or pin._retired or pin._fd is None or pin._proc is None
                    or type(view) is not _WorkerView or anchor._view is not view
                    or view._retired or view._pin is not pin):
                raise ValueError()

    def _io(self, call, *args, **kw):
        self._budget()
        value = call(*args, **kw)
        self._budget()
        return value

    def _receive(self):
        self._io(self._channel.settimeout, self._budget())
        self._budget()
        data, ancillary, flags, _address = self._channel.recvmsg(256,
            socket.CMSG_SPACE(253 * array.array('i').itemsize) + socket.CMSG_SPACE(12),
            getattr(socket, 'MSG_CMSG_CLOEXEC', 0x40000000))
        peers, unwanted = [], False
        # Own every delivered FD before any veto, even with truncation/extra cmsg.
        for level, name, raw in ancillary:
            if level == socket.SOL_SOCKET and name == socket.SCM_RIGHTS:
                unwanted = True
                width = array.array('i').itemsize
                for fd in array.array('i', raw[:len(raw) // width * width]):
                    if fd >= 0 and fd not in self._fds:
                        self._fds.append(fd)
            elif level == socket.SOL_SOCKET and name == getattr(socket, 'SCM_CREDENTIALS', 2):
                peers.append(raw)
            else:
                unwanted = True
        self._budget()
        if (unwanted or flags & ~getattr(socket, 'MSG_CMSG_CLOEXEC', 0x40000000)
                or type(data) is not bytes or len(peers) != 1 or type(peers[0]) is not bytes or len(peers[0]) != 12):
            raise ValueError()
        return data, peers[0]

    def _send(self, payload):
        self._io(self._channel.settimeout, self._budget())
        self._budget()
        if self._channel.sendmsg([payload]) != len(payload):
            raise ValueError()
        self._budget()

    def _check_locked(self):
        self._budget()
        if self._role != 'anchor':
            self._material._anchor_locked()
        # The original view performs material._verify before its inspection;
        # don't scan that same material twice at one composed boundary.
        self._view._check_locked(scope_guard=self._budget)
        self._budget()

    def _handshake(self):
        material, role = self._material, self._role
        if role != 'anchor':
            # The committed bridge check already includes the original anchor
            # and endpoints. Compose it at this boundary, not twice in callers.
            if material._endpoints is not None:
                material._bridge_locked()
            else:
                material._anchor_locked()
        else:
            material._verify()
        row = material._journal._resources[material._resource]['roles'].get(role, {})
        if row.get('state') != 'observed' or row.get('granted', False) or role not in material._bindings:
            raise ValueError()
        binding = material._bindings[role]
        self._io(material._socket.settimeout, self._budget())
        self._budget()
        self._channel, _address = material._socket.accept()
        self._budget()
        self._io(self._channel.set_inheritable, False)
        self._io(self._channel.setsockopt, socket.SOL_SOCKET, getattr(socket, 'SO_PASSCRED', 16), 1)
        data, peer = self._receive()
        expected = ('HPW1 hello ' + material._resource + ' ' + role + ' ' + binding['handshake']).encode('ascii')
        if (data != expected or self._io(self._channel.getsockopt, socket.SOL_SOCKET,
                getattr(socket, 'SO_PEERCRED', 17), 12) != peer):
            raise ValueError()
        self._pin = _WorkerPin._from_received_peer_locked(material._journal, material._manager,
            material._resource, role, peer, scope_guard=self._budget, scope_veto=self._veto)
        self._budget()
        self._view = _WorkerView._open_locked(material, self._pin, scope_guard=self._budget)
        self._budget()
        entropy = self._io(os.urandom, 32)
        if type(entropy) is not bytes or len(entropy) != 32 or entropy == b'\0' * 32:
            raise ValueError()
        nonce = entropy.hex()
        if nonce == binding['handshake']:
            raise ValueError()
        self._check_locked()
        self._send(('HPW1 challenge ' + nonce).encode('ascii'))
        response, sender = self._receive()
        self._pin._check_sender_locked(sender, scope_guard=self._budget)
        if response != ('HPW1 response ' + nonce).encode('ascii'):
            raise ValueError()
        self._check_locked()
        material._append('role_grant', role=role, invocation=self._pin._record[3],
            bindingDigest=material._credentials[role][2], challengeDigest=hashlib.sha256(entropy).hexdigest())
        # Fsync has consumed the grant. Every later failure remains unknown;
        # neither a retry nor a reopen may manufacture a replacement sender.
        self._check_locked()
        self._send(('HPW1 grant ' + nonce).encode('ascii'))
        owned, self._channel = self._channel, None
        owned.close()
        self._budget()

    def close(self):
        self._retired = True
        failed = False
        owned, self._channel = self._channel, None
        if owned is not None:
            try:
                owned.close()
            except Exception:
                failed = True
        for name in ('_view', '_pin'):
            owned = getattr(self, name)
            setattr(self, name, None)
            if owned is not None:
                try:
                    owned.close()
                except Exception:
                    failed = True
        while self._fds:
            fd = self._fds.pop()
            try:
                os.close(fd)
            except Exception:
                failed = True
        if failed:
            _deny()
