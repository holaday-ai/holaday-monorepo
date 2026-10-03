"""One original app stream, durable reservation and fixed complete group start."""
import array
import os
import select
import secrets
import socket
import struct
import time

import launch_authorization
from quartet_create_offer import _CreateOffer
from quartet_protocol import (decode_control_frame, decode_quartet_request, encode_control_frame,
    QuartetCreateRequest, decode_boot_frame, encode_boot_frame)
from resource_journal import ResourceJournal


def _deny():
    try:
        raise ValueError('POOL_BROKER_CREATE_CONTROL_UNPROVEN') from None
    except ValueError as error:
        error.__context__ = None
        raise


class _CreateControl:
    def __init__(self): raise TypeError('private original application control')
    def __reduce_ex__(self, _protocol): raise TypeError('private original application control')

    @classmethod
    def accept(cls, journal, stream, *, listener=None):
        return cls._accept(journal, stream, listener=listener, window=None)

    @classmethod
    def accept_boot(cls, journal, stream, window, *, listener=None):
        return cls._accept(journal, stream, listener=listener, window=window)

    @classmethod
    def _accept(cls, journal, stream, *, listener, window):
        item = object.__new__(cls)
        item._stream = stream if isinstance(stream, socket.socket) else None
        item._offer = None
        item._material = item._runtime = None
        item._launch_attempted = item._creation_attempted = False
        item._retired = item._attempted = item._accepted = False
        item._input_bytes = item._output_bytes = 0
        item._listener = listener
        item._boot_window = window
        try:
            if type(journal) is not ResourceJournal or item._stream is None: raise ValueError()
            if window is not None and (type(window) is not launch_authorization.LaunchWindow
                    or window._candidate != journal._candidate): raise ValueError()
            if listener is not None:
                from quartet_listener import _QuartetListener
                if type(listener) is not _QuartetListener or listener._journal is not journal: raise ValueError()
                listener._veto()
            item._journal, item._registration, item._pin = journal, journal._registration, journal._pin
            item._last_ns = time.monotonic_ns()
            if type(item._last_ns) is not int or not 0 <= item._last_ns < 2**63 - 60000000000: raise ValueError()
            item._deadline_ns, item._phase_ns = item._last_ns + 60000000000, item._last_ns + 5000000000
            if window is not None: item._deadline_ns = item._phase_ns
            item._budget()
            if stream.family != socket.AF_UNIX or stream.getsockopt(socket.SOL_SOCKET, socket.SO_TYPE) != socket.SOCK_STREAM:
                raise ValueError()
            item._budget()
            stream.set_inheritable(False)
            item._budget()
            stream.setsockopt(socket.SOL_SOCKET, getattr(socket, 'SO_PASSCRED', 16), 1)
            item._budget()
            item._peer = stream.getsockopt(socket.SOL_SOCKET, getattr(socket, 'SO_PEERCRED', 17), 12)
            item._check()
            return item
        except Exception:
            item.close()
            _deny()

    def _veto(self):
        if self._listener is not None: self._listener._veto()
        journal, reg, pin = self._journal, self._registration, self._pin
        if (self._retired or self._stream is None or journal._retired or reg._revoked or not reg._received
                or journal._registration is not reg or journal._pin is not pin or reg._pin is not pin
                or pin._fd is None or self._offer is not None and self._offer._retired): raise ValueError()
        # The child's own boundary performs its final full owner veto. Do not
        # recursively sweep that graph for every call to its parent time scope.
        if self._material is not None and self._material._retired: raise ValueError()
        if self._runtime is not None: self._runtime._veto()

    def _budget(self):
        now = time.monotonic_ns()
        if type(now) is not int or now < self._last_ns or now >= min(self._deadline_ns, self._phase_ns): raise ValueError()
        self._last_ns = now
        remaining = float('inf') if self._boot_window is None else self._boot_window.remaining()
        if self._boot_window is not None and self._listener is not None:
            remaining = min(remaining, self._listener._budget())
        if self._boot_window is not None:
            last = time.monotonic_ns()
            if (type(last) is not int or last < now or last >= min(self._deadline_ns, self._phase_ns)
                    or self._boot_window._revoked): raise ValueError()
            remaining -= (last - now) / 1000000000
            if remaining <= 0: raise ValueError()
            now = self._last_ns = last
        self._veto()
        return min(remaining, (min(self._deadline_ns, self._phase_ns) - now) / 1000000000)

    def _check(self):
        self._budget()
        launch_authorization._context()
        self._budget()
        stream = self._stream
        peer = stream.getsockopt(socket.SOL_SOCKET, getattr(socket, 'SO_PEERCRED', 17), 12)
        self._budget()
        if type(peer) is not bytes or len(peer) != 12 or peer != self._peer: raise ValueError()
        self._registration.check_runtime_sender(peer, self._journal._boot)
        self._budget()
        if self._stream is not stream: raise ValueError()
        if self._material is not None: self._material._owner_veto()

    def _begin(self):
        self._budget()
        self._phase_ns = min(self._deadline_ns, self._last_ns + 5000000000)

    def _prepare_io(self):
        self._check()
        stream = self._stream
        stream.settimeout(self._budget())
        self._budget()
        if self._stream is not stream: raise ValueError()
        if self._material is not None: self._material._owner_veto()
        self._veto()
        return stream

    def _receive(self):
        payload = b''
        while True:
            stream = self._prepare_io()
            chunk, ancillary, flags, _address = stream.recvmsg(4101 - len(payload),
                socket.CMSG_SPACE(253 * array.array('i').itemsize) + socket.CMSG_SPACE(12),
                getattr(socket, 'MSG_CMSG_CLOEXEC', 0x40000000))
            # Own newly delivered rights locally BEFORE any reentrant parent
            # veto. Parent close cannot erase these descriptors from cleanup.
            owned, peers, invalid = [], [], False
            try:
                for level, kind, raw in ancillary:
                    if (level, kind) == (socket.SOL_SOCKET, socket.SCM_RIGHTS):
                        invalid = True
                        width = array.array('i').itemsize
                        for fd in array.array('i', raw[:len(raw) // width * width]):
                            if fd >= 0 and fd not in owned: owned.append(fd)
                    elif (level, kind) == (socket.SOL_SOCKET, getattr(socket, 'SCM_CREDENTIALS', 2)):
                        peers.append(raw)
                    else: invalid = True
                self._check()
                if (invalid or flags & ~getattr(socket, 'MSG_CMSG_CLOEXEC', 0x40000000)
                        or type(chunk) is not bytes or not chunk or peers != [self._peer]): raise ValueError()
                self._input_bytes += len(chunk)
                if self._input_bytes > 8200: raise ValueError()
                payload += chunk
                if len(payload) >= 4:
                    size = struct.unpack('!I', payload[:4])[0]
                    if not 1 <= size <= 4096 or len(payload) > size + 4: raise ValueError()
                    if len(payload) == size + 4:
                        self._decode(payload)
                        self._budget()
                        return payload
            finally:
                failed = False
                for fd in owned:
                    try: os.close(fd)
                    except Exception: failed = True
                if failed: raise ValueError()

    def _send(self, frame):
        self._decode(frame)
        self._output_bytes += len(frame)
        if self._output_bytes > 8200: raise ValueError()
        stream = self._prepare_io()
        if stream.sendmsg([frame]) != len(frame): raise ValueError()
        self._check()

    def _no_queued_input(self):
        self._check()
        stream = self._stream
        readable, _writable, exceptional = select.select([stream], [], [stream], 0)
        self._budget()
        if self._stream is not stream or readable or exceptional: raise ValueError()
        # Readiness only: never MSG_PEEK/receive SCM_RIGHTS into an unowned FD.
        # This rejects bytes/EOF queued NOW, not bytes sent at an arbitrary future time.

    def _decode(self, frame):
        return (decode_control_frame if self._boot_window is None else decode_boot_frame)(frame)

    def confirm_boot(self):
        try:
            if self._attempted or self._boot_window is None: raise ValueError()
            self._attempted = True
            data = self._decode(self._receive())
            if (data['phase'] != 'boot-hello' or data['candidate'] != self._journal._candidate
                    or data['boot'] != self._journal._boot): raise ValueError()
            self._no_queued_input()
            nonce = secrets.token_hex(16)
            self._budget()
            transcript = data | {'rootNonce': nonce, 'epoch': self._boot_window._epoch}
            self._send(encode_boot_frame(transcript | {'phase': 'boot-challenge'}))
            accepted = self._decode(self._receive())
            if accepted != transcript | {'phase': 'boot-accepted'}: raise ValueError()
            self._no_queued_input()
            self._send(encode_boot_frame(transcript | {'phase': 'boot-ack'}))
            self._no_queued_input()
            stream = self._stream
            stream.close()
            self._budget()
            self._registration._require_registered()
            self._budget()
            if self._stream is not stream: raise ValueError()
            self._stream = None
            self._retired = True
        except Exception:
            self.close()
            _deny()

    def prepare(self):
        try:
            if self._attempted or self._boot_window is not None: raise ValueError()
            self._attempted = True
            request_frame = self._receive()
            request = decode_quartet_request(request_frame[4:])
            if type(request) is not QuartetCreateRequest: raise ValueError()
            self._no_queued_input()
            self._begin()
            self._offer = _CreateOffer.open(self._journal, request,
                deadline_ns=self._deadline_ns, scope_guard=self._budget)
            self._check()
            frame = self._offer.take_prepared()
            self._send(frame)
            self._begin()
            accepted = self._receive()
            self._no_queued_input()
            self._offer.accept_frame(accepted)
            self._no_queued_input()
            self._accepted = True
            self._phase_ns = self._deadline_ns
            return self._offer
        except Exception:
            self.close()
            _deny()

    def close(self):
        self._retired = True
        failed = False
        stream, self._stream = self._stream, None
        live, self._runtime = self._runtime, None
        material, self._material = self._material, None
        try:
            if live is not None: live.retire()
            elif material is not None: material.close()
        except Exception: failed = True
        try:
            if self._offer is not None: self._offer.close()
        except Exception: failed = True
        if stream is not None:
            try: stream.close()
            except Exception: failed = True
        if failed: _deny()
        # A closed control connection is not physical group exit or slot release.

    def launch(self, manager):
        """Consume this stream's accepted reservation once; no path/request DTO."""
        from quartet_material import _GroupMaterial
        try:
            self._check()
            if not self._accepted or self._creation_attempted or self._launch_attempted: raise ValueError()
            self._creation_attempted = True
            prepared = self._offer.consume()
            self._material = _GroupMaterial.create(self._journal, manager, prepared,
                deadline_ns=self._offer._deadline_ns, scope_guard=self._offer._budget)
            self._check()
            return self._start_material(self._material)
        except Exception:
            self.close()
            _deny()

    def _start_material(self, material):
        """Private original allocation continuation, never journal reconstruction."""
        from quartet_material import _GroupMaterial
        from quartet_launch import _launch_material
        from quartet_runtime import _RunningQuartet
        try:
            self._check()
            offer = self._offer
            if (not self._accepted or self._launch_attempted or type(material) is not _GroupMaterial
                    or self._material is not None and self._material is not material
                    or type(offer) is not _CreateOffer or not offer._consumed
                    or material._journal is not self._journal or material._prepared is not offer._prepared
                    or material._resource != offer._resource or material._create_deadline_ns != offer._deadline_ns):
                raise ValueError()
            self._launch_attempted = True
            self._material = material
            _launch_material(material, ready_offer=offer)
            live = _RunningQuartet.adopt(material, offer)
            self._runtime = live
            self._begin()  # Final ready delivery is a <=5s phase, never a new total lease.
            self._no_queued_input()
            self._send(encode_control_frame(offer._scope | {'phase': 'ready', 'preparedDigest': offer._digest}))
            self._no_queued_input()
            # Keep this control's deadline through physical close and its last
            # veto. Only then detach the one original live owner from cleanup.
            stream = self._stream
            stream.close()
            self._budget()
            material._owner_veto()
            if self._stream is not stream or self._runtime is not live: raise ValueError()
            self._stream = self._offer = self._material = self._runtime = None
            self._retired = True
            return live
        except Exception:
            self.close()
            _deny()
