/** Strict first-identity data only; not a business command or opening permit. */
export type BrokerBootFrame = Readonly<{
  version: 2;
  phase: 'boot-hello' | 'boot-challenge' | 'boot-accepted' | 'boot-ack';
  candidate: string;
  boot: string;
  clientNonce: string;
  rootNonce?: string;
  epoch?: string;
}>;
const invalid = () => new Error('POOL_BOOT_FRAME_INVALID');

function payload(value: unknown): Buffer {
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype)
    throw invalid();
  const data: Record<string, unknown> = Object.create(null);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') throw invalid();
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.get || descriptor.set) throw invalid();
    data[key] = descriptor.value;
  }
  if (
    data.version !== 2 ||
    typeof data.phase !== 'string' ||
    !['boot-hello', 'boot-challenge', 'boot-accepted', 'boot-ack'].includes(data.phase)
  )
    throw invalid();
  const fields = ['version', 'phase', 'candidate', 'boot', 'clientNonce'];
  if (data.phase !== 'boot-hello') fields.push('rootNonce', 'epoch');
  fields.sort();
  if (Object.keys(data).sort().join(',') !== fields.join(',')) throw invalid();
  const result: Record<string, unknown> = {};
  for (const name of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(data, name);
    if (!descriptor || descriptor.get || descriptor.set) throw invalid();
    const item = descriptor.value;
    if (
      name !== 'version' &&
      name !== 'phase' &&
      (typeof item !== 'string' ||
        item.length !== (name === 'candidate' ? 40 : 32) ||
        !/^[0-9a-f]+$/.test(item) ||
        /^0+$/.test(item))
    )
      throw invalid();
    result[name] = item;
  }
  if (
    typeof result.phase !== 'string' ||
    (data.phase !== 'boot-hello' && result.clientNonce === result.rootNonce)
  )
    throw invalid();
  return Buffer.from(JSON.stringify(result), 'ascii');
}

export function encodeBrokerBootFrame(value: BrokerBootFrame): Buffer {
  const raw = payload(value);
  const header = Buffer.alloc(4);
  header.writeUInt32BE(raw.length);
  return Buffer.concat([header, raw]);
}

export function decodeBrokerBootFrame(bytes: Buffer): BrokerBootFrame {
  try {
    if (
      !Buffer.isBuffer(bytes) ||
      bytes.length < 5 ||
      bytes.length > 1028 ||
      bytes.readUInt32BE(0) !== bytes.length - 4
    )
      throw invalid();
    const raw = bytes.subarray(4);
    const data: unknown = JSON.parse(raw.toString('utf8'));
    if (!payload(data).equals(raw)) throw invalid();
    return Object.freeze(data as BrokerBootFrame);
  } catch {
    throw invalid();
  }
}
