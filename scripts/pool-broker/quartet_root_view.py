"""Original candidate filesystem evidence; not a mount or execution permission."""

import hashlib
import json
import math
import os
import re
import stat
import time

from protocol import _unique_object, _reject_constant, _identifier
from resource_journal import ResourceJournal

# Only the hash-verified loader may supply this, never a caller path or policy.
_POLICY = globals().get('_POLICY')
_FLAGS = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC
_EMPTY = {'/dev', '/proc', '/sys', '/run', '/tmp', '/profile'}
_TOOLS = {'/usr/bin/' + name for name in ('python3', 'Xvfb', 'brave-browser', 'x11vnc', 'websockify')}
_PREFIXES = ('/usr/bin', '/usr/lib', '/usr/share', '/lib', '/lib64', '/bin',
             '/opt/brave.com/brave', '/etc/fonts', '/etc/ssl/certs')


def _deny():
    try:
        raise ValueError('POOL_BROKER_ROOT_VIEW_UNPROVEN') from None
    except ValueError as error:
        error.__context__ = None
        raise


def _policy(candidate):
    if type(_POLICY) is not bytes or not 0 < len(_POLICY) <= 1048576:
        raise ValueError()
    value = json.loads(_POLICY, object_pairs_hook=_unique_object, parse_constant=_reject_constant)
    if (type(value) is not dict or set(value) != {'version', 'status', 'candidate', 'nodes'}
            or type(value['version']) is not int or value['version'] != 1
            or value['status'] != 'linux-verified' or value['candidate'] != candidate
            or type(value['nodes']) is not list or not 1 <= len(value['nodes']) <= 4096):
        raise ValueError()
    _identifier(candidate, 40)
    nodes, total = {}, 0
    for node in value['nodes']:
        if type(node) is not dict:
            raise ValueError()
        path, kind, mode = node.get('path'), node.get('kind'), node.get('mode')
        if (type(path) is not str or len(path) > 512 or path in nodes
                or (path != '/' and (re.fullmatch(r'(?:/[A-Za-z0-9_.+@-]+)+', path) is None
                    or any(p in ('.', '..') for p in path.split('/')[1:])))
                or len(path.split('/')) > 24 or type(mode) is not int):
            raise ValueError()
        permitted = path == '/quartet_worker_guard.py' or path in _EMPTY or path == '/'
        permitted |= any(path == p or path.startswith(p + '/') or p.startswith(path + '/') for p in _PREFIXES)
        if not permitted or any(path.startswith(p + '/') for p in _EMPTY):
            raise ValueError()
        keys = {'path', 'kind', 'mode'}
        if kind == 'directory':
            if set(node) != keys or mode != 0o555:
                raise ValueError()
        elif kind == 'file':
            if (set(node) != keys | {'size', 'sha256'} or mode not in (0o444, 0o555)
                    or type(node['size']) is not int or not 0 < node['size'] <= 536870912):
                raise ValueError()
            _identifier(node['sha256'], 64)
            total += node['size']
        else:
            raise ValueError()
        nodes[path] = node
    if total > 2147483648:
        raise ValueError()
    for path, node in nodes.items():
        if path != '/':
            parent = path.rsplit('/', 1)[0] or '/'
            if parent not in nodes or nodes[parent]['kind'] != 'directory':
                raise ValueError()
    for path in _EMPTY | {'/'}:
        if path not in nodes or nodes[path]['kind'] != 'directory':
            raise ValueError()
    for path in _TOOLS | {'/quartet_worker_guard.py'}:
        if (path not in nodes or nodes[path]['kind'] != 'file'
                or nodes[path]['mode'] != (0o555 if path in _TOOLS else 0o444)):
            raise ValueError()
    return nodes


def _signature(info):
    return tuple(getattr(info, name) for name in
                 ('st_dev', 'st_ino', 'st_mode', 'st_uid', 'st_gid', 'st_nlink',
                  'st_size', 'st_mtime_ns', 'st_ctime_ns'))


class _RootView:
    def __init__(self):
        raise TypeError('private original root view')

    def __reduce_ex__(self, _protocol):
        raise TypeError('private original root view')

    @classmethod
    def open(cls, journal, *, scope_guard=None):
        root = object.__new__(cls)
        root._fds, root._chain, root._identities = [], [], {}
        root._busy, root._retired = False, False
        try:
            if type(journal) is not ResourceJournal:
                raise ValueError()
            root._journal, root._registration, root._pin = journal, journal._registration, journal._pin
            root._candidate = journal._candidate
            root._nodes = _policy(root._candidate)
            root._policy_digest = hashlib.sha256(_POLICY).hexdigest()
            root._children = {p: {} for p, n in root._nodes.items() if n['kind'] == 'directory'}
            for path in root._nodes:
                if path != '/':
                    parent, leaf = path.rsplit('/', 1)
                    root._children[parent or '/'][leaf] = path
            root._parts = ('/', 'usr', 'local', 'lib', 'holaday-pool-broker', 'releases', root._candidate, 'rootfs')
            def acquire():
                journal._local()
                for name in root._parts:
                    fd = root._open(name, _FLAGS, root._chain[-1][0] if root._chain else None)
                    info = root._metadata(fd)
                    root._chain.append((fd, (info.st_dev, info.st_ino)))
                root._root = root._chain[-1][0]
                root._walk(root._root, '/', initial=True)
                root._verify()
            root._run(acquire, scope_guard=scope_guard)
            return root
        except Exception:
            root.close()
            _deny()

    def _veto(self):
        reg, journal = self._registration, self._journal
        if (self._retired or not self._busy or journal._retired or reg._revoked or not reg._received
                or journal._registration is not reg or journal._pin is not self._pin
                or reg._pin is not self._pin or self._pin._fd is None
                or reg._candidate.hex() != self._candidate or journal._candidate != self._candidate):
            raise ValueError()

    def _budget(self):
        self._journal._alive()
        now = time.monotonic()
        if not math.isfinite(now) or now < self._last or now >= self._deadline:
            raise ValueError()
        self._last = now
        self._veto()

    def _io(self, call, *args, **kw):
        self._budget()
        result = call(*args, **kw)
        self._budget()
        return result

    def _open(self, name, flags, parent=None):
        self._budget()
        fd = os.open(name, flags, **({'dir_fd': parent} if parent is not None else {}))
        self._fds.append(fd)  # Own before any callback can veto the result.
        self._budget()
        return fd

    def _close_fd(self, fd):
        self._fds.remove(fd)
        os.close(fd)  # Never retry a possibly reused descriptor number.
        self._budget()

    def _metadata(self, fd, node=None):
        info = self._io(os.fstat, fd)
        regular = node is not None and node['kind'] == 'file'
        if (info.st_uid != 0 or info.st_gid != 0 or info.st_mode & 0o7022
                or not (stat.S_ISREG(info.st_mode) if regular else stat.S_ISDIR(info.st_mode))
                or regular and info.st_nlink != 1
                or node is not None and stat.S_IMODE(info.st_mode) != node['mode']):
            raise ValueError()
        if set(self._io(os.listxattr, fd)) & {'system.posix_acl_access', 'system.posix_acl_default', 'security.capability'}:
            raise ValueError()
        if node is not None and self._io(os.fstatvfs, fd).f_flag & 1 != 1:
            raise ValueError()
        return info

    def _walk(self, fd, path, *, initial=False):
        node = self._nodes[path]
        before = _signature(self._metadata(fd, node))
        if not initial and self._identities.get(path) != before:
            raise ValueError()
        if node['kind'] == 'directory':
            children = self._children[path]
            names = self._io(os.listdir, fd)
            if len(names) != len(children) or set(names) != set(children):
                raise ValueError()
            for leaf, child in children.items():
                flags = _FLAGS if self._nodes[child]['kind'] == 'directory' else (
                    os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC | os.O_NONBLOCK)
                child_fd = self._open(leaf, flags, fd)
                try:
                    self._walk(child_fd, child, initial=initial)
                finally:
                    self._close_fd(child_fd)
        elif initial:
            if before[6] != node['size']:
                raise ValueError()
            digest, offset = hashlib.sha256(), 0
            while offset < node['size']:
                part = self._io(os.pread, fd, min(65536, node['size'] - offset), offset)
                if type(part) is not bytes or not 0 < len(part) <= min(65536, node['size'] - offset):
                    raise ValueError()
                digest.update(part)
                offset += len(part)
            if self._io(os.pread, fd, 1, offset) or digest.hexdigest() != node['sha256']:
                raise ValueError()
        if _signature(self._metadata(fd, node)) != before:
            raise ValueError()
        self._identities[path] = before

    def _verify(self):
        if (self._io(os.getresuid) != (0, 0, 0) or self._io(os.getresgid) != (0, 0, 0)):
            raise ValueError()
        for index, (fd, identity) in enumerate(self._chain):
            info = self._metadata(fd)
            if (info.st_dev, info.st_ino) != identity:
                raise ValueError()
            if index:
                linked = self._io(os.stat, self._parts[index], dir_fd=self._chain[index - 1][0], follow_symlinks=False)
                if (linked.st_dev, linked.st_ino) != identity:
                    raise ValueError()
        self._walk(self._root, '/')

    def _run(self, operation, *, locked=False, scope_guard=None):
        if self._busy or self._retired:
            self.close()
            _deny()
        self._busy = True
        try:
            self._last = time.monotonic()
            if not math.isfinite(self._last):
                raise ValueError()
            self._deadline = self._last + 30.0
            if locked:
                if not self._journal._busy or scope_guard is not None:
                    raise ValueError()
                self._journal._guard()
                operation()
                self._journal._guard()
            else:
                self._journal._run(operation, scope_guard)
            self._budget()
            # journal._run has now released its scope. Preserve that original
            # shorter scope through this view's final local clock/native tail.
            if scope_guard is not None:
                remaining = scope_guard()
                if type(remaining) not in (int, float) or not math.isfinite(remaining) or remaining <= 0:
                    raise ValueError()
                self._veto()
        except Exception:
            self._retired = True
            _deny()
        finally:
            self._busy = False
            if self._retired:
                self._discard()

    def _check(self):
        self._run(self._verify)

    def _check_locked(self):
        """Only within the original writer's still-held transaction."""
        self._run(self._verify, locked=True)

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

    def __enter__(self):
        self._check()
        return self

    def __exit__(self, *_exc):
        self.close()
