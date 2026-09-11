"""Synthetic NSS/filesystem boundaries; never modify real OS identities."""

import contextlib
import os
import stat
import sys
import unittest
from types import SimpleNamespace
from unittest.mock import patch

try:
    import installation
except ModuleNotFoundError as error:
    if error.name != "installation":
        raise
    installation = None


class InstallationTests(unittest.TestCase):
    @contextlib.contextmanager
    def system(self):
        self.assertIsNotNone(installation, "installation preflight missing")
        app = SimpleNamespace(pw_name="holaday", pw_uid=998, pw_gid=998,
                              pw_dir="/var/lib/holaday", pw_shell="/usr/sbin/nologin")
        browser = SimpleNamespace(pw_name="holaday-browser-pool", pw_uid=997, pw_gid=997,
                                  pw_dir="/var/lib/holaday-pool-workers", pw_shell="/usr/sbin/nologin")
        groups = {998: SimpleNamespace(gr_name="holaday", gr_gid=998, gr_mem=[]),
                  997: SimpleNamespace(gr_name="holaday-browser-pool", gr_gid=997, gr_mem=[])}
        paths = {}
        def add(path, uid=0, gid=0, mode=0o755, kind=stat.S_IFDIR):
            parent = os.path.dirname(path)
            if path != "/" and parent not in paths:
                add(parent)
            paths[path] = SimpleNamespace(st_uid=uid, st_gid=gid, st_mode=kind | mode,
                                         st_nlink=1 if kind == stat.S_IFREG else 2, attrs=[])
        package = "/usr/local/lib/holaday-pool-broker/releases/" + "a" * 40
        add(package)
        for name in ("installation.py", "process_pin.py", "protocol.py", "launch_registration.py", "application_guard.py", "root_launch.py"):
            add(package + "/" + name, mode=0o644, kind=stat.S_IFREG)
        for path in ("/etc/holaday-pool-broker", "/var/lib/holaday-pool-broker", "/run/holaday-pool-broker"):
            add(path, mode=0o700)
        add("/var/lib/holaday-pool-workers", uid=997, gid=997, mode=0o700)
        opened, closed, calls = {}, [], []
        serial = [100]
        def open_path(path, flags, *, dir_fd=None):
            target = path if dir_fd is None else opened[dir_fd].rstrip("/") + "/" + path
            calls.append((target, flags, dir_fd))
            if target not in paths:
                raise FileNotFoundError("synthetic private path")
            serial[0] += 1
            opened[serial[0]] = target
            return serial[0]
        def close_fd(fd):
            closed.append(fd)
            del opened[fd]
        with contextlib.ExitStack() as stack:
            stack.enter_context(patch.object(sys, "platform", "linux"))
            mocks = {}
            entries = (
                (installation.os, "geteuid", lambda: 0),
                (installation.pwd, "getpwuid", lambda uid: {998: app, 997: browser}[uid]),
                (installation.pwd, "getpwnam", lambda name: {app.pw_name: app, browser.pw_name: browser}[name]),
                (installation.pwd, "getpwall", lambda: [app, browser]),
                (installation.grp, "getgrgid", lambda gid: groups[gid]),
                (installation.grp, "getgrnam", lambda name: next(g for g in groups.values() if g.gr_name == name)),
                (installation.grp, "getgrall", lambda: list(groups.values())),
                (installation.os, "getgrouplist", lambda name, gid: [gid]),
                (installation.os, "open", open_path),
                (installation.os, "fstat", lambda fd: paths[opened[fd]]),
                (installation.os, "listxattr", lambda fd: paths[opened[fd]].attrs),
                (installation.os, "close", close_fd),
            )
            for target, name, fn in entries:
                mocks[name] = stack.enter_context(patch.object(target, name, side_effect=fn, create=True))
            yield SimpleNamespace(app=app, browser=browser, groups=groups, paths=paths,
                                  opened=opened, closed=closed, calls=calls, mocks=mocks, package=package)

    def test_inspects_fixed_objects_without_leaking_open_descriptors(self):
        with self.system() as s:
            result = installation.inspect_installation("a" * 40)
            self.assertEqual((result.app_gid, result.browser_uid, result.browser_gid), (998, 997, 997))
            self.assertEqual(set(path for path, _, _ in s.calls), set(s.paths))
            self.assertEqual(s.opened, {})
            self.assertNotIn("997", repr(result))
            self.assertNotIn("998", repr(result))

    def reject(self, call):
        with self.assertRaises(ValueError) as caught:
            call()
        self.assertEqual(type(caught.exception).__name__, "InstallationError")
        self.assertEqual(str(caught.exception), "POOL_BROKER_INSTALLATION_UNPROVEN")
        self.assertIsNone(caught.exception.__context__)
        self.assertIsNone(caught.exception.__cause__)

    def inspect(self):
        return installation.inspect_installation("a" * 40)

    def test_invalid_candidate_rejected_before_nss_or_filesystem(self):
        with self.system() as s:
            for candidate in ("", "a" * 39, "A" * 40, "0" * 40, "../" + "a" * 40, None, 123):
                self.reject(lambda: installation.inspect_installation(candidate))
            s.mocks["getpwuid"].assert_not_called()
            s.mocks["open"].assert_not_called()

    def test_non_linux_non_root_or_missing_acl_capability_rejected(self):
        with self.system() as s:
            with patch.object(sys, "platform", "darwin"):
                self.reject(self.inspect)
            s.mocks["geteuid"].side_effect = lambda: 998
            self.reject(self.inspect)
            s.mocks["geteuid"].side_effect = lambda: 0
            with patch.object(installation.os, "listxattr", None):
                self.reject(self.inspect)
            s.mocks["open"].assert_not_called()

    @unittest.skipIf(sys.platform == "linux", "native non-Linux rejection")
    def test_actual_non_linux_is_rejected_without_opening_host_paths(self):
        self.assertIsNotNone(installation)
        self.reject(self.inspect)

    def test_identity_uid_gid_home_and_shell_conflicts_are_rejected(self):
        for role, field, value in (
            ("app", "pw_uid", 999), ("app", "pw_gid", 0), ("app", "pw_dir", "/root"),
            ("browser", "pw_uid", 0), ("browser", "pw_uid", 998), ("browser", "pw_uid", 65534),
            ("browser", "pw_gid", 998), ("browser", "pw_gid", 0), ("browser", "pw_gid", 65534),
            ("browser", "pw_shell", "/bin/bash"), ("browser", "pw_dir", "/var/lib/holaday-browsers"),
            ("browser", "pw_name", "another-user"),
        ):
            with self.subTest(role=role, field=field, value=value), self.system() as s:
                setattr(getattr(s, role), field, value)
                self.reject(self.inspect)
                s.mocks["open"].assert_not_called()

    def test_nss_bidirectional_mismatch_and_extra_members_are_rejected(self):
        for mode in ("uid-name", "gid-name", "group-member", "browser-extra", "main-shared"):
            with self.subTest(mode=mode), self.system() as s:
                if mode == "uid-name":
                    s.mocks["getpwuid"].side_effect = lambda uid: s.app
                elif mode == "gid-name":
                    s.mocks["getgrnam"].side_effect = lambda name: s.groups[998]
                elif mode == "group-member":
                    s.groups[997].gr_mem = ["another-user"]
                elif mode == "browser-extra":
                    s.mocks["getgrouplist"].side_effect = lambda name, gid: [gid, 27]
                else:
                    s.mocks["getgrouplist"].side_effect = lambda name, gid: [998, 997] if name == "holaday" else [997]
                self.reject(self.inspect)
                s.mocks["open"].assert_not_called()

    def test_all_account_lookup_failures_are_fixed_without_private_exception_context(self):
        for name in ("getpwuid", "getpwnam", "getgrgid", "getgrnam", "getgrouplist"):
            with self.subTest(name=name), self.system() as s:
                s.mocks[name].side_effect = OSError("private NSS detail")
                self.reject(self.inspect)
                s.mocks["open"].assert_not_called()

    def test_each_object_owner_mode_type_acl_and_link_violation_rejects(self):
        mutations = (
            ("/usr/local", "st_mode", stat.S_IFDIR | 0o775),
            ("/usr/local", "st_uid", 998),
            ("/usr/local", "st_mode", stat.S_IFLNK | 0o777),
            ("/etc/holaday-pool-broker", "st_mode", stat.S_IFDIR | 0o755),
            ("/var/lib/holaday-pool-broker", "st_gid", 998),
            ("/run/holaday-pool-broker", "attrs", ["system.posix_acl_default"]),
            ("/var/lib/holaday-pool-workers", "st_uid", 998),
            ("/var/lib/holaday-pool-workers", "st_mode", stat.S_IFDIR | 0o750),
        )
        for path, field, value in mutations:
            with self.subTest(path=path, field=field), self.system() as s:
                setattr(s.paths[path], field, value)
                self.reject(self.inspect)
                self.assertEqual(s.opened, {})
        for field, value in (("st_uid", 998), ("st_gid", 998), ("st_nlink", 2),
                              ("st_mode", stat.S_IFREG | 0o666), ("st_mode", stat.S_IFREG | 0o4644),
                              ("st_mode", stat.S_IFIFO | 0o644), ("st_mode", stat.S_IFLNK | 0o644),
                              ("attrs", ["system.posix_acl_access"]), ("attrs", ["security.capability"])):
            with self.subTest(field=field, value=value), self.system() as s:
                setattr(s.paths[s.package + "/process_pin.py"], field, value)
                self.reject(self.inspect)
                self.assertEqual(s.opened, {})

    def test_missing_required_object_fails_without_creating_it(self):
        with self.system() as s:
            del s.paths["/run/holaday-pool-broker"]
            self.reject(self.inspect)
            self.assertEqual(s.opened, {})
            self.assertNotIn("/run/holaday-pool-broker", s.paths)

    def test_guard_must_be_present_and_root_owned(self):
        for missing in (True, False):
            with self.subTest(missing=missing), self.system() as s:
                path = s.package + '/application_guard.py'
                if missing:
                    del s.paths[path]
                else:
                    s.paths[path].st_uid = 998
                self.reject(self.inspect)
                self.assertEqual(s.opened, {})

    def test_root_launcher_must_be_present_and_root_owned(self):
        for missing in (True, False):
            with self.subTest(missing=missing), self.system() as s:
                path = s.package + '/root_launch.py'
                if missing:
                    del s.paths[path]
                else:
                    s.paths[path].st_uid = 998
                self.reject(self.inspect)
                self.assertEqual(s.opened, {})

    def test_open_stat_and_acl_errors_clean_all_acquired_fds(self):
        for name in ("open", "fstat", "listxattr"):
            with self.subTest(name=name), self.system() as s:
                original = s.mocks[name].side_effect
                calls = [0]
                def fail_second(*args, **kwargs):
                    calls[0] += 1
                    if calls[0] == 2:
                        raise OSError("private path detail")
                    return original(*args, **kwargs)
                s.mocks[name].side_effect = fail_second
                self.reject(self.inspect)
                self.assertEqual(s.opened, {})

    def test_close_error_does_not_skip_other_fds_or_retry_closed_numbers(self):
        with self.system() as s:
            original = s.mocks["close"].side_effect
            calls = [0]
            def fail_first(fd):
                original(fd)
                calls[0] += 1
                if calls[0] == 1:
                    raise OSError("private close detail")
            s.mocks["close"].side_effect = fail_first
            self.reject(self.inspect)
            self.assertEqual(s.opened, {})
            self.assertEqual(len(s.closed), len(set(s.closed)))

    def test_checks_actual_opened_objects_and_never_follows_symlinks_or_blocks_on_fifo(self):
        with self.system() as s:
            self.inspect()
            for path, flags, parent in s.calls:
                self.assertTrue(flags & os.O_NOFOLLOW)
                self.assertTrue(flags & os.O_CLOEXEC)
                if path != "/": self.assertIsNotNone(parent)
                if stat.S_ISDIR(s.paths[path].st_mode): self.assertTrue(flags & os.O_DIRECTORY)
                else: self.assertTrue(flags & os.O_NONBLOCK)
            self.assertEqual(s.mocks["fstat"].call_count, len(s.calls))
            self.assertEqual(s.mocks["listxattr"].call_count, len(s.calls))

    def test_caller_exception_is_not_retained(self):
        with self.system():
            try:
                raise RuntimeError("private caller detail")
            except RuntimeError:
                self.reject(lambda: installation.inspect_installation("bad"))

    def test_aliases_and_other_primary_group_members_cannot_hide_behind_nss_lookup(self):
        for mode in ("browser-uid-alias", "app-uid-alias", "browser-name-alias", "other-primary-member",
                     "browser-gid-alias", "app-gid-alias", "browser-group-name-alias", "hidden-supplementary"):
            with self.subTest(mode=mode), self.system() as s:
                users, groups = [s.app, s.browser], list(s.groups.values())
                if mode.endswith("uid-alias"):
                    users.append(SimpleNamespace(pw_name="other", pw_uid=997 if mode.startswith("browser") else 998, pw_gid=996))
                elif mode == "browser-name-alias":
                    users.append(SimpleNamespace(pw_name="holaday-browser-pool", pw_uid=996, pw_gid=996))
                elif mode == "other-primary-member":
                    users.append(SimpleNamespace(pw_name="other", pw_uid=996, pw_gid=997))
                elif mode.endswith("gid-alias"):
                    groups.append(SimpleNamespace(gr_name="other", gr_gid=997 if mode.startswith("browser") else 998, gr_mem=[]))
                elif mode == "browser-group-name-alias":
                    groups.append(SimpleNamespace(gr_name="holaday-browser-pool", gr_gid=996, gr_mem=[]))
                else:
                    groups.append(SimpleNamespace(gr_name="other", gr_gid=996, gr_mem=["holaday-browser-pool"]))
                s.mocks["getpwall"].side_effect = lambda: users
                s.mocks["getgrall"].side_effect = lambda: groups
                self.reject(self.inspect)
                s.mocks["open"].assert_not_called()

    def test_nss_enumeration_error_missing_target_or_excess_results_are_rejected(self):
        for name in ("getpwall", "getgrall"):
            for mode in ("error", "empty", "oversized"):
                with self.subTest(name=name, mode=mode), self.system() as s:
                    if mode == "error": s.mocks[name].side_effect = OSError("private NSS failure")
                    elif mode == "empty": s.mocks[name].side_effect = lambda: []
                    else: s.mocks[name].side_effect = lambda: [None] * 4097
                    self.reject(self.inspect)
                    s.mocks["open"].assert_not_called()


if __name__ == "__main__":
    unittest.main()
