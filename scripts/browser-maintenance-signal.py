"""Signal exactly the observed Linux process, never a later reuse of its PID.

No kill(pid) fallback: unsupported pidfd kernels/Python stop the release.
This helper does not declare drain/exit; its caller must still prove both.
"""
import os
import re
import signal
import sys


def signal_original(pid, start, cwd, role, kernel):
    if (not isinstance(pid, int) or pid <= 1 or
            not isinstance(start, str) or not re.fullmatch(r'[0-9]+', start) or
            not isinstance(cwd, str) or not re.fullmatch(
                r'/opt/holaday-releases/[a-f0-9]{40}/apps/orchestrator', cwd) or
            role not in ('main', 'worker')):
        raise RuntimeError('MAINTENANCE_SIGNAL_INPUT')
    descriptor = kernel.open(pid)
    try:
        actual = kernel.inspect(pid)
        if actual != {'start': start, 'uid': 998, 'cwd': cwd, 'role': role}:
            raise RuntimeError('MAINTENANCE_PROCESS_IDENTITY')
        kernel.term(descriptor)
    finally:
        kernel.close(descriptor)


class LinuxKernel:
    def open(self, pid):
        return os.pidfd_open(pid, 0)

    def inspect(self, pid):
        directory = '/proc/' + str(pid)
        with open(directory + '/stat', encoding='utf-8') as stream:
            stat = stream.read()
        if not stat.startswith(str(pid) + ' ('):
            raise RuntimeError('MAINTENANCE_PROCESS_IDENTITY')
        start = stat[stat.rfind(')') + 2:].split()[19]
        cwd = os.readlink(directory + '/cwd')
        with open(directory + '/status', encoding='utf-8') as stream:
            match = re.search(r'^Uid:\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*$', stream.read(), re.M)
        uid = 998 if match and all(value == '998' for value in match.groups()) else -1
        with open(directory + '/cmdline', 'rb') as stream:
            args = stream.read(16385).split(b'\0')
        args = [value.decode('utf-8') for value in args if value]
        role = None
        for name, entry in [('main', '/src/index.ts'), ('worker', '/dist/account-closure/worker-entry.js')]:
            if args == ['/opt/node22/bin/node', '--import', 'tsx', cwd + entry]:
                role = name
        return {'start': start, 'uid': uid, 'cwd': cwd, 'role': role}

    def term(self, descriptor):
        signal.pidfd_send_signal(descriptor, signal.SIGTERM, None, 0)

    def close(self, descriptor):
        os.close(descriptor)


def main(args):
    if sys.platform != 'linux' or os.geteuid() != 0:
        raise RuntimeError('MAINTENANCE_LINUX_ROOT_REQUIRED')
    if not hasattr(os, 'pidfd_open') or not hasattr(signal, 'pidfd_send_signal'):
        raise RuntimeError('MAINTENANCE_PIDFD_UNAVAILABLE')
    # Exercise kernel support without signalling anything, before closing service.
    descriptor = os.pidfd_open(os.getpid(), 0)
    os.close(descriptor)
    if args == ['--check']:
        return
    if len(args) != 4:
        raise RuntimeError('MAINTENANCE_SIGNAL_INPUT')
    signal_original(int(args[0]), args[1], args[2], args[3], LinuxKernel())


if __name__ == '__main__':
    try:
        main(sys.argv[1:])
    except Exception as error:
        code = str(error)
        print(code if re.fullmatch(r'MAINTENANCE_[A-Z_]+', code) else 'MAINTENANCE_SIGNAL_UNPROVEN', file=sys.stderr)
        sys.exit(1)
