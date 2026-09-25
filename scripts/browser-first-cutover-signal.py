"""First-cutover unmanaged targets only. PM2 has a separate approved stop path.
The caller must prove journal ownership, fencing and complete work inventory.
No numeric-PID fallback, no SIGKILL and no inferred legacy protocol identity.
"""
import hashlib
import json
import os
import re
import signal
import socket
import sys

KEYS = ('host', 'bootId', 'pid', 'ppid', 'start', 'uids', 'exe', 'cwd', 'argvDigest')


def signal_legacy(target, kernel):
    if not isinstance(target, dict):
        raise RuntimeError('CUTOVER_SIGNAL_INPUT')
    p = target
    legacy = p.get('cwd') == '/opt/holaday-monorepo/apps/orchestrator'
    gateway = bool(re.fullmatch(r'/opt/holaday-cn-payment/releases/[a-f0-9]{12}-[0-9]{14}(?:/apps/cn-payment)?', p.get('cwd', '')))
    if (type(p.get('pid')) is not int or p['pid'] <= 1 or
            type(p.get('ppid')) is not int or p['ppid'] < 1 or
            not re.fullmatch(r'[a-z0-9.-]{1,128}', p.get('host', '')) or
            not re.fullmatch(r'[a-f0-9]{32}', p.get('bootId', '')) or
            not re.fullmatch(r'[0-9]+', p.get('start', '')) or
            p.get('uids') != [998, 998, 998, 998] or
            p.get('exe') != '/opt/node22/bin/node' or
            not re.fullmatch(r'[a-f0-9]{64}', p.get('argvDigest', '')) or
            not ((legacy and p.get('role') in ('main', 'worker')) or (gateway and p.get('role') == 'gateway')) or
            p.get('managerIdentity') != {'kind': 'unmanaged'}):
        raise RuntimeError('CUTOVER_SIGNAL_INPUT')
    descriptor = kernel.open(p['pid'])
    try:
        if kernel.inspect(p['pid']) != {key: p[key] for key in KEYS}:
            raise RuntimeError('CUTOVER_PROCESS_IDENTITY')
        kernel.term(descriptor)
    finally:
        kernel.close(descriptor)


def bounded(path, limit=65536):
    with open(path, 'rb') as stream:
        value = stream.read(limit + 1)
    if len(value) > limit:
        raise RuntimeError('CUTOVER_PROCESS_IDENTITY')
    return value


class LinuxKernel:
    def open(self, pid):
        return os.pidfd_open(pid, 0)

    def inspect(self, pid):
        directory = '/proc/' + str(pid)
        def identity():
            raw = bounded(directory + '/stat').decode('utf-8')
            if not raw.startswith(str(pid) + ' ('):
                raise RuntimeError('CUTOVER_PROCESS_IDENTITY')
            fields = raw[raw.rfind(')') + 2:].split()
            if fields[0] == 'Z':
                raise RuntimeError('CUTOVER_PROCESS_IDENTITY')
            return fields[19], int(fields[1])
        start, parent = identity()
        match = re.search(r'^Uid:\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*$', bounded(directory + '/status').decode('utf-8'), re.M)
        result = dict(host=socket.gethostname(),
                      bootId=bounded('/proc/sys/kernel/random/boot_id', 128).decode().strip().replace('-', ''),
                      pid=pid, ppid=parent, start=start,
                      uids=[int(x) for x in match.groups()] if match else [],
                      exe=os.readlink(directory + '/exe'), cwd=os.readlink(directory + '/cwd'),
                      argvDigest=hashlib.sha256(bounded(directory + '/cmdline')).hexdigest())
        if identity() != (start, parent):
            raise RuntimeError('CUTOVER_PROCESS_IDENTITY')
        return result

    def term(self, descriptor):
        signal.pidfd_send_signal(descriptor, signal.SIGTERM, None, 0)

    def close(self, descriptor):
        os.close(descriptor)


def main(args):
    if sys.platform != 'linux' or os.geteuid() != 0:
        raise RuntimeError('CUTOVER_LINUX_ROOT_REQUIRED')
    if not hasattr(os, 'pidfd_open') or not hasattr(signal, 'pidfd_send_signal'):
        raise RuntimeError('CUTOVER_PIDFD_UNAVAILABLE')
    descriptor = os.pidfd_open(os.getpid(), 0)
    os.close(descriptor)
    if args == ['--check']:
        return
    if args != ['--stdin']:
        raise RuntimeError('CUTOVER_SIGNAL_INPUT')
    raw = sys.stdin.buffer.read(65537)
    if len(raw) > 65536:
        raise RuntimeError('CUTOVER_SIGNAL_INPUT')
    signal_legacy(json.loads(raw.decode('utf-8')), LinuxKernel())


if __name__ == '__main__':
    try:
        main(sys.argv[1:])
    except Exception as error:
        code = str(error)
        print(code if re.fullmatch(r'CUTOVER_[A-Z_]+', code) else 'CUTOVER_SIGNAL_UNPROVEN', file=sys.stderr)
        sys.exit(1)
