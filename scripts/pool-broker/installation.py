"""Read-only installation snapshot; never a launch authorization or installer."""

import grp
import os
import pwd
import re
import stat
import sys
from dataclasses import dataclass, field


@dataclass(frozen=True, slots=True)
class InstallationIdentity:
    app_gid: int = field(repr=False)
    browser_uid: int = field(repr=False)
    browser_gid: int = field(repr=False)


class InstallationError(ValueError):
    """Fixed private diagnostic; never includes filesystem or NSS data."""


def _deny():
    try:
        raise InstallationError("POOL_BROKER_INSTALLATION_UNPROVEN") from None
    except InstallationError as error:
        error.__context__ = None
        raise


def _id(value):
    return type(value) is int and 0 < value < 4294967295 and value != 65534


def _name(value):
    return type(value) is str and re.fullmatch(r"[a-z_][a-z0-9_-]{0,31}", value) is not None


def _account_fields(account):
    # Deliberately do not touch password or GECOS fields, or compare/print an
    # entire NSS record (which may contain private fields).
    return account.pw_name, account.pw_uid, account.pw_gid, account.pw_dir, account.pw_shell


def _primary_group(gid):
    group = grp.getgrgid(gid)
    if group.gr_gid != gid or not _name(group.gr_name):
        raise ValueError()
    reverse = grp.getgrnam(group.gr_name)
    if (reverse.gr_gid != gid or reverse.gr_name != group.gr_name
            or reverse.gr_mem != group.gr_mem):
        raise ValueError()
    return group


def _unique_snapshot(app, browser, app_group, browser_group):
    # Inspect selected metadata only, never password/GECOS or full-record repr.
    # Enumeration must be supported completely by the deployment's NSS backend;
    # these bounds limit accepted results, not allocation inside the NSS call.
    users, groups = pwd.getpwall(), grp.getgrall()
    if (type(users) is not list or type(groups) is not list
            or not 1 <= len(users) <= 4096 or not 1 <= len(groups) <= 4096):
        raise ValueError()
    for expected in (app, browser):
        matches = [user for user in users
                   if user.pw_uid == expected.pw_uid or user.pw_name == expected.pw_name]
        if len(matches) != 1 or _account_fields(matches[0]) != _account_fields(expected):
            raise ValueError()
    if any(user.pw_gid == browser.pw_gid
           and (user.pw_uid != browser.pw_uid or user.pw_name != browser.pw_name) for user in users):
        raise ValueError()
    for expected in (app_group, browser_group):
        matches = [group for group in groups
                   if group.gr_gid == expected.gr_gid or group.gr_name == expected.gr_name]
        if (len(matches) != 1 or matches[0].gr_gid != expected.gr_gid
                or matches[0].gr_name != expected.gr_name or matches[0].gr_mem != expected.gr_mem):
            raise ValueError()
    for group in groups:
        if type(group.gr_mem) is not list or len(group.gr_mem) > 4096:
            raise ValueError()
        if group.gr_gid != browser.pw_gid and browser.pw_name in group.gr_mem:
            raise ValueError()


def _identities():
    app = pwd.getpwuid(998)
    browser = pwd.getpwnam("holaday-browser-pool")
    if (app.pw_uid != 998 or not _id(app.pw_gid) or not _name(app.pw_name)
            or app.pw_dir != "/var/lib/holaday"
            or _account_fields(pwd.getpwnam(app.pw_name)) != _account_fields(app)
            or browser.pw_name != "holaday-browser-pool"
            or not _id(browser.pw_uid) or browser.pw_uid == 998
            or not _id(browser.pw_gid) or browser.pw_gid in (998, app.pw_gid)
            or browser.pw_dir != "/var/lib/holaday-pool-workers"
            or browser.pw_shell != "/usr/sbin/nologin"
            or _account_fields(pwd.getpwuid(browser.pw_uid)) != _account_fields(browser)):
        raise ValueError()
    app_group = _primary_group(app.pw_gid)
    browser_group = _primary_group(browser.pw_gid)
    if (browser_group.gr_name != "holaday-browser-pool"
            or type(browser_group.gr_mem) is not list
            or any(member != browser.pw_name for member in browser_group.gr_mem)):
        raise ValueError()
    app_groups = os.getgrouplist(app.pw_name, app.pw_gid)
    browser_groups = os.getgrouplist(browser.pw_name, browser.pw_gid)
    if (type(app_groups) is not list or type(browser_groups) is not list
            or any(not _id(gid) for gid in app_groups + browser_groups)
            or app.pw_gid not in app_groups or browser.pw_gid in app_groups
            or set(browser_groups) != {browser.pw_gid}):
        raise ValueError()
    _unique_snapshot(app, browser, app_group, browser_group)
    return InstallationIdentity(app.pw_gid, browser.pw_uid, browser.pw_gid)


def _object(fd, *, uid=0, gid=0, mode=None, regular=False):
    info = os.fstat(fd)
    valid_type = stat.S_ISREG(info.st_mode) if regular else stat.S_ISDIR(info.st_mode)
    bits = stat.S_IMODE(info.st_mode)
    if (not valid_type or info.st_uid != uid or info.st_gid != gid
            or bits & 0o7022 or (mode is not None and bits != mode)
            or (regular and info.st_nlink != 1)):
        raise ValueError()
    attrs = os.listxattr(fd)
    if any(name in attrs for name in (
            "system.posix_acl_access", "system.posix_acl_default", "security.capability")):
        raise ValueError()


def _walk(path, *, uid=0, gid=0, mode=0o700, regular=False):
    fds = []
    failed = True
    try:
        fds.append(os.open("/", os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC | os.O_NOFOLLOW))
        _object(fds[-1])
        parts = path.strip("/").split("/")
        for index, part in enumerate(parts):
            leaf = index == len(parts) - 1
            flags = os.O_RDONLY | os.O_CLOEXEC | os.O_NOFOLLOW
            flags |= os.O_NONBLOCK if leaf and regular else os.O_DIRECTORY
            fds.append(os.open(part, flags, dir_fd=fds[-1]))
            if leaf:
                _object(fds[-1], uid=uid, gid=gid, mode=mode, regular=regular)
            else:
                _object(fds[-1])
        failed = False
    except Exception:
        pass
    finally:
        while fds:
            fd = fds.pop()
            try:
                os.close(fd)
            except Exception:
                # Continue releasing other owned descriptors; this number must
                # not be retried because the kernel may already have reused it.
                failed = True
    if failed:
        _deny()


def inspect_installation(candidate):
    """Inspect fixed candidate paths without reading files or changing the host.

    Root installation/provisioning is separate. A returned snapshot cannot be
    cached as permission to launch, and does not attest to code hashes, locked
    passwords, all login paths, process isolation or application readiness.
    """
    try:
        if (type(candidate) is not str or re.fullmatch(r"[0-9a-f]{40}", candidate) is None
                or candidate == "0" * 40 or sys.platform != "linux" or os.geteuid() != 0
                or not callable(getattr(os, "listxattr", None))):
            raise ValueError()
        identity = _identities()
        package = "/usr/local/lib/holaday-pool-broker/releases/" + candidate
        _walk(package, mode=0o755)
        for name in ("installation.py", "process_pin.py", "protocol.py", "launch_registration.py"):
            _walk(package + "/" + name, mode=0o644, regular=True)
        for path in ("/etc/holaday-pool-broker", "/var/lib/holaday-pool-broker", "/run/holaday-pool-broker"):
            _walk(path)
        _walk("/var/lib/holaday-pool-workers", uid=identity.browser_uid,
              gid=identity.browser_gid)
        return identity
    except Exception:
        pass
    _deny()
