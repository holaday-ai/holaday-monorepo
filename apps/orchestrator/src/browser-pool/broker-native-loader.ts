import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { constants } from 'node:os';
import { isMainThread } from 'node:worker_threads';
import type { OriginalEgressFactory } from './broker-egress-listener.js';
import type { OriginalNativeControlFactory } from './broker-native-control.js';

// Routing metadata only, emitted by the sealed-capsule guard. Import before
// application configuration; no later dotenv value may repair a missing value.
const candidate = process.env.HOLADAY_POOL_CANDIDATE;
const boot = process.env.HOLADAY_POOL_BOOT;
let attempted = false;
// dlopen may cache the /proc/self/fd/N filename. Never reuse either original FD
// during this process, including a partial load failure.
const retained: number[] = [];
const modules = [
  'installation',
  'process_pin',
  'protocol',
  'slot_identity',
  'quartet_protocol',
  'launch_authorization',
  'launch_registration',
  'application_guard',
  'quartet_worker_guard',
  'root_launch',
  'quartet_records',
  'resource_journal',
  'quartet_journal',
  'quartet_root_view',
  'manager_probe',
  'xvfb_launch',
  'quartet_worker_pin',
  'quartet_material',
  'quartet_worker_view',
  'quartet_worker_channel',
  'quartet_launch',
  'quartet_endpoints',
  'quartet_bridge_channel',
  'quartet_egress',
  'quartet_probe_clock',
  'quartet_probe_channel',
  'quartet_create_offer',
  'quartet_runtime',
  'quartet_create_control',
  'quartet_listener',
  'resource_recovery',
  'runtime_channel',
  'launch_listener',
  'bootstrap_input',
];
const files = [
  ...modules.map((name) => `${name}.py`),
  'bootstrap.py',
  'application_env_keys.json',
  'slot-identity-policy.json',
  'rootfs-policy.json',
  'native-entry',
  'root-native-entry',
  'egress-listener.node',
  'control-connector.node',
];
const tools = [
  '/usr/bin/python3',
  '/usr/bin/setpriv',
  '/opt/node22/bin/node',
  '/usr/bin/busctl',
  '/usr/bin/Xvfb',
];
const invalid = () => new Error('POOL_NATIVE_LOAD_UNPROVEN');
function ensure(condition: unknown): asserts condition {
  if (!condition) throw invalid();
}
function record(value: unknown): asserts value is Record<string, unknown> {
  ensure(value !== null && typeof value === 'object' && !Array.isArray(value));
  ensure(Object.getPrototypeOf(value) === Object.prototype);
}
function keys(value: Record<string, unknown>, expected: string[]): void {
  ensure(Object.keys(value).sort().join('\0') === [...expected].sort().join('\0'));
}
function hex(value: unknown, length: number): value is string {
  return typeof value === 'string' && value.length === length && /^[0-9a-f]+$/.test(value);
}
function decodeManifest(bytes: Buffer): Record<string, unknown> {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  // All fields are fixed ASCII names, hashes and integer 1. This additionally
  // rejects duplicate keys and alternate escaped representations, but permits
  // the whitespace emitted by the root Python manifest builder.
  let quoted = false;
  let escaped = false;
  let compact = '';
  for (const character of text) {
    if (quoted || !/\s/.test(character)) compact += character;
    if (escaped) escaped = false;
    else if (quoted && character === '\\') escaped = true;
    else if (character === '"') quoted = !quoted;
  }
  const value: unknown = JSON.parse(text);
  record(value);
  ensure(compact === JSON.stringify(value));
  keys(value, ['version', 'status', 'candidate', 'architecture', 'files', 'tools']);
  ensure(value.version === 1 && value.status === 'linux-verified' && value.candidate === candidate);
  ensure(value.architecture === (process.arch === 'x64' ? 'x86_64' : 'aarch64'));
  record(value.files);
  keys(value.files, files);
  for (const digest of Object.values(value.files)) ensure(hex(digest, 64));
  record(value.tools);
  keys(value.tools, tools);
  for (const tool of tools) {
    const item = value.tools[tool];
    record(item);
    keys(item, ['resolved', 'sha256']);
    ensure(hex(item.sha256, 64));
    ensure(
      item.resolved === tool ||
        (tool === '/usr/bin/python3' &&
          typeof item.resolved === 'string' &&
          /^\/usr\/bin\/python3\.[0-9]+$/.test(item.resolved)),
    );
  }
  return value;
}
type Held = { fd: number; path: string; stat: fs.Stats; regular: boolean };
function metadata(stat: fs.Stats, regular: boolean): void {
  for (const value of [stat.dev, stat.ino, stat.mode, stat.uid, stat.gid, stat.nlink, stat.size])
    ensure(Number.isSafeInteger(value) && value >= 0);
  ensure(stat.uid === 0 && stat.gid === 0 && !(stat.mode & 0o7022));
  ensure(
    regular
      ? stat.isFile() && stat.nlink === 1 && (stat.mode & 0o7777) === 0o644
      : stat.isDirectory() && (stat.mode & 0o005) === 0o005,
  );
}
function same(first: fs.Stats, second: fs.Stats): boolean {
  return (
    ['dev', 'ino', 'mode', 'uid', 'gid', 'nlink', 'size', 'mtimeMs', 'ctimeMs'] as const
  ).every((name) => first[name] === second[name]);
}

/** Fixed original artifacts only. This does not authorize a launch or enable a lane.
 * Root bootstrap independently checks ACLs/capabilities, every source and tool;
 * Linux artifact verification must reject unapproved ELF dependencies and RPATH.
 * The installed candidate must remain immutable throughout this process.
 */
export function loadOriginalBrokerNative(): Readonly<{
  candidate: string;
  boot: string;
  egress: OriginalEgressFactory;
  control: OriginalNativeControlFactory;
}> {
  if (attempted) throw invalid();
  attempted = true;
  const held: Held[] = [];
  let dispatched = false;
  try {
    ensure(
      process.platform === 'linux' &&
        isMainThread &&
        (process.arch === 'x64' || process.arch === 'arm64'),
    );
    // CVE-2026-58044: earlier parsers can silently omit security headers.
    // Fixed 22.x line starts at 22.23.2; major-version identity alone is not enough.
    const node = /^22\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(process.versions.node);
    const minor = Number(node?.[1]);
    const patch = Number(node?.[2]);
    ensure(
      node !== null &&
        Number.isSafeInteger(minor) &&
        Number.isSafeInteger(patch) &&
        (minor > 23 || (minor === 23 && patch >= 2)) &&
        process.execPath === '/opt/node22/bin/node',
    );
    ensure(process.getuid?.() === 998 && process.geteuid?.() === 998);
    const gid = process.getgid?.();
    ensure(
      Number.isSafeInteger(gid) &&
        gid !== undefined &&
        gid > 0 &&
        gid < 4294967295 &&
        gid !== 65534,
    );
    ensure(process.getegid?.() === gid && process.getgroups?.().every((value) => value === gid));
    ensure(hex(candidate, 40) && !/^0+$/.test(candidate) && hex(boot, 32) && !/^0+$/.test(boot));
    let last = performance.now();
    const deadline = last + 5000;
    const clock = () => {
      const now = performance.now();
      ensure(Number.isFinite(now) && now >= last && now < deadline);
      last = now;
    };
    const check = () => {
      clock();
      for (const item of held) {
        const original = fs.fstatSync(item.fd);
        metadata(original, item.regular);
        const named = fs.lstatSync(item.path);
        metadata(named, item.regular);
        ensure(same(original, item.stat) && same(original, named));
      }
      clock();
    };
    const open = (path: string, regular: boolean): Held => {
      clock();
      const fd = fs.openSync(
        path,
        fs.constants.O_RDONLY |
          fs.constants.O_NOFOLLOW |
          (regular ? fs.constants.O_NONBLOCK : fs.constants.O_DIRECTORY),
      );
      // Own immediately, even if metadata inspection throws.
      const item: Held = { fd, path, stat: undefined as unknown as fs.Stats, regular };
      held.push(item);
      item.stat = fs.fstatSync(fd);
      metadata(item.stat, regular);
      check();
      return item;
    };
    let parent = open('/', false);
    for (const part of ['usr', 'local', 'lib', 'holaday-pool-broker', 'releases', candidate])
      parent = open(`/proc/self/fd/${parent.fd}/${part}`, false);
    const read = (item: Held, limit: number): Buffer => {
      check();
      ensure(item.stat.size > 0 && item.stat.size <= limit);
      const result = Buffer.alloc(item.stat.size);
      let offset = 0;
      while (offset < result.length) {
        clock();
        const size = fs.readSync(item.fd, result, offset, result.length - offset, offset);
        ensure(size > 0);
        offset += size;
      }
      ensure(fs.readSync(item.fd, Buffer.alloc(1), 0, 1, result.length) === 0);
      check();
      return result;
    };
    const manifestFile = open(`/proc/self/fd/${parent.fd}/native-build-manifest.json`, true);
    const manifest = decodeManifest(read(manifestFile, 65536));
    record(manifest.files);
    const digests = manifest.files;
    const artifacts = ['egress-listener.node', 'control-connector.node'].map((name) => {
      const file = open(`/proc/self/fd/${parent.fd}/${name}`, true);
      ensure(createHash('sha256').update(read(file, 262144)).digest('hex') === digests[name]);
      return file;
    });
    // Verify both before either native module can execute. Keep all originals,
    // including the parent chain, so no loader filename is recycled.
    check();
    const loaded = artifacts.map((item, index) => {
      check();
      const module = { exports: {} as unknown };
      dispatched = true;
      process.dlopen(module, `/proc/self/fd/${item.fd}`, constants.dlopen.RTLD_NOW);
      check();
      record(module.exports);
      const name = index === 0 ? 'createListener' : 'connectControl';
      ensure(Object.isFrozen(module.exports) && Reflect.ownKeys(module.exports).length === 1);
      const descriptor = Object.getOwnPropertyDescriptor(module.exports, name);
      ensure(
        descriptor && typeof descriptor.value === 'function' && !descriptor.get && !descriptor.set,
      );
      return module.exports;
    });
    check();
    retained.push(...held.map((item) => item.fd));
    return Object.freeze({
      candidate,
      boot,
      egress: loaded[0] as unknown as OriginalEgressFactory,
      control: loaded[1] as unknown as OriginalNativeControlFactory,
    });
  } catch {
    if (dispatched) retained.push(...held.map((item) => item.fd));
    else
      for (const item of held.reverse()) {
        try {
          fs.closeSync(item.fd);
        } catch {
          /* no old-FD retry */
        }
      }
    throw invalid();
  }
}
