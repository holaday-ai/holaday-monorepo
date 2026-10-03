"""Original-process pin only; not a socket authenticator or launch registrar."""

import os
import re
import select
import signal
import struct
import sys
import threading


class BrokerIdentityError(ValueError):
    """Fixed diagnostic with no kernel or request data."""


def _deny():
    # `raise ... from None` suppresses display but retains an active caller's
    # exception as __context__. Clear it after raising, then re-raise unchanged.
    try:
        raise BrokerIdentityError("POOL_BROKER_IDENTITY_UNPROVEN") from None
    except BrokerIdentityError as error:
        error.__context__ = None
        raise


class PinnedApplication:
    """Necessary identity checks, never proof of credential origin or code isolation.

    The root launch owner must supply its already-held original pidfd before
    releasing the application. Do not expose this factory as a registration API.
    Callers must close the pin; no PID lookup or automatic recovery is supported.
    """

    __slots__ = ("_fd", "_pid", "_boot", "_gid", "_lock")

    def __init__(self):
        raise TypeError("use trusted launch registration")

    @classmethod
    def from_root_launch(cls, pidfd, expected_pid, boot, gid):
        pin = object.__new__(cls)
        pin._fd = None
        pin._lock = threading.RLock()
        try:
            _require_platform()
            if (type(pidfd) is not int or not 0 <= pidfd <= 2147483647
                    or type(expected_pid) is not int or not 2 <= expected_pid <= 2147483647
                    or type(gid) is not int or not 0 < gid < 4294967295
                    or type(boot) is not str or re.fullmatch(r"[0-9a-f]{32}", boot) is None
                    or boot == "0" * 32):
                raise ValueError()
            pin._pid, pin._boot, pin._gid = expected_pid, boot, gid
            pin._fd = os.dup(pidfd)
            os.set_inheritable(pin._fd, False)
            pin._observe()
            return pin
        except Exception:
            pass
        try:
            pin._discard()
        except Exception:
            pass
        _deny()

    def _observe(self):
        _require_platform()
        if self._fd is None:
            raise ValueError()
        # Signal zero checks the pidfd and permission; it sends no signal.
        signal.pidfd_send_signal(self._fd, 0, None, 0)
        info_fd = os.open(f"/proc/self/fdinfo/{self._fd}",
                          os.O_RDONLY | os.O_CLOEXEC | os.O_NOFOLLOW)
        try:
            info = os.read(info_fd, 8193)
        finally:
            os.close(info_fd)
        if len(info) > 8192:
            raise ValueError()
        pids = [line for line in info.splitlines() if line.startswith(b"Pid:")]
        if len(pids) != 1:
            raise ValueError()
        match = re.fullmatch(rb"Pid:[ \t]+([1-9][0-9]*)", pids[0])
        if match is None or int(match[1]) != self._pid:
            raise ValueError()
        poller = select.poll()
        poller.register(self._fd, select.POLLIN | select.POLLHUP | select.POLLERR)
        if poller.poll(0):
            raise ValueError()

    def _require_live(self):
        try:
            self._observe()
            return
        except Exception:
            pass
        try:
            self._discard()
        except Exception:
            pass
        _deny()

    def check_sender(self, credentials, boot):
        """Check kernel-sourced ucred; plain input bytes do not prove that source.

        Success is instantaneous and returns no authorization capability. It
        cannot be cached for later dispatch or used to prove absence of reexec.
        """
        with self._lock:
            self._require_live()
            if (type(credentials) is not bytes or len(credentials) != 12
                    or type(boot) is not str or boot != self._boot
                    or struct.unpack("=iII", credentials) != (self._pid, 998, self._gid)):
                _deny()
            self._require_live()

    def _discard(self):
        # Invalidate before close, including on error; never retry a reused fd.
        fd, self._fd = self._fd, None
        if fd is not None:
            os.close(fd)

    def close(self):
        with self._lock:
            try:
                self._discard()
                return
            except Exception:
                pass
        _deny()

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        self.close()


def _require_platform():
    if (sys.platform != "linux" or os.geteuid() != 0
            or not callable(getattr(signal, "pidfd_send_signal", None))
            or not callable(getattr(select, "poll", None))):
        raise ValueError()
