"""Real sshd/ssh, isolated private-network Docker only. Never on production."""
import importlib.util
import hashlib
import json
import os
import pathlib
import shutil
import subprocess
import tempfile
import time

assert pathlib.Path('/.dockerenv').exists() and os.geteuid() == 0
run = lambda args, **kwargs: subprocess.run(args, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, **kwargs)
run(['ip', 'address', 'add', '207.148.70.106/32', 'dev', 'lo'])
base = pathlib.Path('/var/lib/holaday-deploy/channel')
base.mkdir(parents=True, mode=0o700)
entry = base / 'browser-cutover-channel.py'
shutil.copyfile('/source/browser-cutover-channel.py', entry)
entry.chmod(0o600)
if not pathlib.Path('/usr/bin/node').exists():
    shutil.copy2('/opt/node22/bin/node', '/usr/bin/node')
observer = b'export async function readCutoverHostSnapshot() { return {processes:[{pid:process.pid}],searchPath:process.env.PATH,cleanEnvironment:!process.env.INJECTED_QA_ENV}; }\n'
(base / 'browser-cutover-evidence.mjs').write_bytes(observer)
(base / 'observer.sha256').write_text(hashlib.sha256(observer).hexdigest())
for name in ['browser-cutover-evidence.mjs', 'observer.sha256']:
    (base / name).chmod(0o600)
spec = importlib.util.spec_from_file_location('channel', entry)
channel = importlib.util.module_from_spec(spec)
spec.loader.exec_module(channel)
with tempfile.TemporaryDirectory(prefix='cutover-ssh-qa-', dir='/root') as scratch:
    root = pathlib.Path(scratch)
    for name in ['identity', 'host']:
        run(['ssh-keygen', '-q', '-t', 'ed25519', '-N', '', '-f', str(root / name)])
    key = ' '.join((root / 'identity.pub').read_text().split()[:2])
    auth = root / 'authorized_keys'
    auth.write_text(channel.authorized_key_line(key))
    auth.chmod(0o600)
    known = root / 'known_hosts'
    known.write_text('[127.0.0.1]:22222 ' + ' '.join((root / 'host.pub').read_text().split()[:2]) + '\n')
    pathlib.Path('/run/sshd').mkdir(exist_ok=True)
    run(['usermod', '-p', 'x', 'root'])  # Disposable account, not a real password.
    rc = pathlib.Path('/root/.ssh/rc')
    rc.parent.mkdir(mode=0o700, exist_ok=True)
    rc.write_text('touch /tmp/cutover-ssh-user-rc-ran\n')
    config = root / 'sshd_config'
    config.write_text(f'''Port 22222
ListenAddress 127.0.0.1
HostKey {root / 'host'}
PidFile {root / 'sshd.pid'}
AuthorizedKeysFile {auth}
PermitRootLogin prohibit-password
PasswordAuthentication no
KbdInteractiveAuthentication no
UsePAM no
PermitUserEnvironment no
StrictModes yes
LogLevel VERBOSE
''')
    run(['/usr/sbin/sshd', '-t', '-f', str(config)])
    log = open(root / 'sshd.log', 'wb')
    server = subprocess.Popen(['/usr/sbin/sshd', '-D', '-e', '-f', str(config)], stderr=log)
    def ssh(command, extra=None, source='207.148.70.106'):
        return subprocess.run(['ssh', '-F', '/dev/null', '-b', source, '-p', '22222',
            '-i', str(root / 'identity'), '-o', 'IdentitiesOnly=yes', '-o', 'BatchMode=yes',
            '-o', 'StrictHostKeyChecking=yes', '-o', f'UserKnownHostsFile={known}',
            '-o', 'GlobalKnownHostsFile=/dev/null', '-o', 'ConnectTimeout=3',
            *(extra or []), 'root@127.0.0.1', *command],
            input=b'', stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=10)
    try:
        for _ in range(50):
            if (root / 'sshd.pid').exists(): break
            if server.poll() is not None: raise RuntimeError('QA sshd failed')
            time.sleep(.05)
        result = ssh(['holaday-cutover-v1 probe'])
        assert result.returncode == 0, result.stderr.decode() + (root / 'sshd.log').read_text()
        assert json.loads(result.stdout)['actions'] == ['probe', 'observe']
        result = ssh(['holaday-cutover-v1 observe ' + 'a'*32])
        assert result.returncode == 0, result.stderr.decode()
        observation = json.loads(result.stdout)
        assert observation['requestId'] == 'a'*32
        assert observation['sourceCandidate'] is None
        assert observation['snapshot']['searchPath'] == '/usr/sbin:/usr/bin:/sbin:/bin'
        assert observation['sourceDigest'] == hashlib.sha256(observer).hexdigest()
        assert observation['snapshot']['observer'] == observation['snapshot']['processes'][0]
        (base / 'observer.sha256').write_text('0'*64)
        result = ssh(['holaday-cutover-v1 observe ' + 'a'*32])
        assert result.returncode != 0 and b'CUTOVER_CHANNEL_UNPROVEN' in result.stderr
        for command in [[], ['id'], ['sh'], ['scp -t /tmp/stolen'],
                        ['holaday-cutover-v1 probe; touch /tmp/cutover-ssh-escaped'],
                        ['holaday-cutover-v1 execute']]:
            result = ssh(command)
            assert result.returncode != 0 and b'CUTOVER_CHANNEL_UNPROVEN' in result.stderr
        result = ssh(['sftp'], ['-s'])
        assert result.returncode != 0
        result = ssh([], ['-W', '127.0.0.1:22222'])
        assert result.returncode != 0 and b'administratively prohibited' in result.stderr
        result = ssh([], ['-N', '-R', '127.0.0.1:0:127.0.0.1:22222', '-o', 'ExitOnForwardFailure=yes'])
        assert result.returncode != 0 and b'forwarding failed' in result.stderr
        result = ssh(['holaday-cutover-v1 probe'], ['-tt'])
        assert b'PTY allocation request failed' in result.stderr
        result = ssh(['holaday-cutover-v1 probe'], source='127.0.0.1')
        assert result.returncode != 0 and b'Permission denied' in result.stderr
        assert not pathlib.Path('/tmp/cutover-ssh-user-rc-ran').exists()
        assert not pathlib.Path('/tmp/cutover-ssh-escaped').exists()
        print(json.dumps({'probe': 'passed', 'observe': 'passed', 'changedObserver': 'denied', 'arbitraryCommand': 'denied', 'scpSftp': 'denied',
                          'directForward': 'denied', 'remoteForward': 'denied', 'pty': 'denied',
                          'wrongSource': 'denied', 'userRc': 'not-executed'}))
    finally:
        server.terminate()
        server.wait(timeout=5)
        log.close()
