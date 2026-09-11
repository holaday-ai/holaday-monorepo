"""Root-only original-process registration; ACK is not application readiness."""

import array
import os
import re
import socket
import struct
import sys
import threading
import time

from process_pin import PinnedApplication
from launch_authorization import LaunchWindow


class BrokerRegistrationError(ValueError):
    """Fixed failure; never contains credentials, descriptors or source errors."""


def _deny():
    try:
        raise BrokerRegistrationError("POOL_BROKER_REGISTRATION_UNPROVEN") from None
    except BrokerRegistrationError as error:
        error.__context__ = None
        raise


def _token(value, length):
    if (type(value) is not str or re.fullmatch(r"[0-9a-f]{%d}" % length, value) is None
            or value == "0" * length):
        raise ValueError()
    return bytes.fromhex(value)


def _config(candidate, gid):
    candidate_bytes = _token(candidate, 40)
    if type(gid) is not int or not 0 < gid < 4294967295:
        raise ValueError()
    return candidate_bytes


def _platform():
    if (sys.platform != "linux" or os.geteuid() != 0 or os.getuid() != 0 or os.getgid() != 0
            or not callable(getattr(os, "pidfd_open", None))
            or any(not hasattr(socket, name) for name in (
                "SO_PASSCRED", "SO_PEERCRED", "SCM_CREDENTIALS", "MSG_CMSG_CLOEXEC"))):
        raise ValueError()


def _remaining(channel, deadline):
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        raise TimeoutError()
    channel.settimeout(remaining)


def _expired(deadline):
    # Final check performs no socket operation after the socket is closed.
    try:
        return deadline is None or time.monotonic() >= deadline
    except Exception:
        return True


def _prepare(channel, deadline):
    _platform()
    if (not isinstance(channel, socket.socket) or channel.family != socket.AF_UNIX
            or channel.getsockopt(socket.SOL_SOCKET, socket.SO_TYPE) != socket.SOCK_SEQPACKET):
        raise ValueError()
    channel.set_inheritable(False)
    channel.setsockopt(socket.SOL_SOCKET, socket.SO_PASSCRED, 1)
    peer = channel.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12)
    if type(peer) is not bytes or len(peer) != 12:
        raise ValueError()
    pid, uid, gid = struct.unpack("=iII", peer)
    if pid < 2 or uid != 0 or gid != 0:
        raise ValueError()
    _remaining(channel, deadline)
    return peer


def _close_fds(fds):
    # Remove ownership before close; never retry even if close raises.
    failed = False
    while fds:
        fd = fds.pop()
        try:
            os.close(fd)
        except Exception:
            failed = True
    return failed


def _close_channel(channel):
    try:
        channel.close()
        return False
    except Exception:
        return True


def _receive(channel, peer, deadline, fds, expected_fds):
    _remaining(channel, deadline)
    # Linux SCM_MAX_FD is 253. Bound memory while still collecting all returned
    # rights, including truncated/invalid packets, before rejecting any content.
    payload, ancillary, flags, _address = channel.recvmsg(
        49, socket.CMSG_SPACE(253 * array.array("i").itemsize) + socket.CMSG_SPACE(12),
        socket.MSG_CMSG_CLOEXEC)
    credentials = []
    rights_count = 0
    invalid = False
    for level, kind, data in ancillary:
        if level == socket.SOL_SOCKET and kind == socket.SCM_RIGHTS:
            rights_count += 1
            width = array.array("i").itemsize
            count = len(data) // width * width
            invalid |= count != len(data)
            for fd in array.array("i", data[:count]):
                if fd < 0 or fd in fds:
                    invalid = True
                else:
                    fds.append(fd)
        elif level == socket.SOL_SOCKET and kind == socket.SCM_CREDENTIALS:
            credentials.append(data)
        else:
            invalid = True
    if (invalid or flags & ~(socket.MSG_EOR | socket.MSG_CMSG_CLOEXEC)
            or type(payload) is not bytes or len(payload) != 48
            or credentials != [peer] or len(fds) != expected_fds
            or rights_count != (1 if expected_fds else 0)):
        raise ValueError()
    _remaining(channel, deadline)
    return payload


def register_self(channel, candidate, boot, gid):
    """Consume a connected root-private socket. Return only after exact ACK.

    The trusted launcher must close on failure, not load or exec application
    code. This function does not perform installation, privilege drop or exec.
    """
    own_fds, received_fds = [], []
    deadline = None
    failed = True
    try:
        deadline = time.monotonic() + 5.0
        candidate_bytes, boot_bytes = _config(candidate, gid), _token(boot, 32)
        peer = _prepare(channel, deadline)
        pid = os.getpid()
        if pid < 2:
            raise ValueError()
        fd = os.pidfd_open(pid, 0)
        own_fds.append(fd)
        os.set_inheritable(fd, False)
        payload = struct.pack("!8s20s16sI", b"HDPLREG1", candidate_bytes, boot_bytes, gid)
        _remaining(channel, deadline)
        if channel.sendmsg([payload], [(socket.SOL_SOCKET, socket.SCM_RIGHTS,
                                       array.array("i", [fd]).tobytes())]) != len(payload):
            raise ValueError()
        reply = _receive(channel, peer, deadline, received_fds, 0)
        if reply != b"HDPLACK1" + payload[8:]:
            raise ValueError()
        failed = False
    except Exception:
        pass
    finally:
        failed = _close_fds(received_fds) or failed
        failed = _close_fds(own_fds) or failed
        failed = _close_channel(channel) or failed
        failed = _expired(deadline) or failed
    if failed:
        _deny()


class LaunchRegistration:
    """One registration attempt, no resource creation or readiness API."""

    def __init__(self, candidate, gid):
        try:
            self._candidate, self._gid = _config(candidate, gid), gid
        except Exception:
            _deny()
        self._pin = None
        self._attempted = False
        self._revoked = False
        self._lock = threading.RLock()
        self._window = None
        self._received = False

    def receive(self, channel, *, window=None):
        with self._lock:
            fds = []
            deadline = None
            failed = True
            started = False
            try:
                if self._attempted:
                    raise ValueError()
                self._attempted = True
                started = True
                deadline = time.monotonic() + 5.0
                if window is not None:
                    if type(window) is not LaunchWindow:
                        raise ValueError()
                    self._window = window
                    remaining = window.remaining()
                    deadline = min(deadline, time.monotonic() + remaining)
                self._require_pending()
                peer = _prepare(channel, deadline)
                self._require_pending()
                payload = _receive(channel, peer, deadline, fds, 1)
                self._require_pending()
                magic, candidate, boot, gid = struct.unpack("!8s20s16sI", payload)
                if magic != b"HDPLREG1" or candidate != self._candidate or gid != self._gid or boot == bytes(16):
                    raise ValueError()
                pid = struct.unpack("=iII", peer)[0]
                self._pin = PinnedApplication.from_root_launch(fds[0], pid, boot.hex(), gid)
                self._require_pending()
                if _close_fds(fds):
                    raise ValueError()
                _remaining(channel, deadline)
                self._require_pending()
                if channel.sendmsg([b"HDPLACK1" + payload[8:]]) != len(payload):
                    raise ValueError()
                _remaining(channel, deadline)
                self._require_pending()
                failed = False
            except Exception:
                pass
            finally:
                failed = _close_fds(fds) or failed
                failed = _close_channel(channel) or failed
                failed = _expired(deadline) or failed
                if started and self._window is not None:
                    try:
                        self._window.remaining()
                    except Exception:
                        failed = True
                failed = self._revoked or failed
                if failed and started:
                    self._revoked = True
                    self._discard()
            if failed:
                _deny()
            self._received = True

    def _require_registered(self):
        pin = self._pin
        if not self._received or self._revoked or pin is None:
            raise ValueError()
        pin._require_live()
        if self._revoked or not self._received or self._pin is not pin:
            raise ValueError()

    def check_runtime_sender(self, credentials, boot=None):
        """Internal kernel credentials only; success never grants resource authority."""
        with self._lock:
            self._require_registered()
            pin = self._pin
            pin.check_sender(credentials, pin._boot if boot is None else boot)
            self._require_registered()
            if self._pin is not pin:
                raise ValueError()

    def _require_pending(self):
        if self._revoked:
            raise ValueError()
        window = self._window
        if window is not None:
            window.remaining()
        if self._revoked or self._window is not window:
            raise ValueError()

    def _discard(self):
        pin, self._pin = self._pin, None
        if pin is not None:
            try:
                pin.close()
            except Exception:
                return True
        return False

    def close(self):
        with self._lock:
            self._attempted = True
            self._revoked = True
            if self._discard():
                _deny()
