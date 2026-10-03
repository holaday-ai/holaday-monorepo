"""Real retained files and guard; only Linux kernel/exec boundaries are synthetic."""
import contextlib
import os
import signal
import stat
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import test_quartet_worker_guard as fixture

guard = fixture.guard
NATIVE = fixture.NATIVE
PYTHON = sys.executable


class ExecObserved(BaseException):
    pass


class WorkerExecTests(unittest.TestCase):
    @contextlib.contextmanager
    def system(self, role='brave'):
        helper = fixture.WorkerGuardTests()
        with helper.system(role) as s, contextlib.ExitStack() as stack:
            proxy = guard.os
            s.execs, s.exec_hook, s.fd_extra = [], lambda: None, []
            s.stdio_bad = False
            s.auth = s.credential.rsplit('/', 1)[0] + '/xauthority'
            (s.root / 'usr/bin').mkdir(parents=True)
            (s.root / 'bin').mkdir()
            (s.root / 'profile').mkdir()
            for name in ('Xvfb', 'brave-browser', 'x11vnc', 'websockify', 'python3'):
                path = '/usr/bin/' + name
                (s.root / path[1:]).write_bytes(b'\x7fELF' + b'\0' * 60)
                s.metadata[path] = {'st_mode': stat.S_IFREG | 0o555}
                s.flags[path] = 1
            (s.root / 'bin/sh').write_bytes(b'\x7fELF' + b'\0' * 60)
            s.metadata['/bin/sh'] = {'st_mode': stat.S_IFREG | 0o555}
            s.flags['/bin/sh'] = 1
            s.metadata['/profile'] = {'st_mode': stat.S_IFDIR | 0o700, 'st_uid': 2001, 'st_gid': 2001}
            s.flags['/profile'] = 14
            # One hand-derived Xau FamilyWild/display 99/cookie record.
            (s.root / s.auth[1:]).write_bytes(b'\xff\xff\0\0\0\x02' + b'99' + b'\0\x12MIT-MAGIC-COOKIE-1\0\x10' + b'\x37' * 16)
            s.metadata[s.auth] = {'st_mode': stat.S_IFREG | 0o400, 'st_uid': 2001}
            s.flags[s.auth] = 1
            s.packets = [helper.packet(s, 'challenge'), helper.packet(s, 'grant')]
            old_fstat = proxy.fstat

            def fstat(fd):
                if fd in (0, 1, 2):
                    return SimpleNamespace(st_mode=stat.S_IFCHR, st_rdev=os.makedev(1, 5 if s.stdio_bad else 3))
                if fd not in s.opened:
                    return NATIVE.fstat(fd)
                return old_fstat(fd)

            def listdir(path):
                self.assertEqual(path, '/proc/self/fd')
                return [str(n) for n in (0, 1, 2, *s.opened, *s.fd_extra)]

            def execute(path, argv, env):
                s.execs.append((path, argv, env))
                self.assertEqual(s.packets, [], 'exec must follow the real complete grant exchange')
                self.assertTrue(all(c.closed for c in s.channels))
                self.assertTrue(all(NATIVE.get_inheritable(fd) is False for fd in s.opened))
                s.exec_hook()
                raise ExecObserved()

            for name, value in (('fstat', fstat), ('listdir', listdir), ('execve', execute),
                                ('chdir', lambda path: s.events.append(('cwd', path))),
                                ('umask', lambda mask: s.events.append(('umask', mask)))):
                stack.enter_context(patch.object(proxy, name, value))
            stack.enter_context(patch.object(guard, 'signal', SimpleNamespace(
                valid_signals=lambda: {signal.SIGTERM, signal.SIGINT, signal.SIGKILL, signal.SIGSTOP},
                SIGKILL=signal.SIGKILL, SIGSTOP=signal.SIGSTOP, SIG_DFL=signal.SIG_DFL,
                SIG_SETMASK=signal.SIG_SETMASK,
                signal=lambda *_: None, pthread_sigmask=lambda *_: None), create=True))
            with helper.open(role) as worker:
                self.assertTrue(callable(getattr(worker, '_execute', None)), 'fixed worker exec consumer missing')
                yield s, worker, helper

    def test_four_roles_consume_grant_and_execute_only_fixed_commands(self):
        for role, name in (('xvfb', 'Xvfb'), ('brave', 'brave-browser'), ('x11vnc', 'x11vnc'), ('websockify', 'websockify')):
            with self.system(role) as (s, worker, _):
                with patch.dict(os.environ, {'LD_PRELOAD': 'untrusted', 'API_KEY': 'private'}, clear=True):
                    with self.assertRaises(ExecObserved):
                        worker._execute()
                path, argv, env = s.execs[0]
                self.assertEqual(path, '/usr/bin/' + name)
                self.assertEqual(argv[0], path)
                self.assertEqual(env['HOME'], '/profile')
                self.assertEqual(env['PATH'], '/usr/bin:/bin')
                self.assertNotIn('LD_PRELOAD', env)
                self.assertNotIn('API_KEY', env)
                self.assertNotIn('-ac', argv)
                self.assertNotIn('--no-sandbox', argv)
                self.assertIn(('cwd', '/profile'), s.events)
                self.assertIn(('umask', 0o077), s.events)
                if role == 'brave':
                    self.assertIn('--proxy-server=http://127.0.0.1:18080', argv)
                    self.assertIn('--proxy-bypass-list=<-loopback>', argv)
                    self.assertIn('--remote-debugging-port=19222', argv)
                    self.assertIn('--user-data-dir=/profile', argv)
                elif role == 'xvfb':
                    self.assertEqual(argv[1:], [':99', '-screen', '0', '1280x800x24', '-nolisten', 'tcp', '-auth', s.auth])
                elif role == 'x11vnc':
                    self.assertIn('-auth', argv)
                    self.assertEqual(argv[argv.index('-listen') + 1], '127.0.0.1')
                else:
                    self.assertEqual(argv[1:], ['127.0.0.1:16080', '127.0.0.1:15900'])
                self.assertEqual(len(s.execs), 1)

    def test_no_exec_without_fresh_grant_or_after_consumption(self):
        for mode in ('grant', 'consumed', 'anchor'):
            with self.system('anchor' if mode == 'anchor' else 'brave') as (s, worker, helper):
                if mode == 'grant':
                    s.packets[1] = helper.packet(s, 'grant', 'e' * 64)
                elif mode == 'consumed':
                    worker._await_grant()
                helper.deny(worker._execute)
                helper.deny(worker._execute)
                self.assertEqual(s.execs, [])

    def test_exec_exception_or_return_permanently_closes_consumer(self):
        for returns in (False, True):
            with self.system() as (s, worker, helper):
                def failed(*args):
                    s.execs.append(args)
                    if not returns:
                        raise OSError('sensitive detail')
                with patch.object(guard.os, 'execve', failed):
                    helper.deny(worker._execute)
                    helper.deny(worker._execute)
                self.assertEqual(len(s.execs), 1)
                self.assertEqual(s.opened, {})

    def test_missing_bad_or_changed_authority_denies_without_exec(self):
        for mode in ('missing', 'truncated', 'writable', 'changed'):
            with self.system('xvfb') as (s, worker, helper):
                file = s.root / s.auth[1:]
                if mode == 'missing':
                    file.unlink()
                elif mode == 'truncated':
                    file.write_bytes(b'\xff\xff')
                elif mode == 'writable':
                    s.metadata[s.auth]['st_mode'] = stat.S_IFREG | 0o600
                else:
                    s.hook = lambda event: file.write_bytes(b'changed') if event == 'close' else None
                helper.deny(worker._execute)
                self.assertEqual(s.execs, [])

    def test_weak_profile_and_executable_or_symlink_denied(self):
        for mode in ('profile', 'mount', 'cap', 'symlink'):
            with self.system() as (s, worker, helper):
                path = '/usr/bin/brave-browser'
                if mode == 'profile':
                    s.metadata['/profile']['st_uid'] = 998
                elif mode == 'mount':
                    s.flags[path] = 0
                elif mode == 'cap':
                    s.attrs[path] = ['security.capability']
                else:
                    (s.root / path[1:]).unlink()
                    (s.root / path[1:]).symlink_to('Xvfb')
                helper.deny(worker._execute)
                self.assertEqual(s.execs, [])

    def test_script_requires_fixed_present_immutable_interpreter(self):
        for shebang in (b'#!/bin/sh\n', b'#!/usr/bin/env python3\n', b'#!/tmp/interpreter\n'):
            with self.system() as (s, worker, helper):
                (s.root / 'usr/bin/brave-browser').write_bytes(shebang + b'exit 0\n')
                if shebang == b'#!/bin/sh\n':
                    with self.assertRaises(ExecObserved):
                        worker._execute()
                else:
                    helper.deny(worker._execute)
                    self.assertEqual(s.execs, [])
        with self.system() as (s, worker, helper):
            (s.root / 'usr/bin/brave-browser').write_bytes(b'#!/bin/sh\nexit 0\n')
            (s.root / 'bin/sh').unlink()
            helper.deny(worker._execute)
            self.assertEqual(s.execs, [])

    def test_unknown_inheritable_fds_and_non_null_stdio_denied(self):
        for mode in ('unknown', 'inheritable', 'stdio'):
            with self.system() as (s, worker, helper):
                if mode == 'stdio':
                    s.stdio_bad = True
                elif mode == 'inheritable':
                    NATIVE.set_inheritable(worker._fds[0], True)
                else:
                    unknown = NATIVE.open('/dev/null', NATIVE.O_RDONLY)
                    s.fd_extra.append(unknown)
                try:
                    helper.deny(worker._execute)
                    self.assertEqual(s.execs, [])
                finally:
                    if mode == 'unknown':
                        NATIVE.close(unknown)

    def test_handshake_and_preexec_share_original_five_second_deadline(self):
        with self.system() as (s, worker, helper):
            s.hook = lambda event: setattr(s, 'now', s.now + 6) if event == 'close' else None
            helper.deny(worker._execute)
            self.assertEqual(s.execs, [])

    def test_original_executable_and_profile_replacement_after_grant_denied(self):
        for path in ('usr/bin/brave-browser', 'profile'):
            with self.system() as (s, worker, helper):
                def replace(event):
                    if event != 'close':
                        return
                    original = s.root / path
                    original.rename(original.with_name(original.name + '.old'))
                    if path == 'profile':
                        original.mkdir()
                    else:
                        original.write_bytes(b'\x7fELF' + b'\0' * 60)
                s.hook = replace
                helper.deny(worker._execute)
                self.assertEqual(s.execs, [])

    def test_final_fd_boundary_revocation_or_expiration_prevents_exec(self):
        for mode in ('close', 'expire'):
            with self.system() as (s, worker, helper):
                original = guard.os.listdir
                def revoke(path):
                    result = original(path)
                    if mode == 'close':
                        worker.close()
                    else:
                        s.now += 6
                    return result
                with patch.object(guard.os, 'listdir', revoke):
                    helper.deny(worker._execute)
                self.assertEqual(s.execs, [])

    def test_fd_enumeration_transient_closed_entry_is_not_an_authority(self):
        with self.system() as (s, worker, _):
            s.fd_extra.append(2147483647)  # Actual fstat EBADF, never owned/rebuilt.
            with self.assertRaises(ExecObserved):
                worker._execute()

    def test_real_python_shebang_cannot_load_writable_home_startup_module(self):
        with self.system('websockify') as (s, worker, _):
            script = s.root / 'usr/bin/websockify'
            script.write_bytes(b'#!/usr/bin/python3\nimport sys\nsys.exit(42 if getattr(sys, "_untrusted_startup", False) else 0)\n')
            home = str(s.root / 'profile')
            probe = subprocess.run([PYTHON, '-c', 'import site;print(site.getusersitepackages())'],
                env={'HOME': home, 'PATH': '/usr/bin:/bin'}, capture_output=True, text=True, timeout=5)
            self.assertEqual(probe.returncode, 0)
            site = Path(probe.stdout.strip())
            self.assertTrue(site.is_relative_to(s.root / 'profile'))
            site.mkdir(parents=True)
            (site / 'usercustomize.py').write_text('import sys\nsys._untrusted_startup = True\n')
            # The sentinel is actually executable in an unprotected interpreter.
            control = subprocess.run([PYTHON, str(script)], env={'HOME': home, 'PATH': '/usr/bin:/bin'},
                capture_output=True, timeout=5)
            self.assertEqual(control.returncode, 42)
            with self.assertRaises(ExecObserved):
                worker._execute()
            path, argv, env = s.execs[0]
            mapped = [str(script) if value == '/usr/bin/websockify' else value for value in argv[1:]]
            command = [PYTHON, *mapped] if path == '/usr/bin/python3' else [PYTHON, str(script), *mapped]
            result = subprocess.run(command, env=env | {'HOME': home}, capture_output=True, timeout=5)
            self.assertEqual(result.returncode, 0, 'worker Python loaded a writable HOME startup module')


if __name__ == '__main__':
    unittest.main()
