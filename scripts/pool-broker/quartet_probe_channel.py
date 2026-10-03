"""Original root HPT1 producer. Durable observations, never ready or exit proof."""
import array
import hashlib
import os
import socket
import time

from quartet_material import _GroupMaterial
from quartet_probe_clock import _ProtocolClock
from quartet_records import ROLES
from quartet_worker_channel import _WorkerChannel
from quartet_worker_guard import _probe_control_frame


class _ProtocolChannel:
    def __init__(self):
        raise TypeError('original root protocol channel required')

    def __reduce_ex__(self, _protocol):
        raise TypeError('original root protocol channel required')

    @classmethod
    def _open_locked(cls, material):
        if (type(material) is not _GroupMaterial or not material._busy or not material._journal._busy
                or material._protocol is not None or set(material._workers) != {'anchor'}
                or material._bridge is None or not material._bridge._committed
                or material._egress is None or not material._egress._complete): raise ValueError()
        self = object.__new__(cls)
        self._material, self._anchor = material, material._workers['anchor']
        self._pin, self._view = self._anchor._pin, self._anchor._view
        self._channel, self._clock = None, None
        self._binding = material._bindings['anchor']
        self._retired, self._complete, self._stage = False, False, 0
        self._role = self._anchor
        self._role_pin, self._role_view = self._pin, self._view
        self._last_ns = material._create_last_ns
        self._total_ns = material._create_deadline_ns
        self._phase_ns = self._total_ns
        material._protocol = self  # Own before any IO, including writer cleanup.
        try:
            self._begin()
            self._clock = _ProtocolClock._open_locked(material)
            self._handshake()
            return self
        except Exception:
            self.close()
            raise ValueError('POOL_BROKER_PROTOCOL_UNPROVEN') from None

    def _veto(self):
        material, anchor = self._material, self._anchor
        if (self._retired or material._protocol is not self or material._workers.get('anchor') is not anchor
                or type(anchor) is not _WorkerChannel or anchor._retired or anchor._pin is not self._pin
                or anchor._view is not self._view or self._pin._retired or self._pin._fd is None
                or self._pin._proc is None or self._view._retired
                or material._bindings.get('anchor') is not self._binding
                or material._workers.get(ROLES[self._stage]) is not self._role or self._role._retired
                or self._role._pin is not self._role_pin or self._role._view is not self._role_view
                or self._role_pin._retired or self._role_pin._fd is None or self._role_pin._proc is None
                or self._role_view._retired):
            raise ValueError()
        if not material._journal._resources[material._resource]['roles']['anchor'].get('granted'):
            raise ValueError()
        if self._clock is not None:
            if material._probe_clock is not self._clock: raise ValueError()
            self._clock._veto()

    def _budget(self):
        self._veto()
        remaining = self._material._remaining()
        now = time.monotonic_ns()
        if (type(now) is not int or now < self._last_ns or now >= min(self._total_ns, self._phase_ns)):
            raise ValueError()
        self._last_ns = now
        self._veto()
        return min(remaining, (min(self._total_ns, self._phase_ns) - now) / 1000000000)

    def _begin(self):
        self._budget()
        self._phase_ns = min(self._total_ns, self._last_ns + 5000000000)
        # Preserve the absolute integer deadline in the original material
        # transaction, including journal IO and its final guard. Clearing the
        # channel phase for the next command cannot clear this transaction cap.
        self._material._transaction_deadline_ns = min(
            self._material._transaction_deadline_ns, self._phase_ns)
        self._budget()

    def _io(self, call, *args):
        self._budget()
        result = call(*args)
        self._budget()
        return result

    def _check(self):
        self._budget()
        # This original view already performs material._verify; invoking the
        # channel wrapper would repeat the same full rootfs scan immediately.
        self._view._check_locked(scope_guard=self._budget)
        if self._role is not self._anchor:
            self._role_view._check_running_locked(scope_guard=self._budget)
        self._clock._check_locked(scope_guard=self._budget)
        self._budget()

    def _receive(self, expected, *, terminal=False):
        self._budget()
        self._io(self._channel.settimeout, self._budget())
        self._budget()
        # Received rights stay locally owned even if recvmsg reenters parent close.
        data, ancillary, flags, _address = self._channel.recvmsg(256,
            socket.CMSG_SPACE(253 * array.array('i').itemsize) + socket.CMSG_SPACE(12),
            getattr(socket, 'MSG_CMSG_CLOEXEC', 0x40000000))
        fds, peers, unwanted = [], [], False
        try:
            for level, kind, raw in ancillary:
                if level == socket.SOL_SOCKET and kind == socket.SCM_RIGHTS:
                    unwanted = True
                    width = array.array('i').itemsize
                    for fd in array.array('i', raw[:len(raw) // width * width]):
                        if fd >= 0 and fd not in fds: fds.append(fd)
                elif level == socket.SOL_SOCKET and kind == getattr(socket, 'SCM_CREDENTIALS', 2):
                    peers.append(raw)
                else: unwanted = True
            self._budget()
            if (unwanted or flags & ~getattr(socket, 'MSG_CMSG_CLOEXEC', 0x40000000)
                    or type(data) is not bytes or data != expected or len(peers) != 1
                    or type(peers[0]) is not bytes or len(peers[0]) != 12): raise ValueError()
            self._pin._check_sender_locked(peers[0], scope_guard=self._budget)
            if self._io(self._channel.getsockopt, socket.SOL_SOCKET,
                    getattr(socket, 'SO_PEERCRED', 17), 12) != peers[0]: raise ValueError()
            if not terminal: self._check()
        finally:
            failed = False
            while fds:
                try: os.close(fds.pop())
                except Exception: failed = True
            if failed: raise ValueError('POOL_BROKER_PROTOCOL_CLEANUP_UNPROVEN')
        self._budget()

    def _send(self, payload):
        self._budget()
        self._io(self._channel.settimeout, self._budget())
        self._budget()
        if self._channel.sendmsg([payload]) != len(payload): raise ValueError()
        self._budget()

    def _context(self):
        nonce = self._io(os.urandom, 32)
        if type(nonce) is not bytes or len(nonce) != 32 or nonce == bytes(32) or nonce.hex() == self._binding['handshake']:
            raise ValueError()
        self._nonce = nonce
        self._invocation, self._pid = self._role._pin._record[3], self._role._pin._pid
        self._evidence = {'stage': self._stage, 'role': ROLES[self._stage], 'invocation': self._invocation,
            'pid': self._pid, 'challengeDigest': hashlib.sha256(nonce).hexdigest(),
            'totalDeadlineNs': self._total_ns, 'phaseDeadlineNs': self._phase_ns,
            'clockDevice': self._clock._identity[0], 'clockInode': self._clock._identity[1]}

    def _frame(self, kind):
        return _probe_control_frame(kind, self._stage, self._binding, self._invocation,
            self._pid, self._nonce, self._total_ns, self._phase_ns)

    def _append(self, action):
        self._budget()
        self._material._append(action, **self._evidence)
        self._check()

    def _handshake(self):
        # Clock capture validated the original pin; hello's post-receive full
        # check runs before any durable offer or outward challenge.
        self._budget()
        self._io(self._material._socket.settimeout, self._budget())
        self._budget()
        self._channel, _address = self._material._socket.accept()
        self._budget()
        self._io(self._channel.set_inheritable, False)
        self._io(self._channel.setsockopt, socket.SOL_SOCKET, getattr(socket, 'SO_PASSCRED', 16), 1)
        self._receive(_probe_control_frame(1, 0, self._binding, '0' * 32, 0,
            bytes.fromhex(self._binding['handshake']), 0, 0))
        self._context()
        self._append('probe_open')
        self._send(self._frame(2))
        self._receive(self._frame(3))
        self._append('probe_accept')
        self._phase_ns = self._total_ns

    def _observe_locked(self, stage):
        try:
            if (type(stage) is not int or stage != self._stage + 1 or stage not in range(1, 5)
                    or self._complete or not self._material._busy or not self._material._journal._busy):
                raise ValueError()
            self._budget()
            role = self._material._workers.get(ROLES[stage])
            if type(role) is not _WorkerChannel or role._retired: raise ValueError()
            self._stage, self._role = stage, role
            self._role_pin, self._role_view = role._pin, role._view
            self._begin()
            self._context()
            # The consumed command is harmless metadata until the post-fsync
            # complete identity/clock check below permits its only send.
            self._append('protocol_command')
            self._send(self._frame(4))
            self._receive(self._frame(5))
            self._append('protocol_observed')
            self._send(self._frame(6))
            if stage == 4:
                # No outward action follows this exact, authenticated final
                # frame. The full terminal check follows its fsync and close.
                self._receive(self._frame(7), terminal=True)
                self._material._append('protocol_complete', **self._evidence)
                owned, self._channel = self._channel, None
                owned.close()
                # One full terminal check follows BOTH durable IO and close.
                self._check()
                self._complete = True
            self._phase_ns = self._total_ns
        except Exception:
            self.close()
            raise ValueError('POOL_BROKER_PROTOCOL_UNPROVEN') from None

    def close(self):
        self._retired = True
        owned, self._channel = self._channel, None
        if owned is not None: owned.close()
        # Pins, views and same-clock descriptors belong to original material.
