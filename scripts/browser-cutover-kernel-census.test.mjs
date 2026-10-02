import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFirstCutoverCloudRecoveryCensus as read } from './browser-cutover-evidence.mjs';

function recoveryCensusFixture() {
  const boot = '12345678-1234-4234-8234-123456789def';
  const files = new Map([['/proc/sys/kernel/random/boot_id', `${boot}\n`]]);
  const links = new Map();
  const names = ['1', '7', '8', '20', '40', 'self'];
  for (const [pid, state, flags, exe, ppid] of [
    [1, 'S', 0, '/sbin/init', 0],
    [7, 'S', 2097152, '', 0],
    [8, 'Z', 0, '', 1],
    [20, 'S', 0, '/opt/node22/bin/node', 1],
    [40, 'S', 0, '/bin/sleep', 1],
  ]) {
    const fields = [state, String(ppid), ...Array(17).fill('0'), String(pid * 10)];
    fields[6] = String(flags);
    files.set(`/proc/${pid}/stat`, `${pid} (process) ${fields.join(' ')}\n`);
    files.set(
      `/proc/${pid}/status`,
      `State:\t${state}\nPPid:\t${ppid}\nUid:\t0\t0\t0\t0\nNoNewPrivs:\t1\n${['CapInh', 'CapPrm', 'CapEff', 'CapBnd', 'CapAmb'].map((key) => `${key}:\t0000000000000000\n`).join('')}`,
    );
    files.set(`/proc/${pid}/cmdline`, exe ? `${exe}\0private-argument\0` : '');
    files.set(`/proc/${pid}/cgroup`, '0::/shared.slice\n');
    links.set(`/proc/${pid}/exe`, exe);
    links.set(`/proc/${pid}/cwd`, '/');
    links.set(`/proc/${pid}/ns/mnt`, 'mnt:[1]');
  }
  const io = {
    platform: 'linux',
    uid: 0,
    hostname: () => 'native-qa',
    now: () => 1000,
    readdir: async () => [...names],
    readlink: async (path) => {
      assert.ok(links.has(path), path);
      return links.get(path);
    },
    open: async (path) => {
      assert.ok(files.has(path), path);
      const bytes = Buffer.from(files.get(path));
      return {
        read: async (buffer, offset, length, position) => {
          const bytesRead = Math.max(0, Math.min(length, bytes.length - position));
          bytes.copy(buffer, offset, position, position + bytesRead);
          return { bytesRead };
        },
        close: async () => {},
      };
    },
  };
  return { io, files, links, names, boot };
}

function withSecondPass(mode) {
  const f = recoveryCensusFixture();
  let passes = 0;
  if (mode === 'host') f.io.hostname = () => (passes >= 2 ? 'changed' : 'native-qa');
  const readdir = f.io.readdir;
  f.io.readdir = async () => {
    if (++passes === 2) {
      if (mode.endsWith('-add')) {
        const source = mode.startsWith('kernel') ? 7 : mode.startsWith('zombie') ? 8 : 40;
        f.names.push('41');
        for (const key of ['stat', 'status', 'cmdline', 'cgroup']) {
          f.files.set(
            `/proc/41/${key}`,
            f.files.get(`/proc/${source}/${key}`).replace(`${source} (`, '41 ('),
          );
        }
        for (const key of ['exe', 'cwd', 'ns/mnt'])
          f.links.set(`/proc/41/${key}`, f.links.get(`/proc/${source}/${key}`));
      } else if (mode.endsWith('-remove')) {
        f.names.splice(
          f.names.indexOf(mode.startsWith('kernel') ? '7' : mode.startsWith('zombie') ? '8' : '40'),
          1,
        );
      } else if (mode === 'shared-flags') {
        f.files.set('/proc/7/stat', f.files.get('/proc/7/stat').replace('2097152', '2097153'));
      } else if (mode === 'shared-start') {
        f.files.set('/proc/7/stat', f.files.get('/proc/7/stat').replace('70', '71'));
      } else if (mode === 'shared-parent') {
        f.files.set('/proc/7/stat', f.files.get('/proc/7/stat').replace('S 0 ', 'S 1 '));
      } else if (mode === 'kernel-zombie') {
        f.files.set('/proc/7/stat', f.files.get('/proc/7/stat').replace(') S', ') Z'));
      } else if (mode === 'kernel-userspace') {
        f.files.set('/proc/7/stat', f.files.get('/proc/7/stat').replace('2097152', '0'));
        f.files.set('/proc/7/cmdline', '/bin/sleep\0');
        f.links.set('/proc/7/exe', '/bin/sleep');
      } else if (mode === 'user-field') {
        f.files.set('/proc/40/cgroup', '0::/changed.slice\n');
      } else if (mode === 'host') {
        f.io.hostname = () => 'changed';
      } else if (mode === 'boot') {
        f.files.set('/proc/sys/kernel/random/boot_id', '22345678-1234-4234-8234-123456789def\n');
      }
    }
    return readdir();
  };
  if (mode === 'within-kernel-start') {
    const open = f.io.open;
    let reads = 0;
    f.io.open = async (path) => {
      if (path === '/proc/7/stat' && ++reads === 2)
        f.files.set(path, f.files.get(path).replace('70', '71'));
      return open(path);
    };
  }
  return f;
}
for (const mode of ['kernel-add', 'kernel-remove', 'stable']) {
  test(`census accepts only verified unshared kernel churn: ${mode}`, async () => {
    const value = await read(withSecondPass(mode).io);
    assert.deepEqual(
      value.processes.map((row) => row.pid),
      [1, 20, 40],
    );
  });
}
for (const mode of [
  'zombie-add',
  'zombie-remove',
  'user-add',
  'user-remove',
  'shared-flags',
  'shared-start',
  'shared-parent',
  'kernel-zombie',
  'kernel-userspace',
  'user-field',
  'host',
  'boot',
  'within-kernel-start',
]) {
  test(`census still rejects ${mode}`, async () => {
    await assert.rejects(
      read(withSecondPass(mode).io),
      /^Error: CUTOVER_CLOUD_RECOVERY_CENSUS_UNPROVEN$/,
    );
  });
}
