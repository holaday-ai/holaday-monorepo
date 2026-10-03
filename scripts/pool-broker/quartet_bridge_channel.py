"""Single original-anchor FD handoff; not a business proxy or readiness proof."""
import array
import hashlib
import os
import socket
import struct

from quartet_endpoints import _GroupEndpoints
from quartet_material import _GroupMaterial
from quartet_worker_channel import _WorkerChannel
from quartet_worker_guard import _bridge_frame
from quartet_worker_pin import _WorkerPin
from quartet_worker_view import _WorkerView


class _BridgeChannel(_WorkerChannel):
    @classmethod
    def _transfer_locked(cls, material):
        if (type(material) is not _GroupMaterial or not material._busy or not material._journal._busy
                or material._bridge is not None or set(material._workers) != {'anchor'}
                or type(material._endpoints) is not _GroupEndpoints):
            raise ValueError()
        material._remaining()
        # Clamp the ORIGINAL transaction, including its final journal guard.
        # A later material transaction gets a new budget; this is not a lease.
        material._deadline = min(material._deadline, material._last + 5.0)
        item = object.__new__(cls)
        item._material, item._endpoints = material, material._endpoints
        item._channel, item._fds, item._retired, item._committed = None, [], False, False
        anchor = material._workers['anchor']
        item._anchor = (anchor, anchor._pin, anchor._view)
        material._bridge = item  # Own before accept, including final writer failure.
        item._handshake()

    def _veto(self):
        material = self._material
        anchor, pin, view = self._anchor
        if (self._retired or material._bridge is not self
                or material._endpoints is not self._endpoints or self._endpoints._retired
                or type(anchor) is not _WorkerChannel or material._workers.get('anchor') is not anchor
                or anchor._material is not material or anchor._role != 'anchor' or anchor._retired
                or type(pin) is not _WorkerPin or anchor._pin is not pin or pin._retired
                or pin._fd is None or pin._proc is None
                or type(view) is not _WorkerView or anchor._view is not view or view._retired or view._pin is not pin):
            raise ValueError()

    def _budget(self):
        remaining = self._material._remaining()
        self._veto()
        if not self._material._journal._busy:
            raise ValueError()
        return remaining

    def _check_locked(self):
        self._budget()
        anchor = self._material._anchor_locked()
        self._endpoints._verify_locked()
        self._budget()
        return anchor

    def _packet(self, expected):
        data, peer = self._receive()  # Own and reject every unexpected right.
        self._anchor[1]._check_sender_locked(peer, scope_guard=self._budget)
        self._check_locked()
        if data != expected:
            raise ValueError()
        return peer

    def _handshake(self):
        material = self._material
        self._check_locked()
        row = material._journal._resources[material._resource]
        if (row.get('endpoints', {}).get('state') != 'ready' or 'bridge' in row
                or set(row['roles']) != {'anchor'} or not row['roles']['anchor'].get('granted')
                or set(row['material']['credentials']) != {'anchor'}):
            raise ValueError()
        binding = material._bindings['anchor']
        invocation = self._anchor[1]._record[3]
        entries = self._endpoints._listeners
        identities = tuple(number for entry in entries for number in entry['fdIdentity'])
        if (len(identities) != 4 or any(type(v) is not int or not 0 <= v < 2**64 for v in identities)
                or identities[1] == 0 or identities[3] == 0 or identities[:2] == identities[2:]):
            raise ValueError()
        self._io(material._socket.settimeout, self._budget())
        self._channel, _address = material._socket.accept()
        self._budget()
        self._io(self._channel.set_inheritable, False)
        self._io(self._channel.setsockopt, socket.SOL_SOCKET, getattr(socket, 'SO_PASSCRED', 16), 1)
        peer = self._packet(_bridge_frame(0, binding, '0' * 32, binding['handshake'], (0, 0, 0, 0)))
        if self._io(self._channel.getsockopt, socket.SOL_SOCKET, getattr(socket, 'SO_PEERCRED', 17), 12) != peer:
            raise ValueError()
        entropy = self._io(os.urandom, 32)
        if type(entropy) is not bytes or len(entropy) != 32 or entropy == bytes(32) or entropy.hex() == binding['handshake']:
            raise ValueError()
        nonce = entropy.hex()
        self._check_locked()
        self._send(_bridge_frame(1, binding, invocation, nonce, identities))
        self._packet(_bridge_frame(2, binding, invocation, nonce, identities))
        evidence = {'invocation': invocation, 'challengeDigest': hashlib.sha256(entropy).hexdigest(),
                    'endpointDigest': hashlib.sha256(struct.pack('!QQQQ', *identities)).hexdigest()}
        material._append('bridge_offer', **evidence)
        self._check_locked()
        self._io(self._channel.settimeout, self._budget())
        payload = _bridge_frame(3, binding, invocation, nonce, identities)
        rights = array.array('i', [entry['socket'].fileno() for entry in entries])
        self._budget()
        if self._channel.sendmsg([payload], [(socket.SOL_SOCKET, socket.SCM_RIGHTS, rights)]) != len(payload):
            raise ValueError()
        self._budget()
        self._packet(_bridge_frame(4, binding, invocation, nonce, identities))
        material._append('bridge_commit', **evidence)
        self._check_locked()
        self._send(_bridge_frame(5, binding, invocation, nonce, identities))
        owned, self._channel = self._channel, None
        owned.close()
        self._check_locked()
        # This permits subsequent dispatch only; only the consumer knows it
        # received commit. Neither side can infer service readiness or exit.
        self._committed = True

    def close(self):
        self._retired = True
        failed = False
        owned, self._channel = self._channel, None
        if owned is not None:
            try: owned.close()
            except Exception: failed = True
        while self._fds:
            try: os.close(self._fds.pop())
            except Exception: failed = True
        # Original anchor pin/view and listeners are borrowed from material.
        # Closing root originals cannot revoke remote descriptor copies.
        if failed: raise ValueError('POOL_BROKER_BRIDGE_UNPROVEN')
