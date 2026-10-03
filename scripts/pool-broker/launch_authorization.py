"""Consume one root-issued launch permission; never issue or reset one."""

import json
import math
import os
import re
import sys
import time

import installation


def _deny():
    try:
        raise ValueError('POOL_BROKER_LAUNCH_AUTHORIZATION_UNPROVEN') from None
    except ValueError as error:
        error.__context__ = None
        raise


def _context():
    if (sys.platform != 'linux' or os.getresuid() != (0, 0, 0)
            or os.getresgid() != (0, 0, 0) or len(os.listdir('/proc/self/task')) != 1
            or dict(os.environ) != {'PATH': '/usr/bin:/bin', 'LANG': 'C.UTF-8'}):
        raise ValueError()


def _directory(path, fds):
    current = os.open('/', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC)
    fds.append(current)
    installation._object(current)
    parts = path.strip('/').split('/')
    for index, part in enumerate(parts):
        current = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=current)
        fds.append(current)
        installation._object(current, mode=0o700 if index == len(parts) - 1 else None)
    return current


def _unique(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError()
        result[key] = value
    return result


def _clocks():
    wall, monotonic = time.time(), time.monotonic()
    if (type(wall) not in (int, float) or type(monotonic) not in (int, float)
            or not math.isfinite(wall) or not math.isfinite(monotonic)
            or not 0 <= wall < 9007199254740 or monotonic < 0):
        raise ValueError()
    return wall * 1000, monotonic


class LaunchWindow:
    """Private, non-serializable lifetime check; not readiness or resource authority."""

    __slots__ = ('_expires', '_deadline', '_last_wall', '_last_mono', '_revoked', '_candidate', '_epoch')

    def __init__(self):
        raise TypeError('created only by durable consumption')

    def remaining(self):
        try:
            if self._revoked:
                raise ValueError()
            wall, monotonic = _clocks()
            if wall < self._last_wall or monotonic < self._last_mono:
                raise ValueError()
            self._last_wall, self._last_mono = wall, monotonic
            remaining = min((self._expires - wall) / 1000, self._deadline - monotonic)
            if remaining <= 0:
                raise ValueError()
            return remaining
        except Exception:
            self._revoked = True
            _deny()

    def __reduce_ex__(self, _protocol):
        raise TypeError('launch window cannot be serialized')


def consume_launch_authorization(candidate):
    fds, window, failed = [], None, True
    try:
        _context()
        if type(candidate) is not str or re.fullmatch(r'[0-9a-f]{40}', candidate) is None or candidate == '0' * 40:
            raise ValueError()
        parent = _directory('/etc/holaday-pool-broker', fds)
        fd = os.open('launch-authorization.json', os.O_RDONLY | os.O_CLOEXEC | os.O_NOFOLLOW | os.O_NONBLOCK,
                     dir_fd=parent)
        fds.append(fd)
        installation._object(fd, mode=0o600, regular=True)
        size = os.fstat(fd).st_size
        if not 0 < size <= 1024:
            raise ValueError()
        raw = os.pread(fd, size + 1, 0)
        if len(raw) != size:
            raise ValueError()
        data = json.loads(raw, object_pairs_hook=_unique)
        if (type(data) is not dict or set(data) != {'version', 'candidate', 'epoch', 'not_before_ms', 'expires_at_ms'}
                or type(data['version']) is not int or data['version'] != 1 or data['candidate'] != candidate
                or type(data['epoch']) is not str or re.fullmatch(r'[0-9a-f]{32}', data['epoch']) is None
                or data['epoch'] == '0' * 32
                or type(data['not_before_ms']) is not int or type(data['expires_at_ms']) is not int
                or not 0 <= data['not_before_ms'] < data['expires_at_ms'] < 9007199254740992
                or data['expires_at_ms'] - data['not_before_ms'] > 60000):
            raise ValueError()
        wall, monotonic = _clocks()
        if not data['not_before_ms'] <= wall < data['expires_at_ms']:
            raise ValueError()
        window = object.__new__(LaunchWindow)
        window._candidate, window._epoch = candidate, data['epoch']
        window._expires = data['expires_at_ms']
        window._deadline = monotonic + (data['expires_at_ms'] - wall) / 1000
        window._last_wall, window._last_mono, window._revoked = wall, monotonic, False
        parent = _directory('/var/lib/holaday-pool-broker', fds)
        fd = os.open('launch-consumed.json', os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC,
                     0o600, dir_fd=parent)
        fds.append(fd)
        installation._object(fd, mode=0o600, regular=True)
        record = json.dumps({'version': 1, 'candidate': candidate, 'epoch': data['epoch']}).encode()
        offset = 0
        while offset < len(record):
            count = os.write(fd, record[offset:])
            if count <= 0 or count > len(record) - offset:
                raise ValueError()
            offset += count
        os.fsync(fd)
        os.fsync(parent)
        _context()
        window.remaining()
        failed = False
    except Exception:
        pass
    finally:
        while fds:
            owned = fds.pop()
            try:
                os.close(owned)
            except Exception:
                failed = True
    try:
        if failed:
            raise ValueError()
        _context()
        window.remaining()
        return window
    except Exception:
        if window is not None:
            window._revoked = True
        _deny()
