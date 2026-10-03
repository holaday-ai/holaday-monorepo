import { createHash } from 'node:crypto';

interface Scope {
  readonly version: 2;
  readonly requestId: string;
  readonly candidate: string;
  readonly boot: string;
  readonly resource: string;
  readonly slot: number;
}
export interface BrokerPreparedFrame extends Scope {
  readonly phase: 'prepared';
  readonly capability: string;
  readonly egressCapability: string;
  readonly nonce: string;
}
export interface BrokerPhaseFrame extends Scope {
  readonly phase: 'accepted' | 'ready';
  readonly preparedDigest: string;
}
export type BrokerControlRequest = Readonly<{
  version: 2;
  requestId: string;
  boot: string;
}> &
  (
    | Readonly<{ action: 'create'; slot: number }>
    | Readonly<{ action: 'query' | 'close'; capability: string }>
  );
export type BrokerControlFrame = BrokerControlRequest | BrokerPreparedFrame | BrokerPhaseFrame;

const invalid = (): never => {
  throw new Error('POOL_BROKER_CONTROL_FRAME_INVALID');
};
function identifier(value: unknown, length: number): void {
  if (
    typeof value !== 'string' ||
    value.length !== length ||
    !/^[0-9a-f]+$/.test(value) ||
    /^0+$/.test(value)
  )
    invalid();
}
function slot(value: unknown): void {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value >= 32) invalid();
}
function keys(data: Record<string, unknown>, fields: string[]): void {
  if (Object.keys(data).sort().join(',') !== fields.sort().join(',')) invalid();
}
function canonical(data: unknown): Buffer {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) invalid();
  const value = data as Record<string, unknown>;
  if (value.version !== 2) invalid();
  identifier(value.requestId, 32);
  identifier(value.boot, 32);
  if ('action' in value) {
    if (!['create', 'query', 'close'].includes(value.action as string)) invalid();
    const create = value.action === 'create';
    keys(value, ['version', 'action', 'requestId', 'boot', create ? 'slot' : 'capability']);
    if (create) slot(value.slot);
    else identifier(value.capability, 64);
  } else {
    if (!['prepared', 'accepted', 'ready'].includes(value.phase as string)) invalid();
    const prepared = value.phase === 'prepared';
    const extra = prepared ? ['capability', 'egressCapability', 'nonce'] : ['preparedDigest'];
    keys(value, [
      'version',
      'phase',
      'requestId',
      'candidate',
      'boot',
      'resource',
      'slot',
      ...extra,
    ]);
    identifier(value.candidate, 40);
    identifier(value.resource, 32);
    slot(value.slot);
    for (const key of extra) identifier(value[key], 64);
    if (prepared && new Set(extra.map((key) => value[key])).size !== 3) invalid();
  }
  const raw = Buffer.from(JSON.stringify(Object.fromEntries(Object.entries(value).sort())));
  if (raw.length === 0 || raw.length > 4096) invalid();
  return raw;
}

/** Data only: no decoded phase grants dispatch, readiness or physical exit. */
export function encodeBrokerControlFrame(data: unknown): Buffer {
  try {
    const raw = canonical(data);
    const prefix = Buffer.alloc(4);
    prefix.writeUInt32BE(raw.length);
    return Buffer.concat([prefix, raw]);
  } catch {
    return invalid();
  }
}

export function decodeBrokerControlFrame(frame: Buffer): BrokerControlFrame {
  try {
    if (
      !Buffer.isBuffer(frame) ||
      frame.length < 5 ||
      frame.length > 4100 ||
      frame.readUInt32BE(0) !== frame.length - 4
    )
      invalid();
    const raw = frame.subarray(4);
    if (raw.some((byte) => byte > 127)) invalid();
    const value: unknown = JSON.parse(raw.toString('ascii'));
    // Exact reencoding also rejects duplicate keys, alternate escapes, whitespace,
    // exponent/negative-zero numbers and a second object after a valid frame.
    if (!canonical(value).equals(raw)) invalid();
    return Object.freeze(value) as BrokerControlFrame;
  } catch {
    return invalid();
  }
}

export function preparedBrokerControlDigest(frame: Buffer): string {
  try {
    const value = decodeBrokerControlFrame(frame);
    if (!('phase' in value) || value.phase !== 'prepared') invalid();
    return createHash('sha256').update(frame).digest('hex');
  } catch {
    return invalid();
  }
}
